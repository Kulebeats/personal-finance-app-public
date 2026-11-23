/**
 * Transaction Service
 *
 * Business logic layer for transaction operations.
 *
 * @module services/transaction/service
 */

import { transactionRepository, type TransactionUpdateData } from "../../repositories/TransactionRepository";
import { merchants, transactions, type Transaction, type InsertTransaction } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import {
  NotFoundError,
  AuthorizationError,
  ConflictError,
  ValidationError,
} from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import { invalidateOnChangeAfterCommit } from "../CacheInvalidation";
import {
  ensureMerchantAlias,
  resolveMerchantMatch,
} from "../merchantRecognition";
import { outboxEventService, EventTypes } from "../../core/events";
import { transferService } from "../TransferService";
import { businessAuditService } from "../BusinessAuditService";
import type { TransactionType } from "../../utils/withTransaction";
import { lockTransactionCreateGrant } from "../../repositories/TransactionCreateBoundary";
import { visibleTransactionPredicate } from "../../core/authz/transaction-visibility";

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
import { createTransaction as doCreateTransaction, type TransactionPostingOptions } from "./create";
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
    data: Omit<InsertTransaction, "householdId"> & {
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
    auditContext?: { ipAddress?: string },
    postingOptions?: TransactionPostingOptions
  ): Promise<{ transaction: Transaction; isDuplicate: boolean }> {
    return doCreateTransaction(
      data,
      householdId,
      userId,
      idempotencyKey,
      auditContext,
      postingOptions
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
      audit?: { ipAddress?: string };
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
      expectedUpdatedAt?: string;
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
    userId: string,
    audit?: { ipAddress?: string }
  ): Promise<{ outflow: Transaction; inflow: Transaction }> {
    return await transferService.updateTransfer(id, data, householdId, userId, audit);
  }

  /**
   * Update a transaction with optimistic concurrency
   *
   * Rule 9 (P8b): this service enlists one UPDATE audit and event in the
   * repository transaction, so every caller is audited atomically — not just the
   * transactions controller. updateOwner/markReviewed/markUnreviewed and the
   * bulk-update paths all funnel through this method, so they inherit the
   * same single audit row instead of each controller handler auditing again.
   */
  async updateTransaction(
    id: string,
    data: TransactionUpdateData,
    householdId: string,
    userId: string,
    expectedUpdatedAt?: Date,
    auditContext?: { ipAddress?: string; metadata?: Record<string, unknown> },
    ownerBatchTx?: TransactionType,
  ): Promise<Transaction> {
    if (ownerBatchTx && Object.keys(data).some(field => field !== "ownerUserId")) throw new ValidationError("Owner batches accept attribution changes only");
    // First verify visibility/access
    let existing: Transaction | undefined;
    if (ownerBatchTx) {
      const actor = await lockTransactionCreateGrant(ownerBatchTx, householdId, { createActor: { householdId, userId } });
      if (!actor) throw new NotFoundError("Transaction not found");
      [existing] = await ownerBatchTx.select().from(transactions).where(and(eq(transactions.id, id), visibleTransactionPredicate(actor))).limit(1);
    } else existing = await transactionRepository.findByIdWithVisibility(id, householdId, userId);

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
    let merchantAlias: { merchantId: string; name: string } | undefined;

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
          merchantAlias = { merchantId: merchantMatch.merchant.id, name: merchantMatch.aliasCandidate };
        }
      } else if (
        updatePayload.name !== undefined &&
        !updatePayload.merchantId
      ) {
        updatePayload.name = merchantMatch.cleanedName || rawName;
      }
    }

    const { transaction, conflict } = await transactionRepository.update(
      id, householdId, updatePayload, expectedUpdatedAt, ownerBatchTx, {
        actor: { householdId, userId },
        onWrite: async (tx, snapshot) => {
          if (merchantAlias) {
            const merchantId = snapshot.after.merchantId;
            if (!merchantId || merchantId !== merchantAlias.merchantId) throw new NotFoundError("Merchant not found");
            const [merchant] = await tx.select({ id: merchants.id }).from(merchants).where(and(
              eq(merchants.id, merchantId), eq(merchants.householdId, householdId),
            )).for("share");
            if (!merchant || merchant.id !== merchantAlias.merchantId) throw new NotFoundError("Merchant not found");
            await ensureMerchantAlias(merchant.id, merchantAlias.name, tx);
          }
          const changes = getAuditChanges(snapshot.before, snapshot.after);
          if (snapshot.splitsChanged) {
            changes.splits = { before: snapshot.beforeSplits, after: snapshot.afterSplits };
          }
          if (Object.keys(changes).length > 0) {
            await businessAuditService.log({
              tx, householdId: snapshot.privateAudit ? null : householdId, userId, action: "UPDATE", entityType: "transaction",
              entityId: snapshot.after.id, details: { ...auditContext?.metadata, changes },
              ipAddress: auditContext?.ipAddress,
            });
          }
          await outboxEventService.publish({
            eventType: EventTypes.TRANSACTION_UPDATED, aggregateType: "transaction",
            aggregateId: snapshot.after.id, householdId,
            payload: { id: snapshot.after.id, changes: Object.keys(data) },
          }, tx);
        },
      },
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

    // A joined owner batch invalidates once after its outer commit.
    if (!ownerBatchTx) await invalidateOnChangeAfterCommit("transaction", householdId);

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
    userId: string,
    ipAddress?: string
  ): Promise<void> {
    return doAddTagsToTransaction(transactionId, tagIds, householdId, userId, ipAddress);
  }
}

// Export singleton instance
export const transactionService = new TransactionService();
