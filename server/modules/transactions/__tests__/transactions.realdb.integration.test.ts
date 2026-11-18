/**
 * Transactions Module - REAL-DB HTTP + service Integration Tests (SCP-316)
 *
 * Audit gap (§3.11): Transactions had ZERO real-DB HTTP tests, and the transfer
 * FOR UPDATE / overdraft guard (SCP-320) was only ever exercised by mock-theater
 * suites that test nothing real.
 *
 * This file proves, against REAL Postgres (no mocks):
 *   1. POST /api/transactions creates a transaction over real HTTP and writes a
 *      CREATE audit row (Rule 9).
 *   2. A transaction referencing another household's account is rejected 404
 *      (household scoping, Rule 11) and nothing is persisted.
 *   3. The transfer write path prevents a double-spend under genuine concurrency:
 *      two transfers racing the same insufficient balance -> exactly one wins,
 *      the source never goes negative, and only one transfer pair is persisted.
 *      (The fix under test is TransferService.createTransfer FOR UPDATE +
 *      overdraft, already on main from SCP-320; this test must PASS against it.)
 *
 * The transfer concurrency is exercised at the service layer because the HTTP
 * transfer route is gated by requireStepUp("FINANCIAL"), which a fresh test
 * session does not satisfy; the row locks live in the service/repository, so the
 * service-level race is the meaningful test of the fix.
 *
 * NODE_ENV=test disables CSRF (see server/app.ts), so only the session cookie is
 * required for the HTTP tests.
 *
 * @module modules/transactions/__tests__/transactions.realdb.integration.test
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
  type Transaction,
} from "@shared/schema";
import {
  getTestApp,
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";
import { transferService } from "../../../services/TransferService";
import { transactionRepository } from "../../../repositories/TransactionRepository";
import { ValidationError } from "../../../utils/errorHandler";
import { hashPassword } from "../../../auth";
import { randomUUID } from "crypto";

interface AuditRow {
  id: string;
  householdId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
}

describe("Transactions REAL-DB Integration (SCP-316)", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;
  let accountId: string;

  // Second household: proves cross-household account access is rejected.
  let otherHouseholdId: string;
  let otherUserId: string;
  let otherAccountId: string;

  const timestamp = Date.now();

  beforeAll(async () => {
    app = await getTestApp();

    // --- Primary household + user + account ---
    const testUser = createTestUser({
      email: `txn-realdb-${timestamp}@example.com`,
      username: `txn-realdb-user-${timestamp}`,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "Txn RealDB Household",
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
      name: "Primary Checking",
      type: "checking",
      balance: "10000.00",
      currency: "ZMW",
      isAsset: true,
    });

    // --- Second household + account (no shared membership) ---
    const otherUser = createTestUser({
      email: `txn-realdb-other-${timestamp}@example.com`,
      username: `txn-realdb-other-${timestamp}`,
    });
    const otherHousehold = createTestHousehold(otherUser.id, {
      name: "Txn RealDB Other Household",
      currency: "ZMW",
    });
    otherUser.passwordHash = await hashPassword("OtherPassword123");
    otherHouseholdId = otherHousehold.id;
    otherUserId = otherUser.id;
    otherUser.householdId = otherHousehold.id;

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
        .delete(auditLogs)
        .where(eq(auditLogs.householdId, otherHouseholdId));
      await db
        .delete(transactions)
        .where(eq(transactions.householdId, householdId));
      await db
        .delete(transactions)
        .where(eq(transactions.householdId, otherHouseholdId));
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
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(users).where(eq(users.id, otherUserId));
      await db.delete(households).where(eq(households.id, householdId));
      await db.delete(households).where(eq(households.id, otherHouseholdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Transactions SCP-316 cleanup error", error);
    }
  });

  // Seed a fresh source/destination account pair in the primary household.
  async function seedTransferPair(sourceBalance: string): Promise<{
    fromId: string;
    toId: string;
  }> {
    const fromId = randomUUID();
    const toId = randomUUID();
    await db.insert(accounts).values([
      {
        id: fromId,
        householdId,
        name: `xfer-src-${fromId.slice(0, 8)}`,
        type: "checking",
        balance: sourceBalance,
        currency: "ZMW",
        isAsset: true,
      },
      {
        id: toId,
        householdId,
        name: `xfer-dst-${toId.slice(0, 8)}`,
        type: "checking",
        balance: "0.00",
        currency: "ZMW",
        isAsset: true,
      },
    ]);
    return { fromId, toId };
  }

  const balanceOf = async (id: string): Promise<string> => {
    const [row] = await db
      .select({ balance: accounts.balance })
      .from(accounts)
      .where(eq(accounts.id, id))
      .limit(1);
    return row.balance;
  };

  describe("GET /api/transactions (visibility pagination)", () => {
    it("applies transaction visibility before limit/offset pagination", async () => {
      const deletedAccountId = randomUUID();
      await db.insert(accounts).values({
        id: deletedAccountId,
        householdId,
        name: "Deleted account",
        type: "checking",
        balance: "0.00",
        currency: "ZMW",
        isAsset: true,
        deletedAt: new Date(),
      });

      await db.insert(transactions).values([
        {
          householdId,
          accountId,
          ownerUserId: otherUserId,
          date: "2026-12-31",
          name: "Invisible private transaction",
          amount: "10.00",
          currency: "ZMW",
          type: "expense",
          isPrivate: true,
        },
        {
          householdId,
          accountId,
          ownerUserId: userId,
          date: "2026-12-30",
          name: "Visible page transaction",
          amount: "20.00",
          currency: "ZMW",
          type: "expense",
          isPrivate: false,
        },
        {
          householdId,
          accountId: deletedAccountId,
          ownerUserId: userId,
          date: "2026-12-29",
          name: "Deleted account transaction",
          amount: "30.00",
          currency: "ZMW",
          type: "expense",
          isPrivate: false,
        },
      ]);

      const res = await request(app)
        .get(
          "/api/transactions?limit=1&offset=0&startDate=2026-12-01&endDate=2026-12-31",
        )
        .set("Cookie", authCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe("Visible page transaction");
      expect(res.body.pagination.total).toBe(1);
      expect(res.body.pagination.hasNext).toBe(false);
    });
  });

  describe("POST /api/transactions (create)", () => {
    it("creates an expense over real HTTP and persists it", async () => {
      const res = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId,
          amount: { amount: "120.50", currency: "ZMW" },
          type: "expense",
          date: "2026-02-10",
          name: "Groceries",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      const txnId: string = res.body.data.id;

      const [persisted] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, txnId));
      expect(persisted).toBeDefined();
      expect(persisted.householdId).toBe(householdId);
      expect(persisted.accountId).toBe(accountId);
      expect(persisted.amount).toBe("120.50");
      expect(persisted.type).toBe("expense");
    });

    it("writes a CREATE audit row for the transaction (Rule 9)", async () => {
      const res = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId,
          amount: { amount: "75.00", currency: "ZMW" },
          type: "expense",
          date: "2026-02-11",
          name: "Audited Expense",
        })
        .expect(201);

      const txnId: string = res.body.data.id;

      const [audit] = (await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "transaction"),
            eq(auditLogs.entityId, txnId),
            eq(auditLogs.action, "CREATE"),
          ),
        )) as AuditRow[];

      expect(audit).toBeDefined();
      expect(audit.householdId).toBe(householdId);
      expect(audit.userId).toBe(userId);
    });

    it("rejects invalid payload with 400", async () => {
      const res = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId,
          amount: { amount: "-5.00", currency: "ZMW" },
          type: "expense",
          date: "2026-02-12",
          name: "Bad",
        });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("rejects asset-account expenses that would overdraw the account", async () => {
      const guardedAccountId = randomUUID();
      await db.insert(accounts).values({
        id: guardedAccountId,
        householdId,
        name: "Guarded Checking",
        type: "checking",
        balance: "25.00",
        currency: "ZMW",
        isAsset: true,
      });

      const res = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId: guardedAccountId,
          amount: { amount: "30.00", currency: "ZMW" },
          type: "expense",
          date: "2026-02-12",
          name: "Overdraft attempt",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(await balanceOf(guardedAccountId)).toBe("25.00");

      const persisted = await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, guardedAccountId));
      expect(persisted).toHaveLength(0);
    });

    it("accepts income into a negative-balance asset account (deposit is never an overdraft)", async () => {
      const overdrawnAccountId = randomUUID();
      await db.insert(accounts).values({
        id: overdrawnAccountId,
        householdId,
        name: "Overdrawn Checking",
        type: "checking",
        balance: "-80.00",
        currency: "ZMW",
        isAsset: true,
      });

      const res = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId: overdrawnAccountId,
          amount: { amount: "50.00", currency: "ZMW" },
          type: "income",
          date: "2026-02-13",
          name: "Partial repayment",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(await balanceOf(overdrawnAccountId)).toBe("-30.00");
    });

    it("allows liability-account expenses to move the balance negative", async () => {
      const liabilityAccountId = randomUUID();
      await db.insert(accounts).values({
        id: liabilityAccountId,
        householdId,
        name: "Credit Card",
        type: "credit",
        balance: "0.00",
        currency: "ZMW",
        isAsset: false,
      });

      await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId: liabilityAccountId,
          amount: { amount: "30.00", currency: "ZMW" },
          type: "expense",
          date: "2026-02-12",
          name: "Credit spend",
        })
        .expect(201);

      expect(await balanceOf(liabilityAccountId)).toBe("-30.00");
    });
  });

  describe("PUT /api/transactions/:id (update)", () => {
    it("rejects an asset expense update that would overdraw and rolls back", async () => {
      const guardedAccountId = randomUUID();
      await db.insert(accounts).values({
        id: guardedAccountId,
        householdId,
        name: "Update Guard Checking",
        type: "checking",
        balance: "100.00",
        currency: "ZMW",
        isAsset: true,
      });

      const createRes = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId: guardedAccountId,
          amount: { amount: "40.00", currency: "ZMW" },
          type: "expense",
          date: "2026-02-14",
          name: "Initial expense",
        })
        .expect(201);

      expect(await balanceOf(guardedAccountId)).toBe("60.00");

      const txnId: string = createRes.body.data.id;
      const updateRes = await request(app)
        .put(`/api/transactions/${txnId}`)
        .set("Cookie", authCookie)
        .send({
          amount: { amount: "150.00", currency: "ZMW" },
        });

      expect(updateRes.status).toBe(400);
      expect(updateRes.body.success).toBe(false);
      expect(await balanceOf(guardedAccountId)).toBe("60.00");

      const [persisted] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, txnId));
      expect(persisted.amount).toBe("40.00");
    });

    it("moves balance impact between locked accounts when accountId changes", async () => {
      const sourceAccountId = randomUUID();
      const targetAccountId = randomUUID();
      await db.insert(accounts).values([
        {
          id: sourceAccountId,
          householdId,
          name: "Original Checking",
          type: "checking",
          balance: "100.00",
          currency: "ZMW",
          isAsset: true,
        },
        {
          id: targetAccountId,
          householdId,
          name: "Target Checking",
          type: "checking",
          balance: "20.00",
          currency: "ZMW",
          isAsset: true,
        },
      ]);

      const createRes = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId: sourceAccountId,
          amount: { amount: "40.00", currency: "ZMW" },
          type: "expense",
          date: "2026-02-14",
          name: "Move account expense",
        })
        .expect(201);

      expect(await balanceOf(sourceAccountId)).toBe("60.00");
      expect(await balanceOf(targetAccountId)).toBe("20.00");

      const txnId: string = createRes.body.data.id;
      const updateResult = await transactionRepository.update(
        txnId,
        householdId,
        {
          accountId: targetAccountId,
          amount: "15.00",
          currency: "ZMW",
        } satisfies Partial<Transaction>,
      );

      expect(updateResult.conflict).toBe(false);
      expect(updateResult.transaction?.accountId).toBe(targetAccountId);
      expect(await balanceOf(sourceAccountId)).toBe("100.00");
      expect(await balanceOf(targetAccountId)).toBe("5.00");
    });
  });

  describe("Household scoping (Rule 11)", () => {
    it("rejects a transaction referencing another household's account (404)", async () => {
      const res = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId: otherAccountId,
          amount: { amount: "10.00", currency: "ZMW" },
          type: "expense",
          date: "2026-02-13",
          name: "Cross-household attempt",
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);

      // Nothing was written against the foreign account.
      const leaked = await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, otherAccountId));
      expect(leaked.length).toBe(0);
    });
  });

  describe("Transfer no-double-spend under concurrency (SCP-320 fix)", () => {
    it("lets exactly one of two racing full-balance transfers win", async () => {
      // Source has exactly 100; two concurrent transfers of 100 each race.
      const { fromId, toId } = await seedTransferPair("100.00");

      const results = await Promise.allSettled([
        transferService.createTransfer(
          fromId,
          toId,
          "100.00",
          householdId,
          userId,
          { name: "race-A" },
        ),
        transferService.createTransfer(
          fromId,
          toId,
          "100.00",
          householdId,
          userId,
          { name: "race-B" },
        ),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      // Exactly one transfer succeeds; the other fails for insufficient funds.
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const reason = (rejected[0] as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(ValidationError);

      // No double-spend: source drained to exactly 0, destination got exactly 100.
      expect(await balanceOf(fromId)).toBe("0.00");
      expect(await balanceOf(toId)).toBe("100.00");

      // Only one transfer pair persisted (one outflow row on the source).
      const sourceRows = await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, fromId));
      expect(sourceRows.length).toBe(1);
    });
  });
});
