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
  transactionCreateOwnerIntents,
  accounts,
  type Transaction,
} from "@shared/schema";
import { EventTypes, outboxEventService } from "../core/events";
import { withTransaction } from "../utils/withTransaction";
import { invalidateOnChangeAfterCommit } from "../services/CacheInvalidation";
import { goalAccountAssignmentService } from "../services/GoalAccountAssignmentService";
import { Money } from "../core/money";
import { NotFoundError, ValidationError } from "../utils/errorHandler";
import { logger } from "../utils/logger";
import { businessAuditService } from "../services/BusinessAuditService";

import { lockTransactionCreateGrant } from "./TransactionCreateBoundary";
import { visibleTransactionPredicate } from "../core/authz/transaction-visibility";
import { authorizedTransferReplay, readTransferReplay, requireTransferPair, requireTransferVisibility } from "./TransferReplay";
import { TransferCreateRequest, type TransferPosting, directTransferTerms, readPreparedTransfer, transferAmount, transferHash, validateTransferRate } from "../services/TransferCreateRequest";
import { isPostgresError } from "../utils/postgresError";
import { buildPostingReceipt, readPostingEffect } from "./TransactionPostingEffect";

export { requireTransferPair, requireTransferVisibility } from "./TransferReplay";

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
    input: TransferPosting | TransferCreateRequest,
  ): Promise<{
    outflow: Transaction;
    inflow: Transaction;
    isDuplicate: boolean;
  }> {
    fromAccountId = fromAccountId.toLowerCase();
    toAccountId = toAccountId.toLowerCase();
    const request = input instanceof TransferCreateRequest ? readPreparedTransfer(input) : undefined;
    const commonData = request?.posting ?? structuredClone(input as TransferPosting);
    commonData.householdId = commonData.householdId.toLowerCase();
    commonData.ownerUserId = commonData.ownerUserId.toLowerCase();
    amount = transferAmount(amount).toString();
    validateTransferRate(commonData.fxRate);
    if (request && (request.from !== fromAccountId || request.to !== toAccountId || request.amount !== String(amount))) {
      throw new ValidationError("Transfer posting does not match the request");
    }
    const terms = commonData.idempotencyKey && (request?.terms ?? directTransferTerms(fromAccountId, toAccountId, amount, commonData));
    // Generate shared transfer ID
    const transferTransactionId = crypto.randomUUID();

    const result = await withTransaction(async (tx) => {
      const actor = { householdId: commonData.householdId, userId: commonData.ownerUserId };
      const grant = await lockTransactionCreateGrant(tx, actor.householdId, { createActor: actor });
      if (!grant) throw new NotFoundError("Transfer not found");
      // SCP-320: Lock BOTH accounts FOR UPDATE before any read-then-write. Locking
      // in a consistent id order (regardless of transfer direction) prevents
      // deadlocks between A->B and B->A transfers running concurrently. These locks
      // serialize concurrent transfers touching the same accounts, which is what
      // makes the idempotency and overdraft checks below race-free.
      const lockedAccounts = await tx
        .select()
        .from(accounts)
        .where(and(inArray(accounts.id, [fromAccountId, toAccountId]), eq(accounts.householdId, commonData.householdId), isNull(accounts.deletedAt)))
        .orderBy(accounts.id)
        .for("update");

      const lockedFrom = lockedAccounts.find((a) => a.id === fromAccountId);
      const lockedTo = lockedAccounts.find((a) => a.id === toAccountId);
      if (!lockedFrom || !lockedTo || fromAccountId === toAccountId) {
        // An account was removed between the service's visibility check and this
        // lock (rare TOCTOU). Fail loudly rather than write against a missing FK.
        throw new NotFoundError("Transfer account not found");
      }

      requireTransferVisibility(lockedAccounts, actor.userId);
      const inflowAmount = commonData.destinationAmount ?? String(amount);
      if (lockedFrom.currency === lockedTo.currency && !new Money(inflowAmount).equals(new Money(amount))) {
        throw new ValidationError("Transfer amounts must match within one currency");
      }

      if (commonData.idempotencyKey && terms) {
        const replay = await readTransferReplay(tx, grant, commonData.idempotencyKey, terms,
          { fromAccountId, toAccountId, amount, inflowAmount, currency: commonData.currency, destinationCurrency: commonData.destinationCurrency });
        if (replay) return replay;
      }

      if ((commonData.currency && commonData.currency !== lockedFrom.currency) ||
          (commonData.destinationCurrency && commonData.destinationCurrency !== lockedTo.currency) ||
          (lockedFrom.currency !== lockedTo.currency && (!commonData.destinationAmount || !commonData.destinationCurrency))) {
        throw new ValidationError("Transfer account denominations changed", [{ field: "currency", message: "Refresh the transfer quote" }]);
      }
      const outgoing = buildPostingReceipt(lockedFrom, { type: "transfer", amount: String(amount), currency: lockedFrom.currency, isTransferIn: false });
      const incoming = buildPostingReceipt(lockedTo, { type: "transfer", amount: inflowAmount, currency: lockedTo.currency, isTransferIn: true });
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

      const outflowId = crypto.randomUUID(), inflowId = crypto.randomUUID();
      if (commonData.idempotencyKey && terms) {
        await tx.insert(transactionCreateOwnerIntents).values({
          transactionId: outflowId, idempotencyKey: commonData.idempotencyKey, householdId: actor.householdId,
          actorUserId: actor.userId, ownerSelected: false, operation: "transfer",
          transferGroupId: transferTransactionId, transferInflowId: inflowId,
          requestDigest: "t1:" + transferHash([terms, outflowId, inflowId, transferTransactionId]),
        });
      }
      // Create outflow transaction
      const outflowResult = await tx
        .insert(transactions)
        .values({
          id: outflowId,
          householdId: commonData.householdId,
          accountId: fromAccountId,
          ownerUserId: commonData.ownerUserId,
          date: commonData.date,
          name: commonData.name || "Transfer",
          amount: String(amount),
          ...outgoing,
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

      // Create inflow transaction
      const inflowResult = await tx
        .insert(transactions)
        .values({
          id: inflowId,
          householdId: commonData.householdId,
          accountId: toAccountId,
          ownerUserId: commonData.ownerUserId,
          date: commonData.date,
          name: commonData.name || "Transfer",
          amount: inflowAmount,
          ...incoming,
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

      // Apply each leg’s recorded effect in its own account denomination.
      await tx
        .update(accounts)
        .set({
          balance: sql`${accounts.balance} + ${outgoing.postedBalanceDelta}::numeric`,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, fromAccountId));

      await tx
        .update(accounts)
        .set({
          balance: sql`${accounts.balance} + ${incoming.postedBalanceDelta}::numeric`,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, toAccountId));

      if (commonData.audit) {
        await businessAuditService.logCreate({ tx, userId: actor.userId, householdId: actor.householdId,
          entityId: outflowResult[0].id, entityType: "transaction", ipAddress: commonData.audit.ipAddress,
          metadata: { isTransfer: true }, newValue: { fromAccountId, toAccountId, amount: outflowResult[0].amount,
            inflowTransactionId: inflowResult[0].id } });
      }
      for (const leg of [outflowResult[0], inflowResult[0]]) {
        await outboxEventService.publish({
          eventType: EventTypes.TRANSACTION_CREATED, aggregateType: "transaction",
          aggregateId: leg.id, householdId: leg.householdId,
          payload: { id: leg.id, type: leg.type, amount: leg.amount, accountId: leg.accountId },
        }, tx);
      }
      return {
        outflow: outflowResult[0],
        inflow: inflowResult[0],
        isDuplicate: false,
      };
    }).catch(async (error: unknown) => {
      if (commonData.idempotencyKey && terms && isPostgresError(error, "23505", "idempotency")) {
        const replay = await authorizedTransferReplay(commonData.householdId, commonData.ownerUserId, commonData.idempotencyKey, terms,
          { fromAccountId, toAccountId, amount, inflowAmount: commonData.destinationAmount ?? String(amount),
            currency: commonData.currency, destinationCurrency: commonData.destinationCurrency });
        if (replay) return replay;
        throw new NotFoundError("Transfer not found");
      }
      throw error;
    });

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
      await invalidateOnChangeAfterCommit("transaction", result.outflow.householdId);
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
      const userId = options?.audit?.userId;
      if (userId) await lockTransactionCreateGrant(tx, householdId, { createActor: { householdId, userId } });
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
        .orderBy(transactions.id)
        .for("update");

      if (lockedPair.length === 0) return 0;
      requireTransferPair(lockedPair);

      const affectedAccountIds = Array.from(
        new Set(lockedPair.map((leg) => leg.accountId)),
      ).sort();

      const lockedAccounts = await tx
        .select()
        .from(accounts)
        .where(and(inArray(accounts.id, affectedAccountIds), eq(accounts.householdId, householdId), isNull(accounts.deletedAt)))
        .orderBy(accounts.id)
        .for("update");

      if (lockedAccounts.length !== affectedAccountIds.length) {
        throw new NotFoundError("Transfer account not found");
      }

      if (userId) requireTransferVisibility([...lockedPair, ...lockedAccounts], userId);
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

      for (const leg of lockedPair) {
        const account = lockedAccounts.find(a => a.id === leg.accountId)!;
        const delta = readPostingEffect(account, leg).delta.negated();
        if (account.isAsset && delta.lt(0) && new Money(account.balance, account.currency).add(delta).lt(0)) {
          throw new ValidationError("Insufficient funds to reverse transfer", [{ field: "amount", message: "The receiving asset cannot cover the reversal" }]);
        }

        await tx
          .update(accounts)
          .set({
            balance: sql`${accounts.balance} + ${delta.toString()}::numeric`,
            updatedAt: new Date(),
          })
          .where(eq(accounts.id, account.id));
        await outboxEventService.publish({
          eventType: EventTypes.TRANSACTION_DELETED, aggregateType: "transaction",
          aggregateId: leg.id, householdId, payload: { id: leg.id },
        }, tx);
        accountsToSyncAfterCommit.add(account.id);
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
    userId?: string,
  ): Promise<Transaction[]> {
    return await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.transferTransactionId, transferTransactionId),
          eq(transactions.householdId, householdId),
          isNull(transactions.deletedAt),
          userId ? visibleTransactionPredicate({ householdId, userId, role: "member" }) : undefined,
        ),
      );
  }
}

// Export singleton instance
export const transactionTransferRepository = new TransactionTransferRepository();
