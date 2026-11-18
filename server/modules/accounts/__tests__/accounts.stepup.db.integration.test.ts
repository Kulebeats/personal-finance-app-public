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
import { eq } from "drizzle-orm";
import {
  users,
  households,
  householdMembers,
  accounts,
  transactions,
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
  const PASSWORD = "TestPassword123!";

  beforeAll(async () => {
    app = await getTestApp();

    const testUser = createTestUser({
      email: `stepup-${timestamp}@example.com`,
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
    await db
      .delete(transactions)
      .where(eq(transactions.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db
      .delete(householdMembers)
      .where(eq(householdMembers.householdId, householdId));
    // users table has no householdId column — delete by userId directly
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(households).where(eq(households.id, householdId));
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
