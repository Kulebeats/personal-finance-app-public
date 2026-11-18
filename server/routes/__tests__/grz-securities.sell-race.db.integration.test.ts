/**
 * GRZ double-write races — REAL HTTP + REAL Postgres.
 *
 * Two GRZ state transitions each booked money to the ledger via a read-then-write
 * TOCTOU with no row lock and no in-lock re-check:
 *
 *  1. PUT /api/grz/bonds/:id/sell — read the bond, check `status === 'sold'`
 *     OUTSIDE the transaction, then write inside it. Two concurrent sells (a
 *     double-clicked button, a retried request) both read status='active', both
 *     pass the guard, and both write — flipping the bond to 'sold' twice and
 *     inserting TWO investment_transactions rows. The same bond's proceeds are
 *     booked twice; the second is phantom income. A sale is not idempotent, so
 *     nothing downstream corrects it.
 *     FIX: lock the bond FOR UPDATE inside the txn and re-check status under it.
 *
 *  2. POST /api/grz/payments/:id/pay — same TOCTOU on the coupon payment row,
 *     but worse: it books a real INCOME transaction to the main ledger, and does
 *     so BEFORE and OUTSIDE the transaction that flips the status. Two concurrent
 *     pays booked the same coupon's net amount twice.
 *     FIX: a deterministic uuidv5 idempotency key derived from the payment id
 *     (transactions.idempotency_key is UNIQUE, so the loser's insert collides and
 *     returns the winner's row) PLUS a FOR UPDATE lock + in-lock status re-check
 *     so the status flip and its audit row happen exactly once.
 *
 * DETERMINISM — why these reproduce every run rather than by timing luck:
 *   - The pool is pre-warmed (10 concurrent SELECT 1) so neither racer pays a
 *     connection-setup cost that would accidentally serialize them.
 *   - The race window is structurally wide, not a narrow instruction gap: between
 *     the pre-flight status read and the write, both handlers await a dynamic
 *     import() and an account lookup. Both requests are therefore always still
 *     inside that window when the other reads, so on unfixed code BOTH always
 *     pass the guard.
 *   - The assertions are on the COMMITTED END STATE (how many ledger rows exist),
 *     never on which request won. That makes them true detectors: the count is
 *     wrong on old code and right on new code, regardless of scheduling. The
 *     assertions are not relaxed to tolerate either outcome.
 *
 * RED evidence: with the fixes reverted, both `expect(...).toHaveLength(1)` ledger
 * assertions fail with 2 — reproduced on every run.
 *
 * tsconfig no longer excludes *.test.ts, but run explicitly:
 *   npx vitest run grz-securities.sell-race
 */
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { randomUUID } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";

import { db } from "../../db";
import {
  grzBonds,
  grzBondPayments,
  investmentTransactions,
  transactions,
  accounts,
  households,
  users,
  householdMembers,
  auditLogs,
} from "@shared/schema";
import {
  createTestUser,
  createTestHousehold,
  getTestApp,
} from "../../__tests__/fixtures";
import { hashPassword } from "../../auth";

describe("GRZ concurrency — real HTTP double-write races", () => {
  let app: Express;
  let authCookie: string;
  let csrfToken: string;
  let householdId: string;
  let accountId: string;

  const authRequest = (req: request.Test) =>
    req.set("Cookie", authCookie).set("X-CSRF-Token", csrfToken);

  beforeAll(async () => {
    app = await getTestApp();

    // Pre-warm the pool so the two racers don't serialize on connection setup.
    await Promise.all(Array.from({ length: 10 }, () => db.execute(sql`SELECT 1`)));

    const timestamp = Date.now();
    const testUser = createTestUser({
      email: `grz-race-${timestamp}@example.com`,
      username: `grz-race-user-${timestamp}`,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "GRZ Race Household",
      currency: "ZMW",
    });
    householdId = testHousehold.id;
    testUser.passwordHash = await hashPassword("TestPassword123");

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
      name: "GRZ Race Account",
      type: "investment",
      balance: "1000000.00",
      currency: "ZMW",
    });

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: testUser.email, password: "TestPassword123" })
      .expect(200);
    authCookie = loginRes.headers["set-cookie"]
      ? (loginRes.headers["set-cookie"] as unknown as string[]).join("; ")
      : "";

    const csrfRes = await request(app)
      .get("/api/csrf-token")
      .set("Cookie", authCookie)
      .expect(200);
    csrfToken = csrfRes.body.csrfToken;
    if (csrfRes.headers["set-cookie"]) {
      authCookie = [authCookie, ...csrfRes.headers["set-cookie"]].join("; ");
    }
  });

  afterAll(async () => {
    try {
      await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
      const bonds = await db
        .select({ id: grzBonds.id })
        .from(grzBonds)
        .where(eq(grzBonds.householdId, householdId));
      if (bonds.length > 0) {
        await db.delete(grzBondPayments).where(
          inArray(
            grzBondPayments.bondId,
            bonds.map((b) => b.id),
          ),
        );
      }
      await db.delete(grzBonds).where(eq(grzBonds.householdId, householdId));
      await db
        .delete(investmentTransactions)
        .where(eq(investmentTransactions.householdId, householdId));
      await db
        .delete(transactions)
        .where(eq(transactions.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, householdId));
      await db.delete(households).where(eq(households.id, householdId));
      await db.delete(users).where(eq(users.email, `grz-race-${householdId}`));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("grz race cleanup error", error);
    }
  });

  async function seedActiveBond() {
    const [bond] = await db
      .insert(grzBonds)
      .values({
        householdId,
        accountId,
        bondName: `GRZ Bond ${randomUUID().slice(0, 6)}`,
        faceValue: "10000.00",
        purchasePrice: "9800.00",
        couponRate: "12.5000",
        purchaseDate: "2026-01-01",
        maturityDate: "2029-01-01",
        tenorYears: 3,
        status: "active",
      })
      .returning();
    return bond;
  }

  it("books sale proceeds exactly once when two sells race", async () => {
    const bond = await seedActiveBond();

    const sell = () =>
      authRequest(request(app).put(`/api/grz/bonds/${bond.id}/sell`)).send({
        soldPrice: "9500.00",
        soldDate: "2026-06-01",
        accountId,
      });

    const [a, b] = await Promise.all([sell(), sell()]);

    // Exactly one sell succeeds; the loser is rejected with the same 409
    // "already sold" CONFLICT contract the pre-flight check returns — not a
    // 500, not a silent no-op.
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.success).toBe(false);
    expect(loser.body.error.code).toBe("CONFLICT");
    expect(loser.body.error.message).toBe("Bond is already sold");

    // THE ASSERTION THAT MATTERS: the ledger holds ONE proceeds row. On the old
    // code this is 2 — the same bond's proceeds booked twice.
    const ledgerRows = await db
      .select()
      .from(investmentTransactions)
      .where(eq(investmentTransactions.householdId, householdId));

    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].amount).toBe("9500.00");
    expect(ledgerRows[0].type).toBe("sell");

    // And the bond is sold exactly once, at the winning price.
    const [finalBond] = await db
      .select()
      .from(grzBonds)
      .where(eq(grzBonds.id, bond.id));
    expect(finalBond.status).toBe("sold");
    expect(finalBond.soldPrice).toBe("9500.00");

    await db
      .delete(investmentTransactions)
      .where(eq(investmentTransactions.householdId, householdId));
  });

  it("books coupon income exactly once when two coupon pays race", async () => {
    const bond = await seedActiveBond();
    const [payment] = await db
      .insert(grzBondPayments)
      .values({
        bondId: bond.id,
        paymentDate: "2026-07-01",
        grossAmount: "625.00",
        withholdingTax: "93.75",
        netAmount: "531.25",
        paymentType: "coupon",
        status: "scheduled",
      })
      .returning();

    const pay = () =>
      authRequest(request(app).post(`/api/grz/payments/${payment.id}/pay`)).send({
        accountId,
        date: "2026-07-01",
      });

    const [a, b] = await Promise.all([pay(), pay()]);

    // One wins; the loser gets the same 409 CONFLICT contract as the
    // pre-flight check.
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.success).toBe(false);
    expect(loser.body.error.code).toBe("CONFLICT");
    expect(loser.body.error.message).toBe("Payment is already marked as paid");

    // THE ASSERTION THAT MATTERS: the net coupon is booked to the ledger ONCE.
    // On the old code this is 2 rows of 531.25 — phantom income.
    const incomeRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.householdId, householdId));

    expect(incomeRows).toHaveLength(1);
    expect(incomeRows[0].amount).toBe("531.25");
    expect(incomeRows[0].type).toBe("income");

    // The payment is marked paid exactly once and points at that single row.
    const [finalPayment] = await db
      .select()
      .from(grzBondPayments)
      .where(eq(grzBondPayments.id, payment.id));
    expect(finalPayment.status).toBe("paid");
    expect(finalPayment.incomeTransactionId).toBe(incomeRows[0].id);

    // The status transition is audited exactly once — the in-lock guard must
    // stop the loser BEFORE it writes a second PROCESS audit row.
    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, payment.id));
    expect(audits).toHaveLength(1);
  });
});
