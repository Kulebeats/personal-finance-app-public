/**
 * Merchants Module - archive, merge and undo merge (ORG-007, ORG-008)
 *
 * What each settings delete option does:
 * - archive (DELETE /merchants/:id): the merchant becomes inactive. Its
 *   transactions, aliases and logo stay with it, so it can be switched back
 *   on. Allowed with or without transactions.
 * - merge (POST /merchants/:id/merge): the source's transactions move to the
 *   target, the source is archived, and a history row records the moved ids
 *   for a 30-day undo. Aliases and logo stay with the archived source, so an
 *   undo restores them exactly; matching ignores inactive merchants.
 * Permanent delete is not offered: it has no retention policy yet (OI-04).
 *
 * Every operation runs in one transaction. It locks the merchant rows it
 * touches (in id order), sets transactionCount from a fresh COUNT of the
 * transactions that reference each merchant (never from a snapshot or cached
 * value), and writes its audit row through the same transaction (Rule 9).
 * Undo claims its history row with one conditional update, so two concurrent
 * undos restore once: the second gets 409. None of these writes a merchant
 * name or alias; the name namespace (merchants.name-guard) already counts
 * inactive merchants, so reactivating one cannot create a duplicate.
 *
 * What the caller is told (A-19, ORG-008): every count in a response is
 * counted for the caller as merchant detail counts it, so another member's
 * private account or transaction, and a deleted row, are never counted. The
 * operation itself still acts on every row of the household, and the full
 * counts go into the audit row only.
 *
 * @module modules/merchants/lifecycle.service
 */

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { merchantMergeHistory, merchants, transactions } from "@shared/schema";
import { ConflictError, NotFoundError } from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import type { WriteActor } from "./merchants.assets.service";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { visibleTransactionPredicate } from "../../core/authz/transaction-visibility";
import { merchantColumnsWithCount } from "./merchants.counts";

type Merchant = typeof merchants.$inferSelect;
type MergeHistory = typeof merchantMergeHistory.$inferSelect;

export interface ArchiveResult {
  merchant: Merchant;
  action: "archive";
  keptTransactionCount: number;
}

export interface MergeResult {
  merged: true;
  targetId: string;
  mergeHistoryId: string;
  mergedTransactionCount: number;
}

export interface UndoMergeResult {
  restoredMerchant: Merchant;
  target: Merchant;
  restoredTransactionCount: number;
  skippedTransactionCount: number;
}

/** Lock the household's merchants among `ids`, in id order (no lock cycles). */
async function lockMerchants(
  tx: TransactionType,
  householdId: string,
  ids: string[],
): Promise<Map<string, Merchant>> {
  const rows = await tx
    .select()
    .from(merchants)
    .where(and(eq(merchants.householdId, householdId), inArray(merchants.id, ids)))
    .orderBy(asc(merchants.id))
    .for("update");
  return new Map(rows.map((row) => [row.id, row]));
}

/** Set each merchant's transactionCount from a fresh COUNT over its rows. */
async function recountTransactions(
  tx: TransactionType,
  ids: string[],
): Promise<Map<string, Merchant>> {
  const rows = await tx
    .update(merchants)
    .set({
      transactionCount: sql`(SELECT count(*)::int FROM ${transactions} WHERE ${transactions.merchantId} = ${merchants.id})`,
      updatedAt: new Date(),
    })
    .where(inArray(merchants.id, ids))
    .returning();
  return new Map(rows.map((row) => [row.id, row]));
}

/** Which of `ids` the viewer can see (ORG-008); a row that no longer exists is not among them. */
async function visibleIds(tx: TransactionType, ids: string[], viewer: HouseholdContext): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(inArray(transactions.id, ids), visibleTransactionPredicate(viewer)));
  return new Set(rows.map((row) => row.id));
}

/** The merchants among `ids`, with transactionCount as `viewer` sees it (ORG-008). */
async function withViewerCounts(
  tx: TransactionType,
  ids: string[],
  viewer: HouseholdContext,
): Promise<Map<string, Merchant>> {
  const rows = await tx.select(merchantColumnsWithCount(viewer)).from(merchants).where(inArray(merchants.id, ids));
  return new Map(rows.map((row) => [row.id, row]));
}

function readMergedTransactionIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/** This household's history row, regardless of whether it can be undone. */
async function findHistory(
  tx: TransactionType,
  householdId: string,
  historyId: string,
): Promise<Pick<MergeHistory, "canUndo"> | undefined> {
  const [row] = await tx
    .select({ canUndo: merchantMergeHistory.canUndo })
    .from(merchantMergeHistory)
    .innerJoin(merchants, eq(merchants.id, merchantMergeHistory.targetMerchantId))
    .where(and(eq(merchantMergeHistory.id, historyId), eq(merchants.householdId, householdId)));
  return row;
}

/**
 * Claim the undo: flip canUndo in one conditional update. A concurrent claim
 * waits on the row and then finds canUndo already false, so only one wins.
 */
async function claimHistory(
  tx: TransactionType,
  householdId: string,
  historyId: string,
): Promise<MergeHistory> {
  const [claimed] = await tx
    .update(merchantMergeHistory)
    .set({ canUndo: false })
    .where(and(
      eq(merchantMergeHistory.id, historyId),
      eq(merchantMergeHistory.canUndo, true),
      sql`(${merchantMergeHistory.undoExpiresAt} IS NULL OR ${merchantMergeHistory.undoExpiresAt} > now())`,
      sql`EXISTS (SELECT 1 FROM ${merchants} WHERE ${merchants.id} = ${merchantMergeHistory.targetMerchantId} AND ${merchants.householdId} = ${householdId})`,
    ))
    .returning();
  if (claimed) return claimed;

  const existing = await findHistory(tx, householdId, historyId);
  if (!existing) throw new NotFoundError("Merchant merge history not found");
  if (!existing.canUndo) throw new ConflictError("Merchant merge has already been undone");
  throw new ConflictError("Merchant merge undo period has expired");
}

export const merchantLifecycleService = {
  /**
   * A-19: the caller is told how many transactions stay with the merchant
   * counted as merchant detail counts them for `viewer` (another member's
   * private account or transaction left out). The merchant-wide count goes
   * into the audit row only.
   */
  async archive(merchantId: string, actor: WriteActor, viewer: HouseholdContext): Promise<ArchiveResult> {
    return withTransaction(async (tx) => {
      const merchant = (await lockMerchants(tx, actor.householdId, [merchantId])).get(merchantId);
      if (!merchant) throw new NotFoundError("Merchant not found");

      const [{ kept, visibleKept }] = await tx
        .select({
          kept: sql<number>`count(*)::int`,
          visibleKept: sql<number>`(count(*) FILTER (WHERE ${visibleTransactionPredicate(viewer)}))::int`,
        })
        .from(transactions)
        .where(eq(transactions.merchantId, merchantId));
      const [updated] = await tx
        .update(merchants)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(merchants.id, merchantId))
        .returning();

      await businessAuditService.logDelete({
        tx,
        householdId: actor.householdId,
        userId: actor.userId,
        entityType: "merchant",
        entityId: merchantId,
        oldValue: { name: merchant.name, isActive: merchant.isActive },
        ipAddress: actor.ipAddress,
        metadata: { operation: "archive", keptTransactionCount: kept },
      });
      return {
        merchant: { ...updated, transactionCount: visibleKept },
        action: "archive",
        keptTransactionCount: visibleKept,
      };
    });
  },

  async merge(sourceId: string, targetId: string, actor: WriteActor, viewer: HouseholdContext): Promise<MergeResult> {
    if (sourceId === targetId) {
      throw new ConflictError("Cannot merge a merchant into itself");
    }
    const { householdId } = actor;
    return withTransaction(async (tx) => {
      const locked = await lockMerchants(tx, householdId, [sourceId, targetId]);
      const source = locked.get(sourceId);
      if (!source || !locked.has(targetId)) {
        throw new NotFoundError("Source or target merchant not found");
      }

      const moved = await tx
        .update(transactions)
        .set({ merchantId: targetId, updatedAt: new Date() })
        .where(and(eq(transactions.merchantId, sourceId), eq(transactions.householdId, householdId)))
        .returning({ id: transactions.id });
      const visibleMoved = await visibleIds(tx, moved.map((row) => row.id), viewer);
      await tx
        .update(merchants)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(merchants.id, sourceId));
      await recountTransactions(tx, [sourceId, targetId]);

      const [history] = await tx
        .insert(merchantMergeHistory)
        .values({
          sourceMerchantId: sourceId,
          sourceMerchantName: source.name,
          targetMerchantId: targetId,
          mergedTransactionIds: moved.map((row) => row.id),
          mergedBy: actor.userId,
          canUndo: true,
        })
        .returning({ id: merchantMergeHistory.id });

      await businessAuditService.log({
        tx,
        householdId,
        userId: actor.userId,
        action: "MERGE",
        entityType: "merchant",
        entityId: targetId,
        details: { sourceId, targetId, mergeHistoryId: history.id, mergedTransactionCount: moved.length },
        ipAddress: actor.ipAddress,
      });
      return { merged: true, targetId, mergeHistoryId: history.id, mergedTransactionCount: visibleMoved.size };
    });
  },

  /**
   * Restore the transactions still on the target among those the merge moved;
   * one since edited to another merchant, or deleted, is skipped.
   */
  async undoMerge(historyId: string, actor: WriteActor, viewer: HouseholdContext): Promise<UndoMergeResult> {
    const { householdId } = actor;
    return withTransaction(async (tx) => {
      const history = await claimHistory(tx, householdId, historyId);
      const sourceId = history.sourceMerchantId;
      const targetId = history.targetMerchantId;
      const locked = await lockMerchants(tx, householdId, [sourceId, targetId]);
      if (!locked.has(sourceId) || !locked.has(targetId)) {
        throw new NotFoundError("Source or target merchant not found");
      }

      const mergedIds = readMergedTransactionIds(history.mergedTransactionIds);
      const restored = mergedIds.length === 0 ? [] : await tx
        .update(transactions)
        .set({ merchantId: sourceId, updatedAt: new Date() })
        .where(and(
          eq(transactions.householdId, householdId),
          eq(transactions.merchantId, targetId),
          inArray(transactions.id, mergedIds),
        ))
        .returning({ id: transactions.id });
      await tx
        .update(merchants)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(merchants.id, sourceId));
      await recountTransactions(tx, [sourceId, targetId]);
      const counted = await withViewerCounts(tx, [sourceId, targetId], viewer);

      const restoredTransactionCount = restored.length;
      const skippedTransactionCount = mergedIds.length - restored.length;
      const visibleMerged = await visibleIds(tx, mergedIds, viewer);
      const visibleRestored = restored.filter((row) => visibleMerged.has(row.id)).length;
      await businessAuditService.log({
        tx,
        householdId,
        userId: actor.userId,
        action: "RESTORE",
        entityType: "merchant",
        entityId: sourceId,
        details: { historyId, targetId, restoredTransactionCount, skippedTransactionCount },
        ipAddress: actor.ipAddress,
      });
      return {
        restoredMerchant: counted.get(sourceId)!,
        target: counted.get(targetId)!,
        restoredTransactionCount: visibleRestored,
        skippedTransactionCount: visibleMerged.size - visibleRestored,
      };
    });
  },
};
