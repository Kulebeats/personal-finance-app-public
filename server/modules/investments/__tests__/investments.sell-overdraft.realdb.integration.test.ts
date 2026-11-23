/**
 * Investments Module - SELL / overdraft REAL-DB Integration Tests (SCP-316)
 *
 * Audit gap (§3.11): the Investments SELL/overdraft guard (the GRZ/holdings
 * money path) was claimed fixed but UNTESTED. This file proves the guard with
 * REAL HTTP requests against REAL Postgres (no mocks).
 *
 * The guard under test lives in InvestmentService.createTransaction
 * (server/modules/investments/investments.service.ts): for a SELL it locks the
 * holding row FOR UPDATE, reads the current quantity, and throws ConflictError
 * (HTTP 409) when the requested sell quantity exceeds the held quantity.
 *
 * Tests:
 *   1. A SELL exceeding the held quantity is rejected 409 and the holding
 *      quantity is unchanged (no negative position).
 *   2. A valid SELL succeeds, decrements the holding, and writes a CREATE audit
 *      row for the investment transaction (Rule 9).
 *   3. Two concurrent SELLs that each try to drain the full position cannot both
 *      succeed: at most one wins and the holding never goes negative (the FOR
 *      UPDATE lock is genuinely exercised under real concurrency).
 *
 * NODE_ENV=test disables CSRF (see server/app.ts); only the session cookie is
 * required. The buy path seeds both holding quantity and tax lots, so the SELL's
 * tax-lot disposal path is satisfied for the valid-sell case.
 *
 * @module modules/investments/__tests__/investments.sell-overdraft.realdb.integration.test
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { Express } from "express";
import { db } from "../../../db";
import { eq, inArray } from "drizzle-orm";
import {
  users,
  households,
  householdMembers,
  accounts,
  securities,
  holdings,
  investmentTransactions,
  taxLots,
  taxLotDisposals,
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

interface AuditRow {
  id: string;
  householdId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
}

describe("Investments SELL / overdraft REAL-DB (SCP-316)", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;
  let accountId: string;
  let securityId: string;

  const timestamp = Date.now();

  beforeAll(async () => {
    app = await getTestApp();

    const testUser = createTestUser({
      email: `invest-sell-${timestamp}@example.com`,
      username: `invest-sell-user-${timestamp}`,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "Invest Sell Household",
      currency: "USD",
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
      name: "Brokerage",
      type: "investment",
      balance: "100000.00",
      currency: "USD",
      isAsset: true,
    });

    securityId = randomUUID();
    await db.insert(securities).values({
      id: securityId,
      symbol: "TST",
      name: "Test Security",
      type: "stock",
      currency: "USD",
      currentPrice: "100.00",
    });

    // NEW-21: foreign trades need a dated rate; this suite claims none, so a synthetic 20.
    await seedDatedFxRate(householdId, testUser.id, "20");

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
        .delete(taxLotDisposals)
        .where(eq(taxLotDisposals.householdId, householdId));
      await db.delete(taxLots).where(eq(taxLots.householdId, householdId));
      await db
        .delete(investmentTransactions)
        .where(eq(investmentTransactions.householdId, householdId));
      await db.delete(householdFxRateOverrides).where(eq(householdFxRateOverrides.householdId, householdId));
      await db.delete(holdings).where(eq(holdings.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      await db.delete(securities).where(eq(securities.id, securityId));
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, householdId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Investments SELL SCP-316 cleanup error", error);
    }
  });

  // Create a holding via the BUY path so quantity AND tax lots both exist.
  async function seedBoughtHolding(quantity: string): Promise<string> {
    const holdingId = randomUUID();
    await db.insert(holdings).values({
      id: holdingId,
      householdId,
      accountId,
      securityId,
      quantity: "0",
      costBasis: "0.00",
      acquiredDate: "2026-01-01",
    });

    const buyRes = await request(app)
      .post("/api/investments/transactions")
      .set("Cookie", authCookie)
      .send({
        accountId,
        holdingId,
        securityId,
        type: "buy",
        quantity,
        price: "100.00",
        amount: (Number(quantity) * 100).toFixed(2),
        currency: "USD",
        transactionDate: "2026-01-02",
      })
      .expect(201);
    expect(buyRes.body.success).toBe(true);

    return holdingId;
  }

  const heldQuantity = async (holdingId: string): Promise<number> => {
    const [row] = await db
      .select({ quantity: holdings.quantity })
      .from(holdings)
      .where(eq(holdings.id, holdingId))
      .limit(1);
    return Number(row.quantity);
  };

  let holdingId: string;

  describe("SELL overdraft guard", () => {
    beforeEach(async () => {
      // Fresh 10-share holding for each scenario.
      holdingId = await seedBoughtHolding("10");
    });

    it("rejects a SELL that exceeds the held quantity (409) and leaves position intact", async () => {
      const res = await request(app)
        .post("/api/investments/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId,
          holdingId,
          securityId,
          type: "sell",
          quantity: "11", // more than the 10 held
          price: "120.00",
          amount: "1320.00",
          currency: "USD",
          transactionDate: "2026-01-03",
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/insufficient shares to sell/i);

      // Position unchanged: still 10 shares, never negative.
      expect(await heldQuantity(holdingId)).toBeCloseTo(10, 6);
    });

    it("accepts a valid SELL, decrements the holding, and writes an audit row", async () => {
      const res = await request(app)
        .post("/api/investments/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId,
          holdingId,
          securityId,
          type: "sell",
          quantity: "4",
          price: "120.00",
          amount: "480.00",
          currency: "USD",
          transactionDate: "2026-01-04",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      const txnId: string = res.body.data.id;

      // Holding decremented 10 -> 6.
      expect(await heldQuantity(holdingId)).toBeCloseTo(6, 6);

      // CREATE audit row for the investment transaction (Rule 9).
      const [audit] = (await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, txnId))) as AuditRow[];
      expect(audit).toBeDefined();
      expect(audit.action).toBe("CREATE");
      expect(audit.entityType).toBe("investment_transaction");
      expect(audit.householdId).toBe(householdId);
    });

    it("cannot oversell via two concurrent full-position SELLs (FOR UPDATE lock)", async () => {
      // Holding has 10 shares; two concurrent SELLs of 10 each race.
      const sell = () =>
        request(app)
          .post("/api/investments/transactions")
          .set("Cookie", authCookie)
          .send({
            accountId,
            holdingId,
            securityId,
            type: "sell",
            quantity: "10",
            price: "120.00",
            amount: "1200.00",
            currency: "USD",
            transactionDate: "2026-01-05",
          });

      const [a, b] = await Promise.all([sell(), sell()]);
      const statuses = [a.status, b.status];
      const successCount = statuses.filter((s) => s === 201).length;
      const conflictCount = statuses.filter((s) => s === 409).length;

      // At most one full-position sell can succeed. If both somehow returned
      // 201, the holding would be -10, which the final assertion forbids.
      expect(successCount).toBeLessThanOrEqual(1);
      expect(successCount + conflictCount).toBe(2);

      // The decisive invariant: the position is never negative.
      const finalQty = await heldQuantity(holdingId);
      expect(finalQty).toBeGreaterThanOrEqual(0);
      // If exactly one sale won, 0 remain; if both were rejected, 10 remain.
      expect([0, 10]).toContain(Math.round(finalQty));
    });
  });
});
