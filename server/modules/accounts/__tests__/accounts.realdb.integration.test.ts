/**
 * Accounts Module - REAL-DB HTTP Integration Tests (R15 / audit v2 finding E3)
 *
 * Audit gap: server/modules/accounts/__tests__/accounts.integration.test.ts mocks
 * accountService entirely, so the Accounts module — a core financial module — had
 * ZERO real-DB CRUD/balance/visibility coverage despite being the account-of-record
 * for every balance shown to the user.
 *
 * This file proves, against REAL Postgres (no mocked repositories/services):
 *   1. CRUD over real HTTP: create (+ validation 400, + CREATE audit row), read/list
 *      (household-scoped), update (+ UPDATE audit row, + the "no direct balance
 *      write" business rule), delete (guarded by step-up, soft-delete effect).
 *   2. Balance correctness: adjust-balance and a real transaction both mutate the
 *      account row, and a subsequent GET through the Accounts read path reflects it
 *      (Rule 1 money-critical path — Accounts is the read side of that path).
 *   3. Rule 11 visibility: a private account is invisible to a household member who
 *      is not its owner, both in the list and by direct id lookup.
 *   4. Cross-household authorization: another household's account is a 404 (not a
 *      leaked 403) for read, update, and delete.
 *
 * NODE_ENV=test disables CSRF (see server/app.ts), so only the session cookie is
 * required for the HTTP tests. DELETE is gated by requireStepUp("DESTRUCTIVE"); the
 * full step-up state-machine (wrong password, lockout, etc.) is already covered by
 * accounts.stepup.db.integration.test.ts, so here we only exercise the pass/fail
 * shape needed to prove delete's guard + effect.
 *
 * @module modules/accounts/__tests__/accounts.realdb.integration.test
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { db } from "../../../db";
import { eq, and } from "drizzle-orm";
import {
  users,
  households,
  householdMembers,
  accounts,
  transactions,
  auditLogs,
} from "@shared/schema";
import {
  getTestApp,
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { randomUUID } from "crypto";

interface AuditRow {
  id: string;
  householdId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  details: unknown;
}

describe("Accounts REAL-DB Integration (R15)", () => {
  let app: Express;

  // Primary household: userA (admin, creates/owns most fixtures) + userB (member,
  // used for the Rule 11 private-account visibility test).
  let householdId: string;
  let userAId: string;
  let userBId: string;
  let authCookieA: string;
  let authCookieB: string;

  // Second household: no shared membership with the primary household.
  let otherHouseholdId: string;
  let otherUserId: string;
  let otherAccountId: string;

  const timestamp = Date.now();
  const PASSWORD_A = "TestPassword123!";
  const PASSWORD_B = "TestPasswordB123!";
  const PASSWORD_OTHER = "OtherPassword123!";

  beforeAll(async () => {
    app = await getTestApp();

    // --- Primary household + two members ---
    const testUserA = createTestUser({
      email: `acct-realdb-a-${timestamp}@example.com`,
      username: `acct-realdb-a-${timestamp}`,
      mfaEnabled: false,
    });
    const testHousehold = createTestHousehold(testUserA.id, {
      name: "Accounts RealDB Household",
      currency: "ZMW",
    });
    testUserA.passwordHash = await hashPassword(PASSWORD_A);
    householdId = testHousehold.id;
    userAId = testUserA.id;

    const testUserB = createTestUser({
      email: `acct-realdb-b-${timestamp}@example.com`,
      username: `acct-realdb-b-${timestamp}`,
      mfaEnabled: false,
    });
    testUserB.passwordHash = await hashPassword(PASSWORD_B);
    userBId = testUserB.id;

    await db.insert(households).values({
      id: testHousehold.id,
      name: testHousehold.name,
      currency: testHousehold.currency,
    });
    await db.insert(users).values([
      {
        id: testUserA.id,
        email: testUserA.email,
        username: testUserA.username,
        passwordHash: testUserA.passwordHash,
        fullName: testUserA.fullName,
        emailVerified: testUserA.emailVerified,
        mfaEnabled: testUserA.mfaEnabled,
        failedLoginAttempts: testUserA.failedLoginAttempts,
        lockedUntil: testUserA.lockedUntil,
      },
      {
        id: testUserB.id,
        email: testUserB.email,
        username: testUserB.username,
        passwordHash: testUserB.passwordHash,
        fullName: testUserB.fullName,
        emailVerified: testUserB.emailVerified,
        mfaEnabled: testUserB.mfaEnabled,
        failedLoginAttempts: testUserB.failedLoginAttempts,
        lockedUntil: testUserB.lockedUntil,
      },
    ]);
    await db.insert(householdMembers).values([
      { householdId: testHousehold.id, userId: testUserA.id, role: "admin" },
      { householdId: testHousehold.id, userId: testUserB.id, role: "member" },
    ]);

    // --- Second household + account (no shared membership) ---
    const otherUser = createTestUser({
      email: `acct-realdb-other-${timestamp}@example.com`,
      username: `acct-realdb-other-${timestamp}`,
      mfaEnabled: false,
    });
    const otherHousehold = createTestHousehold(otherUser.id, {
      name: "Accounts RealDB Other Household",
      currency: "ZMW",
    });
    otherUser.passwordHash = await hashPassword(PASSWORD_OTHER);
    otherHouseholdId = otherHousehold.id;
    otherUserId = otherUser.id;

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

    otherAccountId = randomUUID();
    await db.insert(accounts).values({
      id: otherAccountId,
      householdId: otherHouseholdId,
      name: "Foreign Checking",
      type: "checking",
      balance: "5000.00",
      currency: "ZMW",
      isAsset: true,
    });

    const loginResA = await request(app)
      .post("/api/auth/login")
      .send({ email: testUserA.email, password: PASSWORD_A })
      .expect(200);
    authCookieA = loginResA.headers["set-cookie"]
      ? (loginResA.headers["set-cookie"] as unknown as string[]).join("; ")
      : "";

    const loginResB = await request(app)
      .post("/api/auth/login")
      .send({ email: testUserB.email, password: PASSWORD_B })
      .expect(200);
    authCookieB = loginResB.headers["set-cookie"]
      ? (loginResB.headers["set-cookie"] as unknown as string[]).join("; ")
      : "";
  });

  afterAll(async () => {
    try {
      await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
      await db
        .delete(auditLogs)
        .where(eq(auditLogs.householdId, otherHouseholdId));
      await db
        .delete(transactions)
        .where(eq(transactions.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      await db
        .delete(accounts)
        .where(eq(accounts.householdId, otherHouseholdId));
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, householdId));
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, otherHouseholdId));
      await db.delete(users).where(eq(users.id, userAId));
      await db.delete(users).where(eq(users.id, userBId));
      await db.delete(users).where(eq(users.id, otherUserId));
      await db.delete(households).where(eq(households.id, householdId));
      await db.delete(households).where(eq(households.id, otherHouseholdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Accounts R15 cleanup error", error);
    }
  });

  const accountRow = async (id: string) => {
    const [row] = await db.select().from(accounts).where(eq(accounts.id, id));
    return row;
  };

  // ==========================================================================
  // CREATE
  // ==========================================================================

  describe("POST /api/accounts (create)", () => {
    it("creates an account over real HTTP and persists it", async () => {
      const res = await request(app)
        .post("/api/accounts")
        .set("Cookie", authCookieA)
        .send({
          name: "Primary Checking",
          type: "checking",
          currency: "ZMW",
          initialBalance: "500.00",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      const accountId: string = res.body.data.id;

      const persisted = await accountRow(accountId);
      expect(persisted).toBeDefined();
      expect(persisted.householdId).toBe(householdId);
      expect(persisted.name).toBe("Primary Checking");
      expect(persisted.balance).toBe("500.00");
      expect(persisted.ownerUserId).toBe(userAId);
    });

    it("writes a CREATE audit row for the account (Rule 9)", async () => {
      const res = await request(app)
        .post("/api/accounts")
        .set("Cookie", authCookieA)
        .send({
          name: "Audited Savings",
          type: "savings",
          currency: "ZMW",
          initialBalance: "0.00",
        })
        .expect(201);

      const accountId: string = res.body.data.id;

      const [audit] = (await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "account"),
            eq(auditLogs.entityId, accountId),
            eq(auditLogs.action, "CREATE"),
          ),
        )) as AuditRow[];

      expect(audit).toBeDefined();
      expect(audit.householdId).toBe(householdId);
      expect(audit.userId).toBe(userAId);
    });

    it("rejects an invalid payload (missing name) with 400 and persists nothing", async () => {
      const res = await request(app)
        .post("/api/accounts")
        .set("Cookie", authCookieA)
        .send({
          type: "checking",
          currency: "ZMW",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBeDefined();
    });

    it("rejects an invalid account type with 400", async () => {
      const res = await request(app)
        .post("/api/accounts")
        .set("Cookie", authCookieA)
        .send({
          name: "Bad Type Account",
          type: "not_a_real_type",
          currency: "ZMW",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================================================
  // READ / LIST (household scoping)
  // ==========================================================================

  describe("GET /api/accounts (list, household scoping)", () => {
    it("returns accounts for the caller's own household", async () => {
      const seedId = randomUUID();
      await db.insert(accounts).values({
        id: seedId,
        householdId,
        name: "List Visibility Checking",
        type: "checking",
        balance: "100.00",
        currency: "ZMW",
        isAsset: true,
      });

      const res = await request(app)
        .get("/api/accounts")
        .set("Cookie", authCookieA)
        .expect(200);

      expect(res.body.success).toBe(true);
      const ids = (res.body.data as Array<{ id: string }>).map((a) => a.id);
      expect(ids).toContain(seedId);
    });

    it("does NOT return another household's accounts", async () => {
      const res = await request(app)
        .get("/api/accounts")
        .set("Cookie", authCookieA)
        .expect(200);

      const ids = (res.body.data as Array<{ id: string }>).map((a) => a.id);
      expect(ids).not.toContain(otherAccountId);
    });
  });

  describe("GET /api/accounts/:id", () => {
    it("returns a single account by id", async () => {
      const seedId = randomUUID();
      await db.insert(accounts).values({
        id: seedId,
        householdId,
        name: "GetById Checking",
        type: "checking",
        balance: "42.00",
        currency: "ZMW",
        isAsset: true,
      });

      const res = await request(app)
        .get(`/api/accounts/${seedId}`)
        .set("Cookie", authCookieA)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(seedId);
      expect(res.body.data.balance).toBe("42.00");
    });

    it("returns 404 for another household's account (authz)", async () => {
      const res = await request(app)
        .get(`/api/accounts/${otherAccountId}`)
        .set("Cookie", authCookieA);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("returns 404 for a non-existent account id", async () => {
      const res = await request(app)
        .get(`/api/accounts/${randomUUID()}`)
        .set("Cookie", authCookieA);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================================================
  // RULE 11 VISIBILITY — private accounts
  // ==========================================================================

  describe("Rule 11 visibility - private accounts", () => {
    let privateAccountId: string;

    beforeAll(async () => {
      // User B creates a private account (ownerUserId defaults to creator).
      const res = await request(app)
        .post("/api/accounts")
        .set("Cookie", authCookieB)
        .send({
          name: "User B Private Savings",
          type: "savings",
          currency: "ZMW",
          initialBalance: "300.00",
          isPrivate: true,
        })
        .expect(201);
      privateAccountId = res.body.data.id;
    });

    it("is invisible to a different household member in the list", async () => {
      const res = await request(app)
        .get("/api/accounts")
        .set("Cookie", authCookieA)
        .expect(200);

      const ids = (res.body.data as Array<{ id: string }>).map((a) => a.id);
      expect(ids).not.toContain(privateAccountId);
    });

    it("is invisible to a different household member by direct id (404)", async () => {
      const res = await request(app)
        .get(`/api/accounts/${privateAccountId}`)
        .set("Cookie", authCookieA);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("is visible to its owner in the list and by direct id", async () => {
      const listRes = await request(app)
        .get("/api/accounts")
        .set("Cookie", authCookieB)
        .expect(200);
      const ids = (listRes.body.data as Array<{ id: string }>).map(
        (a) => a.id,
      );
      expect(ids).toContain(privateAccountId);

      const getRes = await request(app)
        .get(`/api/accounts/${privateAccountId}`)
        .set("Cookie", authCookieB)
        .expect(200);
      expect(getRes.body.data.id).toBe(privateAccountId);
      expect(getRes.body.data.isPrivate).toBe(true);
    });
  });

  // ==========================================================================
  // UPDATE
  // ==========================================================================

  describe("PUT /api/accounts/:id (update)", () => {
    it("updates an account field over real HTTP and writes an UPDATE audit row", async () => {
      const seedId = randomUUID();
      await db.insert(accounts).values({
        id: seedId,
        householdId,
        name: "Original Name",
        type: "checking",
        balance: "10.00",
        currency: "ZMW",
        isAsset: true,
      });

      const res = await request(app)
        .put(`/api/accounts/${seedId}`)
        .set("Cookie", authCookieA)
        .send({ name: "Renamed Checking", institution: "Test Bank" })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("Renamed Checking");

      const persisted = await accountRow(seedId);
      expect(persisted.name).toBe("Renamed Checking");
      expect(persisted.institution).toBe("Test Bank");

      const [audit] = (await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "account"),
            eq(auditLogs.entityId, seedId),
            eq(auditLogs.action, "UPDATE"),
          ),
        )) as AuditRow[];
      expect(audit).toBeDefined();
      expect(audit.userId).toBe(userAId);
    });

    it("rejects direct balance modification via PUT (must use adjust-balance)", async () => {
      const seedId = randomUUID();
      await db.insert(accounts).values({
        id: seedId,
        householdId,
        name: "Balance Guard Checking",
        type: "checking",
        balance: "100.00",
        currency: "ZMW",
        isAsset: true,
      });

      const res = await request(app)
        .put(`/api/accounts/${seedId}`)
        .set("Cookie", authCookieA)
        .send({ balance: "999.00" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(await accountRow(seedId)).toMatchObject({ balance: "100.00" });
    });

    it("returns 404 when updating another household's account", async () => {
      const res = await request(app)
        .put(`/api/accounts/${otherAccountId}`)
        .set("Cookie", authCookieA)
        .send({ name: "Hijacked Name" });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);

      const stillForeign = await accountRow(otherAccountId);
      expect(stillForeign.name).toBe("Foreign Checking");
    });
  });

  // ==========================================================================
  // BALANCE CORRECTNESS (money-critical path)
  // ==========================================================================

  describe("Balance correctness — Accounts read reflects real writes", () => {
    it("reflects an adjust-balance increase on a subsequent GET", async () => {
      const seedId = randomUUID();
      await db.insert(accounts).values({
        id: seedId,
        householdId,
        name: "Adjust Balance Checking",
        type: "checking",
        balance: "1000.00",
        currency: "ZMW",
        isAsset: true,
      });

      const adjustRes = await request(app)
        .post(`/api/accounts/${seedId}/adjust-balance`)
        .set("Cookie", authCookieA)
        .send({ amount: "250.00", isIncrease: true, notes: "Bonus deposit" })
        .expect(200);

      expect(adjustRes.body.success).toBe(true);
      expect(adjustRes.body.data.account.balance).toBe("1250.00");

      const getRes = await request(app)
        .get(`/api/accounts/${seedId}`)
        .set("Cookie", authCookieA)
        .expect(200);
      expect(getRes.body.data.balance).toBe("1250.00");

      const [audit] = (await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "account"),
            eq(auditLogs.entityId, seedId),
            eq(auditLogs.action, "UPDATE"),
          ),
        )) as AuditRow[];
      expect(audit).toBeDefined();

      // A real transaction (expense) against the same account then reduces
      // the balance, and the Accounts read path reflects it exactly.
      const txnRes = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookieA)
        .send({
          accountId: seedId,
          amount: { amount: "120.50", currency: "ZMW" },
          type: "expense",
          date: "2026-03-01",
          name: "Groceries",
        })
        .expect(201);
      expect(txnRes.body.success).toBe(true);

      const getAfterTxn = await request(app)
        .get(`/api/accounts/${seedId}`)
        .set("Cookie", authCookieA)
        .expect(200);
      expect(getAfterTxn.body.data.balance).toBe("1129.50");

      // The list endpoint reflects the same balance.
      const listRes = await request(app)
        .get("/api/accounts")
        .set("Cookie", authCookieA)
        .expect(200);
      const listed = (
        listRes.body.data as Array<{ id: string; balance: string }>
      ).find((a) => a.id === seedId);
      expect(listed?.balance).toBe("1129.50");
    });

    it("rejects a non-positive adjust-balance amount with 400", async () => {
      const seedId = randomUUID();
      await db.insert(accounts).values({
        id: seedId,
        householdId,
        name: "Zero Adjust Checking",
        type: "checking",
        balance: "50.00",
        currency: "ZMW",
        isAsset: true,
      });

      const res = await request(app)
        .post(`/api/accounts/${seedId}/adjust-balance`)
        .set("Cookie", authCookieA)
        .send({ amount: "0.00", isIncrease: true });

      expect(res.status).toBe(400);
      expect(await accountRow(seedId)).toMatchObject({ balance: "50.00" });
    });
  });

  // ==========================================================================
  // DELETE (step-up guard + effect)
  // ==========================================================================

  describe("DELETE /api/accounts/:id (step-up guard + soft-delete effect)", () => {
    let deleteAccountId: string;

    beforeAll(async () => {
      deleteAccountId = randomUUID();
      await db.insert(accounts).values({
        id: deleteAccountId,
        householdId,
        name: "Account To Delete",
        type: "checking",
        balance: "0.00",
        currency: "ZMW",
        isAsset: true,
      });
    });

    it("blocks DELETE without step-up (401 requiresStepUp)", async () => {
      const res = await request(app)
        .delete(`/api/accounts/${deleteAccountId}`)
        .set("Cookie", authCookieA);

      expect(res.status).toBe(401);
      expect(res.body.requiresStepUp).toBe(true);

      // Nothing was deleted.
      const persisted = await accountRow(deleteAccountId);
      expect(persisted.deletedAt).toBeNull();
    });

    it("deletes (soft) after step-up and 404s on subsequent read", async () => {
      const stepUpRes = await request(app)
        .post("/api/settings/security/step-up")
        .set("Cookie", authCookieA)
        .send({ password: PASSWORD_A });
      expect(stepUpRes.status).toBe(200);
      expect(stepUpRes.body.success).toBe(true);

      const delRes = await request(app)
        .delete(`/api/accounts/${deleteAccountId}`)
        .set("Cookie", authCookieA)
        .expect(200);
      expect(delRes.body.success).toBe(true);

      const persisted = await accountRow(deleteAccountId);
      expect(persisted.deletedAt).not.toBeNull();

      const getRes = await request(app)
        .get(`/api/accounts/${deleteAccountId}`)
        .set("Cookie", authCookieA);
      expect(getRes.status).toBe(404);

      const [audit] = (await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "account"),
            eq(auditLogs.entityId, deleteAccountId),
            eq(auditLogs.action, "DELETE"),
          ),
        )) as AuditRow[];
      expect(audit).toBeDefined();
    });

    it("returns 404 (not the foreign account) when deleting another household's account, even with an active step-up window", async () => {
      // Step-up window from the previous test is still active for authCookieA.
      const res = await request(app)
        .delete(`/api/accounts/${otherAccountId}`)
        .set("Cookie", authCookieA);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);

      const stillThere = await accountRow(otherAccountId);
      expect(stillThere.deletedAt).toBeNull();
    });
  });
});
