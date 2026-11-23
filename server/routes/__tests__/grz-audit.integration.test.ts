/**
 * GRZ DPA Audit Logging - Integration Tests (SCP-312)
 *
 * Proves that GRZ bond/T-bill/coupon writes record an audit_logs row with the
 * correct actor and action, and that the system-initiated maturity cron logs
 * with a null (system) actor. Real HTTP + real Postgres.
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { db } from "../../db";
import { eq, and } from "drizzle-orm";
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
import { InvestmentAutomationService } from "../../services/InvestmentAutomationService";
import { randomUUID } from "crypto";

describe("GRZ DPA Audit Logging (SCP-312)", () => {
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
      email: `grz-audit-${timestamp}@example.com`,
      username: `grz-audit-user-${timestamp}`,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "GRZ Audit Household",
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
      name: "GRZ Audit Account",
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
      // bond payments reference bonds; delete via the household's bonds
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
      console.error("GRZ audit test cleanup error", error);
    }
  });

  it("writes a grz_bond CREATE audit row on bond creation (correct actor)", async () => {
    const res = await authRequest(
      request(app).post("/api/grz/bonds"),
    )
      .send({
        bondName: "GRZ 5Y Test Bond",
        tenorYears: 5,
        faceValue: "100000.00",
        purchasePrice: "98000.00",
        purchaseDate: "2026-01-01",
        couponRate: "0.1100",
        maturityDate: "2031-01-01",
        accountId,
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    const bondId = res.body.data.id;
    expect(bondId).toBeTruthy();

    const [row] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "grz_bond"),
          eq(auditLogs.entityId, bondId),
          eq(auditLogs.action, "CREATE"),
        ),
      );
    expect(row).toBeDefined();
    expect(row.userId).toBe(userId);
    expect(row.householdId).toBe(householdId);
  });

  it("writes a grz_tbill CREATE audit row on T-bill creation", async () => {
    const res = await authRequest(request(app).post("/api/grz/tbills"))
      .send({
        tbillName: "GRZ 91-Day Test TBill",
        tenorDays: 91,
        purchaseYield: "0.9999",
        faceValue: "10000.00",
        purchasePrice: "9500.00",
        purchaseDate: "2026-01-01",
        maturityDate: "2026-04-02",
        accountId,
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    const tbillId = res.body.data.id;
    expect(tbillId).toBeTruthy();

    const [row] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "grz_tbill"),
          eq(auditLogs.entityId, tbillId),
          eq(auditLogs.action, "CREATE"),
        ),
      );
    expect(row).toBeDefined();
    expect(row.userId).toBe(userId);
    expect(row.householdId).toBe(householdId);
    const [stored] = await db.select().from(grzTBills).where(eq(grzTBills.id, tbillId));
    expect(stored.purchaseYield).not.toBe("0.9999");
    expect(row.details).toMatchObject({ newValue: { purchaseYield: stored.purchaseYield, discountAmount: "500.00" } });
  });

  it("writes a grz_bond_payment PROCESS audit row when a coupon is paid", async () => {
    // Create a bond (which generates a scheduled payment schedule)
    const bondRes = await authRequest(request(app).post("/api/grz/bonds"))
      .send({
        bondName: "GRZ Coupon Test Bond",
        tenorYears: 2,
        faceValue: "50000.00",
        purchasePrice: "49000.00",
        purchaseDate: "2026-01-01",
        couponRate: "0.1000",
        maturityDate: "2028-01-01",
        accountId,
      })
      .expect(201);
    const bondId = bondRes.body.data.id;

    const [payment] = await db
      .select()
      .from(grzBondPayments)
      .where(
        and(
          eq(grzBondPayments.bondId, bondId),
          eq(grzBondPayments.status, "scheduled"),
        ),
      )
      .limit(1);
    expect(payment).toBeDefined();

    await authRequest(request(app).post(`/api/grz/payments/${payment.id}/pay`))
      .send({ accountId })
      .expect(200);

    const [row] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "grz_bond_payment"),
          eq(auditLogs.entityId, payment.id),
          eq(auditLogs.action, "PROCESS"),
        ),
      );
    expect(row).toBeDefined();
    expect(row.userId).toBe(userId);
    expect(row.householdId).toBe(householdId);
  });

  it("writes a grz_tbill PROCESS audit row with a system (null) actor on cron maturity", async () => {
    const today = new Date().toISOString().split("T")[0];
    const maturedTbillId = randomUUID();
    await db.insert(grzTBills).values({
      id: maturedTbillId,
      householdId,
      accountId,
      tbillName: "GRZ Matured Cron TBill",
      tenorDays: 91,
      faceValue: "10000.00",
      purchasePrice: "9500.00",
      purchaseDate: "2025-10-01",
      maturityDate: today,
      status: "active",
    });

    await new InvestmentAutomationService().processTBillMaturities();

    const [row] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "grz_tbill"),
          eq(auditLogs.entityId, maturedTbillId),
          eq(auditLogs.action, "PROCESS"),
        ),
      );
    expect(row).toBeDefined();
    expect(row.userId).toBeNull();
    expect((row.details as Record<string, unknown>).actor).toBe("system");
    expect(row.householdId).toBe(householdId);
  });
});
