import Decimal from "decimal.js";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { categories, merchants, transactionSplits, type Transaction } from "@shared/schema";
import { NotFoundError, ValidationError } from "../utils/errorHandler";
import type { TransactionType } from "../utils/withTransaction";

export interface TransactionSplitUpdateInput {
  amount: string;
  currency?: string;
  categoryId?: string | null;
  merchantId?: string | null;
  notes?: string | null;
  displayOrder?: number;
}
export type TransactionUpdateData = Partial<Transaction> & { splits?: TransactionSplitUpdateInput[] };
export interface SplitAuditSnapshot {
  amount: string;
  categoryId: string | null;
  merchantId: string | null;
  notes: string | null;
  displayOrder: number;
}

function invalid(message: string): never {
  throw new ValidationError(message, [{ field: "splits", message }]);
}
function positiveAmount(value: string): Decimal {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) invalid("Split amounts require decimal strings with at most two decimal places");
  const amount = new Decimal(value);
  if (!amount.gt(0) || amount.gt("9999999999999.99")) invalid("Split amounts must be positive and within the supported range");
  return amount;
}
function reference(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) invalid("Split references must be valid UUIDs or null");
  return parsed.data.toLowerCase();
}
function snapshot(row: SplitAuditSnapshot): SplitAuditSnapshot {
  return { amount: row.amount, categoryId: row.categoryId, merchantId: row.merchantId,
    notes: row.notes, displayOrder: row.displayOrder };
}
async function lockReferences(tx: TransactionType, householdId: string, splits: SplitAuditSnapshot[], parentCategoryId?: string | null, parentMerchantId?: string | null) {
  const categoryIds = Array.from(new Set([...splits.map(split => split.categoryId), parentCategoryId].filter((id): id is string => typeof id === "string"))).sort();
  const merchantIds = Array.from(new Set([...splits.map(split => split.merchantId), parentMerchantId].filter((id): id is string => typeof id === "string"))).sort();
  // Same category-then-merchant SHARE order as the ordinary create boundary.
  if (categoryIds.length) {
    const rows = await tx.select({ id: categories.id }).from(categories).where(and(
      inArray(categories.id, categoryIds), eq(categories.householdId, householdId), isNull(categories.deletedAt),
    )).orderBy(categories.id).for("share");
    if (rows.length !== categoryIds.length) throw new NotFoundError("Category not found");
  }
  if (merchantIds.length) {
    const rows = await tx.select({ id: merchants.id }).from(merchants).where(and(
      inArray(merchants.id, merchantIds), eq(merchants.householdId, householdId),
    )).orderBy(merchants.id).for("share");
    if (rows.length !== merchantIds.length) throw new NotFoundError("Merchant not found");
  }
}

async function readSnapshots(tx: TransactionType, parentId: string): Promise<SplitAuditSnapshot[]> {
  return (await tx.select().from(transactionSplits).where(eq(transactionSplits.transactionId, parentId))
    .orderBy(transactionSplits.displayOrder, transactionSplits.id)).map(snapshot);
}

/** Caller holds the live parent FOR UPDATE, checks its version, and owns commit. */
export async function applyTransactionSplitUpdate(
  tx: TransactionType,
  lockedParent: Transaction,
  update: TransactionUpdateData,
  options: { allowEmpty?: boolean; ordinaryActor?: boolean } = {},
): Promise<{ beforeSplits: SplitAuditSnapshot[]; afterSplits: SplitAuditSnapshot[]; changed: boolean; parentCategoryId?: string | null }> {
  const beforeSplits = await readSnapshots(tx, lockedParent.id);
  // No new split assertion: keep the established unsplit repository contract.
  if (!beforeSplits.length && update.splits === undefined) {
    if (options.ordinaryActor) {
      await lockReferences(tx, lockedParent.householdId, [], reference(update.categoryId), reference(update.merchantId));
    }
    return { beforeSplits, afterSplits: beforeSplits, changed: false };
  }
  let amountChanged = false;
  if (update.amount !== undefined) {
    try { amountChanged = !new Decimal(update.amount).equals(lockedParent.amount); }
    catch { invalid("Invalid parent amount"); }
  }
  const suppliedCategory = update.categoryId === undefined ? undefined : reference(update.categoryId);
  const storedCategory = lockedParent.categoryId?.toLowerCase() ?? null;
  if (update.splits === undefined) {
    if (beforeSplits.length && amountChanged) invalid("Changing a split parent amount requires complete replacement allocations");
    if (beforeSplits.length && update.type !== undefined && update.type !== lockedParent.type) invalid("Changing a split parent type requires complete replacement allocations");
    if (beforeSplits.length && update.currency !== undefined && update.currency !== lockedParent.currency) invalid("Split source currency cannot change");
    if (options.ordinaryActor && suppliedCategory && suppliedCategory !== storedCategory) invalid("Choose categories on the split allocations instead of the parent");
    await lockReferences(tx, lockedParent.householdId, [],
      suppliedCategory !== storedCategory ? suppliedCategory : undefined,
      options.ordinaryActor ? reference(update.merchantId) : undefined);
    // Metadata and trusted rule categorize retain the established parent field.
    return { beforeSplits, afterSplits: beforeSplits, changed: false };
  }
  if (!Array.isArray(update.splits) || update.splits.length > 50) invalid("Splits must be an array of at most 50 allocations");
  if (!update.splits.length && (!options.allowEmpty || amountChanged)) invalid("A split replacement requires positive allocations");
  if (update.splits.length && (
    !["income", "expense"].includes(lockedParent.type) ||
    !["income", "expense"].includes(update.type ?? lockedParent.type) ||
    lockedParent.transferTransactionId || lockedParent.transferAccountId || lockedParent.isTransferIn ||
    update.transferTransactionId || update.transferAccountId || update.isTransferIn
  )) invalid("Only ordinary income and expense transactions support split allocations");
  if (update.splits.length && (!lockedParent.currency ||
    (update.currency !== undefined && update.currency !== lockedParent.currency))) invalid("Split updates require a reconciled, unchanged source currency");
  // Clearing trusted legacy children makes no new monetary assertion. A real
  // replacement must validate BOTH original and proposed parent magnitudes.
  if (update.splits.length) positiveAmount(lockedParent.amount);
  const total = update.splits.length ? positiveAmount(update.amount ?? lockedParent.amount) : undefined;
  let sum = new Decimal(0);
  const afterSplits = update.splits.map((split, index): SplitAuditSnapshot => {
    if (!split || typeof split !== "object") invalid("Each split must be an allocation object");
    const amount = positiveAmount(split.amount);
    if (split.currency !== undefined && split.currency !== lockedParent.currency) invalid("Split currency must match the transaction source currency");
    if (split.notes !== undefined && split.notes !== null && (typeof split.notes !== "string" || split.notes.length > 1000)) invalid("Split notes must be at most 1000 characters");
    const displayOrder = split.displayOrder ?? index;
    if (!Number.isInteger(displayOrder) || displayOrder < 0 || displayOrder > 2147483647) invalid("Split display order must be a nonnegative integer");
    sum = sum.add(amount);
    return { amount: amount.toFixed(2), categoryId: reference(split.categoryId),
      merchantId: reference(split.merchantId), notes: split.notes ?? null, displayOrder };
  });
  if (total && !sum.equals(total)) invalid("Sum of splits must equal the total transaction amount");
  let parentCategoryId: string | null | undefined;
  if (afterSplits.length) {
    if (options.ordinaryActor && suppliedCategory && suppliedCategory !== storedCategory) invalid("Choose categories on the split allocations instead of the parent");
    // The advertised modal omits parent category. An unchanged stale legacy
    // category in a full-object ordinary save is also treated as omission.
    parentCategoryId = options.ordinaryActor ? null : suppliedCategory;
  }
  await lockReferences(tx, lockedParent.householdId, afterSplits, parentCategoryId, reference(update.merchantId));
  const changed = JSON.stringify(beforeSplits) !== JSON.stringify(afterSplits);
  if (changed) {
    await tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, lockedParent.id));
    if (afterSplits.length) await tx.insert(transactionSplits).values(afterSplits.map(split => ({ transactionId: lockedParent.id, ...split })));
  }
  const savedSplits = changed ? await readSnapshots(tx, lockedParent.id) : beforeSplits;
  return { beforeSplits, afterSplits: savedSplits, changed,
    ...(parentCategoryId !== undefined ? { parentCategoryId } : {}) };
}
