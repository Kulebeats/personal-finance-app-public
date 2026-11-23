/**
 * Report Formatters
 *
 * Formatting utilities for Reports feature module
 */

import type { MoneyValue } from "@shared/money";
import { formatCurrency as formatMoney, toMoneyNumber } from "@/lib/money";

/**
 * Format a report amount as the rest of the app shows money: in its own
 * currency (a MoneyDto's, else `currency`), to that currency's minor units,
 * never rounded to whole units (42.50 is "K 42.50", not "ZMW 43"). With no
 * known currency (null) the bare number is shown, never a guessed symbol.
 */
export function formatCurrency(
  value: MoneyValue | number,
  currency: string | null,
): string {
  return formatMoney(value, currency ?? "");
}

/**
 * Format percentage
 */
export function formatPercentage(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format export date range for display
 */
export function formatExportRange(
  start?: string | null,
  end?: string | null
): string {
  if (start && end) return `${start} to ${end}`;
  if (start) return `From ${start}`;
  if (end) return `Through ${end}`;
  return "All time";
}

/**
 * Format large numbers for chart axes (e.g., 1000 -> "1k")
 */
export function formatAxisValue(value: MoneyValue | number): string {
  const numericValue = toMoneyNumber(value);
  if (Math.abs(numericValue) >= 1000) {
    return `${(numericValue / 1000).toFixed(0)}k`;
  }
  return String(numericValue);
}
