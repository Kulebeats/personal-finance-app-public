import type { NetWorthData } from "@shared/weekly-recap";

/** Preserve the snapshot denomination; preferences never convert captured values. */
export function formatCapturedWorth(value: number | string, currency: string | null | undefined, fallback: (value: number) => string): string {
  // Numeric conversion is confined to the existing display formatter. Financial
  // arithmetic and the authoritative decimal-string DTO stay on the server.
  const displayValue = typeof value === "string" ? Number(value) : value;
  return currency
    ? new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "code" }).format(displayValue)
    : fallback(displayValue);
}

export function formatPreviousWorth(worth: NetWorthData, fallback: (value: number) => string): string | null {
  if (worth.previousMoney) return formatCapturedWorth(worth.previousMoney.amount, worth.previousMoney.currency, fallback);
  return worth.previous === null ? null : formatCapturedWorth(worth.previous, worth.currency, fallback);
}

/** Snapshot dates are calendar labels, independent of the browser's UTC offset. */
export function snapshotCalendarDate(date: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00` : date);
}
