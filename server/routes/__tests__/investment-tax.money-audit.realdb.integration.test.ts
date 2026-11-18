/**
 * Investment Tax Service - Money precision + ZRA export DPA audit (packet R7)
 *
 * Two audit gaps on main:
 *  1. server/services/InvestmentTaxService.ts computed the tax-year summary and
 *     ZRA export with raw IEEE-754 floats (Number()/`+=`), a REGULATORY output.
 *  2. server/routes/investment-tax.ts egressed financial+PII data via the
 *     ZRA export endpoint with NO audit log (compare the reports CSV export,
 *     which logs via BusinessAuditService).
 *
 * Real HTTP + real Postgres. No mocks.
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { db } from "../../db";
import { eq, and, desc } from "drizzle-orm";
import {
  users,
  households,
  householdMembers,
  accounts,
  investmentTransactions,
  auditLogs,
} from "@shared/schema";
import {
  getTestApp,
  createTestUser,
  createTestHousehold,
} from "../../__tests__/fixtures";
import { hashPassword } from "../../auth";
import { randomUUID } from "crypto";

describe("Investment Tax Service - Money precision + DPA audit (packet R7)", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;
  let accountId: string;

  // A distant, unlikely-to-collide tax year so this suite never shares rows
  // with any other test that queries "this year".
  const TAX_YEAR = 2031;

  beforeAll(async () => {
    app = await getTestApp();
    const timestamp = Date.now();

    const testUser = createTestUser({
      email: `invest-tax-${timestamp}@example.com`,
      username: `invest-tax-user-${timestamp}`,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "Investment Tax Household",
      currency: "ZMW",
    });
    testUser.passwordHash = await hashPassword("TestPassword123");
    householdId = testHousehold.id;
    userId = testUser.id;

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
      balance: "0.00",
      currency: "ZMW",
      isAsset: true,
    });

    // Precision fixture: two interest postings whose per-row gross
    // (amount + withholdingTax) AND year-accumulation diverge under raw
    // IEEE-754 float math:
    //   row1: 0.10 + 0.20 === 0.30000000000000004 in JS (not 0.30)
    //   row2: 0.20 + 0.10 === 0.30000000000000004 in JS (not 0.30)
    //   interestIncome: 0.30000000000000004 + 0.30000000000000004
    //                    === 0.6000000000000001 in JS (not 0.60)
    //   totalWht: 0.20 + 0.10 === 0.30000000000000004 in JS (not 0.30)
    //   netIncome: grossIncome - totalWht === 0.30000000000000004 in JS
    //              (not the exact 0.30)
    // A Decimal/Money-backed computation must land on the exact values.
    await db.insert(investmentTransactions).values([
      {
        id: randomUUID(),
        householdId,
        accountId,
        type: "interest",
        amount: "0.10",
        currency: "ZMW",
        withholdingTax: "0.20",
        transactionDate: `${TAX_YEAR}-03-01`,
      },
      {
        id: randomUUID(),
        householdId,
        accountId,
        type: "interest",
        amount: "0.20",
        currency: "ZMW",
        withholdingTax: "0.10",
        transactionDate: `${TAX_YEAR}-04-01`,
      },
    ]);

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
        .delete(investmentTransactions)
        .where(eq(investmentTransactions.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, householdId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Investment tax money/audit test cleanup error", error);
    }
  });

  it("computes the tax-year summary with exact decimal precision (no float drift)", async () => {
    const res = await request(app)
      .get(`/api/investments/tax/summary?year=${TAX_YEAR}`)
      .set("Cookie", authCookie)
      .expect(200);

    expect(res.body.interestIncome).toBe("0.60");
    expect(res.body.totalWht).toBe("0.30");
    expect(res.body.dividendIncome).toBe("0.00");
    expect(res.body.realizedGains).toBe("0.00");
    expect(res.body.grossIncome).toBe("0.60");
    expect(res.body.netIncome).toBe("0.30");
    expect(res.body.currency).toBe("ZMW");
  });

  it("computes exact per-row gross amounts in the ZRA export (no float drift)", async () => {
    const res = await request(app)
      .get(`/api/investments/tax/zra-export?year=${TAX_YEAR}&format=json`)
      .set("Cookie", authCookie)
      .expect(200);

    const rows = res.body as Array<{
      grossAmount: string;
      whtPaid: string;
      netAmount: string;
    }>;
    expect(rows).toHaveLength(2);
    const grossAmounts = rows.map((r) => r.grossAmount).sort();
    expect(grossAmounts).toEqual(["0.30", "0.30"]);
  });

  it("writes a data_export DPA audit row when the ZRA export is downloaded", async () => {
    await request(app)
      .get(`/api/investments/tax/zra-export?year=${TAX_YEAR}&format=csv`)
      .set("Cookie", authCookie)
      .expect(200);

    const [row] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "data_export"),
          eq(auditLogs.householdId, householdId),
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);

    expect(row).toBeDefined();
    expect(row!.userId).toBe(userId);
    expect(row!.householdId).toBe(householdId);
    expect(row!.action).toBe("PROCESS");
  });
});
