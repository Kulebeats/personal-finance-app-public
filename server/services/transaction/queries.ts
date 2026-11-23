/**
 * Transaction Queries
 *
 * Read-only transaction queries and summaries.
 *
 * @module services/transaction/queries
 */

import { transactionRepository, type TransactionWithNames } from "../../repositories/TransactionRepository";
import { requireTransferPair } from "../../repositories/TransactionTransferRepository";
import { type Transaction } from "@shared/schema";
import { NotFoundError, ValidationError } from "../../utils/errorHandler";
import Decimal from "decimal.js";
import { readTransactionSummaryInputs, SummaryDataUnavailable, type TransactionSummaryOptions } from "../../repositories/TransactionSummaryInputs";
export type { TransactionSummaryOptions } from "../../repositories/TransactionSummaryInputs";
import { isCurrencyCode } from "@shared/denomination";



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
): Promise<TransactionWithNames[]> {
  return await transactionRepository.findByHouseholdWithVisibility(
    householdId,
    userId,
    { ...toRepositoryOptions(options), includeSplits: true },
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
    true,
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
    userId,
  );
  if (pair.length !== 2) throw new NotFoundError("Transfer pair not found");
  return requireTransferPair(pair);
}

/**
 * Get transaction summary for a period
 * Uses household base currency for aggregation with FX conversion (CLAUDE.md Money/Arithmetic Rule)
 * Date range capping bounds the aggregation work.
 */
export async function getTransactionSummary(
  householdId: string,
  userId: string,
  startDate: string,
  endDate: string,
  options?: TransactionSummaryOptions,
) {
  // FIX PERF-TRANSACTIONS-002: Cap date range to prevent unbounded memory usage
  const start = new Date(startDate);
  const end = new Date(endDate);
  const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  if (daysDiff < 0) {
    throw new ValidationError("Start date must be on or before the end date.",
      [{ field: "dateRange", message: "Date range is reversed" }]);
  }
  if (daysDiff > 730) { // Cap at 2 years
    throw new ValidationError(
      "Date range too large. Maximum allowed is 2 years (730 days).",
      [{ field: "dateRange", message: "Date range exceeds maximum of 2 years" }]
    );
  }

  // Re-read visibility and amounts on each request. The old TTL cache had no
  // complete invalidation path across financial and privacy writers.
  const { rows: txns, currency: baseCurrency } = await readTransactionSummaryInputs(householdId, userId, startDate, endDate, options);
  let income = new FlowDecimal(0), expenses = new FlowDecimal(0);
  let largestIncome = new FlowDecimal(0), largestExpense = new FlowDecimal(0);
  let firstTransactionDate: string | null = null, lastTransactionDate: string | null = null;
  for (const row of txns) {
    if (!firstTransactionDate || row.date < firstTransactionDate) firstTransactionDate = row.date;
    if (!lastTransactionDate || row.date > lastTransactionDate) lastTransactionDate = row.date;
    if (row.isExcludedFromReports || (row.type !== "income" && row.type !== "expense")) continue;
    const native = new FlowDecimal(row.amount);
    if (!native.isFinite() || native.lt(0)) throw new SummaryDataUnavailable(`Invalid amount on ${row.date}.`);
    if (native.isZero()) continue;
    if (!isCurrencyCode(row.currency)) throw new SummaryDataUnavailable(`Unknown transaction currency for conversion to ${baseCurrency} on ${row.date}.`);
    const rate = row.currency === baseCurrency ? "1" : row.summaryRate;
    if (!rate) throw new SummaryDataUnavailable(`No trusted ${row.currency} to ${baseCurrency} exchange rate is available for ${row.date}.`);
    const converted = native.times(rate);
    if (row.type === "income") {
      income = income.plus(converted);
      largestIncome = FlowDecimal.max(largestIncome, converted);
    } else {
      expenses = expenses.plus(converted);
      largestExpense = FlowDecimal.max(largestExpense, converted);
    }
  }

  const displayedIncome = income.toDecimalPlaces(2), displayedExpenses = expenses.toDecimalPlaces(2);
  return {
    totalIncome: displayedIncome.toFixed(2), totalExpenses: displayedExpenses.toFixed(2), netFlow: displayedIncome.minus(displayedExpenses).toFixed(2),
    largestIncome: largestIncome.toFixed(2), largestExpense: largestExpense.toFixed(2),
    firstTransactionDate, lastTransactionDate, transactionCount: txns.length, currency: baseCurrency,
  };
}

// Rates have up to 30 digits. Preserve their full product with ledger amounts
// until rounding the period totals to cents.
const FlowDecimal = Decimal.clone({ precision: 64, rounding: Decimal.ROUND_HALF_UP });
