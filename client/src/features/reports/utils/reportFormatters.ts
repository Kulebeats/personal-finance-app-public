/**
 * Report Formatters
 *
 * Formatting utilities for Reports feature module
 */

import type { MoneyValue } from "@shared/money";
import { toMoneyNumber } from "@/lib/money";

/**
 * Format currency value
 */
export function formatCurrency(
  value: MoneyValue | number,
  currency = "USD",
): string {
  const numericValue = toMoneyNumber(value);
  const resolvedCurrency =
    typeof value === "object" && value !== null && "currency" in value
      ? value.currency
      : currency;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: resolvedCurrency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(numericValue);
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
