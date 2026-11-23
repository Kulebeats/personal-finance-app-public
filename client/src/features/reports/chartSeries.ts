/**
 * Report chart adapters (FIN-18, spec R12.3).
 *
 * Each point is keyed by its ISO period value and only formatted for display.
 */
import type {
  ReportsCashflowResponse,
  ReportsNetWorthResponse,
  ReportsSavingsRateResponse,
} from "@shared/reports";
import { toMoneyNumber } from "@/lib/money";

const CASHFLOW_BAR_MONTHS = 6;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISO_DAY = /^\d{4}-(\d{2})-\d{2}(?:$|T)/;

/**
 * Short English month name ("Oct") of an ISO date, read from its own digits.
 * `new Date("2026-10-01")` is UTC midnight, which is still September west of
 * UTC, so the value is never parsed into a Date. Anything that is not an ISO
 * date (such as a formatted "Oct 2026" label) yields "" rather than Invalid Date.
 */
export function shortMonthLabel(isoDate: string): string {
  const month = Number(ISO_DAY.exec(isoDate)?.[1] ?? 0);
  return MONTH_LABELS[month - 1] ?? "";
}

export function toCashflowBars(series: ReportsCashflowResponse["series"]) {
  return series.slice(-CASHFLOW_BAR_MONTHS).map((s) => ({
    month: shortMonthLabel(s.periodStart),
    income: toMoneyNumber(s.income),
    expenses: toMoneyNumber(s.expenses),
  }));
}

export function toNetWorthPoints(data: ReportsNetWorthResponse["series"][number]["data"]) {
  return data.map((d) => ({ x: shortMonthLabel(d.x), y: toMoneyNumber(d.y) }));
}

export function toSavingsRateBars(series: ReportsSavingsRateResponse["series"]) {
  return series.map((s) => ({
    month: shortMonthLabel(s.periodStart),
    rate: s.savingsRate,
  }));
}
