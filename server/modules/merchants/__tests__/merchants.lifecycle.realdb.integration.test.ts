/**
 * Merchant delete options and merge undo (ORG-007, ORG-008), real HTTP against
 * real Postgres.
 *
 * The settings dialog offers two delete options, and each one has the effect
 * it describes:
 * - archive (DELETE /api/merchants/:id): the merchant becomes inactive; its
 *   transactions, aliases and logo stay with it, with or without transactions;
 * - merge (POST /api/merchants/:id/merge): transactions move to the target and
 *   an undo history row is written.
 * Permanent delete has no retention policy yet (OI-04, owner question), so the
 * server refuses it instead of silently archiving.
 *
 * Merge and undo set merchant usage counts from a fresh COUNT over the rows
 * they actually moved, and undo claims its history row atomically: two
 * concurrent undos restore once.
 */
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  auditLogs, merchantAliases, merchantLogoUploads, merchantMergeHistory, merchants, transactions,
} from "@shared/schema";
import { db, pool } from "../../../db";
import {
  createSignedHousehold, insertAccount, type SignedHousehold,
} from "../../../__tests__/signed-household-fixture";

let fx: SignedHousehold;
let accountId: string;

/** A merchant with a deliberately stale cached count, so recounts are visible. */
async function insertMerchant(name: string, cachedCount = 0): Promise<string> {
  const [merchant] = await db.insert(merchants)
    .values({ householdId: fx.householdId, name, isActive: true, transactionCount: cachedCount })
    .returning({ id: merchants.id });
  return merchant.id;
}

async function insertTransactions(merchantId: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    await db.insert(transactions).values({
      id, householdId: fx.householdId, accountId, merchantId, ownerUserId: fx.userId,
      amount: "-10.00", currency: fx.currency, date: "2026-03-04", name: `Synthetic txn ${i}`,
      type: "expense", isPending: false, isRecurring: false, isPrivate: false,
    });
    ids.push(id);
  }
  return ids;
}

/** Fresh COUNT of the transactions that reference a merchant. */
async function rowCount(merchantId: string): Promise<number> {
  const result = await pool.query("SELECT count(*)::int AS n FROM transactions WHERE merchant_id = $1", [merchantId]);
  return result.rows[0].n as number;
}

async function merchantRow(id: string) {
  const [row] = await db.select().from(merchants).where(eq(merchants.id, id));
  return row;
}

async function merchantIdsOf(ids: string[]): Promise<(string | null)[]> {
  const rows = await db.select({ id: transactions.id, merchantId: transactions.merchantId })
    .from(transactions).where(inArray(transactions.id, ids));
  return ids.map((id) => rows.find((row) => row.id === id)?.merchantId ?? null);
}

async function auditRows(entityId: string, action: "DELETE" | "MERGE" | "RESTORE") {
  return db.select().from(auditLogs).where(and(
    eq(auditLogs.householdId, fx.householdId), eq(auditLogs.entityId, entityId), eq(auditLogs.action, action),
  ));
}

function merge(sourceId: string, targetId: string) {
  return request(fx.app).post(`/api/merchants/${sourceId}/merge`).set(fx.headers).send({ targetMerchantId: targetId });
}

function undo(historyId: string) {
  return request(fx.app).post(`/api/merchants/merge/${historyId}/undo`).set(fx.headers).send({});
}

async function mergeAndGetHistory(sourceId: string, targetId: string): Promise<string> {
  const res = await merge(sourceId, targetId);
  expect(res.status).toBe(200);
  return res.body.data.mergeHistoryId as string;
}

describe("merchant delete options and merge undo (real Postgres)", () => {
  beforeAll(async () => {
    fx = await createSignedHousehold("merchant-lifecycle");
    accountId = await insertAccount(fx);
  }, 30000);

  afterAll(async () => {
    if (fx) await fx.cleanup(async () => {
      const ids = (await db.select({ id: merchants.id }).from(merchants)
        .where(eq(merchants.householdId, fx.householdId))).map((row) => row.id);
      if (ids.length > 0) {
        await db.delete(merchantMergeHistory).where(inArray(merchantMergeHistory.targetMerchantId, ids));
      }
    });
  });

  describe("archive (DELETE, the default option)", () => {
    it("archives a merchant with no transactions and audits it", async () => {
      const id = await insertMerchant("Synthetic Archive Empty");

      const res = await request(fx.app).delete(`/api/merchants/${id}`).set(fx.headers);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ action: "archive", keptTransactionCount: 0 });
      expect((await merchantRow(id)).isActive).toBe(false);
      expect(await auditRows(id, "DELETE")).toHaveLength(1);
    });

    it("archives a merchant that has transactions and keeps its transactions, aliases and logo", async () => {
      const id = await insertMerchant("Synthetic Archive Busy");
      const txnIds = await insertTransactions(id, 2);
      await db.insert(merchantAliases).values({ merchantId: id, aliasName: "SYNTHETIC ARCHIVE ALIAS" });
      const logoPath = `uploads/merchant-logos/${fx.householdId}/${randomUUID()}.png`;
      await db.insert(merchantLogoUploads).values({
        merchantId: id, originalFilename: "logo.png", storedFilename: "logo.png", filePath: logoPath,
        fileSize: 10, mimeType: "image/png", uploadedBy: fx.userId,
      });
      await db.update(merchants).set({ logoUrl: `/${logoPath}` }).where(eq(merchants.id, id));

      const res = await request(fx.app).delete(`/api/merchants/${id}?action=soft`).set(fx.headers);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ action: "archive", keptTransactionCount: 2 });
      const after = await merchantRow(id);
      expect(after).toMatchObject({ isActive: false, logoUrl: `/${logoPath}` });
      expect(await merchantIdsOf(txnIds)).toEqual([id, id]);
      expect(await db.select().from(merchantAliases).where(eq(merchantAliases.merchantId, id))).toHaveLength(1);
      expect(await db.select().from(merchantLogoUploads).where(eq(merchantLogoUploads.merchantId, id))).toHaveLength(1);
      expect(await auditRows(id, "DELETE")).toHaveLength(1);
    });

    it("refuses permanent delete (no retention policy yet) and leaves the merchant untouched", async () => {
      const id = await insertMerchant("Synthetic Hard Delete");
      await insertTransactions(id, 1);

      const res = await request(fx.app).delete(`/api/merchants/${id}?action=hard`).set(fx.headers);

      expect(res.status).toBe(400);
      expect((await merchantRow(id)).isActive).toBe(true);
      expect(await rowCount(id)).toBe(1);
      expect(await auditRows(id, "DELETE")).toHaveLength(0);
    });

    it("refuses action=merge on DELETE instead of archiving without merging", async () => {
      const source = await insertMerchant("Synthetic Delete Merge Source");
      const target = await insertMerchant("Synthetic Delete Merge Target");
      const txnIds = await insertTransactions(source, 1);

      const res = await request(fx.app)
        .delete(`/api/merchants/${source}?action=merge&mergeTargetId=${target}`).set(fx.headers);

      expect(res.status).toBe(400);
      expect((await merchantRow(source)).isActive).toBe(true);
      expect(await merchantIdsOf(txnIds)).toEqual([source]);
    });
  });

  describe("merge (POST /:id/merge, the merge option)", () => {
    it("moves the rows, sets both counts from a fresh COUNT and audits the merge", async () => {
      const source = await insertMerchant("Synthetic Merge Source", 7);
      const target = await insertMerchant("Synthetic Merge Target", 4);
      const sourceTxns = await insertTransactions(source, 2);
      await insertTransactions(target, 1);

      const historyId = await mergeAndGetHistory(source, target);

      expect(await merchantIdsOf(sourceTxns)).toEqual([target, target]);
      expect(await merchantRow(source)).toMatchObject({ isActive: false, transactionCount: 0 });
      expect((await merchantRow(target)).transactionCount).toBe(await rowCount(target));
      expect(await rowCount(target)).toBe(3);
      const [audit] = await auditRows(target, "MERGE");
      expect(audit?.details).toMatchObject({ sourceId: source, mergeHistoryId: historyId, mergedTransactionCount: 2 });
    });
  });

  describe("undo merge", () => {
    it("restores only rows still on the target and counts from the rows actually restored", async () => {
      const source = await insertMerchant("Synthetic Undo Source");
      const target = await insertMerchant("Synthetic Undo Target");
      const third = await insertMerchant("Synthetic Undo Third");
      const [kept, edited, deleted] = await insertTransactions(source, 3);
      await insertTransactions(target, 1);
      const historyId = await mergeAndGetHistory(source, target);
      await db.update(transactions).set({ merchantId: third }).where(eq(transactions.id, edited));
      await db.delete(transactions).where(eq(transactions.id, deleted));

      const res = await undo(historyId);

      expect(res.status).toBe(200);
      // ORG-008: the caller is told only about rows they can see; the deleted row is gone, so it is
      // not counted as skipped. The audit row below keeps the full count (2).
      expect(res.body.data).toMatchObject({ restoredTransactionCount: 1, skippedTransactionCount: 1 });
      expect(await merchantIdsOf([kept, edited])).toEqual([source, third]);
      expect(await merchantRow(source)).toMatchObject({ isActive: true, transactionCount: 1 });
      expect((await merchantRow(source)).transactionCount).toBe(await rowCount(source));
      expect((await merchantRow(target)).transactionCount).toBe(await rowCount(target));
      const [audit] = await auditRows(source, "RESTORE");
      expect(audit?.details).toMatchObject({ historyId, restoredTransactionCount: 1, skippedTransactionCount: 2 });
    });

    it("restores once when two undos of the same merge race: one 200, one 409", async () => {
      const source = await insertMerchant("Synthetic Race Source");
      const target = await insertMerchant("Synthetic Race Target");
      await insertTransactions(source, 3);
      await insertTransactions(target, 2);
      const historyId = await mergeAndGetHistory(source, target);

      const statuses = (await Promise.all([undo(historyId), undo(historyId)])).map((res) => res.status).sort();

      expect(statuses).toEqual([200, 409]);
      expect((await merchantRow(source)).transactionCount).toBe(await rowCount(source));
      expect((await merchantRow(target)).transactionCount).toBe(await rowCount(target));
      expect(await rowCount(source)).toBe(3);
      expect(await rowCount(target)).toBe(2);
      expect(await auditRows(source, "RESTORE")).toHaveLength(1);
      const [history] = await db.select().from(merchantMergeHistory).where(eq(merchantMergeHistory.id, historyId));
      expect(history.canUndo).toBe(false);
    });

    it("undoing the first of two chained merges restores nothing that moved on, with counts from rows", async () => {
      const a = await insertMerchant("Synthetic Chain A");
      const b = await insertMerchant("Synthetic Chain B");
      const c = await insertMerchant("Synthetic Chain C");
      const aTxns = await insertTransactions(a, 2);
      const firstHistory = await mergeAndGetHistory(a, b);
      await mergeAndGetHistory(b, c);

      const res = await undo(firstHistory);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ restoredTransactionCount: 0, skippedTransactionCount: 2 });
      expect(await merchantIdsOf(aTxns)).toEqual([c, c]);
      expect(await merchantRow(a)).toMatchObject({ isActive: true, transactionCount: 0 });
      expect((await merchantRow(c)).transactionCount).toBe(await rowCount(c));
    });

    it("answers 409 for an expired undo and changes nothing", async () => {
      const source = await insertMerchant("Synthetic Expired Source");
      const target = await insertMerchant("Synthetic Expired Target");
      const txnIds = await insertTransactions(source, 1);
      const historyId = await mergeAndGetHistory(source, target);
      await db.update(merchantMergeHistory)
        .set({ undoExpiresAt: new Date(Date.now() - 60_000) }).where(eq(merchantMergeHistory.id, historyId));

      const res = await undo(historyId);

      expect(res.status).toBe(409);
      expect(await merchantIdsOf(txnIds)).toEqual([target]);
      expect((await merchantRow(source)).isActive).toBe(false);
    });
  });
});
