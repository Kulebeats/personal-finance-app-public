import { businessAuditService } from "./BusinessAuditService";
import { accountRepository } from "../repositories/AccountRepository";
import { transactionRepository } from "../repositories/TransactionRepository";
import { accounts, transactions, type Transaction } from "@shared/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../utils/errorHandler";
import { logger } from "../utils/logger";
import { EventTypes, outboxEventService } from "../core/events";
import { withTransaction } from "../utils/withTransaction";
import { goalAccountAssignmentService } from "./GoalAccountAssignmentService";
import { invalidateOnChangeAfterCommit } from "./CacheInvalidation";
import { Money, roundMoney } from "../core/money";
import Decimal from "decimal.js";
import { TransferCreateRequest, serviceTransferTerms, transferAmount, validateTransferRate, type TransferOptions } from "./TransferCreateRequest";
import { authorizedTransferReplay, transferQuoteAccounts } from "../repositories/TransferReplay";

import { lockTransactionCreateGrant } from "../repositories/TransactionCreateBoundary";
import { requireTransferPair, requireTransferVisibility } from "../repositories/TransactionTransferRepository";
import { nextTransactionVersion } from "../repositories/TransactionUpdateWriter";
import { buildPostingReceipt, readPostingEffect } from "../repositories/TransactionPostingEffect";

export class TransferService {
  /**
   * Create a transfer (two-row model)
   */
  async createTransfer(
    fromAccountId: string,
    toAccountId: string,
    amount: number | string,
    householdId: string,
    userId: string,
    input?: TransferOptions,
  ): Promise<{
    outflow: Transaction;
    inflow: Transaction;
    isDuplicate: boolean;
  }> {
    const options = structuredClone(input ?? {});
    fromAccountId = fromAccountId.toLowerCase();
    toAccountId = toAccountId.toLowerCase();
    householdId = householdId.toLowerCase();
    userId = userId.toLowerCase();
    const moneyAmount = transferAmount(amount);
    validateTransferRate(options.fxRate);
    if (options.idempotencyKey) {
      const replay = await authorizedTransferReplay(householdId, userId, options.idempotencyKey,
        serviceTransferTerms(fromAccountId, toAccountId, moneyAmount, options),
        { fromAccountId, toAccountId, amount, currency: options.currency });
      if (replay) return replay;
    }

    // Validate accounts
    if (fromAccountId === toAccountId) {
      throw new ValidationError("Cannot transfer to the same account", [
        { field: "toAccountId", message: "Must be different from source account" },
      ]);
    }

    const { from: fromAccount, to: toAccount } = await transferQuoteAccounts(householdId, userId, fromAccountId, toAccountId);

    if (!fromAccount) {
      throw new NotFoundError("Source account not found");
    }
    if (!toAccount) {
      throw new NotFoundError("Destination account not found");
    }

    const request = await TransferCreateRequest.prepare(fromAccountId, toAccountId, moneyAmount, householdId, userId,
      fromAccount.currency, toAccount.currency, options);
    const result = await transactionRepository.createTransfer(fromAccountId, toAccountId, moneyAmount.toString(), request);

    logger.info("Transfer created", {
      householdId,
      isDuplicate: result.isDuplicate,
    });

    return result;
  }

  /**
   * Update a transfer (both sides + account balances)
   */
  async updateTransfer(
    id: string,
    input: {
      expectedUpdatedAt?: string;
      fromAccountId: string;
      toAccountId: string;
      amount: number | string;
      date?: string;
      name?: string;
      notes?: string | null;
      currency?: string;
      fxRate?: number; // FIX DATA-TRANSFER-002: Accept FX rate for cross-currency updates
    },
    householdId: string,
    userId: string,
    audit?: { ipAddress?: string },
  ): Promise<{ outflow: Transaction; inflow: Transaction }> {
    const { expectedUpdatedAt, ...data } = input;
    const existing = await transactionRepository.findByIdWithVisibility(
      id,
      householdId,
      userId,
    );

    if (!existing) {
      throw new NotFoundError("Transfer not found");
    }

    if (existing.isPrivate && existing.ownerUserId !== userId) {
      throw new AuthorizationError(
        "Cannot modify private transfer owned by another user",
      );
    }

    if (existing.type !== "transfer" || !existing.transferTransactionId) {
      throw new ValidationError("Transaction is not a transfer", [
        { field: "type", message: "Transfer required" },
      ]);
    }
    const transferTransactionId = existing.transferTransactionId;

    if (data.fromAccountId === data.toAccountId) {
      throw new ValidationError("Cannot transfer to the same account", [
        { field: "toAccountId", message: "Must be different from source account" },
      ]);
    }

    const [fromAccount, toAccount] = await Promise.all([
      accountRepository.findByIdWithVisibility(
        data.fromAccountId,
        householdId,
        userId,
      ),
      accountRepository.findByIdWithVisibility(
        data.toAccountId,
        householdId,
        userId,
      ),
    ]);

    if (!fromAccount) {
      throw new NotFoundError("Source account not found");
    }
    if (!toAccount) {
      throw new NotFoundError("Destination account not found");
    }

    const newAmount = new Money(data.amount);

    // FIX DATA-TRANSFER-002: Validate FX rate for cross-currency transfers
    const isCrossCurrency = fromAccount.currency !== toAccount.currency;
    if (isCrossCurrency && !data.fxRate) {
      throw new ValidationError(
        "FX rate required for cross-currency transfer updates",
        [{ field: "fxRate", message: "FX rate is required when updating cross-currency transfers" }],
      );
    }

    // FIX DATA-TRANSFER-002: Calculate destination amount for cross-currency transfers
    const destinationAmount = isCrossCurrency && data.fxRate
      ? roundMoney(new Decimal(newAmount.toString()).times(data.fxRate), 2)
      : newAmount.toString();


    const { outflow, inflow, affectedAccountIds } = await withTransaction(async (tx) => {
      await lockTransactionCreateGrant(tx, householdId, { createActor: { householdId, userId } });
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

      if (lockedPair.length === 0) throw new NotFoundError("Transfer not found");
      const { outflow: lockedOutflow, inflow: lockedInflow } = requireTransferPair(lockedPair);

      // Drizzle skips undefined fields. Omitted metadata stays on its original leg.
      const metadata = { name: data.name?.trim() || undefined, date: data.date || undefined, notes: data.notes };
      const affectedAccountIds = Array.from(
        new Set([
          lockedOutflow.accountId,
          lockedInflow.accountId,
          data.fromAccountId,
          data.toAccountId,
        ]),
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

      requireTransferVisibility([...lockedPair, ...lockedAccounts], userId);
      const selected = lockedPair.find(leg => leg.id === existing.id);
      if (!selected) throw new NotFoundError("Transfer not found");
      if (expectedUpdatedAt !== undefined && selected.updatedAt.getTime() !== Date.parse(expectedUpdatedAt)) {
        throw new ConflictError("Transfer was modified. Refresh before saving your changes.");
      }
      const pairVersion = nextTransactionVersion(lockedOutflow.updatedAt > lockedInflow.updatedAt ? lockedOutflow.updatedAt : lockedInflow.updatedAt);
      const balanceDeltas = new Map<string, Money>();
      const addDelta = (accountId: string, delta: Money) => {
        const current = balanceDeltas.get(accountId) ?? Money.zero(delta.currency);
        balanceDeltas.set(accountId, current.add(delta));
      };

      const accountById = new Map(lockedAccounts.map(account => [account.id, account]));
      const lockedFrom = accountById.get(data.fromAccountId)!;
      const lockedTo = accountById.get(data.toAccountId)!;
      if (lockedFrom.currency !== fromAccount.currency || lockedTo.currency !== toAccount.currency ||
          lockedFrom.currency !== lockedOutflow.currency || lockedTo.currency !== lockedInflow.currency ||
          (data.currency && data.currency !== lockedFrom.currency)) {
        throw new ValidationError("Transfer denominations changed", [{ field: "currency", message: "Refresh the account and transfer quote" }]);
      }
      const outgoing = buildPostingReceipt(lockedFrom, { type: "transfer", amount: newAmount.toString(), currency: lockedFrom.currency, isTransferIn: false });
      const incoming = buildPostingReceipt(lockedTo, { type: "transfer", amount: destinationAmount, currency: lockedTo.currency, isTransferIn: true });
      addDelta(lockedOutflow.accountId, readPostingEffect(accountById.get(lockedOutflow.accountId)!, lockedOutflow).delta.negated());
      addDelta(lockedInflow.accountId, readPostingEffect(accountById.get(lockedInflow.accountId)!, lockedInflow).delta.negated());
      addDelta(data.fromAccountId, new Money(outgoing.postedBalanceDelta, outgoing.currency));
      addDelta(data.toAccountId, new Money(incoming.postedBalanceDelta, incoming.currency));

      for (const lockedAccount of lockedAccounts) {
        const delta = balanceDeltas.get(lockedAccount.id);
        // Guard only balance-reducing deltas: a positive delta must never be
        // blocked, even when the stored balance is already negative.
        if (!delta || !delta.isNegative()) {
          continue;
        }

        const finalBalance = new Money(
          lockedAccount.balance,
          lockedAccount.currency,
        ).add(delta);

        if (lockedAccount.isAsset && delta.lt(0) && finalBalance.lt(0)) {
          throw new ValidationError("Insufficient funds for transfer", [
            {
              field: "amount",
              message: "Source account balance is insufficient for this transfer",
            },
          ]);
        }
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
      }

      // FIX DATA-TRANSFER-002: Update outflow with FX metadata
      const [updatedOutflow] = await tx
        .update(transactions)
        .set({
          accountId: data.fromAccountId,
          transferAccountId: data.toAccountId,
          amount: newAmount.toString(),
          ...metadata,
          ...outgoing,
          convertedAmount: isCrossCurrency ? destinationAmount : null, // Store destination amount
          fxRate: isCrossCurrency && data.fxRate ? data.fxRate.toString() : null,
          updatedAt: pairVersion,
        })
        .where(eq(transactions.id, lockedOutflow.id))
        .returning();

      // FIX DATA-TRANSFER-002: Update inflow with FX-converted amount and destination currency
      const [updatedInflow] = await tx
        .update(transactions)
        .set({
          accountId: data.toAccountId,
          transferAccountId: data.fromAccountId,
          amount: destinationAmount, // Use converted amount for cross-currency
          ...metadata,
          ...incoming,
          convertedAmount: isCrossCurrency ? newAmount.toString() : null, // Store source amount
          fxRate: isCrossCurrency && data.fxRate ? data.fxRate.toString() : null,
          updatedAt: pairVersion,
        })
        .where(eq(transactions.id, lockedInflow.id))
        .returning();

      if (audit) {
        await businessAuditService.logUpdate({ tx, userId, householdId, entityId: id, entityType: "transaction",
          oldValue: { fromAccountId: lockedOutflow.accountId, toAccountId: lockedInflow.accountId, amount: lockedOutflow.amount,
            currency: lockedOutflow.currency, date: lockedOutflow.date, name: lockedOutflow.name, notes: lockedOutflow.notes },
          newValue: data, ipAddress: audit.ipAddress, metadata: { transfer: true } });
      }
      const fields = ["accountId", "transferAccountId", "amount", "date", "name", "notes", "fxRate", "convertedAmount"] as const;
      for (const [before, after] of [[lockedOutflow, updatedOutflow], [lockedInflow, updatedInflow]]) {
        const changes = fields.filter(field => before[field] !== after[field]);
        await outboxEventService.publish({
          eventType: EventTypes.TRANSACTION_UPDATED, aggregateType: "transaction",
          aggregateId: after.id, householdId, payload: { id: after.id, changes },
        }, tx);
      }
      return { outflow: updatedOutflow, inflow: updatedInflow, affectedAccountIds };
    });

    logger.info("Transfer updated", { householdId });
    await invalidateOnChangeAfterCommit("transaction", householdId);

    for (const accountId of affectedAccountIds) {
      try {
        await goalAccountAssignmentService.syncGoalsForAccount(
          accountId,
          "transfer_updated",
        );
      } catch (error) {
        logger.error("Goal auto-sync failed after transfer update", {
          accountId,
          error,
        });
      }
    }

    return { outflow, inflow };
  }
}

export const transferService = new TransferService();
