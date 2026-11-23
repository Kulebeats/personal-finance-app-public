/**
 * Packet P6a (DPA audit edges): transaction CREATE/DELETE audit must live at the
 * service/repository layer, not only in the transactions controller — REAL DB.
 *
 * Audit finding (production-readiness-audit-v2-2026-07-11.md): the CREATE and
 * DELETE audit rows for `entityType: "transaction"` were written ONLY inside
 * transactions.controller.ts's `create`/`remove` handlers. Any caller that
 * reaches transactionService.createTransaction / deleteTransaction WITHOUT going
 * through that controller (GRZ coupon postings, CSV import, future callers)
 * produced a real ledger write with NO audit trail — a Zambia DPA gap.
 *
 * The fix moves the audit write down into TransactionRepository.create /
 * .softDelete and TransactionTransferRepository.softDeleteTransferPair, using
 * the same `audit` option shape RecurringProcessingService already established
 * (packet R5) for createWithinTransaction. The controller no longer audits
 * separately, so a single HTTP request must still produce exactly ONE row.
 *
 * These tests run the real service/repository against real Postgres:
 *  (a) CREATE via the SERVICE directly (bypassing the controller) writes a
 *      CREATE auditLogs row. Fails on old code (absent).
 *  (b) DELETE via the SERVICE directly (bypassing the controller) writes a
 *      DELETE auditLogs row. Fails on old code (absent).
 *  (c) POST /api/transactions (through the controller) writes EXACTLY ONE
 *      CREATE row — proves the controller's old separate audit call was
 *      removed, not left to double-audit alongside the new repository-level one.
 *  (d) DELETE /api/transactions/:id (through the controller) writes EXACTLY
 *      ONE DELETE row, same proof for the delete path.
 *
 * @module services/transaction/__tests__/p6a-create-delete-audit.realdb.integration.test
 */
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../../../db";
import {
  users,
  households,
  householdMembers,
  accounts,
  transactions,
  auditLogs,
  outboxEvents,
} from "@shared/schema";
import {
  getTestApp,
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { transactionService } from "../service";
import { transactionRepository } from "../../../repositories/TransactionRepository";
import { withTransaction } from "../../../utils/withTransaction";

describe("Transaction CREATE/DELETE audit lives at the service layer (P6a) — REAL DB", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;
  let accountId: string;

  const timestamp = Date.now();

  beforeAll(async () => {
    app = await getTestApp();

    const testUser = createTestUser({
      email: `p6a-${timestamp}@example.com`,
      username: `p6a-user-${timestamp}`,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "P6a Household",
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
      name: "P6a Checking",
      type: "checking",
      balance: "10000.00",
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
      await db.delete(outboxEvents).where(eq(outboxEvents.householdId, householdId));
      await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
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
      console.error("P6a cleanup error", error);
    }
  });

  const auditRowsFor = async (entityId: string, action: "CREATE" | "DELETE") =>
    db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "transaction"),
          eq(auditLogs.entityId, entityId),
          eq(auditLogs.action, action),
        ),
      );

  describe("Service-layer create (bypasses the controller)", () => {
    it("writes a CREATE auditLogs row even when called directly from the service", async () => {
      const { transaction } = await transactionService.createTransaction(
        {
          accountId,
          amount: "42.00",
          currency: "ZMW",
          type: "expense",
          date: "2026-03-01",
          name: "Service-direct expense (bypasses controller)",
        },
        householdId,
        userId,
      );

      const rows = await auditRowsFor(transaction.id, "CREATE");
      expect(rows).toHaveLength(1);
      expect(rows[0].householdId).toBe(householdId);
      expect(rows[0].userId).toBe(userId);
    });
  });

  // FIN-05: the posting receipt is the last line. Below the service check, a
  // posting in another currency is refused, never relabelled as the account's.
  describe("Repository create below the service currency check", () => {
    it("refuses a posting in a currency other than the account's: no row, no balance change", async () => {
      const balanceOf = async () => (await db.select({ balance: accounts.balance }).from(accounts).where(eq(accounts.id, accountId)))[0].balance;
      const before = await balanceOf();
      const name = "FIN-05 mismatched-currency posting";

      await expect(withTransaction(tx => transactionRepository.createWithinTransaction(tx, {
        householdId, ownerUserId: userId, accountId, name, amount: "42.00", currency: "USD", type: "expense", date: "2026-03-01",
      }, { createActor: { householdId, userId } }))).rejects.toMatchObject({ statusCode: 400, message: "Transaction currency must match the locked account currency" });

      expect(await db.select().from(transactions).where(and(eq(transactions.householdId, householdId), eq(transactions.name, name)))).toEqual([]);
      expect(await balanceOf()).toBe(before);
    });
  });

  describe("Service-layer delete (bypasses the controller)", () => {
    it("writes a DELETE auditLogs row even when called directly from the service", async () => {
      const { transaction } = await transactionService.createTransaction(
        {
          accountId,
          amount: "17.00",
          currency: "ZMW",
          type: "expense",
          date: "2026-03-02",
          name: "Service-direct expense to delete",
        },
        householdId,
        userId,
      );

      await transactionService.deleteTransaction(
        transaction.id,
        householdId,
        userId,
      );

      const rows = await auditRowsFor(transaction.id, "DELETE");
      expect(rows).toHaveLength(1);
      expect(rows[0].householdId).toBe(householdId);
      expect(rows[0].userId).toBe(userId);
    });
  });

  const eventsFor = (id: string) => db.select({
    eventType: outboxEvents.eventType,
    aggregateType: outboxEvents.aggregateType,
    payload: outboxEvents.payload,
  }).from(outboxEvents).where(and(eq(outboxEvents.householdId, householdId), eq(outboxEvents.aggregateId, id)));

  describe("HTTP controller path writes exactly ONE row (no double-audit)", () => {
    it("POST /api/transactions writes one CREATE audit row and one created event", async () => {
      const res = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId,
          amount: { amount: "9.99", currency: "ZMW" },
          type: "expense",
          date: "2026-03-03",
          name: "HTTP create - single audit row",
        })
        .expect(201);

      const txnId: string = res.body.data.id;
      const rows = await auditRowsFor(txnId, "CREATE");
      expect(rows).toHaveLength(1);
      expect(await eventsFor(txnId)).toEqual([{
        eventType: "transaction.created", aggregateType: "transaction",
        payload: expect.objectContaining({ id: txnId, accountId, type: "expense" }),
      }]);
    });

    it("DELETE /api/transactions/:id writes one DELETE audit row and one deleted event", async () => {
      const createRes = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId,
          amount: { amount: "5.50", currency: "ZMW" },
          type: "expense",
          date: "2026-03-04",
          name: "HTTP create for delete test",
        })
        .expect(201);

      const txnId: string = createRes.body.data.id;

      await request(app)
        .delete(`/api/transactions/${txnId}`)
        .set("Cookie", authCookie)
        .expect(200);

      const rows = await auditRowsFor(txnId, "DELETE");
      expect(rows).toHaveLength(1);
      const events = await eventsFor(txnId);
      expect(events).toHaveLength(2);
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ eventType: "transaction.created" }),
        { eventType: "transaction.deleted", aggregateType: "transaction", payload: { id: txnId } },
      ]));
    });
  });
});
