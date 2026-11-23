/**
 * Settings Module - Account Deletion Purge Items (A-34)
 *
 * Erasure deletes database rows in one transaction, but stored files can only
 * be deleted after it commits. A household delete cascades the
 * `storage_objects` manifest rows, so a purge list held in memory alone is lost
 * if the process stops between the commit and the file cleanup. Erasure
 * therefore records one `storage_purge_items` row per collected file INSIDE its
 * transaction (`recordPurgeItems`), and the files are deleted by draining those
 * rows: right after commit for that erasure's items, and at boot for any left
 * by a crash (`drainStoragePurgeItemsAtBoot`).
 *
 * Draining is safe to repeat and to run twice at once:
 *   - each item is claimed with FOR UPDATE SKIP LOCKED, so two drains never
 *     process the same item at the same time;
 *   - an object or legacy file that is already gone counts as removed;
 *   - the item's row is deleted (success) or its attempt recorded (failure) in
 *     the transaction that holds the claim;
 *   - an item stops being retried after MAX_PURGE_ATTEMPTS failures and stays
 *     findable by an operator through its upload name and object key.
 *
 * @module modules/settings/account-deletion-purge
 */
import { and, asc, eq, inArray, lt, notInArray, sql } from "drizzle-orm";
import { storagePurgeItems, type StoragePurgeItem } from "@shared/schema";
import { validateStorageKey, type StorageKey } from "../../core/storage";
import { removeUploadTarget, UploadStorageError, type UploadObjectTarget } from "../../core/storage/upload-objects";
import { logger } from "../../utils/logger";
import { businessAuditService } from "../../services/BusinessAuditService";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";

export const MAX_PURGE_ATTEMPTS = 5;

export interface PurgeDrainFilter {
  /** Only these items (one erasure's); all pending items when omitted. */
  readonly ids?: readonly string[];
}

export interface PurgeDrainTotals {
  readonly removed: number;
  readonly failed: number;
}

interface PurgeDrainOutcome {
  readonly removed: number;
  readonly failedTargets: readonly UploadObjectTarget[];
}

/**
 * Record the files an erasure must delete, in the erasure's own transaction.
 * A name already pending (collected twice, or by an earlier interrupted
 * erasure) keeps its existing item, which gains the object key if it had none.
 * Returns the id of every item for these targets, new or already pending.
 */
export async function recordPurgeItems(tx: TransactionType, targets: readonly UploadObjectTarget[]): Promise<string[]> {
  const unique = [...new Map(targets.map((target) => [target.name, target])).values()];
  if (!unique.length) return [];
  const rows = await tx.insert(storagePurgeItems)
    .values(unique.map((target) => ({ uploadName: target.name, objectKey: target.key, keepLegacy: target.keepLegacy ?? false })))
    // A pending name keeps its item; a key it lacked (a legacy file moved
    // since) is filled in, so the object is not left without a purge row.
    .onConflictDoUpdate({
      target: storagePurgeItems.uploadName,
      set: { objectKey: sql`coalesce(${storagePurgeItems.objectKey}, excluded.object_key)` },
    })
    .returning({ id: storagePurgeItems.id });
  return rows.map((row) => row.id);
}

function targetOf(item: StoragePurgeItem): UploadObjectTarget {
  if (item.objectKey) validateStorageKey(item.objectKey);
  return { name: item.uploadName, key: (item.objectKey as StorageKey | null) ?? null, keepLegacy: item.keepLegacy };
}

/**
 * Log every failed attempt by item id and key only (the upload name embeds the
 * household id). The erasure's own drain is audited by the erasure (attempt 1);
 * a later drain has no user to name, so each later failure gets its own
 * storage_object audit row, in the claim's transaction. The attempt that
 * reaches the cap also raises an operator alert: no drain claims it again.
 */
async function recordLaterFailure(tx: TransactionType, item: StoragePurgeItem, attempts: number, code: string): Promise<void> {
  const context = { purgeItemId: item.id, objectKey: item.objectKey, attempts, code };
  logger.error("Erasure purge could not delete a stored file; it stays queued", context);
  if (attempts <= 1) return;
  const isCapped = attempts >= MAX_PURGE_ATTEMPTS;
  await businessAuditService.log({
    tx, householdId: null, userId: null, action: "DELETE", entityType: "storage_object", entityId: item.id,
    details: { reason: isCapped ? "erasure_purge_capped" : "erasure_purge_retry_failed", attempts, code, objectKey: item.objectKey },
  });
  if (isCapped) {
    logger.error("Erasure purge item reached the attempt cap; an operator must delete it", { ...context, alert: "storage_purge_capped" });
  }
}

function storageCodeOf(error: unknown): string {
  return error instanceof UploadStorageError ? error.storageCode : "UNKNOWN";
}

/**
 * Claim the next pending item not yet tried in this run, delete its file, and
 * record the outcome, all in one transaction. Undefined when nothing is left.
 */
async function drainNext(filter: PurgeDrainFilter, tried: readonly string[]): Promise<{ id: string; failed?: UploadObjectTarget } | undefined> {
  return withTransaction(async (tx) => {
    const conditions = [lt(storagePurgeItems.attempts, MAX_PURGE_ATTEMPTS)];
    if (filter.ids) conditions.push(inArray(storagePurgeItems.id, [...filter.ids]));
    if (tried.length) conditions.push(notInArray(storagePurgeItems.id, [...tried]));
    const [item] = await tx.select().from(storagePurgeItems).where(and(...conditions))
      .orderBy(asc(storagePurgeItems.createdAt)).limit(1).for("update", { skipLocked: true });
    if (!item) return undefined;
    // Inside the try: an item that cannot even be read as a target counts a
    // failed attempt like any other, so it never blocks the rest of the drain.
    // Unvalidated until targetOf passes; kept as stored for the failure audit.
    let target: UploadObjectTarget = { name: item.uploadName, key: item.objectKey as StorageKey | null, keepLegacy: item.keepLegacy };
    try {
      target = targetOf(item);
      await removeUploadTarget(target, tx);
    } catch (error) {
      const code = storageCodeOf(error);
      const [{ attempts }] = await tx.update(storagePurgeItems)
        .set({ attempts: sql`${storagePurgeItems.attempts} + 1`, lastErrorCode: code, lastAttemptAt: new Date() })
        .where(eq(storagePurgeItems.id, item.id)).returning({ attempts: storagePurgeItems.attempts });
      await recordLaterFailure(tx, item, attempts, code);
      return { id: item.id, failed: target };
    }
    await tx.delete(storagePurgeItems).where(eq(storagePurgeItems.id, item.id));
    return { id: item.id };
  });
}

async function drainPurgeItems(filter: PurgeDrainFilter = {}): Promise<PurgeDrainOutcome> {
  if (filter.ids && !filter.ids.length) return { removed: 0, failedTargets: [] };
  const tried: string[] = [];
  const failedTargets: UploadObjectTarget[] = [];
  for (;;) {
    const outcome = await drainNext(filter, tried);
    if (!outcome) break;
    tried.push(outcome.id);
    if (outcome.failed) failedTargets.push(outcome.failed);
  }
  return { removed: tried.length - failedTargets.length, failedTargets };
}

/** Drain pending purge items (all, or the given ones). Counts only. */
export async function drainStoragePurgeItems(filter: PurgeDrainFilter = {}): Promise<PurgeDrainTotals> {
  const { removed, failedTargets } = await drainPurgeItems(filter);
  return { removed, failed: failedTargets.length };
}

/**
 * After an erasure commits: drain its items. Never throws (the erasure is
 * already durable); a drain that cannot run leaves the items for the boot
 * drain. Returns the files that could not be deleted, for the failure audit.
 */
export async function drainErasurePurgeItems(ids: readonly string[]): Promise<readonly UploadObjectTarget[]> {
  try {
    return (await drainPurgeItems({ ids })).failedTargets;
  } catch (error) {
    logger.error("Erasure purge could not run after commit; its items stay queued for the next boot", {
      items: ids.length, code: storageCodeOf(error),
    });
    return [];
  }
}

/** At boot: finish purges a stopped process left behind. Never throws. */
export async function drainStoragePurgeItemsAtBoot(): Promise<void> {
  try {
    const { removed, failed } = await drainStoragePurgeItems();
    if (removed || failed) logger.info("Erasure purge items drained at boot", { processed: removed, failed });
  } catch (error) {
    logger.error("Erasure purge items could not be drained at boot", { code: storageCodeOf(error) });
  }
}
