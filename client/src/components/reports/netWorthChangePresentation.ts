import { isCurrencyCode } from "@shared/denomination";
import type { ReportsNetWorthChangesResponse } from "@shared/reports";

function monthLabel(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short" });
}

export function netWorthChangeLabel({ period, startPeriod, spansGap }: ReportsNetWorthChangesResponse["periods"][number]) {
  return spansGap && startPeriod ? `${monthLabel(startPeriod)}–${monthLabel(period)}` : monthLabel(period);
}

/** Financial reports carry their own unit, which can differ from the viewer's preference. */
export function formatNetWorthChange(amount: number, currency: unknown) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
    ...(isCurrencyCode(currency) ? { style: "currency", currency } : {}),
  }).format(amount);
}
