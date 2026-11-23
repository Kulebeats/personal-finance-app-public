/**
 * Transaction Deletion Service
 *
 * Handles soft-deleting a transaction (or, for transfers, both linked legs
 * atomically) with balance reversal and an atomic Rule 9 audit row.
 *
 * @module services/transaction/delete
 */

import { transactionRepository } from "../../repositories/TransactionRepository";
import { transactionTransferRepository } from "../../repositories/TransactionTransferRepository";
import { NotFoundError, AuthorizationError } from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import { invalidateOnChangeAfterCommit } from "../CacheInvalidation";

/**
 * Delete a transaction (soft delete with balance reversal).
 *
 * Rule 9: the DELETE audit row is written atomically at the repository layer
 * (TransactionRepository.softDelete / TransactionTransferRepository.
 * softDeleteTransferPair `audit` option) rather than by the caller, so every
 * caller of this service function is audited — not just the transactions
 * controller (bulk delete, future callers).
 */
export async function deleteTransaction(
  id: string,
  householdId: string,
  userId: string,
  auditContext?: { ipAddress?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  // Verify access
  const existing = await transactionRepository.findByIdWithVisibility(
    id,
    householdId,
    userId,
  );

  if (!existing) {
    throw new NotFoundError("Transaction not found");
  }

  // Check ownership for private transactions
  if (existing.isPrivate && existing.ownerUserId !== userId) {
    throw new AuthorizationError(
      "Cannot delete private transaction owned by another user",
    );
  }

  // Snapshot for the audit row, captured before the delete so it reflects
  // the transaction as the caller/user actually saw it.
  const auditOldValue = {
    amount: existing.amount,
    categoryId: existing.categoryId,
    description: existing.name,
    date: existing.date,
    accountId: existing.accountId,
  };

  // If this is a transfer, delete both sides atomically (one transaction,
  // pair + accounts locked FOR UPDATE) — two sequential softDelete calls
  // could half-reverse the pair on a crash or concurrent edit.
  if (existing.type === "transfer" && existing.transferTransactionId) {
    const deletedCount =
      await transactionTransferRepository.softDeleteTransferPair(
        existing.transferTransactionId,
        householdId,
        {
          audit: {
            userId,
            entityId: existing.id,
            oldValue: auditOldValue,
            ipAddress: auditContext?.ipAddress,
            metadata: { isTransfer: true, ...auditContext?.metadata },
          },
        },
      );

    if (deletedCount === 0) {
      throw new NotFoundError("Transaction not found");
    }

    logger.info("Transfer deleted", { householdId });

    // Invalidate analytics cache
    await invalidateOnChangeAfterCommit("transaction", householdId);
    return;
  }

  const deleted = await transactionRepository.softDelete(id, householdId, {
    actor: { householdId, userId },
    publishDeletedEvent: true,
    audit: {
      userId,
      oldValue: auditOldValue,
      ipAddress: auditContext?.ipAddress,
      metadata: auditContext?.metadata,
    },
  });

  if (!deleted) {
    throw new NotFoundError("Transaction not found");
  }

  logger.info("Transaction deleted", { householdId });

  // Invalidate analytics cache
  await invalidateOnChangeAfterCommit("transaction", householdId);

}
