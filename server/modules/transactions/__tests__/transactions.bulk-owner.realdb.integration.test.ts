/**
 * Bulk-Owner Endpoint - REAL-DB HTTP Integration Tests (SCP-331)
 *
 * Audit gap (§4, High): PUT /api/transactions/bulk-owner was unvalidated and
 * uncapped. It read req.body.transactionIds with no Zod validation (a malformed
 * body could 500) and no batch-size cap (unbounded-parallel work -> DOS risk).
 * The fix wires the existing `bulkSetTransactionOwnerSchema` into the controller.
 *
 * This file proves, against REAL Postgres over REAL HTTP (no mocks):
 *   (a) an invalid payload (wrong shape: non-UUID transaction ids) -> 400.
 *   (b) an oversized payload (101 ids, over the 100 cap)            -> 400.
 *   (c) a valid in-cap payload                                      -> 200,
 *       and the new owner is actually persisted on the transactions.
 *
 * NODE_ENV=test disables CSRF (see server/app.ts), so only the session cookie is
 * required for the HTTP tests.
 *
 * @module modules/transactions/__tests__/transactions.bulk-owner.realdb.integration.test
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
  auditLogs,
} from "@shared/schema";
import {
  getTestApp,
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { randomUUID } from "crypto";

describe("Bulk-Owner Endpoint REAL-DB Integration (SCP-331)", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;
  let memberUserId: string;
  let accountId: string;
  let txnIdA: string;
  let txnIdB: string;

  const timestamp = Date.now();

  beforeAll(async () => {
    app = await getTestApp();

    // --- Household + admin user (the caller) ---
    const testUser = createTestUser({
      email: `bulkowner-${timestamp}@example.com`,
      username: `bulkowner-user-${timestamp}`,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "BulkOwner Household",
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

    // --- A second member of the same household (valid new owner) ---
    const memberUser = createTestUser({
      email: `bulkowner-member-${timestamp}@example.com`,
      username: `bulkowner-member-${timestamp}`,
    });
    memberUserId = memberUser.id;
    memberUser.householdId = testHousehold.id;
    await db.insert(users).values({
      id: memberUser.id,
      email: memberUser.email,
      username: memberUser.username,
      passwordHash: await hashPassword("MemberPassword123"),
      fullName: memberUser.fullName,
      emailVerified: memberUser.emailVerified,
      mfaEnabled: memberUser.mfaEnabled,
      failedLoginAttempts: memberUser.failedLoginAttempts,
      lockedUntil: memberUser.lockedUntil,
    });
    await db.insert(householdMembers).values({
      householdId: testHousehold.id,
      userId: memberUser.id,
      role: "member",
    });

    accountId = randomUUID();
    await db.insert(accounts).values({
      id: accountId,
      householdId,
      name: "BulkOwner Checking",
      type: "checking",
      balance: "10000.00",
      currency: "ZMW",
      isAsset: true,
    });

    // Seed two transactions owned by the caller; the valid case reassigns them.
    txnIdA = randomUUID();
    txnIdB = randomUUID();
    await db.insert(transactions).values([
      {
        id: txnIdA,
        householdId,
        accountId,
        amount: "50.00",
        type: "expense",
        date: "2026-03-01",
        name: "Bulk owner txn A",
        ownerUserId: userId,
        currency: "ZMW",
      },
      {
        id: txnIdB,
        householdId,
        accountId,
        amount: "75.00",
        type: "expense",
        date: "2026-03-02",
        name: "Bulk owner txn B",
        ownerUserId: userId,
        currency: "ZMW",
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
        .delete(transactions)
        .where(eq(transactions.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, householdId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(users).where(eq(users.id, memberUserId));
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Bulk-owner SCP-331 cleanup error", error);
    }
  });

  describe("PUT /api/transactions/bulk-owner validation (SCP-331)", () => {
    it("rejects an invalid payload (non-UUID transaction ids) with 400", async () => {
      const res = await request(app)
        .put("/api/transactions/bulk-owner")
        .set("Cookie", authCookie)
        .send({
          transactionIds: ["not-a-uuid", "also-not-a-uuid"],
          ownerUserId: memberUserId,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("rejects an oversized payload (over the 100 cap) with 400", async () => {
      const tooMany = Array.from({ length: 101 }, () => randomUUID());
      const res = await request(app)
        .put("/api/transactions/bulk-owner")
        .set("Cookie", authCookie)
        .send({
          transactionIds: tooMany,
          ownerUserId: memberUserId,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("accepts a valid in-cap payload (200) and persists the new owner", async () => {
      const res = await request(app)
        .put("/api/transactions/bulk-owner")
        .set("Cookie", authCookie)
        .send({
          transactionIds: [txnIdA, txnIdB],
          ownerUserId: memberUserId,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(2);

      // The new owner is actually persisted on both transactions.
      const persisted = await db
        .select({ id: transactions.id, ownerUserId: transactions.ownerUserId })
        .from(transactions)
        .where(eq(transactions.householdId, householdId));
      const owners = new Map(persisted.map((t) => [t.id, t.ownerUserId]));
      expect(owners.get(txnIdA)).toBe(memberUserId);
      expect(owners.get(txnIdB)).toBe(memberUserId);
    });
  });
});
