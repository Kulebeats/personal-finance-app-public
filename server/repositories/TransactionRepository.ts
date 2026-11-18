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

import { eq, and, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  transactions,
  accounts,
  transactionSplits,
  type Transaction,
  type InsertTransaction,
  type Account,
} from "@shared/schema";
import {
  withTransaction,
  type TransactionType,
} from "../utils/withTransaction";
import { Money } from "../core/money";
import { goalAccountAssignmentService } from "../services/GoalAccountAssignmentService";
import { logger } from "../utils/logger";
import { TransactionRepositoryDelegates } from "./TransactionRepository.delegates";
import { NotFoundError, ValidationError } from "../utils/errorHandler";
import { businessAuditService } from "../services/BusinessAuditService";

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
  merchantName?: string | null;
  merchantLogoUrl?: string | null;
  categoryName?: string | null;
  accountName?: string | null;
}

export interface TransactionCreateOptions {
  audit?: {
    userId: string | null;
    householdId: string;
    ipAddress?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface TransactionDeleteOptions {
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
    return lockedAccounts.get(accountId)!;
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
  ): Promise<Transaction | undefined> {
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
    const lockedAccount = await this.lockAccountForBalanceMutation(
      tx,
      txnData.accountId,
      txnData.householdId,
    );

    // FIX DATA-ACCOUNT-001: Calculate balance delta using Money (no .toNumber())
    // Keep Money object through calculation to preserve precision
    const amount = new Money(txnData.amount, txnData.currency ?? undefined);
    const delta = this.calculateBalanceDelta(
      txnData.type,
      amount,
      txnData.isTransferIn ?? false,
      txnData.isBalanceAdjustmentIncrease ?? true,
    );

    this.assertAssetAccountCanApplyDelta(lockedAccount, delta);

    const txnResult = await tx.insert(transactions).values(txnData).returning();

    const txn = txnResult[0];

    if (options?.audit) {
      await businessAuditService.logCreate({
        tx,
        userId: options.audit.userId,
        householdId: options.audit.householdId,
        entityId: txn.id,
        entityType: "transaction",
        newValue: {
          accountId: txn.accountId,
          amount: txn.amount,
          currency: txn.currency,
          date: txn.date,
          type: txn.type,
          source: txn.source,
        },
        ipAddress: options.audit.ipAddress,
        metadata: options.audit.metadata,
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

    // Update account balance using string delta to avoid floating-point drift
    const accountResult = await tx
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
    const result = await withTransaction((tx) =>
      this.createWithTx(tx, data, options),
    );

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
    data: Partial<Transaction>,
    expectedUpdatedAt?: Date,
    externalTx?: TransactionType,
  ): Promise<{ transaction?: Transaction; conflict: boolean }> {
    const accountsToSyncAfterCommit = new Set<string>();

    const operation = async (tx: TransactionType) => {
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

      if (!lockedExisting) {
        return { transaction: undefined, conflict: false };
      }

      const targetAccountId = data.accountId ?? lockedExisting.accountId;
      const balanceMayChange =
        data.amount !== undefined ||
        data.type !== undefined ||
        data.isTransferIn !== undefined ||
        data.isBalanceAdjustmentIncrease !== undefined ||
        data.accountId !== undefined ||
        data.currency !== undefined;

      const lockedAccounts = balanceMayChange
        ? await this.lockAccountsForBalanceMutation(
            tx,
            [lockedExisting.accountId, targetAccountId],
            householdId,
          )
        : new Map<string, Account>();

      const conditions = [...baseConditions];

      // Optimistic concurrency check
      if (expectedUpdatedAt) {
        conditions.push(eq(transactions.updatedAt, expectedUpdatedAt));
      }

      const result = await tx
        .update(transactions)
        .set({ ...data, updatedAt: new Date() })
        .where(and(...conditions))
        .returning();

      if (result.length === 0 && expectedUpdatedAt) {
        return { transaction: undefined, conflict: true };
      }

      if (result.length === 0) {
        return { transaction: undefined, conflict: false };
      }

      const updated = result[0];

      // FIX DATA-ACCOUNT-001: Recalculate balance if amount or type changed - use Money (no .toNumber())
      if (balanceMayChange) {
        const oldAmount = new Money(
          lockedExisting.amount,
          lockedExisting.currency ?? undefined,
        );
        const newAmount = new Money(
          updated.amount,
          updated.currency ?? undefined,
        );

        const oldDelta = this.calculateBalanceDelta(
          lockedExisting.type,
          oldAmount,
          lockedExisting.isTransferIn ?? false,
          lockedExisting.isBalanceAdjustmentIncrease ?? true,
        );

        const newDelta = this.calculateBalanceDelta(
          updated.type,
          newAmount,
          updated.isTransferIn ?? false,
          updated.isBalanceAdjustmentIncrease ?? true,
        );

        const netDelta = newDelta.subtract(oldDelta);

        const balanceDeltas = new Map<string, Money>();
        const addDelta = (accountId: string, delta: Money) => {
          const current =
            balanceDeltas.get(accountId) ?? Money.zero(delta.currency);
          balanceDeltas.set(accountId, current.add(delta));
        };

        if (lockedExisting.accountId === updated.accountId) {
          addDelta(updated.accountId, netDelta);
        } else {
          addDelta(lockedExisting.accountId, oldDelta.negated());
          addDelta(updated.accountId, newDelta);
        }

        for (const [accountId, delta] of balanceDeltas.entries()) {
          if (delta.isZero()) {
            continue;
          }

          const lockedAccount = lockedAccounts.get(accountId);
          if (!lockedAccount) {
            throw new NotFoundError("Account not found");
          }

          this.assertAssetAccountCanApplyDelta(lockedAccount, delta);
        }

        for (const [accountId, delta] of balanceDeltas.entries()) {
          if (delta.isZero()) {
            continue;
          }

          await tx
            .update(accounts)
            .set({
              balance: sql`${accounts.balance} + ${delta.toString()}::numeric`,
              updatedAt: new Date(),
            })
            .where(eq(accounts.id, accountId));
          accountsToSyncAfterCommit.add(accountId);
        }
      }

      return { transaction: updated, conflict: false };
    };

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
      await this.lockAccountForBalanceMutation(
        tx,
        lockedExisting.accountId,
        householdId,
      );

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
        await businessAuditService.logDelete({
          tx,
          userId: options.audit.userId,
          householdId,
          entityId: id,
          entityType: "transaction",
          oldValue: options.audit.oldValue,
          ipAddress: options.audit.ipAddress,
          metadata: options.audit.metadata,
        });
      }

      // FIX DATA-ACCOUNT-001: Reverse balance impact using Money (no .toNumber())
      const amount = new Money(
        lockedExisting.amount,
        lockedExisting.currency ?? undefined,
      );
      const delta = this.calculateBalanceDelta(
        lockedExisting.type,
        amount,
        lockedExisting.isTransferIn ?? false,
        lockedExisting.isBalanceAdjustmentIncrease ?? true,
      );

      // Reverse the delta using string to avoid floating-point drift
      await tx
        .update(accounts)
        .set({
          balance: sql`${accounts.balance} - ${delta.toString()}::numeric`,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, lockedExisting.accountId));

      accountToSyncAfterCommit = lockedExisting.accountId;
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
        .limit(1);

      if (!txn) {
        throw new Error(
          "Transaction not found or does not belong to household",
        );
      }

      // Delete existing splits (if any) to replace with new splits
      await tx
        .delete(transactionSplits)
        .where(eq(transactionSplits.transactionId, transactionId));

      // Insert new splits
      if (splits.length > 0) {
        await tx.insert(transactionSplits).values(
          splits.map((s, index) => ({
            transactionId,
            amount: s.amount,
            categoryId: s.categoryId || null,
            merchantId: s.merchantId || null,
            notes: s.notes || null,
            displayOrder: s.displayOrder ?? index,
          })),
        );
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
