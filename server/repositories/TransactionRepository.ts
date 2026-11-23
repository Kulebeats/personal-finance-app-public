/**
 * Transaction Repository
 *
 * Core CRUD operations for transactions.
 * Query, transfer, and count operations are in separate files.
 *
 * Split modules:
 * - TransactionQueryRepository: findByHousehold, findByHouseholdWithVisibility
 * - TransactionTransferRepository: createTransfer, findTransferPair
 * - TransactionCountRepository: countByHousehold, countByHouseholdWithVisibility
 *
 * @module repositories/TransactionRepository
 */

import { eq, and, inArray, isNull, sql, getTableColumns } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { lockCouponPostingAccount } from "../services/grz/couponPaymentAccess";
import { assertPrincipalCashDelete } from "../services/grz/principalCashGuard";
import { couponCashDescriptionFields, identifiedCouponCashForAudit, GRZ_COUPON_CASH_DESCRIPTION } from "../services/grz/couponCashDescription";
import { db } from "../db";
import {
  transactions,
  accounts,
  transactionSplits,
  transactionCreateOwnerIntents,
  type Transaction,
  type TransactionSplit,
  type InsertTransaction,
  type Account,
} from "@shared/schema";
import {
  withTransaction,
  type TransactionType,
} from "../utils/withTransaction";
import { withRecurringParentForCreate } from "../services/recurring/withWritableRecurringRule";
import { Money } from "../core/money";
import { goalAccountAssignmentService } from "../services/GoalAccountAssignmentService";
import { reverseDeletedSourceLinks } from "../services/goal/GoalLinkSourceSync";
import { logger } from "../utils/logger";
import { TransactionRepositoryDelegates } from "./TransactionRepository.delegates";
import { NotFoundError, ValidationError } from "../utils/errorHandler";
import { businessAuditService } from "../services/BusinessAuditService";
import { lockTransactionCreateGrant, prepareTransactionCreate, type TransactionCreateOptions } from "./TransactionCreateBoundary";

import { nextTransactionVersion, writeTransactionUpdate, type TransactionUpdateOptions } from "./TransactionUpdateWriter";
import { applyTransactionSplitUpdate, type TransactionUpdateData } from "./TransactionSplitUpdate";

import { tagWriteRepository } from "./TagWriteRepository";
import { buildPostingReceipt, resolvePostingEffect } from "./TransactionPostingEffect";
import { outboxEventService, EventTypes } from "../core/events";

import { visibleTransactionPredicate } from "../core/authz/transaction-visibility";

export type { TransactionUpdateData } from "./TransactionSplitUpdate";
export type { TransactionCreateOptions } from "./TransactionCreateBoundary";

// Re-export from split modules for backwards compatibility
export {
  TransactionQueryRepository,
  transactionQueryRepository,
} from "./TransactionQueryRepository";
export {
  TransactionTransferRepository,
  transactionTransferRepository,
} from "./TransactionTransferRepository";
export {
  TransactionCountRepository,
  transactionCountRepository,
} from "./TransactionCountRepository";

// Extended transaction type with denormalized names
export interface TransactionWithNames extends Transaction {
  summaryRate?: string | null;
  splits?: Pick<TransactionSplit, "id" | "amount" | "categoryId" | "merchantId" | "notes" | "displayOrder">[];
  merchantName?: string | null;
  merchantLogoUrl?: string | null;
  categoryName?: string | null;
  accountName?: string | null;
}

export interface TransactionDeleteOptions {
  actor?: { householdId: string; userId: string };
  publishDeletedEvent?: boolean;
  /**
   * Rule 9: when provided, a DELETE audit row is written INSIDE the same
   * transaction as the soft-delete + balance reversal, so a caller that
   * bypasses the controller (bulk delete, future service callers) is still
   * audited. `oldValue` should be a snapshot captured before the call.
   */
  audit?: {
    userId: string | null;
    oldValue?: Record<string, unknown>;
    ipAddress?: string;
    metadata?: Record<string, unknown>;
  };
}

/**
 * TransactionRepository
 *
 * Provides typed query builders for transaction operations.
 * Implements Phase 1 requirements per Canonical Invariants:
 * - Household-scoped queries
 * - Privacy/visibility filtering
 * - Soft delete with balance reversal
 * - Idempotency key deduplication
 * - Transfer pair management
 * - Balance delta calculations
 */
export class TransactionRepository extends TransactionRepositoryDelegates {
  /**
   * FIX DATA-ACCOUNT-001: Calculate balance delta using Money for precision
   * Per Canonical Invariant 3:
   * - income: +amount
   * - expense: -amount
   * - transfer: +amount if is_transfer_in, else -amount
   * - balance_adjustment: +amount if is_balance_adjustment_increase, else -amount
   *
   * Returns Money object to preserve precision through calculation
   */
  calculateBalanceDelta(
    type: string,
    amount: Money,
    isTransferIn?: boolean,
    isBalanceAdjustmentIncrease?: boolean,
  ): Money {
    switch (type) {
      case "income":
        return amount;
      case "expense":
        return amount.negated();
      case "transfer":
        return isTransferIn ? amount : amount.negated();
      case "balance_adjustment":
        return isBalanceAdjustmentIncrease ? amount : amount.negated();
      default:
        return Money.zero(amount.currency);
    }
  }

  private async lockAccountForBalanceMutation(
    tx: TransactionType,
    accountId: string,
    householdId: string,
  ): Promise<Account> {
    const lockedAccounts = await this.lockAccountsForBalanceMutation(
      tx,
      [accountId],
      householdId,
    );
    return lockedAccounts.get(accountId.toLowerCase())!;
  }

  private async lockAccountsForBalanceMutation(
    tx: TransactionType,
    accountIds: string[],
    householdId: string,
  ): Promise<Map<string, Account>> {
    const uniqueAccountIds = Array.from(new Set(accountIds)).sort();
    const lockedAccounts = await tx
      .select()
      .from(accounts)
      .where(
        and(
          inArray(accounts.id, uniqueAccountIds),
          eq(accounts.householdId, householdId),
          isNull(accounts.deletedAt),
        ),
      )
      .orderBy(accounts.id)
      .for("update");

    if (lockedAccounts.length !== uniqueAccountIds.length) {
      throw new NotFoundError("Account not found");
    }

    return new Map(lockedAccounts.map((account) => [account.id, account]));
  }

  private assertAssetAccountCanApplyDelta(
    account: Account,
    delta: Money,
  ): void {
    if (!account.isAsset) {
      return;
    }

    // Only a withdrawal can create an overdraft. A deposit into an already
    // negative balance must never be rejected, or the account can no longer
    // be repaired.
    if (!delta.lt(0)) {
      return;
    }

    const finalBalance = new Money(account.balance, account.currency).add(
      delta,
    );
    if (finalBalance.lt(0)) {
      throw new ValidationError("Insufficient funds", [
        {
          field: "amount",
          message: "Asset account balance cannot go below zero",
        },
      ]);
    }
  }

  /**
   * Find transaction by ID within a household
   */
  async findById(
    id: string,
    householdId: string,
    tx?: TransactionType,
  ): Promise<Transaction | undefined> {
    const result = await (tx ?? db)
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, id),
          eq(transactions.householdId, householdId),
          isNull(transactions.deletedAt),
        ),
      )
      .limit(1);
    return result[0];
  }

  /**
   * Find transaction with visibility check
   * Per Canonical Invariant 1.3: Checks both transaction AND account visibility
   */
  async findByIdWithVisibility(
    id: string,
    householdId: string,
    userId: string,
    projectCashDescription = false,
  ): Promise<Transaction | undefined> {
    if (projectCashDescription) {
      const [row] = await db.select({ ...getTableColumns(transactions), ...couponCashDescriptionFields() }).from(transactions)
        .where(and(eq(transactions.id, id), visibleTransactionPredicate({ householdId, userId, role: "member" }))).limit(1);
      return row;
    }
    const txn = await this.findById(id, householdId);
    if (!txn) return undefined;

    // Check transaction visibility
    if (txn.isPrivate && txn.ownerUserId !== userId) {
      return undefined;
    }

    // Check account visibility
    const account = await db
      .select({
        isPrivate: accounts.isPrivate,
        ownerUserId: accounts.ownerUserId,
      })
      .from(accounts)
      .where(eq(accounts.id, txn.accountId))
      .limit(1);

    if (account.length === 0) return undefined;

    const accountVisible =
      !account[0].isPrivate || account[0].ownerUserId === userId;
    if (!accountVisible) {
      return undefined;
    }

    return txn;
  }

  /**
   * Find transaction by idempotency key (for duplicate detection)
   */
  async findByIdempotencyKey(
    key: string,
    householdId: string,
  ): Promise<Transaction | undefined> {
    const result = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.idempotencyKey, key),
          eq(transactions.householdId, householdId),
        ),
      )
      .limit(1);
    return result[0];
  }

  private async createWithTx(
    tx: Parameters<Parameters<typeof withTransaction>[0]>[0],
    data: InsertTransaction & {
      splits?: {
        amount: string;
        categoryId?: string | null;
        merchantId?: string | null;
        notes?: string | null;
      }[];
    },
    options?: TransactionCreateOptions,
  ): Promise<{ transaction: Transaction; account: Account }> {
    // Split parents are not flagged excluded. Budget/report readers skip the
    // parent lump with NOT EXISTS(transaction_splits) guards and count the
    // split rows instead, so explicit hide/exclude flags keep their meaning.
    const { splits, ...txnData } = data;
    if (String(txnData.type) === "asset_settlement") throw new ValidationError("Use the confirmed principal settlement workflow");
    if (txnData.type === "transfer" || txnData.transferTransactionId || txnData.transferAccountId || txnData.isTransferIn) {
      throw new ValidationError("Use the paired transfer create workflow");
    }
    let applyInitialTags: ((id: string) => Promise<unknown>) | undefined;
    if (options?.initialImportTagNames?.length) {
      if (txnData.source !== "csv_import" || !options.createActor || options.createActor.householdId !== txnData.householdId) {
        throw new ValidationError("Initial statement tags require an authorized account import");
      }
      applyInitialTags = await tagWriteRepository.prepareImport(tx, txnData.householdId, options.createActor.userId, options.initialImportTagNames);
    }
    const createActor = await lockTransactionCreateGrant(tx, txnData.householdId, options);
    const coupon = options?.couponPaymentId && await lockCouponPostingAccount(tx, createActor, options.couponPaymentId, txnData);
    if (coupon && !options?.audit) throw new ValidationError("Coupon posting requires its original audit");
    if (coupon) {
      txnData.notes = coupon.notes;
      if (coupon.genericDescription) { txnData.name = GRZ_COUPON_CASH_DESCRIPTION; txnData.originalName = null; txnData.merchantId = null; }
    }
    const lockedAccount = coupon ? coupon.account : await this.lockAccountForBalanceMutation(tx, txnData.accountId, txnData.householdId);
    await prepareTransactionCreate(tx, lockedAccount, txnData,
      coupon && coupon.genericDescription ? { ...options, merchantAlias: undefined, requestedMerchantId: undefined } : options, createActor);
    const receipt = buildPostingReceipt(lockedAccount, txnData, options?.postingMode);
    const delta = new Money(receipt.postedBalanceDelta, receipt.currency);

    const intent = options?.originalOwnerIntent;
    if (txnData.idempotencyKey && intent) {
      txnData.id ??= randomUUID();
      await tx.insert(transactionCreateOwnerIntents).values({
        transactionId: txnData.id, householdId: txnData.householdId, idempotencyKey: txnData.idempotencyKey,
        actorUserId: intent.actorUserId, ownerSelected: intent.selectedOwnerId !== undefined,
        selectedOwnerId: intent.selectedOwnerId ?? null,
        operation: intent.operation ?? "ordinary",
        requestDigest: intent.requestDigest,
      });
    }
    const txnResult = await tx.insert(transactions).values({ ...txnData, ...receipt }).returning();

    // Claim the key before checking spendable funds. A replay can arrive after
    // its own first debit has spent the balance. New overdrafts still roll back.
    this.assertAssetAccountCanApplyDelta(lockedAccount, delta);
    const txn = txnResult[0];

    if (options?.audit) {
      await businessAuditService.logCreate({
        tx,
        userId: options.audit.userId,
          householdId: txn.isPrivate || lockedAccount.isPrivate || (coupon && coupon.privateAudit) ? null : options.audit.householdId,
        entityId: txn.id,
        entityType: "transaction",
        newValue: {
          accountId: txn.accountId,
          amount: txn.amount,
          currency: txn.currency,
          date: txn.date,
          type: txn.type,
          source: txn.source,
          postedBalanceDelta: txn.postedBalanceDelta,
          postedAccountIsAsset: txn.postedAccountIsAsset,
          postingMode: txn.postingMode,
          isPrivate: txn.isPrivate,
          ownerUserId: txn.ownerUserId,
        },
        ipAddress: options.audit.ipAddress,
        metadata: coupon ? { ...options.audit.metadata, grzCoupon: coupon.receipt } : options.audit.metadata,
      });
    }

    // Insert splits if present
    if (splits && splits.length > 0) {
      await tx.insert(transactionSplits).values(
        splits.map((s) => ({
          transactionId: txn.id,
          amount: s.amount,
          categoryId: s.categoryId,
          merchantId: s.merchantId,
          notes: s.notes,
        })),
      );
    }

    if (applyInitialTags) await applyInitialTags(txn.id);
    if (options?.publishCreatedEvent) {
      await outboxEventService.publish({
        eventType: EventTypes.TRANSACTION_CREATED, aggregateType: "transaction",
        aggregateId: txn.id, householdId: txn.householdId,
        payload: { id: txn.id, type: txn.type, amount: txn.amount, accountId: txn.accountId },
      }, tx);
    }

    // Update account balance using string delta to avoid floating-point drift
    const accountResult = delta.isZero() ? [lockedAccount] : await tx
      .update(accounts)
      .set({
        balance: sql`${accounts.balance} + ${delta.toString()}::numeric`,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, txnData.accountId))
      .returning();

    return {
      transaction: txn,
      account: accountResult[0],
    };
  }

  /**
   * Create a transaction and update account balance atomically
   */
  async create(
    data: InsertTransaction & {
      splits?: {
        amount: string;
        categoryId?: string | null;
        merchantId?: string | null;
        notes?: string | null;
      }[];
    },
    options?: TransactionCreateOptions,
  ): Promise<{ transaction: Transaction; account: Account }> {
    const result = await withRecurringParentForCreate(data, options?.recurringActor, tx =>
      this.createWithTx(tx, data, options), options?.accountImportTransaction);

    if (result.transaction.postingMode === "history_only") return result;
    try {
      await goalAccountAssignmentService.syncGoalsForAccount(
        data.accountId,
        "transaction_created",
      );
    } catch (error) {
      logger.error("Goal auto-sync failed after transaction create", {
        accountId: data.accountId,
        error,
      });
    }

    return result;
  }

  async createWithinTransaction(
    tx: Parameters<Parameters<typeof withTransaction>[0]>[0],
    data: InsertTransaction & {
      splits?: {
        amount: string;
        categoryId?: string | null;
        merchantId?: string | null;
        notes?: string | null;
      }[];
    },
    options?: TransactionCreateOptions,
  ): Promise<{ transaction: Transaction; account: Account }> {
    return this.createWithTx(tx, data, options);
  }

  /**
   * Update a transaction with balance recalculation
   */
  async update(
    id: string,
    householdId: string,
    data: TransactionUpdateData,
    expectedUpdatedAt?: Date,
    externalTx?: TransactionType,
    options?: TransactionUpdateOptions,
  ): Promise<{ transaction?: Transaction; conflict: boolean }> {
    const accountsToSyncAfterCommit = new Set<string>();

    const operation = (tx: TransactionType) => writeTransactionUpdate(
      tx, id, householdId, data, expectedUpdatedAt, {
        callerOwnsTransaction: externalTx !== undefined,
        lockAccounts: this.lockAccountsForBalanceMutation.bind(this),
        assertDelta: this.assertAssetAccountCanApplyDelta.bind(this),
        accountsToSyncAfterCommit,
      }, options,
    );
    const result = externalTx
      ? await operation(externalTx)
      : await withTransaction(operation);

    if (result.transaction && accountsToSyncAfterCommit.size > 0) {
      try {
        await Promise.all(
          Array.from(accountsToSyncAfterCommit).map((accountId) =>
            goalAccountAssignmentService.syncGoalsForAccount(
              accountId,
              "transaction_updated",
            ),
          ),
        );
      } catch (error) {
        logger.error("Goal auto-sync failed after transaction update", {
          accountIds: Array.from(accountsToSyncAfterCommit),
          error,
        });
      }
    }

    return result;
  }

  /**
   * Soft delete a transaction with balance reversal
   *
   * Locks the transaction row FOR UPDATE inside the transaction (like update())
   * so the reversal is computed from the committed row, never a stale snapshot —
   * a concurrent amount/account edit cannot corrupt the balance.
   */
  async softDelete(
    id: string,
    householdId: string,
    options?: TransactionDeleteOptions,
  ): Promise<boolean> {
    let accountToSyncAfterCommit: string | undefined;

    const result = await withTransaction(async (tx) => {
      const actor = options?.actor ? await lockTransactionCreateGrant(tx, householdId, { createActor: options.actor }) : undefined;
      const baseConditions = [
        eq(transactions.id, id),
        eq(transactions.householdId, householdId),
        isNull(transactions.deletedAt),
      ];

      const [lockedExisting] = await tx
        .select()
        .from(transactions)
        .where(and(...baseConditions))
        .limit(1)
        .for("update");

      if (!lockedExisting) return false;

      // Same lock order as update(): transaction row first, then account.
      const account = await this.lockAccountForBalanceMutation(
        tx,
        lockedExisting.accountId,
        householdId,
      );

      if (actor) {
        const [visible] = await tx.select({ id: transactions.id }).from(transactions).where(and(
          eq(transactions.id, id), visibleTransactionPredicate(actor),
        )).limit(1);
        if (!visible) throw new NotFoundError("Transaction not found");
      }
      await assertPrincipalCashDelete(tx, householdId, [lockedExisting]);
      if (lockedExisting.type === "transfer" || lockedExisting.transferTransactionId || lockedExisting.transferAccountId || lockedExisting.isTransferIn) {
        throw new ValidationError("Use the paired transfer delete workflow");
      }
      const { delta } = await resolvePostingEffect(tx, account, lockedExisting);
      this.assertAssetAccountCanApplyDelta(account, delta.negated());

      // Mark as deleted
      const deleteResult = await tx
        .update(transactions)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(...baseConditions))
        .returning();

      if (deleteResult.length === 0) return false;

      // Rule 9: DELETE audit row atomic with the soft-delete + balance
      // reversal below — a bypassing caller (bulk delete, future callers)
      // still gets an audit row because it lives here, not in the controller.
      if (options?.audit) {
        const privateCouponAudit = await identifiedCouponCashForAudit(tx, id);
        await businessAuditService.logDelete({
          tx,
          userId: options.audit.userId,
          householdId: lockedExisting.isPrivate || account.isPrivate || privateCouponAudit ? null : householdId,
          entityId: id,
          entityType: "transaction",
          oldValue: actor ? { amount: lockedExisting.amount, categoryId: lockedExisting.categoryId, description: lockedExisting.name,
            date: lockedExisting.date, accountId: lockedExisting.accountId } : options.audit.oldValue,
          ipAddress: options.audit.ipAddress,
          metadata: options.audit.metadata,
        });
      }

      // R10.3: a deleted source takes back exactly what it gave each linked goal.
      await reverseDeletedSourceLinks(tx, lockedExisting, {
        userId: options?.audit?.userId ?? options?.actor?.userId ?? null, ipAddress: options?.audit?.ipAddress,
        householdId: lockedExisting.isPrivate || account.isPrivate ? null : householdId, viewer: actor,
      });

      if (options?.publishDeletedEvent) {
        await outboxEventService.publish({ eventType: EventTypes.TRANSACTION_DELETED,
          aggregateType: "transaction", aggregateId: id, householdId, payload: { id } }, tx);
      }

      if (!delta.isZero()) {
        await tx.update(accounts).set({
          balance: sql`${accounts.balance} - ${delta.toString()}::numeric`, updatedAt: new Date(),
        }).where(eq(accounts.id, lockedExisting.accountId));
        accountToSyncAfterCommit = lockedExisting.accountId;
      }
      return true;
    });

    if (result && accountToSyncAfterCommit) {
      try {
        await goalAccountAssignmentService.syncGoalsForAccount(
          accountToSyncAfterCommit,
          "transaction_deleted",
        );
      } catch (error) {
        logger.error("Goal auto-sync failed after transaction delete", {
          accountId: accountToSyncAfterCommit,
          error,
        });
      }
    }

    return result;
  }

  /**
   * FIX INT-RULES-001: Add splits to an existing transaction
   * Used by rule engine to persist rule-generated splits
   */
  async addSplits(
    transactionId: string,
    householdId: string,
    splits: Array<{
      amount: string;
      categoryId?: string | null;
      merchantId?: string | null;
      notes?: string | null;
      displayOrder?: number;
    }>,
    externalTx?: TransactionType,
  ): Promise<void> {
    // SCP-334: when an external transaction is provided, run within it so the
    // whole rule-apply is atomic; otherwise open our own transaction.
    const operation = async (tx: TransactionType) => {
      // Verify transaction exists and belongs to household
      const [txn] = await tx
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.id, transactionId),
            eq(transactions.householdId, householdId),
            isNull(transactions.deletedAt),
          ),
        )
        .limit(1)
        .for("update");

      if (!txn) {
        throw new Error(
          "Transaction not found or does not belong to household",
        );
      }

      if (splits.length > 0) {
        const account = await this.lockAccountForBalanceMutation(tx, txn.accountId, householdId);
        if (!txn.currency || account.currency !== txn.currency) {
          throw new ValidationError("Split currency must match the locked account denomination", [
            { field: "currency", message: "Reconcile the source denomination before replacing splits" },
          ]);
        }
      }
      const replacement = await applyTransactionSplitUpdate(tx, txn, { splits }, { allowEmpty: true });
      if (replacement.changed || (replacement.parentCategoryId !== undefined && replacement.parentCategoryId !== txn.categoryId)) {
        await tx.update(transactions).set({
          ...(replacement.parentCategoryId !== undefined ? { categoryId: replacement.parentCategoryId } : {}),
          updatedAt: nextTransactionVersion(txn.updatedAt),
        })
          .where(eq(transactions.id, transactionId));
      }
    };

    if (externalTx) {
      await operation(externalTx);
      return;
    }
    return withTransaction(operation);
  }
}

// Export singleton instance
export const transactionRepository = new TransactionRepository();
