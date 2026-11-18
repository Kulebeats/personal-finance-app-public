/**
 * Transaction Service
 *
 * Business logic layer for transaction operations.
 *
 * @module services/transaction/service
 */

import { transactionRepository } from "../../repositories/TransactionRepository";
import { type Transaction, type InsertTransaction } from "@shared/schema";
import {
  NotFoundError,
  AuthorizationError,
  ConflictError,
  ValidationError,
} from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import { invalidateOnChange } from "../CacheInvalidation";
import {
  ensureMerchantAlias,
  resolveMerchantMatch,
} from "../merchantRecognition";
import { outboxEventService, EventTypes } from "../../core/events";
import { transferService } from "../TransferService";
import { businessAuditService } from "../BusinessAuditService";

// Import extracted modules
import {
  getTransactions as doGetTransactions,
  getTransactionsCount as doGetTransactionsCount,
  getTransactionById as doGetTransactionById,
  getTransferPair as doGetTransferPair,
  getTransactionSummary as doGetTransactionSummary,
  type TransactionQueryOptions,
  type TransactionSummaryOptions,
} from "./queries";
import { getAuditChanges } from "./helpers";
import { assertTransferUpdateAllowed } from "./transferGuard";
import {
  updateOwner as doUpdateOwner,
  bulkUpdateOwner as doBulkUpdateOwner,
} from "./owner";
import {
  markReviewed as doMarkReviewed,
  markUnreviewed as doMarkUnreviewed,
} from "./review";
import { createTransaction as doCreateTransaction } from "./create";
import { deleteTransaction as doDeleteTransaction } from "./delete";
import {
  validateTagIds as doValidateTagIds,
  addTagsToTransaction as doAddTagsToTransaction,
} from "./tags";

/**
 * TransactionService
 *
 * Business logic layer for transaction operations.
 * Implements Phase 1 requirements:
 * - Idempotency handling
 * - Transfer creation (two-row model)
 * - Privacy/visibility enforcement
 * - Balance validation
 */
export class TransactionService {
  // Delegate read operations to queries module
  async getTransactions(
    householdId: string,
    userId: string,
    options?: TransactionQueryOptions
  ): Promise<Transaction[]> {
    return doGetTransactions(householdId, userId, options);
  }

  async getTransactionsCount(
    householdId: string,
    userId: string,
    options?: Omit<TransactionQueryOptions, "limit" | "offset" | "sortBy" | "sortOrder">
  ): Promise<number> {
    return doGetTransactionsCount(householdId, userId, options);
  }

  async getTransactionById(
    id: string,
    householdId: string,
    userId: string
  ): Promise<Transaction> {
    return doGetTransactionById(id, householdId, userId);
  }

  async getTransferPair(
    id: string,
    householdId: string,
    userId: string
  ): Promise<{ outflow: Transaction; inflow: Transaction }> {
    return doGetTransferPair(id, householdId, userId);
  }

  async getTransactionSummary(
    householdId: string,
    userId: string,
    startDate: string,
    endDate: string,
    ownerUserIdOrOptions?: string | null | TransactionSummaryOptions,
  ) {
    const options: TransactionSummaryOptions =
      ownerUserIdOrOptions === null || typeof ownerUserIdOrOptions === "string"
        ? { ownerUserId: ownerUserIdOrOptions }
        : (ownerUserIdOrOptions ?? {});

    return doGetTransactionSummary(
      householdId,
      userId,
      startDate,
      endDate,
      options,
    );
  }

  /**
   * Create a transaction with idempotency support
   */
  async createTransaction(
    data: Omit<InsertTransaction, "householdId" | "ownerUserId"> & {
      splits?: {
        amount: string;
        categoryId?: string | null;
        merchantId?: string | null;
        notes?: string | null;
      }[];
    },
    householdId: string,
    userId: string,
    idempotencyKey?: string,
    auditContext?: { ipAddress?: string }
  ): Promise<{ transaction: Transaction; isDuplicate: boolean }> {
    return doCreateTransaction(
      data,
      householdId,
      userId,
      idempotencyKey,
      auditContext
    );
  }

  /**
   * Create a transfer (two-row model)
   */
  async createTransfer(
    fromAccountId: string,
    toAccountId: string,
    amount: string,
    householdId: string,
    userId: string,
    options?: {
      date?: string;
      name?: string;
      notes?: string;
      idempotencyKey?: string;
      currency?: string;
      fxRate?: string | null;
      fxSource?: string;
    }
  ): Promise<{
    outflow: Transaction;
    inflow: Transaction;
    isDuplicate: boolean;
  }> {
    return await transferService.createTransfer(
      fromAccountId,
      toAccountId,
      amount,
      householdId,
      userId,
      options
    );
  }

  /**
   * Update a transfer (both sides + account balances)
   */
  async updateTransfer(
    id: string,
    data: {
      fromAccountId: string;
      toAccountId: string;
      amount: string;
      date?: string;
      name?: string;
      notes?: string | null;
      currency?: string;
      fxRate?: number; // FIX DATA-TRANSFER-002: Accept FX rate
    },
    householdId: string,
    userId: string
  ): Promise<{ outflow: Transaction; inflow: Transaction }> {
    return await transferService.updateTransfer(id, data, householdId, userId);
  }

  /**
   * Update a transaction with optimistic concurrency
   *
   * Rule 9 (P8b): the UPDATE audit row is written here, atomically with the
   * business logic, so every caller of the service is audited — not just the
   * transactions controller. updateOwner/markReviewed/markUnreviewed and the
   * bulk-update paths all funnel through this method, so they inherit the
   * same single audit row instead of each controller handler auditing again.
   */
  async updateTransaction(
    id: string,
    data: Partial<Transaction>,
    householdId: string,
    userId: string,
    expectedUpdatedAt?: Date,
    auditContext?: { ipAddress?: string; metadata?: Record<string, unknown> }
  ): Promise<Transaction> {
    // First verify visibility/access
    const existing = await transactionRepository.findByIdWithVisibility(
      id,
      householdId,
      userId
    );

    if (!existing) {
      throw new NotFoundError("Transaction not found");
    }

    // Check ownership for private transactions
    if (existing.isPrivate && existing.ownerUserId !== userId) {
      throw new AuthorizationError(
        "Cannot modify private transaction owned by another user"
      );
    }

    // Reject transfer-breaking edits: type changes to/from transfer, and
    // material single-leg edits (amount/account/date/currency). See transferGuard.
    assertTransferUpdateAllowed(existing, data);

    // Enforce strict currency matching on update (for non-transfers)
    // Currency must match the account's currency
    if (data.currency && existing.type !== "transfer") {
      const { accountRepository } = await import(
        "../../repositories/AccountRepository"
      );
      const account = await accountRepository.findById(
        existing.accountId,
        householdId
      );
      if (account && data.currency !== account.currency) {
        throw new ValidationError(
          "Transaction currency must match account currency",
          [
            { field: "currency", message: `Expected ${account.currency}, got ${data.currency}. Use transfers for cross-currency flows.` },
          ]
        );
      }
    }

    const updatePayload = { ...data };

    if (
      updatePayload.name !== undefined ||
      updatePayload.merchantId !== undefined
    ) {
      const rawName = updatePayload.name ?? existing.name;
      const merchantMatch = await resolveMerchantMatch({
        householdId,
        rawName,
        merchantId: updatePayload.merchantId ?? existing.merchantId ?? null,
      });

      if (merchantMatch.merchant) {
        updatePayload.name = merchantMatch.merchant.name;
        if (!updatePayload.merchantId) {
          updatePayload.merchantId = merchantMatch.merchant.id;
        }
        if (merchantMatch.aliasCandidate) {
          await ensureMerchantAlias(
            merchantMatch.merchant.id,
            merchantMatch.aliasCandidate
          );
        }
      } else if (
        updatePayload.name !== undefined &&
        !updatePayload.merchantId
      ) {
        updatePayload.name = merchantMatch.cleanedName || rawName;
      }
    }

    const { transaction, conflict } = await transactionRepository.update(
      id,
      householdId,
      updatePayload,
      expectedUpdatedAt
    );

    if (conflict) {
      throw new ConflictError(
        "Transaction was modified. Please refresh and try again."
      );
    }

    if (!transaction) {
      throw new NotFoundError("Transaction not found");
    }

    logger.info("Transaction updated", { householdId });

    // Invalidate analytics cache
    await invalidateOnChange("transaction", householdId);

    // Emit transaction updated event (fire and forget)
    outboxEventService
      .publish({
        eventType: EventTypes.TRANSACTION_UPDATED,
        aggregateType: "transaction",
        aggregateId: id,
        householdId,
        payload: { id, changes: Object.keys(data) },
      })
      .catch((err) =>
        logger.error("Failed to publish transaction event", { err })
      );

    // Business Audit Log (P8b: single source of truth for transaction UPDATE
    // audit rows — see the method doc comment above). Awaited (unlike the
    // fire-and-forget event publish above) so the audit row is guaranteed
    // written before the caller/HTTP response completes — BusinessAuditService
    // .log()'s non-tx branch already catches its own errors internally, so
    // awaiting it cannot turn an audit failure into an update failure.
    const changes = getAuditChanges(existing, transaction);
    if (Object.keys(changes).length > 0) {
      await businessAuditService.log({
        householdId,
        userId,
        action: "UPDATE",
        entityType: "transaction",
        entityId: transaction.id,
        details: { changes, ...auditContext?.metadata },
        ipAddress: auditContext?.ipAddress,
      });
    }

    return transaction;
  }

  /**
   * Update transaction ownership
   */
  async updateOwner(
    id: string,
    ownerUserId: string | null,
    householdId: string,
    userId: string,
    auditContext?: { ipAddress?: string }
  ): Promise<Transaction> {
    return doUpdateOwner(
      this.updateTransaction.bind(this),
      id,
      ownerUserId,
      householdId,
      userId,
      auditContext
    );
  }

  /**
   * Bulk update transaction ownership
   */
  async bulkUpdateOwner(
    ids: string[],
    ownerUserId: string | null,
    householdId: string,
    userId: string,
    auditContext?: { ipAddress?: string }
  ): Promise<Transaction[]> {
    return doBulkUpdateOwner(
      this.updateTransaction.bind(this),
      ids,
      ownerUserId,
      householdId,
      userId,
      auditContext
    );
  }

  /**
   * Mark a transaction as reviewed
   */
  async markReviewed(
    id: string,
    householdId: string,
    userId: string,
    auditContext?: { ipAddress?: string; metadata?: Record<string, unknown> }
  ): Promise<Transaction> {
    return doMarkReviewed(
      this.updateTransaction.bind(this),
      id,
      householdId,
      userId,
      auditContext
    );
  }

  /**
   * Mark a transaction as unreviewed
   */
  async markUnreviewed(
    id: string,
    householdId: string,
    userId: string,
    auditContext?: { ipAddress?: string; metadata?: Record<string, unknown> }
  ): Promise<Transaction> {
    return doMarkUnreviewed(
      this.updateTransaction.bind(this),
      id,
      householdId,
      userId,
      auditContext
    );
  }

  /**
   * Delete a transaction (soft delete with balance reversal).
   * Delegates to ./delete — the DELETE audit row is written atomically at
   * the repository layer (Rule 9), so every caller of this service method
   * is audited, not just the transactions controller.
   */
  async deleteTransaction(
    id: string,
    householdId: string,
    userId: string,
    auditContext?: { ipAddress?: string; metadata?: Record<string, unknown> }
  ): Promise<void> {
    return doDeleteTransaction(id, householdId, userId, auditContext);
  }

  /**
   * R-10: Validate that all tag IDs belong to the specified household
   * Delegates to tags module
   */
  async validateTagIds(tagIds: string[], householdId: string): Promise<void> {
    return doValidateTagIds(tagIds, householdId);
  }

  /**
   * Add tags to a transaction
   * Delegates to tags module
   */
  async addTagsToTransaction(
    transactionId: string,
    tagIds: string[],
    householdId: string,
    userId: string
  ): Promise<void> {
    return doAddTagsToTransaction(transactionId, tagIds, householdId, userId);
  }
}

// Export singleton instance
export const transactionService = new TransactionService();
