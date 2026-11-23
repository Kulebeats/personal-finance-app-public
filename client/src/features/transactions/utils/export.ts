/**
 * Transaction Utilities
 *
 * Utility functions for transaction operations including CSV export.
 *
 * @module features/transactions/utils/export
 */

import type { Transaction } from "@/lib/api";
import { format, parseISO } from "date-fns";

/**
 * Escape a string for CSV (handle quotes)
 */
function escapeCSV(value: string | undefined | null): string {
  const str = value ?? "";
  return `"${str.replaceAll('"', '""')}"`;
}

/**
 * Export transactions to CSV format
 */
export function exportTransactionsToCSV(transactions: Transaction[]): void {
  // CSV headers
  const headers = [
    "Date",
    "Name",
    "Amount",
    "Type",
    "Category",
    "Account",
    "Notes",
    "Reviewed",
  ];

  // Convert transactions to CSV rows
  const rows = transactions.map((tx) => [
    format(parseISO(tx.date), "yyyy-MM-dd"),
    escapeCSV(tx.name),
    typeof tx.amount === "object" ? tx.amount.amount : String(tx.amount),
    tx.type,
    escapeCSV(tx.categoryName),
    escapeCSV(tx.accountName),
    escapeCSV(tx.notes),
    tx.reviewedAt ? "Yes" : "No",
  ]);

  // Build CSV content
  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.join(",")),
  ].join("\n");

  // Create and download file
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute(
    "download",
    `transactions_${format(new Date(), "yyyy-MM-dd")}.csv`,
  );
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Duplicate a transaction (returns data for creating a new transaction)
 */
export function duplicateTransaction(
  transaction: Transaction,
): Partial<Transaction> {
  return {
    accountId: transaction.accountId,
    ownerUserId: transaction.ownerUserId,
    date: format(new Date(), "yyyy-MM-dd"), // Use today's date
    name: `${transaction.name || "Transaction"} (copy)`,
    amount: transaction.amount,
    type: transaction.type,
    categoryId: transaction.categoryId ?? undefined,
    merchantId: transaction.merchantId ?? undefined,
    isPending: false,
    isRecurring: false,
    isExcludedFromReports: transaction.isExcludedFromReports,
    isExcludedFromBudget: transaction.isExcludedFromBudget,
    isPrivate: transaction.isPrivate,
    notes: transaction.notes ?? undefined,
  };
}
