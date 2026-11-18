/**
 * Packet P8b (DPA audit edges): transaction UPDATE audit must live at the
 * service layer only, not also in the transactions controller — REAL DB.
 *
 * Audit finding: `transactionService.updateTransaction`
 * (server/services/transaction/service.ts) already writes an UPDATE audit
 * row unconditionally, AND `transactions.controller.ts`'s `update` /
 * `updateOwner` / `markReviewed` / `markUnreviewed` handlers EACH ALSO called
 * `businessAuditService.logUpdate` separately. Every HTTP update therefore
 * wrote TWO audit rows for the same change — audit-log noise that makes the
 * DPA trail harder to read/trust. `updateOwner` and `markReviewed` /
 * `markUnreviewed` route through `updateTransaction` internally, so they were
 * double-audited too, and so were the bulk-owner / bulk-category / bulk-review
 * endpoints (one extra batched audit call per successful item, on top of the
 * one updateTransaction already wrote per item).
 *
 * The fix (mirroring P6a's CREATE/DELETE shape) keeps the audit at the
 * SERVICE layer (so controller-bypassing callers stay audited) and removes
 * every controller-level `logUpdate` call, threading `ipAddress` (and, where
 * the controller had richer context, `metadata`) into the service calls
 * instead.
 *
 * These tests run the real service/repository against real Postgres:
 *  (a) UPDATE via the SERVICE directly (bypassing the controller) writes a
 *      single UPDATE auditLogs row.
 *  (b) PUT /api/transactions/:id (through the controller) writes EXACTLY ONE
 *      UPDATE row — proves the controller's old separate audit call was
 *      removed, not left to double-audit alongside the service-level one.
 *  (c) PUT /api/transactions/:id/owner writes EXACTLY ONE UPDATE row.
 *  (d) PUT /api/transactions/:id/review (reviewed=true and reviewed=false)
 *      each write EXACTLY ONE UPDATE row.
 *  (e) PUT /api/transactions/bulk-owner, /bulk-category and /bulk-review
 *      each write EXACTLY ONE UPDATE row per transaction (not two).
 *
 * @module services/transaction/__tests__/p8b-update-audit.realdb.integration.test
 */
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../../../db";
import {
  users,
  households,
  householdMembers,
  accounts,
  transactions,
  categories,
  auditLogs,
} from "@shared/schema";
import {
  getTestApp,
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { transactionService } from "../service";

describe("Transaction UPDATE audit lives ONLY at the service layer (P8b) — REAL DB", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;
  let accountId: string;
  let categoryId: string;

  const timestamp = Date.now();

  beforeAll(async () => {
    app = await getTestApp();

    const testUser = createTestUser({
      email: `p8b-${timestamp}@example.com`,
      username: `p8b-user-${timestamp}`,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "P8b Household",
      currency: "ZMW",
    });
    testUser.passwordHash = await hashPassword("TestPassword123");
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

    accountId = randomUUID();
    await db.insert(accounts).values({
      id: accountId,
      householdId,
      name: "P8b Checking",
      type: "checking",
      balance: "10000.00",
      currency: "ZMW",
      isAsset: true,
    });

    categoryId = randomUUID();
    await db.insert(categories).values({
      id: categoryId,
      householdId,
      name: "P8b Test Category",
      displayOrder: 0,
    });

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: testUser.email, password: "TestPassword123" })
      .expect(200);
    authCookie = loginRes.headers["set-cookie"]
      ? (loginRes.headers["set-cookie"] as unknown as string[]).join("; ")
      : "";
  });

  afterAll(async () => {
    try {
      await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
      await db
        .delete(transactions)
        .where(eq(transactions.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, householdId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("P8b cleanup error", error);
    }
  });

  const auditRowsFor = async (entityId: string) =>
    db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "transaction"),
          eq(auditLogs.entityId, entityId),
          eq(auditLogs.action, "UPDATE"),
        ),
      );

  const seedTransaction = async (name: string, amount = "10.00") => {
    const { transaction } = await transactionService.createTransaction(
      {
        accountId,
        amount,
        currency: "ZMW",
        type: "expense",
        date: "2026-04-01",
        name,
      },
      householdId,
      userId,
    );
    return transaction;
  };

  describe("Service-layer update (bypasses the controller)", () => {
    it("writes a single UPDATE auditLogs row even when called directly from the service", async () => {
      const transaction = await seedTransaction("Service-direct seed");

      await transactionService.updateTransaction(
        transaction.id,
        { name: "Service-direct renamed" },
        householdId,
        userId,
      );

      const rows = await auditRowsFor(transaction.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].householdId).toBe(householdId);
      expect(rows[0].userId).toBe(userId);
    });
  });

  describe("HTTP controller path writes exactly ONE row (no double-audit)", () => {
    it("PUT /api/transactions/:id writes exactly one UPDATE row", async () => {
      const transaction = await seedTransaction("HTTP update seed");

      const res = await request(app)
        .put(`/api/transactions/${transaction.id}`)
        .set("Cookie", authCookie)
        .send({ name: "HTTP update - single audit row" })
        .expect(200);

      expect(res.body.success).toBe(true);
      const rows = await auditRowsFor(transaction.id);
      expect(rows).toHaveLength(1);
      // The service-level audit captures the request's IP via the
      // auditContext threaded through from the controller.
      expect(rows[0].ipAddress).toBeDefined();
    });

    it("PUT /api/transactions/:id/owner writes exactly one UPDATE row", async () => {
      // createTransaction defaults ownerUserId to the creator (userId);
      // clear it to null so the update is a genuine, observable change.
      const transaction = await seedTransaction("HTTP owner-update seed");

      const res = await request(app)
        .put(`/api/transactions/${transaction.id}/owner`)
        .set("Cookie", authCookie)
        .send({ ownerUserId: null })
        .expect(200);

      expect(res.body.success).toBe(true);
      const rows = await auditRowsFor(transaction.id);
      expect(rows).toHaveLength(1);
    });

    it("PUT /api/transactions/:id/review writes exactly one UPDATE row (mark reviewed)", async () => {
      const transaction = await seedTransaction("HTTP mark-reviewed seed");

      const res = await request(app)
        .put(`/api/transactions/${transaction.id}/review`)
        .set("Cookie", authCookie)
        .send({ reviewed: true })
        .expect(200);

      expect(res.body.success).toBe(true);
      const rows = await auditRowsFor(transaction.id);
      expect(rows).toHaveLength(1);
    });

    it("PUT /api/transactions/:id/review writes exactly one UPDATE row (mark unreviewed)", async () => {
      const transaction = await seedTransaction("HTTP mark-unreviewed seed");
      // First mark reviewed (1 row), then unreviewed (a 2nd row for a
      // DIFFERENT change) - assert the unreviewed call itself adds exactly
      // one more row, not two.
      await request(app)
        .put(`/api/transactions/${transaction.id}/review`)
        .set("Cookie", authCookie)
        .send({ reviewed: true })
        .expect(200);

      const beforeUnreview = await auditRowsFor(transaction.id);
      expect(beforeUnreview).toHaveLength(1);

      const res = await request(app)
        .put(`/api/transactions/${transaction.id}/review`)
        .set("Cookie", authCookie)
        .send({ reviewed: false })
        .expect(200);

      expect(res.body.success).toBe(true);
      const rows = await auditRowsFor(transaction.id);
      expect(rows).toHaveLength(2);
    });
  });

  describe("Bulk HTTP paths write exactly ONE row per transaction (no double-audit)", () => {
    it("PUT /api/transactions/bulk-owner writes exactly one UPDATE row per transaction", async () => {
      // Seeded transactions default ownerUserId to the creator (userId);
      // clear it to null so the update is a genuine, observable change.
      const t1 = await seedTransaction("Bulk owner seed 1");
      const t2 = await seedTransaction("Bulk owner seed 2");

      const res = await request(app)
        .put("/api/transactions/bulk-owner")
        .set("Cookie", authCookie)
        .send({ transactionIds: [t1.id, t2.id], ownerUserId: null })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(await auditRowsFor(t1.id)).toHaveLength(1);
      expect(await auditRowsFor(t2.id)).toHaveLength(1);
    });

    it("PUT /api/transactions/bulk-category writes exactly one UPDATE row per transaction", async () => {
      // Seeded transactions start with no category; assign a real one so the
      // update is a genuine, observable change.
      const t1 = await seedTransaction("Bulk category seed 1");
      const t2 = await seedTransaction("Bulk category seed 2");

      const res = await request(app)
        .put("/api/transactions/bulk-category")
        .set("Cookie", authCookie)
        .send({ transactionIds: [t1.id, t2.id], categoryId })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(await auditRowsFor(t1.id)).toHaveLength(1);
      expect(await auditRowsFor(t2.id)).toHaveLength(1);
    });

    it("PUT /api/transactions/bulk-review writes exactly one UPDATE row per transaction", async () => {
      const t1 = await seedTransaction("Bulk review seed 1");
      const t2 = await seedTransaction("Bulk review seed 2");

      const res = await request(app)
        .put("/api/transactions/bulk-review")
        .set("Cookie", authCookie)
        .send({ transactionIds: [t1.id, t2.id], reviewed: true })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(await auditRowsFor(t1.id)).toHaveLength(1);
      expect(await auditRowsFor(t2.id)).toHaveLength(1);
    });
  });
});
