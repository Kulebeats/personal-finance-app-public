/**
 * Transaction Owner Operations
 *
 * Methods for updating transaction ownership.
 *
 * @module services/transaction/owner
 */

import { accounts, householdMembers, transactions, type Transaction } from "@shared/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { NotFoundError } from "../../core/errors";
import { lockTransactionCreateGrant } from "../../repositories/TransactionCreateBoundary";
import { visibleTransactionPredicate } from "../../core/authz/transaction-visibility";
import { assertOrdinaryPrivacyOwner } from "../../core/authz/ordinary-transaction-privacy";
import { invalidateOnChangeAfterCommit } from "../CacheInvalidation";

// Type for the update function to avoid circular dependency
type UpdateTransactionFn = (
  id: string,
  data: Partial<Transaction>,
  householdId: string,
  userId: string,
  expectedUpdatedAt?: Date,
  auditContext?: { ipAddress?: string; metadata?: Record<string, unknown> },
  ownerBatchTx?: TransactionType,
) => Promise<Transaction>;

/**
 * Update transaction ownership
 * FIX AUTH-TRANS-OWNER-001: Validate household membership
 *
 * P8b: audits via updateTransaction's own UPDATE audit row (Rule 9) — do not
 * audit again here, or the controller path would double-audit.
 */
export async function updateOwner(
  updateTransaction: UpdateTransactionFn,
  id: string,
  ownerUserId: string | null,
  householdId: string,
  userId: string,
  auditContext?: { ipAddress?: string }
): Promise<Transaction> {
  // FIX AUTH-TRANS-OWNER-001: Validate ownerUserId is a member of the household
  if (ownerUserId !== null) {
    const member = await householdRepository.findMember(householdId, ownerUserId);
    if (!member) {
      throw new NotFoundError("User is not a member of this household");
    }
  }

  return await updateTransaction(id, { ownerUserId }, householdId, userId, undefined, {
    ipAddress: auditContext?.ipAddress,
    metadata: { operation: "updateOwner" },
  });
}

/**
 * Bulk update transaction ownership
 * FIX AUTH-TRANS-OWNER-001: Validate household membership
 *
 * P8b: each per-id call to updateTransaction writes its own UPDATE audit row
 * (Rule 9) — do not batch-audit again in the controller.
 */
export async function bulkUpdateOwner(
  updateTransaction: UpdateTransactionFn,
  ids: string[],
  ownerUserId: string | null,
  householdId: string,
  userId: string,
  auditContext?: { ipAddress?: string }
): Promise<Transaction[]> {
  // FIX AUTH-TRANS-OWNER-001: Validate ownerUserId is a member of the household
  if (ownerUserId !== null) {
    const member = await householdRepository.findMember(householdId, ownerUserId);
    if (!member) {
      throw new NotFoundError("User is not a member of this household");
    }
  }

  const requested = Array.from(new Set(ids.map(id => id.toLowerCase()))), ordered = [...requested].sort();
  const results = await withTransaction(async tx => {
    const actor = await lockTransactionCreateGrant(tx, householdId, { createActor: { householdId, userId } });
    if (!actor) throw new NotFoundError("Transaction not found");
    const parents = await tx.select().from(transactions).where(and(inArray(transactions.id, ordered),
      eq(transactions.householdId, householdId), isNull(transactions.deletedAt))).orderBy(transactions.id).for("update");
    if (parents.length !== ordered.length) throw new NotFoundError("Transaction not found");
    const accountIds = Array.from(new Set(parents.map(row => row.accountId))).sort();
    await tx.select({ id: accounts.id }).from(accounts).where(and(inArray(accounts.id, accountIds),
      eq(accounts.householdId, householdId))).orderBy(accounts.id).for("update");
    const visible = await tx.select({ id: transactions.id }).from(transactions)
      .where(and(inArray(transactions.id, ordered), visibleTransactionPredicate(actor)));
    if (visible.length !== ordered.length) throw new NotFoundError("Transaction not found");
    if (ownerUserId !== null) {
      const [member] = await tx.select({ id: householdMembers.userId }).from(householdMembers).where(and(
        eq(householdMembers.householdId, householdId), eq(householdMembers.userId, ownerUserId),
      )).for("share");
      if (!member) throw new NotFoundError("User is not a member of this household");
    }
    // Validate the entire batch before its first audit/event/write. Locks and
    // every common writer invocation share this one actual transaction.
    for (const row of parents) assertOrdinaryPrivacyOwner({ ownerUserId }, actor.userId, row);
    const saved = new Map<string, Transaction>();
    for (const id of ordered) saved.set(id, await updateTransaction(id, { ownerUserId }, householdId, userId, undefined, {
      ipAddress: auditContext?.ipAddress, metadata: { operation: "bulkUpdateOwner", batchSize: requested.length },
    }, tx));
    return requested.map(id => saved.get(id)!);
  });
  await invalidateOnChangeAfterCommit("transaction", householdId);
  return results;
}
