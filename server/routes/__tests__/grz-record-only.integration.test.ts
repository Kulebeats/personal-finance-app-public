/**
 * GRZ holding creation record-only invariant (W4)
 *
 * Product decision: creating a GRZ bond or T-bill records a holding only. It
 * must not post cash movement; coupons and maturities are the only GRZ paths
 * that create household income ledger transactions.
 */

import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  accounts,
  auditLogs,
  grzBondPayments,
  grzBonds,
  grzTBills,
  householdMembers,
  households,
  transactions,
  users,
} from "@shared/schema";
import {
  createTestHousehold,
  createTestUser,
  getTestApp,
} from "../../__tests__/fixtures";
import { hashPassword } from "../../auth";

type AuditEntityType = "grz_bond" | "grz_tbill";

describe("GRZ holding creation record-only invariant (W4)", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    app = await getTestApp();

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const user = createTestUser({
      email: `grz-record-only-${stamp}@example.com`,
      username: `grz-record-only-${stamp}`,
    });
    const household = createTestHousehold(user.id, {
      name: `GRZ Record Only ${stamp}`,
      currency: "ZMW",
    });
    user.passwordHash = await hashPassword("TestPassword123");
    user.householdId = household.id;
    householdId = household.id;
    userId = user.id;

    await db.insert(households).values({
      id: household.id,
      name: household.name,
      currency: household.currency,
    });
    await db.insert(users).values({
      id: user.id,
      email: user.email,
      username: user.username,
      passwordHash: user.passwordHash,
      fullName: user.fullName,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil,
    });
    await db.insert(householdMembers).values({
      householdId,
      userId,
      role: "admin",
    });

    accountId = randomUUID();
    await db.insert(accounts).values({
      id: accountId,
      householdId,
      name: "GRZ Settlement Account",
      type: "investment",
      balance: "250000.00",
      currency: "ZMW",
      isAsset: true,
    });

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "TestPassword123" })
      .expect(200);
    authCookie = loginRes.headers["set-cookie"]
      ? (loginRes.headers["set-cookie"] as unknown as string[]).join("; ")
      : "";
  });

  afterAll(async () => {
    try {
      await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
      const bonds = await db
        .select({ id: grzBonds.id })
        .from(grzBonds)
        .where(eq(grzBonds.householdId, householdId));
      for (const bond of bonds) {
        await db
          .delete(grzBondPayments)
          .where(eq(grzBondPayments.bondId, bond.id));
      }
      await db.delete(grzBonds).where(eq(grzBonds.householdId, householdId));
      await db.delete(grzTBills).where(eq(grzTBills.householdId, householdId));
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
      console.error("GRZ record-only cleanup error", error);
    }
  });

  const authRequest = (req: request.Test) => req.set("Cookie", authCookie);

  async function cashState() {
    const [account] = await db
      .select({ balance: accounts.balance })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    const rows = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.householdId, householdId));

    return {
      balance: account.balance,
      transactionCount: rows.length,
    };
  }

  async function expectCreateAuditRow(
    entityType: AuditEntityType,
    entityId: string,
  ) {
    const [row] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, entityType),
          eq(auditLogs.entityId, entityId),
          eq(auditLogs.action, "CREATE"),
        ),
      );

    expect(row).toBeDefined();
    expect(row.householdId).toBe(householdId);
    expect(row.userId).toBe(userId);
    expect(row.details).toEqual(
      expect.objectContaining({
        newValue: expect.any(Object),
      }),
    );
  }

  it("creates bond and T-bill holdings without posting cash movements", async () => {
    const cases = [
      {
        label: "bond with account",
        entityType: "grz_bond" as const,
        path: "/api/grz/bonds",
        table: grzBonds,
        payload: {
          bondName: "GRZ Record-Only Bond With Account",
          tenorYears: 5,
          faceValue: "100000.00",
          purchasePrice: "98000.00",
          purchaseDate: "2026-01-01",
          couponRate: "0.1100",
          maturityDate: "2031-01-01",
          accountId,
        },
      },
      {
        label: "bond without account",
        entityType: "grz_bond" as const,
        path: "/api/grz/bonds",
        table: grzBonds,
        payload: {
          bondName: "GRZ Record-Only Bond Without Account",
          tenorYears: 3,
          faceValue: "50000.00",
          purchasePrice: "49500.00",
          purchaseDate: "2026-02-01",
          couponRate: "0.0950",
          maturityDate: "2029-02-01",
        },
      },
      {
        label: "T-bill with account",
        entityType: "grz_tbill" as const,
        path: "/api/grz/tbills",
        table: grzTBills,
        payload: {
          tbillName: "GRZ Record-Only TBill With Account",
          tenorDays: 91,
          faceValue: "10000.00",
          purchasePrice: "9600.00",
          purchaseDate: "2026-01-01",
          maturityDate: "2026-04-02",
          accountId,
        },
      },
    ];

    for (const testCase of cases) {
      const before = await cashState();

      const response = await authRequest(request(app).post(testCase.path))
        .send(testCase.payload)
        .expect(201);
      expect(response.body.success, testCase.label).toBe(true);
      const entityId = response.body.data.id as string;
      expect(entityId, testCase.label).toBeTruthy();

      const [holding] = await db
        .select()
        .from(testCase.table)
        .where(eq(testCase.table.id, entityId));
      expect(holding, testCase.label).toBeDefined();

      const after = await cashState();
      expect(after, testCase.label).toEqual(before);

      await expectCreateAuditRow(testCase.entityType, entityId);
    }
  });
});
