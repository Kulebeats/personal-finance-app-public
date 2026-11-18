import { accountRepository } from "../repositories/AccountRepository";
import { transactionRepository } from "../repositories/TransactionRepository";
import { accounts, transactions, type Transaction } from "@shared/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "../utils/errorHandler";
import { logger } from "../utils/logger";
import { withTransaction } from "../utils/withTransaction";
import { goalAccountAssignmentService } from "./GoalAccountAssignmentService";
import { invalidateOnChange } from "./CacheInvalidation";
import { Money, roundMoney } from "../core/money";
import Decimal from "decimal.js";
import { calculateFxData, type FxData } from "./TransferFxService";

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
    options?: {
      date?: string;
      name?: string;
      notes?: string;
      idempotencyKey?: string;
      currency?: string;
      fxRate?: string | null;
      fxSource?: string;
    },
  ): Promise<{
    outflow: Transaction;
    inflow: Transaction;
    isDuplicate: boolean;
  }> {
    // SCP-320: idempotency is now resolved INSIDE the repository transaction,
    // under the account FOR UPDATE locks, so a concurrent retry can't race past a
    // read-then-write window. (Previously this check ran here, outside any txn.)

    // Validate accounts
    if (fromAccountId === toAccountId) {
      throw new ValidationError("Cannot transfer to the same account", [
        { field: "toAccountId", message: "Must be different from source account" },
      ]);
    }

    // Verify both accounts exist and are accessible
    const fromAccount = await accountRepository.findByIdWithVisibility(
      fromAccountId,
      householdId,
      userId,
    );
    const toAccount = await accountRepository.findByIdWithVisibility(
      toAccountId,
      householdId,
      userId,
    );

    if (!fromAccount) {
      throw new NotFoundError("Source account not found");
    }
    if (!toAccount) {
      throw new NotFoundError("Destination account not found");
    }

    // Validate amount
    const moneyAmount = new Money(amount);
    if (moneyAmount.isZero() || !moneyAmount.isPositive()) {
      throw new ValidationError("Amount must be positive", [
        { field: "amount", message: "Must be greater than 0" },
      ]);
    }

    // Cross-currency transfer validation and FX calculation
    const isCrossCurrency = fromAccount.currency !== toAccount.currency;
    let fxData: FxData | null = null;

    if (isCrossCurrency) {
      // Get household base currency for consistent reporting
      const { householdRepository } =
        await import("../repositories/HouseholdRepository");
      const household = await householdRepository.findById(householdId);
      const baseCurrency = household?.currency ?? "ZMW";

      // Delegate FX calculation to TransferFxService
      fxData = await calculateFxData({
        amount: moneyAmount,
        fromCurrency: fromAccount.currency,
        toCurrency: toAccount.currency,
        baseCurrency,
        householdId,
        fxRate: options?.fxRate,
        fxSource: options?.fxSource,
      });
    }

    // FIX DATA-TRANSFER-001: Pass converted amount for cross-currency destination balance
    // For cross-currency transfers, destination account should receive converted amount
    const destinationAmount = fxData
      ? roundMoney(new Decimal(moneyAmount.toString()).times(fxData.fxRate), 2)
      : moneyAmount.toString();

    // Create transfer - use toString() for DB storage (CLAUDE.md Money/Arithmetic Rule)
    const result = await transactionRepository.createTransfer(
      fromAccountId,
      toAccountId,
      moneyAmount.toString(),
      {
        householdId,
        ownerUserId: userId,
        date: options?.date || new Date().toISOString().split("T")[0],
        name: options?.name,
        notes: options?.notes,
        idempotencyKey: options?.idempotencyKey,
        currency: options?.currency || fromAccount.currency,
        destinationCurrency: toAccount.currency,
        destinationAmount,
        // FX data for cross-currency transfers
        ...(fxData && {
          fxRate: fxData.fxRate,
          fxBaseCurrency: fxData.fxBaseCurrency,
          fxQuoteCurrency: fxData.fxQuoteCurrency,
          fxTimestamp: fxData.fxTimestamp,
          fxSource: fxData.fxSource,
          convertedAmount: fxData.convertedAmount,
        }),
      },
    );

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
    data: {
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
  ): Promise<{ outflow: Transaction; inflow: Transaction }> {
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

    const pair = await transactionRepository.findTransferPair(
      existing.transferTransactionId,
      householdId,
    );
    const outflow = pair.find((txn) => !txn.isTransferIn);
    const inflow = pair.find((txn) => txn.isTransferIn);

    if (!outflow || !inflow) {
      throw new NotFoundError("Transfer pair not found");
    }

    // R-06: Block currency changes on transfer update (FX recalculation too complex)
    // Check if accounts are changing and if so, ensure currencies match
    const originalFromAccountId = outflow.accountId;
    const originalToAccountId = outflow.transferAccountId!;

    // If changing accounts, verify currencies match the original
    if (data.fromAccountId !== originalFromAccountId) {
      // Fetch original from account to compare currency
      const originalFromAccount =
        await accountRepository.findByIdWithVisibility(
          originalFromAccountId,
          householdId,
          userId,
        );
      if (
        originalFromAccount &&
        fromAccount.currency !== originalFromAccount.currency
      ) {
        throw new ValidationError(
          "Cannot change transfer to account with different currency. Delete and recreate the transfer.",
          [
            { field: "fromAccountId", message: `Currency mismatch: ${originalFromAccount.currency} → ${fromAccount.currency}` },
          ],
        );
      }
    }

    if (data.toAccountId !== originalToAccountId) {
      // Fetch original to account to compare currency
      const originalToAccount = await accountRepository.findByIdWithVisibility(
        originalToAccountId,
        householdId,
        userId,
      );
      if (
        originalToAccount &&
        toAccount.currency !== originalToAccount.currency
      ) {
        throw new ValidationError(
          "Cannot change transfer to account with different currency. Delete and recreate the transfer.",
          [
            { field: "toAccountId", message: `Currency mismatch: ${originalToAccount.currency} → ${toAccount.currency}` },
          ],
        );
      }
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

    const newName = data.name?.trim() || outflow.name;
    const newDate = data.date || outflow.date;
    const newNotes = data.notes !== undefined ? data.notes : outflow.notes;

    const result = await withTransaction(async (tx) => {
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
        .limit(2)
        .for("update");

      const lockedOutflow = lockedPair.find((txn) => !txn.isTransferIn);
      const lockedInflow = lockedPair.find((txn) => txn.isTransferIn);

      if (!lockedOutflow || !lockedInflow) {
        throw new NotFoundError("Transfer pair not found");
      }

      const affectedAccountIds = Array.from(
        new Set([
          lockedOutflow.accountId,
          lockedOutflow.transferAccountId!,
          data.fromAccountId,
          data.toAccountId,
        ]),
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

      const balanceDeltas = new Map<string, Money>();
      const addDelta = (accountId: string, delta: Money) => {
        const current = balanceDeltas.get(accountId) ?? Money.zero(delta.currency);
        balanceDeltas.set(accountId, current.add(delta));
      };

      const oldAmount = new Money(
        lockedOutflow.amount,
        lockedOutflow.currency ?? undefined,
      );
      const oldInflowAmount = new Money(
        lockedInflow.amount,
        lockedInflow.currency ?? undefined,
      );
      const newOutflowAmount = new Money(newAmount.toString(), fromAccount.currency);
      const newInflowAmount = new Money(destinationAmount, toAccount.currency);

      // Reverse old transfer effects, then apply the new transfer effects.
      addDelta(lockedOutflow.accountId, oldAmount);
      addDelta(lockedOutflow.transferAccountId!, oldInflowAmount.negated());
      addDelta(data.fromAccountId, newOutflowAmount.negated());
      addDelta(data.toAccountId, newInflowAmount);

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
          date: newDate,
          name: newName,
          notes: newNotes,
          currency: fromAccount.currency, // Use source account currency
          convertedAmount: isCrossCurrency ? destinationAmount : null, // Store destination amount
          fxRate: isCrossCurrency && data.fxRate ? data.fxRate.toString() : null,
          updatedAt: new Date(),
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
          date: newDate,
          name: newName,
          notes: newNotes,
          currency: toAccount.currency, // Use destination account currency
          convertedAmount: isCrossCurrency ? newAmount.toString() : null, // Store source amount
          fxRate: isCrossCurrency && data.fxRate ? data.fxRate.toString() : null,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, lockedInflow.id))
        .returning();

      return { outflow: updatedOutflow, inflow: updatedInflow };
    });

    logger.info("Transfer updated", { householdId });
    await invalidateOnChange("transaction", householdId);

    const accountsToSync = new Set<string>([
      outflow.accountId,
      outflow.transferAccountId!,
      data.fromAccountId,
      data.toAccountId,
    ]);

    for (const accountId of accountsToSync) {
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

    return result;
  }
}

export const transferService = new TransferService();
