/**
 * Transaction Filters Utils
 *
 * Helper functions for filtering transactions.
 */

import { parseISO } from "date-fns";
import { toMoneyNumber } from "@/lib/money";
import type { TransactionWithDetails, TransactionFilters } from "../types";

/**
 * Check if a transaction matches the given filters
 */
export function matchesFilters(
  transaction: TransactionWithDetails,
  filters: TransactionFilters
): boolean {
  // Search filter (matches name, merchant, notes)
  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    const matchesSearch =
      transaction.name?.toLowerCase().includes(searchLower) ||
      transaction.merchantName?.toLowerCase().includes(searchLower) ||
      transaction.notes?.toLowerCase().includes(searchLower) ||
      transaction.categoryName?.toLowerCase().includes(searchLower);

    if (!matchesSearch) return false;
  }

  // Account filter
  if (filters.accountId && transaction.accountId !== filters.accountId) {
    return false;
  }

  // Category filter
  if (filters.categoryId && transaction.categoryId !== filters.categoryId) {
    return false;
  }

  // Date range filter - use parseISO to avoid timezone off-by-one bugs
  if (filters.startDate) {
    const txDate = parseISO(transaction.date);
    if (txDate < filters.startDate) return false;
  }

  if (filters.endDate) {
    const txDate = parseISO(transaction.date);
    if (txDate > filters.endDate) return false;
  }

  // Amount range filter - use Money class helpers (T-01 fix)
  const amount = toMoneyNumber(transaction.amount);
  const absAmount = Math.abs(amount);

  if (filters.amountMin !== null && absAmount < filters.amountMin) {
    return false;
  }
  if (filters.amountMax !== null && absAmount > filters.amountMax) {
    return false;
  }

  // Type filter - use type field, not sign inference (T-02 fix)
  if (filters.type !== "all") {
    if (filters.type === "income" && transaction.type !== "income") return false;
    if (filters.type === "expense" && transaction.type !== "expense") return false;
    if (filters.type === "transfer" && transaction.type !== "transfer") return false;
  }

  // Reviewed filter (check reviewedAt timestamp exists)
  if (filters.reviewed !== "all") {
    const isReviewed = !!transaction.reviewedAt;
    if (filters.reviewed === "reviewed" && !isReviewed) return false;
    if (filters.reviewed === "unreviewed" && isReviewed) return false;
  }

  return true;
}

/**
 * Filter an array of transactions
 */
export function filterTransactions(
  transactions: TransactionWithDetails[],
  filters: TransactionFilters
): TransactionWithDetails[] {
  return transactions.filter((tx) => matchesFilters(tx, filters));
}

/**
 * Calculate filter summary text
 */
export function getFilterSummary(filters: TransactionFilters): string {
  const parts: string[] = [];

  if (filters.accountId) parts.push("Account");
  if (filters.categoryId) parts.push("Category");
  if (filters.startDate || filters.endDate) parts.push("Date range");
  if (filters.amountMin !== null || filters.amountMax !== null)
    parts.push("Amount");
  if (filters.type !== "all") parts.push(filters.type);
  if (filters.reviewed !== "all") parts.push(filters.reviewed);

  if (parts.length === 0) return "All transactions";
  return `Filtered by: ${parts.join(", ")}`;
}
