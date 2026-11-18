/**
 * Transaction Formatters
 *
 * Helper functions for formatting transaction data.
 */

import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns";

/**
 * Format transaction date for display
 */
export function formatTransactionDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;

  if (isToday(d)) {
    return `Today at ${format(d, "h:mm a")}`;
  }

  if (isYesterday(d)) {
    return `Yesterday at ${format(d, "h:mm a")}`;
  }

  return format(d, "MMM d, yyyy");
}

/**
 * Format relative date (e.g., "2 days ago")
 */
export function formatRelativeDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatDistanceToNow(d, { addSuffix: true });
}

/**
 * Format amount with sign
 */
export function formatAmount(
  amount: number,
  currency = "ZMW",
  showSign = true
): string {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(Math.abs(amount));

  if (!showSign) return formatted;
  return amount >= 0 ? `+${formatted}` : `-${formatted}`;
}

/**
 * Group transactions by date
 */
export function groupTransactionsByDate<T extends { date: string | Date }>(
  transactions: T[]
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const tx of transactions) {
    const dateKey = format(new Date(tx.date), "yyyy-MM-dd");
    const existing = groups.get(dateKey) || [];
    groups.set(dateKey, [...existing, tx]);
  }

  return groups;
}

/**
 * Get display name for date group header
 */
export function getDateGroupLabel(dateKey: string): string {
  const date = new Date(dateKey);

  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";

  return format(date, "EEEE, MMMM d, yyyy");
}
