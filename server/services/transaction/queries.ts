/**
 * Transaction Queries
 *
 * Read-only transaction queries and summaries.
 *
 * @module services/transaction/queries
 */

import { transactionRepository } from "../../repositories/TransactionRepository";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { type Transaction } from "@shared/schema";
import { NotFoundError, ValidationError } from "../../utils/errorHandler";
import { Money } from "../../core/money";
import { logger } from "../../utils/logger";
// FIX PERF-TRANSACTIONS-002: Add caching for expensive summary aggregations
import { withCache, TTL } from "../../core/cache";

/**
 * Query options for listing transactions
 * Note: amountMin/amountMax accept numbers from validation and are converted to strings for repository
 * Note: tagIds are validated at the controller/validation layer to ensure they belong to the household
 */
export interface TransactionQueryOptions {
  limit?: number;
  offset?: number;
  accountId?: string;
  categoryId?: string;
  merchantId?: string;
  type?: string;
  startDate?: string;
  endDate?: string;
  ownerUserId?: string | null;
  sortBy?: "date" | "amount" | "description";
  sortOrder?: "asc" | "desc";
  search?: string;
  amountMin?: number;
  amountMax?: number;
  reviewed?: "reviewed" | "unreviewed";
  tagIds?: string[];
  // R-07: Allow pending preference to be passed through
  includePending?: boolean;
}

export interface TransactionSummaryOptions {
  ownerUserId?: string | null;
  accountId?: string;
  tagIds?: string[];
  includePending?: boolean;
}

/**
 * Convert query options to repository format (convert numbers to strings for amounts)
 */
function toRepositoryOptions(options?: TransactionQueryOptions) {
  if (!options) return undefined;
  return {
    ...options,
    amountMin: options.amountMin?.toString(),
    amountMax: options.amountMax?.toString(),
  };
}

/**
 * Get all transactions visible to the user
 */
export async function getTransactions(
  householdId: string,
  userId: string,
  options?: TransactionQueryOptions,
): Promise<Transaction[]> {
  return await transactionRepository.findByHouseholdWithVisibility(
    householdId,
    userId,
    toRepositoryOptions(options),
  );
}

/**
 * Get total count of transactions with visibility filtering
 * Mirrors the same filters as getTransactions for accurate pagination
 */
export async function getTransactionsCount(
  householdId: string,
  userId: string,
  options?: Omit<
    TransactionQueryOptions,
    "limit" | "offset" | "sortBy" | "sortOrder"
  >,
): Promise<number> {
  return await transactionRepository.countByHouseholdWithVisibility(
    householdId,
    userId,
    toRepositoryOptions(options),
  );
}

/**
 * Get a single transaction with visibility check
 */
export async function getTransactionById(
  id: string,
  householdId: string,
  userId: string,
): Promise<Transaction> {
  const txn = await transactionRepository.findByIdWithVisibility(
    id,
    householdId,
    userId,
  );

  if (!txn) {
    throw new NotFoundError("Transaction not found");
  }

  return txn;
}

/**
 * Get both sides of a transfer with visibility checks
 */
export async function getTransferPair(
  id: string,
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

  if (existing.type !== "transfer" || !existing.transferTransactionId) {
    throw new ValidationError("Transaction is not a transfer", [
      { field: "type", message: "Transfer required" },
    ]);
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

  return { outflow, inflow };
}

/**
 * Get transaction summary for a period
 * Uses household base currency for aggregation with FX conversion (CLAUDE.md Money/Arithmetic Rule)
 * FIX PERF-TRANSACTIONS-002: Added date range capping and caching for performance
 */
export async function getTransactionSummary(
  householdId: string,
  userId: string,
  startDate: string,
  endDate: string,
  options?: TransactionSummaryOptions,
): Promise<{
  totalIncome: number;
  totalExpenses: number;
  netFlow: number;
  transactionCount: number;
  currency: string;
}> {
  // FIX PERF-TRANSACTIONS-002: Cap date range to prevent unbounded memory usage
  const start = new Date(startDate);
  const end = new Date(endDate);
  const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  if (daysDiff > 730) { // Cap at 2 years
    throw new ValidationError(
      "Date range too large. Maximum allowed is 2 years (730 days).",
      [{ field: "dateRange", message: "Date range exceeds maximum of 2 years" }]
    );
  }

  // FIX PERF-TRANSACTIONS-002: Cache expensive summary aggregations
  // Use withCache wrapper to cache results for 5 minutes
  const cachedSummary = withCache(
    async (
      hid: string,
      uid: string,
      start: string,
      end: string,
      opts?: TransactionSummaryOptions,
    ) => {
      // Get household base currency for consistent aggregation
      const household = await householdRepository.findById(hid);
      const baseCurrency = household?.currency ?? "ZMW";

      const txns = await transactionRepository.findByHouseholdWithVisibility(
        hid,
        uid,
        {
          startDate: start,
          endDate: end,
          ownerUserId: opts?.ownerUserId,
          accountId: opts?.accountId,
          tagIds: opts?.tagIds,
          includePending: opts?.includePending ?? true,
        },
      );

  // Collect unique currencies for FX lookup
  const currencies = new Set<string>();
  for (const txn of txns) {
    if (txn.isExcludedFromReports || txn.type === "transfer") continue;
    const txnCurrency = txn.currency ?? baseCurrency;
    if (txnCurrency !== baseCurrency) {
      currencies.add(txnCurrency);
    }
  }

  // Get FX rates for non-base currencies
  let fxRates = new Map<string, number>();
  if (currencies.size > 0) {
    const { getLatestFxRates } = await import("../../core/calculations");
    fxRates = await getLatestFxRates([...currencies], baseCurrency);
  }

  // Use explicit currency for Money operations (CLAUDE.md Money/Arithmetic Rule)
  let totalIncome = Money.zero(baseCurrency);
  let totalExpenses = Money.zero(baseCurrency);

  for (const txn of txns) {
    if (txn.isExcludedFromReports) continue;
    if (txn.type === "transfer") continue;

    const txnCurrency = txn.currency ?? baseCurrency;
    let amount = new Money(txn.amount, txnCurrency);

    // Convert to base currency if needed
    if (txnCurrency !== baseCurrency) {
      // SCP-321: fail closed on a missing rate — never silently use 1.
      const rate = fxRates.get(txnCurrency);
      if (rate === undefined) {
        logger.error("Missing FX rate in transaction summary", {
          fromCurrency: txnCurrency,
          toCurrency: baseCurrency,
        });
        throw new ValidationError(
          `Exchange rate unavailable for ${txnCurrency} -> ${baseCurrency}`,
        );
      }
      // Keep as string to avoid intermediate number conversion (CLAUDE.md Money/Arithmetic Rule)
      const convertedAmount = amount.multiply(rate);
      amount = new Money(convertedAmount.toString(), baseCurrency);
    }

    if (txn.type === "income") {
      totalIncome = totalIncome.add(amount);
    } else if (txn.type === "expense") {
      totalExpenses = totalExpenses.add(amount);
    }
  }

      return {
        totalIncome: totalIncome.toNumber(),
        totalExpenses: totalExpenses.toNumber(),
        netFlow: totalIncome.subtract(totalExpenses).toNumber(),
        transactionCount: txns.length,
        currency: baseCurrency,
      };
    },
    "transaction-summary",
    {
      ttlMs: TTL.MEDIUM, // 5 minutes
      keyGenerator: (...args) => {
        const [hid, uid, start, end, opts] = args as [string, string, string, string, TransactionSummaryOptions | undefined];
        return `txn-summary:${hid}:${uid}:${start}:${end}:${opts?.ownerUserId || 'all'}:${opts?.accountId || 'all'}:${opts?.tagIds?.join(',') || 'all'}:${opts?.includePending ?? true}`;
      },
      tags: [`household:${householdId}`, 'transactions'],
    },
  );

  return await cachedSummary(householdId, userId, startDate, endDate, options);
}
