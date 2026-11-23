import Decimal from "decimal.js";
import { assertPrincipalCashUpdate } from "../services/grz/principalCashGuard";
import { accounts, householdMembers, transactions, type Account, type Transaction } from "@shared/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { visibleAccountPredicate, visibleTransactionPredicate } from "../core/authz/transaction-visibility";
import { isPostgresError } from "../utils/postgresError";
import { Money } from "../core/money";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errorHandler";
import type { TransactionType } from "../utils/withTransaction";
import { buildPostingReceipt, resolvePostingEffect } from "./TransactionPostingEffect";
import { lockTransactionCreateGrant } from "./TransactionCreateBoundary";
import { assertOrdinaryPrivacyOwner } from "../core/authz/ordinary-transaction-privacy";
import { identifiedCouponCashForAudit } from "../services/grz/couponCashDescription";
import { reapplyEditedSourceLinks } from "../services/goal/GoalLinkSourceSync";
import {
  applyTransactionSplitUpdate,
  type SplitAuditSnapshot,
  type TransactionUpdateData,
} from "./TransactionSplitUpdate";

export interface TransactionUpdateSnapshot {
  before: Transaction;
  after: Transaction;
  privateAudit: boolean;
  beforeSplits: SplitAuditSnapshot[];
  afterSplits: SplitAuditSnapshot[];
  splitsChanged: boolean;
}

export interface TransactionUpdateOptions {
  actor?: { householdId: string; userId: string };
  /** Runs while parent/accounts/children are locked, before financial commit. */
  onWrite?: (tx: TransactionType, snapshot: TransactionUpdateSnapshot) => Promise<void>;
}

// The API exposes millisecond versions. Even successive writers admitted in
// the same millisecond must produce different tokens for the next editor.
export function nextTransactionVersion(previous: Date): Date {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}


function invalidUpdate(field: string): never {
  throw new ValidationError("Unsupported ordinary transaction mutation", [{ field, message: "Use the dedicated financial workflow" }]);
}
function sameIdentity(value: unknown, original: unknown): boolean {
  return typeof value === "string" && typeof original === "string"
    ? value.toLowerCase() === original.toLowerCase() : value === original;
}
/** Validate before economic no-op comparisons; never coerce nulls or protected identity. */
export function assertOrdinaryUpdateInput(before: Transaction, data: TransactionUpdateData): void {
  for (const field of ["postedBalanceDelta", "postingMode", "postedAccountIsAsset"] as const) {
    if (Object.hasOwn(data, field)) invalidUpdate(field);
  }
  for (const field of ["id", "householdId", "createdAt", "deletedAt"] as const) {
    const value = data[field], original = before[field];
    if (value === undefined) continue;
    const same = original instanceof Date ?
      (value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN) === original.getTime()
      : sameIdentity(value, original);
    if (!same) invalidUpdate(field);
  }
  for (const field of ["transferTransactionId", "transferAccountId", "isTransferIn"] as const) {
    if (data[field] !== undefined && !sameIdentity(data[field], before[field])) invalidUpdate(field);
  }
  if (data.type !== undefined && !["income", "expense", "transfer", "balance_adjustment"].includes(data.type)) invalidUpdate("type");
  if (data.amount !== undefined) {
    if (typeof data.amount !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(data.amount)) invalidUpdate("amount");
    const amount = new Decimal(data.amount);
    if (amount.gt("9999999999999.99") || (amount.isZero() && (data.type ?? before.type) !== "balance_adjustment")) invalidUpdate("amount");
  }
  if (data.isPending !== undefined && typeof data.isPending !== "boolean") invalidUpdate("isPending");
  if (data.status !== undefined && data.status !== null && !["pending", "cleared", "reconciled"].includes(data.status)) invalidUpdate("status");
  if (data.isBalanceAdjustmentIncrease !== undefined && data.isBalanceAdjustmentIncrease !== before.isBalanceAdjustmentIncrease && typeof data.isBalanceAdjustmentIncrease !== "boolean") invalidUpdate("isBalanceAdjustmentIncrease");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (data.accountId !== undefined && (typeof data.accountId !== "string" || !uuid.test(data.accountId))) invalidUpdate("accountId");
  if (data.ownerUserId !== undefined && data.ownerUserId !== null && (typeof data.ownerUserId !== "string" || !uuid.test(data.ownerUserId))) invalidUpdate("ownerUserId");
  if (data.type !== undefined && data.type !== before.type && (data.type === "transfer" || before.type === "transfer")) invalidUpdate("type");
  if (before.type === "transfer" || before.transferTransactionId || before.transferAccountId || before.isTransferIn) {
    if (data.type !== undefined && data.type !== before.type) invalidUpdate("type");
    if (data.amount !== undefined && !new Decimal(data.amount).equals(before.amount)) invalidUpdate("amount");
    if (data.accountId !== undefined && !sameIdentity(data.accountId, before.accountId)) invalidUpdate("accountId");
    if (data.date !== undefined && data.date !== before.date) invalidUpdate("date");
    if (data.currency !== undefined && data.currency !== before.currency) invalidUpdate("currency");
  }
}

interface UpdateDependencies {
  callerOwnsTransaction: boolean;
  lockAccounts: (tx: TransactionType, ids: string[], householdId: string) => Promise<Map<string, Account>>;
  assertDelta: (account: Account, delta: Money) => void;
  accountsToSyncAfterCommit: Set<string>;
}

/** One locked update boundary; callers without options retain their audit ownership. */
/**
 * The account lock for an owner or privacy change alone, which moves no money:
 * the account row is held whether or not it was soft-deleted, since a live
 * transaction can stay on a deleted account and a goal's verdict still counts
 * it (#245 round 6, P2-2). The row also sets the audit's privacy.
 */
async function lockAccountForVisibilityChange(
  tx: TransactionType, accountId: string, householdId: string,
): Promise<Map<string, Account>> {
  const rows = await tx.select().from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId))).for("update");
  return new Map(rows.map((account) => [account.id, account]));
}

export async function writeTransactionUpdate(
  tx: TransactionType,
  id: string,
  householdId: string,
  data: TransactionUpdateData,
  expectedUpdatedAt: Date | undefined,
  dependencies: UpdateDependencies,
  options?: TransactionUpdateOptions,
): Promise<{ transaction?: Transaction; conflict: boolean }> {
  if (!data || Array.isArray(data) || (Object.getPrototypeOf(data) !== Object.prototype && Object.getPrototypeOf(data) !== null)) invalidUpdate("body");
  data = { ...data };
  // Ordinary service writes retain the existing R04 grant lock order.
  const actor = options?.actor
    ? await lockTransactionCreateGrant(tx, householdId, { createActor: options.actor })
    : undefined;
  const conditions = [
    eq(transactions.id, id),
    eq(transactions.householdId, householdId),
    isNull(transactions.deletedAt),
  ];
  // A single-leg metadata edit also changes what an open pair editor would overwrite.
  // Discover the group before taking either leg lock, then lock in the pair writer's order.
  const [identity] = await tx.select({ type: transactions.type, group: transactions.transferTransactionId })
    .from(transactions).where(and(...conditions)).limit(1);
  if (!identity) return { transaction: undefined, conflict: false };
  const group = identity.type === "transfer" && identity.group;
  const lockQuery = tx.select().from(transactions).where(group
    ? and(eq(transactions.householdId, householdId), eq(transactions.transferTransactionId, group), isNull(transactions.deletedAt))
    : and(...conditions)).orderBy(transactions.id);
  // Receipt and recurring writers can already hold the addressed leg. Waiting for
  // its mate here could complete a cycle with a pair writer holding the lower ID.
  const locked = group && dependencies.callerOwnsTransaction
    ? await lockQuery.for("update", { noWait: true }).catch((error: unknown) => {
        if (isPostgresError(error, "55P03")) throw new ConflictError("Transfer is being edited. Retry this operation.");
        throw error;
      })
    : await lockQuery.for("update");
  const before = locked.find(row => row.id === id.toLowerCase());
  if (!before) return { transaction: undefined, conflict: false };

  const targetAccountId = typeof data.accountId === "string" ? data.accountId.toLowerCase() : before.accountId;
  const balanceMayChange = data.amount !== undefined || data.type !== undefined ||
    data.isTransferIn !== undefined || data.isBalanceAdjustmentIncrease !== undefined ||
    data.accountId !== undefined || data.currency !== undefined;
  // An owner or privacy change (a rule's set_owner passes no actor) changes who can
  // see a linked goal's progress: it takes the account lock a goal notice reads under (#245 r5).
  const visibilityMayChange = data.isPrivate !== undefined || data.ownerUserId !== undefined;
  let lockedAccounts = new Map<string, Account>();
  if (balanceMayChange || actor || data.splits !== undefined) {
    try {
      lockedAccounts = await dependencies.lockAccounts(tx, [before.accountId, targetAccountId], householdId);
    } catch (error) {
      if (actor && error instanceof NotFoundError) throw new NotFoundError("Transaction not found");
      throw error;
    }
  } else if (visibilityMayChange) {
    lockedAccounts = await lockAccountForVisibilityChange(tx, before.accountId, householdId);
  }

  if (actor) {
    // Re-evaluate parent and account privacy after every relevant lock wait.
    const [visibleParent] = await tx.select({ id: transactions.id }).from(transactions)
      .where(and(eq(transactions.id, id), visibleTransactionPredicate(actor))).limit(1);
    const [visibleTarget] = await tx.select({ id: accounts.id }).from(accounts)
      .where(and(eq(accounts.id, targetAccountId), visibleAccountPredicate(actor))).limit(1);
    if (!visibleParent || !visibleTarget) throw new NotFoundError("Transaction not found");
    if (before.type === "transfer" && data.splits?.length) {
      throw new ValidationError("Transfer legs cannot receive ordinary split replacements", [
        { field: "splits", message: "Use the paired transfer workflow" },
      ]);
    }
  }

  await assertPrincipalCashUpdate(tx, before, data);
  assertOrdinaryUpdateInput(before, data);
  assertOrdinaryPrivacyOwner(data, actor?.userId, before);
  if (data.ownerUserId != null && data.ownerUserId !== before.ownerUserId) {
    const [owner] = await tx.select({ id: householdMembers.userId }).from(householdMembers).where(and(
      eq(householdMembers.householdId, householdId), eq(householdMembers.userId, data.ownerUserId),
    )).for("share");
    if (!owner) throw new NotFoundError("User is not a member of this household");
  }

  // Compare the locked row at the same precision exposed by signed reads.
  if (expectedUpdatedAt && before.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    return { transaction: undefined, conflict: true };
  }

  if (data.source !== undefined && data.source !== before.source) {
    throw new ValidationError("Original transaction source is immutable", [{ field: "source", message: "Preserve original producer provenance" }]);
  }
  const amountChanged = data.amount !== undefined &&
    (!/^-?\d+(?:\.\d{1,2})?$/.test(data.amount) || !new Decimal(data.amount).equals(before.amount));
  const economicChanged = amountChanged || targetAccountId !== before.accountId ||
    (data.type !== undefined && data.type !== before.type) ||
    (data.currency !== undefined && data.currency !== before.currency) ||
    (data.isTransferIn !== undefined && (data.isTransferIn ?? false) !== (before.isTransferIn ?? false)) ||
    (data.isBalanceAdjustmentIncrease !== undefined && (data.isBalanceAdjustmentIncrease ?? true) !== (before.isBalanceAdjustmentIncrease ?? true));
  const sourceAccount = lockedAccounts.get(before.accountId);
  const targetAccount = lockedAccounts.get(targetAccountId);
  if (economicChanged && (!sourceAccount || !targetAccount)) throw new NotFoundError("Account not found");
  if (economicChanged && data.currency !== undefined && data.currency !== before.currency) {
    throw new ValidationError("Source currency is immutable", [{ field: "currency", message: "Use a paired FX transfer or reconciliation" }]);
  }
  const oldEffect = economicChanged && sourceAccount ? await resolvePostingEffect(tx, sourceAccount, before) : undefined;
  const receipt = oldEffect && targetAccount ? buildPostingReceipt(targetAccount, {
    ...before, source: before.source,
    type: data.type ?? before.type, amount: data.amount ?? before.amount,
    currency: data.currency !== undefined ? data.currency : before.currency,
    isTransferIn: data.isTransferIn !== undefined ? data.isTransferIn : before.isTransferIn,
    isBalanceAdjustmentIncrease: data.isBalanceAdjustmentIncrease !== undefined ? data.isBalanceAdjustmentIncrease : before.isBalanceAdjustmentIncrease,
  }, oldEffect.mode) : undefined;

  const assertSplitDenomination = () => {
    const source = lockedAccounts.get(before.accountId);
    const destination = lockedAccounts.get(targetAccountId);
    if (!before.currency || (data.currency !== undefined && data.currency !== before.currency) ||
      source?.currency !== before.currency || destination?.currency !== before.currency) {
      throw new ValidationError("Split currency must match the locked account denomination", [
        { field: "currency", message: "Reconcile the source denomination before editing split economics" },
      ]);
    }
  };
  // Validate replacement denomination before the helper can write any children.
  if (data.splits?.length) assertSplitDenomination();
  const splitUpdate = await applyTransactionSplitUpdate(tx, before, data, { ordinaryActor: !!options?.actor });
  // Omitted replacements never mutate children; protect existing split economics too.
  if (data.splits === undefined && splitUpdate.beforeSplits.length > 0 && balanceMayChange) assertSplitDenomination();
  const { splits: _splits, id: _id, householdId: _householdId, createdAt: _createdAt, deletedAt: _deletedAt,
    transferAccountId: _transferAccountId, transferTransactionId: _transferTransactionId, isTransferIn: _isTransferIn, ...parentData } = data;
  if (parentData.accountId !== undefined) parentData.accountId = targetAccountId;
  if (splitUpdate.parentCategoryId !== undefined) parentData.categoryId = splitUpdate.parentCategoryId;
  const mate = group && locked.length === 2 ? locked.find(row => row.id !== before.id &&
    row.type === "transfer" && typeof before.isTransferIn === "boolean" && row.isTransferIn === !before.isTransferIn &&
    row.accountId === before.transferAccountId && row.transferAccountId === before.accountId) : undefined;
  const version = nextTransactionVersion(mate && mate.updatedAt > before.updatedAt ? mate.updatedAt : before.updatedAt);
  if (mate) await tx.update(transactions).set({ updatedAt: version }).where(eq(transactions.id, mate.id));
  const [after] = await tx.update(transactions).set({ ...parentData, ...receipt, updatedAt: version })
    .where(and(...conditions)).returning();
  // The locked/version-checked parent cannot disappear. Never commit children alone.
  if (!after) throw new ConflictError("Transaction changed during update");

  if (oldEffect && receipt) {
    const oldDelta = oldEffect.delta;
    const newDelta = new Money(receipt.postedBalanceDelta, receipt.currency);
    const netDelta = newDelta.subtract(oldDelta);
    const balanceDeltas = new Map<string, Money>();
    if (before.accountId === after.accountId) {
      balanceDeltas.set(after.accountId, netDelta);
    } else {
      balanceDeltas.set(before.accountId, oldDelta.negated());
      balanceDeltas.set(after.accountId, newDelta);
    }
    for (const [accountId, delta] of balanceDeltas) {
      if (delta.isZero()) continue;
      const account = lockedAccounts.get(accountId);
      if (!account) throw new NotFoundError("Account not found");
      dependencies.assertDelta(account, delta);
    }
    for (const [accountId, delta] of balanceDeltas) {
      if (delta.isZero()) continue;
      await tx.update(accounts).set({
        balance: sql`${accounts.balance} + ${delta.toString()}::numeric`, updatedAt: new Date(),
      }).where(eq(accounts.id, accountId));
      dependencies.accountsToSyncAfterCommit.add(accountId);
    }
  }

  // R10.3: linked goals follow the edited source exactly (locks goal after account).
  await reapplyEditedSourceLinks(tx, before, after, { userId: actor?.userId ?? null, viewer: actor,
    householdId: before.isPrivate || after.isPrivate || sourceAccount?.isPrivate || targetAccount?.isPrivate ? null : householdId });
  const privateCouponAudit = options?.onWrite ? await identifiedCouponCashForAudit(tx, id) : false;
  await options?.onWrite?.(tx, {
    before, after, privateAudit: before.isPrivate || after.isPrivate || sourceAccount?.isPrivate === true || targetAccount?.isPrivate === true || privateCouponAudit,
    beforeSplits: splitUpdate.beforeSplits,
    afterSplits: splitUpdate.afterSplits, splitsChanged: splitUpdate.changed,
  });
  return { transaction: after, conflict: false };
}
