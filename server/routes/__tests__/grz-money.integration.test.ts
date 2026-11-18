/**
 * GRZ Money Correctness - Integration Tests (SCP-311)
 *
 * Proves that a GRZ bond purchase and a T-bill purchase compute and PERSIST money
 * to the exact minor unit (the cent), via the Money class, over a real HTTP request
 * against real Postgres.
 *
 * The bond fixture is chosen so the per-period withholding tax is exactly 125.505.
 * Correct (Money/decimal, ROUND_HALF_UP) rounding stores 125.51; the old raw-float
 * path stored 125.50 because 125.505 is not representable in IEEE-754 and lands just
 * below the half. This test fails on the old code and passes on the Money-based code.
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { db } from "../../db";
import { eq, and, asc } from "drizzle-orm";
import {
  grzBonds,
  grzBondPayments,
  grzTBills,
  investmentTransactions,
  transactions,
  accounts,
  auditLogs,
  users,
  households,
  householdMembers,
} from "@shared/schema";
import {
  createTestUser,
  createTestHousehold,
  getTestApp,
} from "../../__tests__/fixtures";
import { hashPassword } from "../../auth";
import { randomUUID } from "crypto";

describe("GRZ Money Correctness (SCP-311)", () => {
  let app: Express;
  let authCookie: string;
  let csrfToken: string;
  let householdId: string;
  let userId: string;
  let accountId: string;

  const authRequest = (req: request.Test) =>
    req.set("Cookie", authCookie).set("X-CSRF-Token", csrfToken);

  beforeAll(async () => {
    app = await getTestApp();
    const timestamp = Date.now();

    const testUser = createTestUser({
      email: `grz-money-${timestamp}@example.com`,
      username: `grz-money-user-${timestamp}`,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "GRZ Money Household",
      currency: "ZMW",
    });
    householdId = testHousehold.id;
    userId = testUser.id;

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
      name: "GRZ Money Account",
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
      for (const b of bonds) {
        await db.delete(grzBondPayments).where(eq(grzBondPayments.bondId, b.id));
      }
      await db.delete(grzBonds).where(eq(grzBonds.householdId, householdId));
      await db.delete(grzTBills).where(eq(grzTBills.householdId, householdId));
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
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("GRZ money test cleanup error", error);
    }
  });

  it("persists bond coupon, withholding tax, and net amount to the exact cent", async () => {
    // Fixture chosen so the per-period coupon is exactly 836.70 (preserving the
    // service's existing coupon-rate semantics: gross uses the stored rate directly).
    //   per-period gross -> 836.70
    //   withholding (15%) -> 125.505, stored 125.51 (ROUND_HALF_UP), never 125.50
    //   net -> 836.70 minus 125.51 = 711.19
    const res = await authRequest(request(app).post("/api/grz/bonds"))
      .send({
        bondName: "GRZ Money Precision Bond",
        tenorYears: 2,
        faceValue: "100.00",
        purchasePrice: "98.00",
        purchaseDate: "2026-01-01",
        couponRate: "16.7340",
        couponFrequency: 2,
        maturityDate: "2028-01-01",
        accountId,
      })
      .expect(201);

    const bondId = res.body.data.id as string;
    expect(bondId).toBeTruthy();

    // First scheduled COUPON payment (principal is added last and excluded here).
    const [coupon] = await db
      .select()
      .from(grzBondPayments)
      .where(
        and(
          eq(grzBondPayments.bondId, bondId),
          eq(grzBondPayments.paymentType, "coupon"),
        ),
      )
      .orderBy(asc(grzBondPayments.paymentDate))
      .limit(1);

    expect(coupon).toBeDefined();
    // To-the-cent assertions on persisted decimal columns.
    expect(coupon.grossAmount).toBe("836.70");
    expect(coupon.withholdingTax).toBe("125.51"); // exact, not 125.50
    expect(coupon.netAmount).toBe("711.19");

    // Principal repayment at maturity equals face value exactly, no withholding.
    const [principal] = await db
      .select()
      .from(grzBondPayments)
      .where(
        and(
          eq(grzBondPayments.bondId, bondId),
          eq(grzBondPayments.paymentType, "principal"),
        ),
      )
      .limit(1);
    expect(principal).toBeDefined();
    expect(principal.grossAmount).toBe("100.00");
    expect(principal.withholdingTax).toBe("0.00");
    expect(principal.netAmount).toBe("100.00");
  });

  it("persists T-bill discount and yield to the exact cent", async () => {
    // face 10,000.00, price 9,636.30, tenor 91 days.
    //   discount -> 10,000 minus 9,636.30 = 363.70
    const res = await authRequest(request(app).post("/api/grz/tbills"))
      .send({
        tbillName: "GRZ Money Precision TBill",
        tenorDays: 91,
        faceValue: "10000.00",
        purchasePrice: "9636.30",
        purchaseDate: "2026-01-01",
        maturityDate: "2026-04-02",
        accountId,
      })
      .expect(201);

    const tbillId = res.body.data.id as string;
    expect(tbillId).toBeTruthy();

    const [tbill] = await db
      .select()
      .from(grzTBills)
      .where(eq(grzTBills.id, tbillId));

    expect(tbill).toBeDefined();
    expect(tbill.discountAmount).toBe("363.70");
    // purchaseYield is a rate (decimal 6,4). Annualized to four places.
    expect(tbill.purchaseYield).toBe("0.1514");
  });

  it("creates the coupon income ledger transaction with the exact net amount", async () => {
    // Create a fresh bond and pay its first coupon; the income transaction value
    // must equal the net coupon (711.19) to the cent.
    const bondRes = await authRequest(request(app).post("/api/grz/bonds"))
      .send({
        bondName: "GRZ Money Coupon Pay Bond",
        tenorYears: 2,
        faceValue: "100.00",
        purchasePrice: "98.00",
        purchaseDate: "2026-01-01",
        couponRate: "16.7340",
        couponFrequency: 2,
        maturityDate: "2028-01-01",
        accountId,
      })
      .expect(201);
    const bondId = bondRes.body.data.id as string;

    const [coupon] = await db
      .select()
      .from(grzBondPayments)
      .where(
        and(
          eq(grzBondPayments.bondId, bondId),
          eq(grzBondPayments.paymentType, "coupon"),
          eq(grzBondPayments.status, "scheduled"),
        ),
      )
      .orderBy(asc(grzBondPayments.paymentDate))
      .limit(1);
    expect(coupon).toBeDefined();
    expect(coupon.netAmount).toBe("711.19");

    await authRequest(request(app).post(`/api/grz/payments/${coupon.id}/pay`))
      .send({ accountId })
      .expect(200);

    const [paidCoupon] = await db
      .select()
      .from(grzBondPayments)
      .where(eq(grzBondPayments.id, coupon.id));
    expect(paidCoupon.status).toBe("paid");
    expect(paidCoupon.incomeTransactionId).toBeTruthy();

    const [incomeTx] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, paidCoupon.incomeTransactionId as string));
    expect(incomeTx).toBeDefined();
    // Ledger income value equals the exact net coupon.
    expect(incomeTx.amount).toBe("711.19");
  });
});
