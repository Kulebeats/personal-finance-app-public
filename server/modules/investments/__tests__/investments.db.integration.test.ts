/**
 * Investments Module - Database Integration Tests
 *
 * Tests account ownership validation and transaction conditional validation
 * using real database operations with proper cleanup.
 *
 * Test Categories:
 * 1. Account Ownership Validation (H1 fixes)
 * 2. Transaction Conditional Validation (H2 fixes)
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { db, pool } from "../../../db";
import { eq, inArray } from "drizzle-orm";
import {
  users,
  households,
  householdMembers,
  accounts,
  securities,
  holdings,
  auditLogs,
  householdFxRateOverrides,
} from "@shared/schema";
import {
  getTestApp,
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { randomUUID } from "crypto";
import { seedDatedFxRate } from "../../../testing/fixtures/dated-fx-rate";
import type { FieldError } from "../../../core/errors/ValidationError";

describe("Investments Module - Database Integration Tests", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;
  let accountId: string;
  let secondaryAccountId: string;
  let securityId: string;
  let secondarySecurityId: string;
  let holdingId: string;

  // Other household for cross-household attack tests
  let otherHouseholdId: string;
  let otherUserId: string;
  let otherAccountId: string;
  let otherAuthCookie: string;

  const timestamp = Date.now();

  beforeAll(async () => {
    app = await getTestApp();

    // =========================================================================
    // Primary Household Setup
    // =========================================================================
    const testUser = createTestUser({
      email: `invest-test-${timestamp}@example.com`,
      username: `invest-test-user-${timestamp}`,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "Investment Test Household",
    });

    const passwordHash = await hashPassword("TestPassword123");
    testUser.passwordHash = passwordHash;
    householdId = testHousehold.id;
    userId = testUser.id;
    testUser.householdId = testHousehold.id;

    await db.insert(households).values({
      id: testHousehold.id,
      name: testHousehold.name,
      currency: testHousehold.currency,
    });

    await db.insert(users).values({
      id: testUser.id,
      email: testUser.email,
      username: testUser.username,
      passwordHash: testUser.passwordHash,
      fullName: testUser.fullName,
      emailVerified: testUser.emailVerified,
      mfaEnabled: testUser.mfaEnabled,
      failedLoginAttempts: testUser.failedLoginAttempts,
      lockedUntil: testUser.lockedUntil,
    });

    await db.insert(householdMembers).values({
      householdId: testHousehold.id,
      userId: testUser.id,
      role: "admin",
    });

    // Create investment account for primary household
    accountId = randomUUID();
    await db.insert(accounts).values({
      id: accountId,
      householdId,
      name: "Test Investment Account",
      type: "investment",
      balance: "10000.00",
      currency: "USD",
    });

    secondaryAccountId = randomUUID();
    await db.insert(accounts).values({
      id: secondaryAccountId,
      householdId,
      name: "Secondary Investment Account",
      type: "investment",
      balance: "5000.00",
      currency: "USD",
    });

    // Create a security
    securityId = randomUUID();
    await db.insert(securities).values({
      id: securityId,
      symbol: "AAPL",
      name: "Apple Inc",
      type: "stock",
      currency: "USD",
      currentPrice: "150.00",
    });

    secondarySecurityId = randomUUID();
    await db.insert(securities).values({
      id: secondarySecurityId,
      symbol: "MSFT",
      name: "Microsoft",
      type: "stock",
      currency: "USD",
      currentPrice: "300.00",
    });

    // NEW-21: foreign trades need a dated rate; this suite claims none, so a synthetic 20.
    await seedDatedFxRate(householdId, testUser.id, "20");

    // Authenticate primary user
    const loginRes = await request(app).post("/api/auth/login").send({
      email: testUser.email,
      password: "TestPassword123",
    });
    authCookie = loginRes.headers["set-cookie"][0];

    // =========================================================================
    // Other Household Setup (for cross-household attack tests)
    // =========================================================================
    const otherUser = createTestUser({
      email: `invest-other-${timestamp}@example.com`,
      username: `invest-other-user-${timestamp}`,
    });
    const otherHousehold = createTestHousehold(otherUser.id, {
      name: "Other Investment Household",
    });

    const otherPasswordHash = await hashPassword("OtherPassword123");
    otherUser.passwordHash = otherPasswordHash;
    otherHouseholdId = otherHousehold.id;
    otherUserId = otherUser.id;
    otherUser.householdId = otherHousehold.id;

    await db.insert(households).values({
      id: otherHousehold.id,
      name: otherHousehold.name,
      currency: otherHousehold.currency,
    });

    await db.insert(users).values({
      id: otherUser.id,
      email: otherUser.email,
      username: otherUser.username,
      passwordHash: otherUser.passwordHash,
      fullName: otherUser.fullName,
      emailVerified: otherUser.emailVerified,
      mfaEnabled: otherUser.mfaEnabled,
      failedLoginAttempts: otherUser.failedLoginAttempts,
      lockedUntil: otherUser.lockedUntil,
    });

    await db.insert(householdMembers).values({
      householdId: otherHousehold.id,
      userId: otherUser.id,
      role: "admin",
    });

    // Create investment account for other household
    otherAccountId = randomUUID();
    await db.insert(accounts).values({
      id: otherAccountId,
      householdId: otherHouseholdId,
      name: "Other Investment Account",
      type: "investment",
      balance: "5000.00",
      currency: "USD",
    });

    // Authenticate other user
    const otherLoginRes = await request(app).post("/api/auth/login").send({
      email: otherUser.email,
      password: "OtherPassword123",
    });
    otherAuthCookie = otherLoginRes.headers["set-cookie"][0];
  });

  afterAll(async () => {
    // Actor-only audits and Express session payloads have no household cascade.
    // Remove only this fixture's records before deleting their actor rows.
    const actorIds = [userId, otherUserId];
    await pool.query('delete from "session" where sess->>\'userId\'=ANY($1::text[]) or sess->>\'mfaPendingUserId\'=ANY($1::text[])', [actorIds]);
    await db.delete(auditLogs).where(inArray(auditLogs.userId, actorIds));
    // Cleanup in reverse dependency order
    await db.delete(householdFxRateOverrides).where(eq(householdFxRateOverrides.householdId, householdId));
    await db.delete(holdings).where(eq(holdings.householdId, householdId));
    await db.delete(holdings).where(eq(holdings.householdId, otherHouseholdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, otherHouseholdId));
    await db
      .delete(householdMembers)
      .where(eq(householdMembers.householdId, householdId));
    await db
      .delete(householdMembers)
      .where(eq(householdMembers.householdId, otherHouseholdId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(users).where(eq(users.id, otherUserId));
    await db.delete(households).where(eq(households.id, householdId));
    await db.delete(households).where(eq(households.id, otherHouseholdId));
    await db.delete(securities).where(eq(securities.id, securityId));
    await db.delete(securities).where(eq(securities.id, secondarySecurityId));
  });

  // ===========================================================================
  // H1: Account Ownership Validation Tests
  // ===========================================================================

  describe("H1: Account Ownership Validation", () => {
    it("should reject creating holding with another household's account", async () => {
      const response = await request(app)
        .post("/api/investments/holdings")
        .set("Cookie", authCookie)
        .send({
          operationId: randomUUID(), expectedCurrency: "USD",
          accountId: otherAccountId, // Other household's account
          securityId,
          quantity: "100",
          costBasis: "10000.00",
          acquiredDate: "2026-01-15",
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain("Account not found");

      // Verify no holding was created
      const dbHoldings = await db
        .select()
        .from(holdings)
        .where(eq(holdings.accountId, otherAccountId));
      expect(dbHoldings).toHaveLength(0);
    });

    it("should allow creating holding with own household's account", async () => {
      const response = await request(app)
        .post("/api/investments/holdings")
        .set("Cookie", authCookie)
        .send({
          operationId: randomUUID(), expectedCurrency: "USD",
          accountId, // Own household's account
          securityId,
          quantity: "50",
          costBasis: "7500.00",
          acquiredDate: "2026-01-20",
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.accountId).toBe(accountId);

      // Save holding ID for later tests
      holdingId = response.body.data.id;

      // Verify holding was created in DB
      const [dbHolding] = await db
        .select()
        .from(holdings)
        .where(eq(holdings.id, holdingId));
      expect(dbHolding).toBeDefined();
      expect(dbHolding.householdId).toBe(householdId);
    });

    it("should reject creating transaction with another household's account", async () => {
      // Use a "fee" transaction: it only requires amount, so it passes schema
      // validation and reaches the service-layer account-ownership check (404).
      // (dividend/buy/etc. would fail schema validation first with a 400 before
      // ownership is ever evaluated.)
      const response = await request(app)
        .post("/api/investments/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId: otherAccountId, // Other household's account
          type: "fee",
          amount: "100.00",
          currency: "USD",
          transactionDate: "2026-01-25",
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain("Account not found");
    });

    it("should reject creating transaction with another household's holding", async () => {
      // First, create a holding in the other household
      const otherHoldingRes = await request(app)
        .post("/api/investments/holdings")
        .set("Cookie", otherAuthCookie)
        .send({
          operationId: randomUUID(), expectedCurrency: "USD",
          accountId: otherAccountId,
          securityId,
          quantity: "25",
          costBasis: "3750.00",
          acquiredDate: "2026-01-20",
        });
      const otherHoldingId = otherHoldingRes.body.data.id;

      // Try to create transaction with other household's holding
      const response = await request(app)
        .post("/api/investments/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId, // Own account
          holdingId: otherHoldingId, // Other household's holding
          securityId,
          type: "sell",
          quantity: "10",
          price: "160.00",
          amount: "1600.00",
          currency: "USD",
          transactionDate: "2026-01-25",
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain("Holding not found");

      // Cleanup
      await db.delete(holdings).where(eq(holdings.id, otherHoldingId));
    });

    it("should reject transaction when holding does not belong to account", async () => {
      const response = await request(app)
        .post("/api/investments/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId: secondaryAccountId,
          holdingId, // Belongs to primary accountId
          securityId,
          type: "sell",
          quantity: "5",
          price: "160.00",
          amount: "800.00",
          currency: "USD",
          transactionDate: "2026-01-26",
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain("Holding not found");
    });

    it("should reject transaction when holding does not match security", async () => {
      const response = await request(app)
        .post("/api/investments/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId,
          holdingId,
          securityId: secondarySecurityId, // Mismatched security
          type: "sell",
          quantity: "5",
          price: "160.00",
          amount: "800.00",
          currency: "USD",
          transactionDate: "2026-01-26",
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain("Holding not found");
    });
  });

  // ===========================================================================
  // H2: Transaction Conditional Validation Tests
  // ===========================================================================

  describe("H2: Transaction Conditional Validation", () => {
    it("should reject buy transaction without holdingId", async () => {
      const response = await request(app)
        .post("/api/investments/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId,
          securityId,
          type: "buy",
          // Missing: holdingId
          quantity: "10",
          price: "150.00",
          amount: "1500.00",
          currency: "USD",
          transactionDate: "2026-01-26",
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.fields).toBeDefined();
      const errors: FieldError[] = response.body.error.fields;
      const holdingIdError = errors.find((e) => e.field === "holdingId");
      expect(holdingIdError).toBeDefined();
      expect(holdingIdError?.message).toContain("holdingId is required for buy");
    });

    it("should reject buy transaction without quantity", async () => {
      const response = await request(app)
        .post("/api/investments/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId,
          securityId,
          holdingId,
          type: "buy",
          // Missing: quantity
          price: "150.00",
          amount: "1500.00",
          currency: "USD",
          transactionDate: "2026-01-26",
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      const errors: FieldError[] = response.body.error.fields;
      const quantityError = errors.find((e) => e.field === "quantity");
      expect(quantityError).toBeDefined();
      expect(quantityError?.message).toContain("quantity is required for buy");
    });

    it("should reject buy transaction without price", async () => {
      const response = await request(app)
        .post("/api/investments/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId,
          securityId,
          holdingId,
          type: "buy",
          quantity: "10",
          // Missing: price
          amount: "1500.00",
          currency: "USD",
          transactionDate: "2026-01-26",
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      const errors: FieldError[] = response.body.error.fields;
      const priceError = errors.find((e) => e.field === "price");
      expect(priceError).toBeDefined();
      expect(priceError?.message).toContain("price is required for buy");
    });

    it("should accept valid buy transaction with all required fields", async () => {
      const response = await request(app)
        .post("/api/investments/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId,
          securityId,
          holdingId,
          type: "buy",
          quantity: "10",
          price: "150.00",
          amount: "1500.00",
          currency: "USD",
          transactionDate: "2026-01-26",
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.type).toBe("buy");
      // quantity is a decimal(18,8) column, so the driver returns it as a
      // full-precision string ("10.00000000"), not "10".
      expect(response.body.data.quantity).toBe("10.00000000");

      // Verify holding quantity was updated (50 + 10 = 60)
      const [updatedHolding] = await db
        .select()
        .from(holdings)
        .where(eq(holdings.id, holdingId));
      expect(updatedHolding.quantity).toBe("60.00000000");
    });

    it("should reject sell transaction without required fields", async () => {
      const response = await request(app)
        .post("/api/investments/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId,
          type: "sell",
          // Missing: holdingId, securityId, quantity, price
          amount: "800.00",
          currency: "USD",
          transactionDate: "2026-01-27",
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      const errors: FieldError[] = response.body.error.fields;
      expect(errors.length).toBeGreaterThanOrEqual(4);
    });

    it("should reject dividend transaction without holdingId", async () => {
      const response = await request(app)
        .post("/api/investments/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId,
          securityId,
          type: "dividend",
          // Missing: holdingId
          amount: "50.00",
          currency: "USD",
          transactionDate: "2026-01-28",
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      const errors: FieldError[] = response.body.error.fields;
      const holdingIdError = errors.find((e) => e.field === "holdingId");
      expect(holdingIdError).toBeDefined();
      expect(holdingIdError?.message).toContain("holdingId is required for dividend");
    });

    it("should accept fee transaction without holdingId/quantity/price", async () => {
      const response = await request(app)
        .post("/api/investments/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId,
          type: "fee",
          amount: "9.99",
          currency: "USD",
          transactionDate: "2026-01-28",
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.type).toBe("fee");
    });

    it("should reject split transaction without quantity", async () => {
      const response = await request(app)
        .post("/api/investments/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId,
          holdingId,
          type: "split",
          // Missing: quantity (split ratio)
          amount: "0.00",
          currency: "USD",
          transactionDate: "2026-01-29",
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      const errors: FieldError[] = response.body.error.fields;
      const quantityError = errors.find((e) => e.field === "quantity");
      expect(quantityError).toBeDefined();
      expect(quantityError?.message).toContain("quantity is required for split");
    });

    it("should reject transfer_in without securityId and quantity", async () => {
      const response = await request(app)
        .post("/api/investments/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId,
          type: "transfer_in",
          // Missing: securityId, quantity
          amount: "1000.00",
          currency: "USD",
          transactionDate: "2026-01-29",
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      const errors: FieldError[] = response.body.error.fields;
      expect(errors.length).toBeGreaterThanOrEqual(2);
      const securityError = errors.find((e) => e.field === "securityId");
      const quantityError = errors.find((e) => e.field === "quantity");
      expect(securityError).toBeDefined();
      expect(quantityError).toBeDefined();
    });
  });
});
