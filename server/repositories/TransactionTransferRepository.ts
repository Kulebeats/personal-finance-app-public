/**
 * Transaction Transfer Repository
 *
 * Transfer operations (create transfer pairs, find pairs).
 * Split from TransactionRepository to keep file sizes under 500 LOC.
 *
 * @module repositories/TransactionTransferRepository
 */

import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  transactions,
  accounts,
  type Transaction,
} from "@shared/schema";
import { withTransaction } from "../utils/withTransaction";
import { goalAccountAssignmentService } from "../services/GoalAccountAssignmentService";
import { Money } from "../core/money";
import { NotFoundError, ValidationError } from "../utils/errorHandler";
import { logger } from "../utils/logger";
import { businessAuditService } from "../services/BusinessAuditService";

export interface TransferDeleteOptions {
  /**
   * Rule 9: when provided, a DELETE audit row is written INSIDE the same
   * transaction as the pair soft-delete + balance reversal. `entityId` is
   * the specific leg id the caller resolved the pair from (the URL/service
   * id), not the shared transferTransactionId group key.
   */
  audit?: {
    userId: string | null;
    entityId: string;
    oldValue?: Record<string, unknown>;
    ipAddress?: string;
    metadata?: Record<string, unknown>;
  };
}

/**
 * Transaction Transfer Repository
 *
 * Handles transfer-specific operations.
 */
export class TransactionTransferRepository {
  /**
   * Create a transfer (two-row model)
   * Per Canonical Invariant 4: creates two linked rows with same transfer_transaction_id
   */
  async createTransfer(
    fromAccountId: string,
    toAccountId: string,
    amount: number | string,
    commonData: {
      householdId: string;
      ownerUserId: string;
      date: string;
      name?: string;
      notes?: string;
      idempotencyKey?: string;
      currency?: string;
      // FIX DATA-TRANSFER-001: Add destination amount/currency for FX transfers
      destinationAmount?: string;
      destinationCurrency?: string;
      // FX fields for cross-currency transfers (stored on BOTH rows)
      fxRate?: string;
      fxBaseCurrency?: string;
      fxQuoteCurrency?: string;
      fxTimestamp?: Date;
      fxSource?: string;
      convertedAmount?: string;
    },
  ): Promise<{
    outflow: Transaction;
    inflow: Transaction;
    isDuplicate: boolean;
  }> {
    // Generate shared transfer ID
    const transferTransactionId = crypto.randomUUID();

    const result = await withTransaction(async (tx) => {
      // SCP-320: Lock BOTH accounts FOR UPDATE before any read-then-write. Locking
      // in a consistent id order (regardless of transfer direction) prevents
      // deadlocks between A->B and B->A transfers running concurrently. These locks
      // serialize concurrent transfers touching the same accounts, which is what
      // makes the idempotency and overdraft checks below race-free.
      const lockedAccounts = await tx
        .select()
        .from(accounts)
        .where(inArray(accounts.id, [fromAccountId, toAccountId]))
        .orderBy(accounts.id)
        .for("update");

      const lockedFrom = lockedAccounts.find((a) => a.id === fromAccountId);
      const lockedTo = lockedAccounts.find((a) => a.id === toAccountId);
      if (!lockedFrom || !lockedTo) {
        // An account was removed between the service's visibility check and this
        // lock (rare TOCTOU). Fail loudly rather than write against a missing FK.
        throw new NotFoundError("Transfer account not found");
      }

      // SCP-320: Idempotency check INSIDE the transaction. Because the account
      // locks above serialize concurrent same-key requests, the second request
      // sees the first's committed row here and short-circuits — instead of both
      // racing past an out-of-txn check and colliding on the unique index.
      if (commonData.idempotencyKey) {
        const [existing] = await tx
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.idempotencyKey, commonData.idempotencyKey),
              eq(transactions.householdId, commonData.householdId),
            ),
          )
          .limit(1);

        if (existing?.transferTransactionId) {
          const pair = await tx
            .select()
            .from(transactions)
            .where(
              and(
                eq(
                  transactions.transferTransactionId,
                  existing.transferTransactionId,
                ),
                eq(transactions.householdId, commonData.householdId),
                isNull(transactions.deletedAt),
              ),
            )
            .limit(2);
          const dupOutflow = pair.find((t) => !t.isTransferIn);
          const dupInflow = pair.find((t) => t.isTransferIn);
          if (dupOutflow && dupInflow) {
            return { outflow: dupOutflow, inflow: dupInflow, isDuplicate: true };
          }
          // Key matched but the live pair is gone (e.g. soft-deleted) — fall
          // through and create a fresh transfer, matching prior behavior.
        }
      }

      // SCP-320: Overdraft guard on the locked source balance. Only asset accounts
      // are guarded — credit cards / loans (isAsset === false) are expected to go
      // negative. Money comparison keeps decimal precision (no float drift).
      if (lockedFrom.isAsset) {
        const sourceBalance = new Money(lockedFrom.balance, lockedFrom.currency);
        const debit = new Money(String(amount), lockedFrom.currency);
        if (sourceBalance.lt(debit)) {
          throw new ValidationError("Insufficient funds for transfer", [
            {
              field: "amount",
              message: "Source account balance is insufficient for this transfer",
            },
          ]);
        }
      }

      // Create outflow transaction
      const outflowResult = await tx
        .insert(transactions)
        .values({
          householdId: commonData.householdId,
          accountId: fromAccountId,
          ownerUserId: commonData.ownerUserId,
          date: commonData.date,
          name: commonData.name || "Transfer",
          amount: String(amount),
          currency: commonData.currency,
          type: "transfer" as const,
          isTransferIn: false,
          transferAccountId: toAccountId,
          transferTransactionId,
          source: "manual" as const,
          notes: commonData.notes,
          idempotencyKey: commonData.idempotencyKey,
          // FX fields for cross-currency transfers (same on both rows)
          fxRate: commonData.fxRate,
          fxBaseCurrency: commonData.fxBaseCurrency,
          fxQuoteCurrency: commonData.fxQuoteCurrency,
          fxTimestamp: commonData.fxTimestamp,
          fxSource: commonData.fxSource,
          convertedAmount: commonData.convertedAmount,
        })
        .returning();

      // FIX DATA-TRANSFER-001: Use destination amount for inflow transaction
      // For cross-currency transfers, inflow uses converted amount in destination currency
      const inflowAmount = commonData.destinationAmount || String(amount);
      const inflowCurrency = commonData.destinationCurrency || commonData.currency;

      // Create inflow transaction
      const inflowResult = await tx
        .insert(transactions)
        .values({
          householdId: commonData.householdId,
          accountId: toAccountId,
          ownerUserId: commonData.ownerUserId,
          date: commonData.date,
          name: commonData.name || "Transfer",
          amount: inflowAmount,
          currency: inflowCurrency,
          type: "transfer" as const,
          isTransferIn: true,
          transferAccountId: fromAccountId,
          transferTransactionId,
          source: "manual" as const,
          notes: commonData.notes,
          // No idempotency key for inflow - only outflow needs it
          // FX fields for cross-currency transfers (same on both rows)
          fxRate: commonData.fxRate,
          fxBaseCurrency: commonData.fxBaseCurrency,
          fxQuoteCurrency: commonData.fxQuoteCurrency,
          fxTimestamp: commonData.fxTimestamp,
          fxSource: commonData.fxSource,
          convertedAmount: commonData.convertedAmount,
        })
        .returning();

      // Update from account balance (subtract)
      await tx
        .update(accounts)
        .set({
          balance: sql`${accounts.balance} - ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, fromAccountId));

      // FIX DATA-TRANSFER-001: Update destination balance with converted amount
      // For cross-currency transfers, add the converted amount to destination account
      await tx
        .update(accounts)
        .set({
          balance: sql`${accounts.balance} + ${inflowAmount}`,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, toAccountId));

      return {
        outflow: outflowResult[0],
        inflow: inflowResult[0],
        isDuplicate: false,
      };
    });

    // Skip goal re-sync for an idempotent replay — nothing changed.
    if (!result.isDuplicate) {
      try {
        await goalAccountAssignmentService.syncGoalsForAccount(
          fromAccountId,
          "transfer_created",
        );
        await goalAccountAssignmentService.syncGoalsForAccount(
          toAccountId,
          "transfer_created",
        );
      } catch (error) {
        logger.error("Goal auto-sync failed after transfer create", {
          fromAccountId,
          toAccountId,
          error,
        });
      }
    }

    return result;
  }

  /**
   * Soft delete both legs of a transfer atomically with balance reversal.
   *
   * Locks the pair rows FOR UPDATE, then both accounts (consistent id order,
   * same as createTransfer), marks every live leg deleted, and reverses the
   * balance impact — all in ONE transaction. Previously this was two separate
   * softDelete transactions; a crash or concurrent edit between them could
   * half-reverse the pair permanently.
   *
   * Returns the number of legs deleted (0 = pair already gone).
   */
  async softDeleteTransferPair(
    transferTransactionId: string,
    householdId: string,
    options?: TransferDeleteOptions,
  ): Promise<number> {
    const accountsToSyncAfterCommit = new Set<string>();

    const deletedCount = await withTransaction(async (tx) => {
      const lockedPair = await tx
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.transferTransactionId, transferTransactionId),
            eq(transactions.householdId, householdId),
            isNull(transactions.deletedAt),
          ),
        )
        .limit(2)
        .for("update");

      if (lockedPair.length === 0) return 0;

      const affectedAccountIds = Array.from(
        new Set(lockedPair.map((leg) => leg.accountId)),
      ).sort();

      const lockedAccounts = await tx
        .select()
        .from(accounts)
        .where(inArray(accounts.id, affectedAccountIds))
        .orderBy(accounts.id)
        .for("update");

      if (lockedAccounts.length !== affectedAccountIds.length) {
        throw new NotFoundError("Transfer account not found");
      }

      const now = new Date();
      await tx
        .update(transactions)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          inArray(
            transactions.id,
            lockedPair.map((leg) => leg.id),
          ),
        );

      // Rule 9: DELETE audit row atomic with the pair soft-delete + balance
      // reversal below. Single row (entityType "transaction") keyed on the
      // caller-resolved leg id, mirroring the pre-existing controller shape.
      if (options?.audit) {
        await businessAuditService.logDelete({
          tx,
          userId: options.audit.userId,
          householdId,
          entityId: options.audit.entityId,
          entityType: "transaction",
          oldValue: options.audit.oldValue,
          ipAddress: options.audit.ipAddress,
          metadata: options.audit.metadata,
        });
      }

      // Reverse each leg's balance impact from the LOCKED rows. Outflow legs
      // subtracted from their account, so reversal adds; inflow legs added, so
      // reversal subtracts. Aggregate per account (self-transfer safety).
      const balanceDeltas = new Map<string, Money>();
      for (const leg of lockedPair) {
        const amount = new Money(leg.amount, leg.currency ?? undefined);
        const reversal = leg.isTransferIn ? amount.negated() : amount;
        const current =
          balanceDeltas.get(leg.accountId) ?? Money.zero(reversal.currency);
        balanceDeltas.set(leg.accountId, current.add(reversal));
      }

      for (const [accountId, delta] of balanceDeltas.entries()) {
        if (delta.isZero()) continue;

        await tx
          .update(accounts)
          .set({
            balance: sql`${accounts.balance} + ${delta.toString()}::numeric`,
            updatedAt: new Date(),
          })
          .where(eq(accounts.id, accountId));
        accountsToSyncAfterCommit.add(accountId);
      }

      return lockedPair.length;
    });

    if (deletedCount > 0) {
      try {
        await Promise.all(
          Array.from(accountsToSyncAfterCommit).map((accountId) =>
            goalAccountAssignmentService.syncGoalsForAccount(
              accountId,
              "transfer_deleted",
            ),
          ),
        );
      } catch (error) {
        logger.error("Goal auto-sync failed after transfer delete", {
          transferTransactionId,
          error,
        });
      }
    }

    return deletedCount;
  }

  /**
   * Find the paired transfer transaction
   */
  async findTransferPair(
    transferTransactionId: string,
    householdId: string,
  ): Promise<Transaction[]> {
    return await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.transferTransactionId, transferTransactionId),
          eq(transactions.householdId, householdId),
          isNull(transactions.deletedAt),
        ),
      )
      .limit(2); // Optimization: transfer pair is max 2
  }
}

// Export singleton instance
export const transactionTransferRepository = new TransactionTransferRepository();
