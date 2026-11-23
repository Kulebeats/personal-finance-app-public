/**
 * Step-Up Re-Authentication — Real-DB Integration Tests
 *
 * Exercises the REAL requireStepUp middleware and the REAL step-up endpoint
 * against a real Postgres (NO mocked middleware). Guards the sudo-mode fix:
 * a non-MFA user must be able to satisfy step-up with their password and then
 * perform destructive/financial actions.
 *
 * See docs/architecture/step-up-reauth-design.md
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { db } from "../../../db";
import { eq, inArray, or, sql } from "drizzle-orm";
import {
  users,
  households,
  householdMembers,
  accounts,
  transactions,
  auditLogs,
  outboxEvents,
  securityAuditLogs,
  session,
} from "@shared/schema";
import {
  getTestApp,
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { randomUUID } from "crypto";

describe("Account/Transfer Step-Up — Real DB Integration", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;
  let deleteAccountId: string;
  let fromAccountId: string;
  let toAccountId: string;

  const timestamp = Date.now();
  const EMAIL = `stepup-${timestamp}@example.com`;
  const PASSWORD = "TestPassword123!";

  beforeAll(async () => {
    app = await getTestApp();

    const testUser = createTestUser({
      email: EMAIL,
      username: `stepup-user-${timestamp}`,
      mfaEnabled: false,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "Step-Up Test Household",
    });

    testUser.passwordHash = await hashPassword(PASSWORD);
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

    deleteAccountId = randomUUID();
    fromAccountId = randomUUID();
    toAccountId = randomUUID();

    await db.insert(accounts).values([
      {
        id: deleteAccountId,
        householdId,
        name: "Account To Delete",
        type: "checking",
        balance: "0.00",
        currency: "ZMW",
      },
      {
        id: fromAccountId,
        householdId,
        name: "Transfer Source",
        type: "checking",
        balance: "1000.00",
        currency: "ZMW",
      },
      {
        id: toAccountId,
        householdId,
        name: "Transfer Destination",
        type: "savings",
        balance: "0.00",
        currency: "ZMW",
      },
    ]);

    const loginRes = await request(app).post("/api/auth/login").send({
      email: testUser.email,
      password: PASSWORD,
    });
    expect(loginRes.status).toBe(200);
    authCookie = loginRes.headers["set-cookie"][0];
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      if (userId) {
        await tx.delete(session).where(or(
          sql`${session.sess}->>'userId' = ${userId}`,
          sql`${session.sess}->>'mfaPendingUserId' = ${userId}`,
        ));
        await tx.delete(securityAuditLogs).where(or(
          eq(securityAuditLogs.userId, userId),
          eq(securityAuditLogs.targetUserId, userId),
        ));
        await tx.delete(auditLogs).where(eq(auditLogs.userId, userId));
        await tx.delete(outboxEvents).where(sql`${outboxEvents.payload}->>'userId' = ${userId}`);
      }
      if (householdId) {
        await tx.delete(outboxEvents).where(eq(outboxEvents.householdId, householdId));
        await tx.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
        await tx.delete(transactions).where(eq(transactions.householdId, householdId));
        await tx.delete(accounts).where(eq(accounts.householdId, householdId));
        await tx.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
      }
      if (userId) await tx.delete(users).where(eq(users.id, userId));
      if (householdId) await tx.delete(households).where(eq(households.id, householdId));
    });
  });

  // 1. No step-up -> blocked (passes on unfixed code too; documents the gate)
  it("blocks DELETE /accounts/:id without step-up (401 requiresStepUp)", async () => {
    const res = await request(app)
      .delete(`/api/accounts/${deleteAccountId}`)
      .set("Cookie", authCookie);

    expect(res.status).toBe(401);
    expect(res.body.requiresStepUp).toBe(true);
    expect(res.body.error.code).toBe("STEP_UP_REQUIRED");
  });

  // 2. Wrong password -> step-up rejected (401 INVALID_CREDENTIALS), delete still blocked.
  // Against the unfixed endpoint this returns 400 "MFA not enabled", so this case
  // (like cases 3 and 4) fails pre-fix and passes post-fix. We assert the precise
  // failure contract so a regression to 500/403 on bad credentials is also caught.
  it("rejects step-up with wrong password and keeps delete blocked", async () => {
    const stepUpRes = await request(app)
      .post("/api/settings/security/step-up")
      .set("Cookie", authCookie)
      .send({ password: "WrongPassword!" });

    expect(stepUpRes.status).toBe(401);
    expect(stepUpRes.body.error.code).toBe("INVALID_CREDENTIALS");

    const delRes = await request(app)
      .delete(`/api/accounts/${deleteAccountId}`)
      .set("Cookie", authCookie);
    expect(delRes.status).toBe(401);
  });

  // 3. Password step-up -> delete works (THE fail-then-pass guard)
  it("allows DELETE after password step-up (non-MFA user)", async () => {
    const stepUpRes = await request(app)
      .post("/api/settings/security/step-up")
      .set("Cookie", authCookie)
      .send({ password: PASSWORD });

    expect(stepUpRes.status).toBe(200);
    expect(stepUpRes.body.success).toBe(true);

    const delRes = await request(app)
      .delete(`/api/accounts/${deleteAccountId}`)
      .set("Cookie", authCookie);
    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);

    const [row] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, deleteAccountId));
    expect(row).toBeDefined();
    expect(row.deletedAt).not.toBeNull();
  });

  // 4. Financial transfer works under the same step-up window (cross-level)
  it("allows POST /transactions/transfer under the active step-up window", async () => {
    const res = await request(app)
      .post("/api/transactions/transfer")
      .set("Cookie", authCookie)
      .send({
        fromAccountId,
        toAccountId,
        amount: { amount: "100.00", currency: "ZMW" },
        name: "Test transfer",
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
    expect(res.body.data.outflow.id).toBeDefined();
    expect(res.body.data.inflow.id).toBeDefined();

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.householdId, householdId));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    {
      label: "credit funding",
      currency: "USD",
      sourceType: "credit" as const,
      sourceIsAsset: false,
      sourceOpening: "500.00",
      destinationType: "checking" as const,
      destinationIsAsset: true,
      destinationOpening: "0.00",
      createAmount: "100.00",
      createdSource: "600.00",
      createdDestination: "100.00",
      editAmount: "150.00",
      editedSource: "650.00",
      editedDestination: "150.00",
    },
    {
      label: "paired repayment",
      currency: "ZMW",
      sourceType: "checking" as const,
      sourceIsAsset: true,
      sourceOpening: "100.00",
      destinationType: "credit" as const,
      destinationIsAsset: false,
      destinationOpening: "100.00",
      createAmount: "20.00",
      createdSource: "80.00",
      createdDestination: "80.00",
      editAmount: "30.00",
      editedSource: "70.00",
      editedDestination: "70.00",
    },
  ])("R08 $label uses its own step-up and reverses both persisted legs exactly", async (scenario) => {
    const fromId = randomUUID(), toId = randomUUID();
    await db.insert(accounts).values([
      { id: fromId, householdId, name: `R08 ${scenario.label} source`, type: scenario.sourceType,
        balance: scenario.sourceOpening, initialBalance: scenario.sourceOpening,
        currency: scenario.currency, isAsset: scenario.sourceIsAsset },
      { id: toId, householdId, name: `R08 ${scenario.label} destination`, type: scenario.destinationType,
        balance: scenario.destinationOpening, initialBalance: scenario.destinationOpening,
        currency: scenario.currency, isAsset: scenario.destinationIsAsset },
    ]);
    const snapshot = async () => ({
      accounts: await db.select().from(accounts).where(inArray(accounts.id, [fromId, toId])).orderBy(accounts.id),
      legs: await db.select().from(transactions).where(inArray(transactions.accountId, [fromId, toId])).orderBy(transactions.id),
    });
    const login = await request(app).post("/api/auth/login").send({ email: EMAIL, password: PASSWORD }).expect(200);
    const headers = { Cookie: (login.headers["set-cookie"] as unknown as string[]).join("; "),
      "X-Capital-Subject": userId, "X-Capital-Household": householdId };
    const createBody = { fromAccountId: fromId, toAccountId: toId,
      amount: { amount: scenario.createAmount, currency: scenario.currency },
      date: "2026-02-12", name: `R08 ${scenario.label}` };
    const initial = await snapshot();
    const deniedCreate = await request(app).post("/api/transactions/transfer").set(headers).send(createBody).expect(401);
    expect(deniedCreate.body).toMatchObject({ requiresStepUp: true, level: "FINANCIAL", error: { code: "STEP_UP_REQUIRED" } });
    expect(await snapshot()).toEqual(initial);

    const steppedUp = await request(app).post("/api/settings/security/step-up").set(headers).send({ password: PASSWORD }).expect(200);
    expect(steppedUp.body.success).toBe(true);
    const created = await request(app).post("/api/transactions/transfer").set(headers).send(createBody).expect(201);
    expect(created.body.success).toBe(true);
    const outflowId: string = created.body.data.outflow.id;
    const inflowId: string = created.body.data.inflow.id;
    const pairId: string = created.body.data.outflow.transferTransactionId;
    expect(outflowId).not.toBe(inflowId);
    expect(pairId).toEqual(expect.any(String));
    expect(created.body.data.inflow.transferTransactionId).toBe(pairId);

    // Literal oracles and independent row reads; no production balance helper.
    const assertPair = async (sourceBalance: string, destinationBalance: string, amount: string, deleted: boolean) => {
      const persisted = await snapshot();
      expect.soft(persisted.accounts.find(account => account.id === fromId)).toMatchObject({
        balance: sourceBalance, initialBalance: scenario.sourceOpening,
        currency: scenario.currency, isAsset: scenario.sourceIsAsset,
      });
      expect.soft(persisted.accounts.find(account => account.id === toId)).toMatchObject({
        balance: destinationBalance, initialBalance: scenario.destinationOpening,
        currency: scenario.currency, isAsset: scenario.destinationIsAsset,
      });
      expect.soft(persisted.legs).toHaveLength(2);
      expect.soft(persisted.legs.find(leg => leg.id === outflowId)).toMatchObject({
        householdId, accountId: fromId, transferAccountId: toId, transferTransactionId: pairId,
        type: "transfer", isTransferIn: false, amount, currency: scenario.currency,
        date: "2026-02-12", deletedAt: deleted ? expect.any(Date) : null,
      });
      expect.soft(persisted.legs.find(leg => leg.id === inflowId)).toMatchObject({
        householdId, accountId: toId, transferAccountId: fromId, transferTransactionId: pairId,
        type: "transfer", isTransferIn: true, amount, currency: scenario.currency,
        date: "2026-02-12", deletedAt: deleted ? expect.any(Date) : null,
      });
    };
    await assertPair(scenario.createdSource, scenario.createdDestination, scenario.createAmount, false);

    const editBody = { fromAccountId: fromId, toAccountId: toId,
      amount: { amount: scenario.editAmount, currency: scenario.currency } };
    const freshLogin = await request(app).post("/api/auth/login").send({ email: EMAIL, password: PASSWORD }).expect(200);
    const unsteppedHeaders = { ...headers, Cookie: (freshLogin.headers["set-cookie"] as unknown as string[]).join("; ") };
    const beforeDeniedEdit = await snapshot();
    const deniedEdit = await request(app).put(`/api/transactions/transfer/${outflowId}`).set(unsteppedHeaders).send(editBody).expect(401);
    expect(deniedEdit.body).toMatchObject({ requiresStepUp: true, level: "FINANCIAL", error: { code: "STEP_UP_REQUIRED" } });
    expect(await snapshot()).toEqual(beforeDeniedEdit);

    const edited = await request(app).put(`/api/transactions/transfer/${outflowId}`).set(headers).send(editBody).expect(200);
    expect(edited.body.success).toBe(true);
    expect(edited.body.data.outflow.id).toBe(outflowId);
    expect(edited.body.data.inflow.id).toBe(inflowId);
    await assertPair(scenario.editedSource, scenario.editedDestination, scenario.editAmount, false);

    const deleted = await request(app).delete(`/api/transactions/${inflowId}`).set(headers).expect(200);
    expect(deleted.body.success).toBe(true);
    await assertPair(scenario.sourceOpening, scenario.destinationOpening, scenario.editAmount, true);
    const deletedState = await snapshot();
    await request(app).delete(`/api/transactions/${outflowId}`).set(headers).expect(404);
    expect(await snapshot()).toEqual(deletedState);
  });

  // 5. Repeated wrong-password step-up attempts lock the account (brute-force defense).
  // Runs last because it leaves the user locked (cleaned up in afterAll).
  it("locks the account after repeated wrong-password step-up attempts", async () => {
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/api/settings/security/step-up")
        .set("Cookie", authCookie)
        .send({ password: "WrongPassword!" });
    }

    // While locked, even the correct password is rejected (uniform 401).
    const lockedRes = await request(app)
      .post("/api/settings/security/step-up")
      .set("Cookie", authCookie)
      .send({ password: PASSWORD });
    expect(lockedRes.status).toBe(401);
    expect(lockedRes.body.error.code).toBe("INVALID_CREDENTIALS");

    // The lock is persisted on the user row.
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row.lockedUntil).not.toBeNull();
  });
});
