/**
 * FIN-18: report charts key each point by its ISO period value and format it
 * for display only. Runs in the America/New_York project (client/vitest.config.ts),
 * where parsing "YYYY-MM-DD" as UTC midnight shows the previous month.
 */
import { describe, expect, it } from "vitest";
import {
  shortMonthLabel,
  toCashflowBars,
  toNetWorthPoints,
  toSavingsRateBars,
} from "../chartSeries";

const money = (amount: string) => ({ amount, currency: "ZMW" });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const periodStarts = MONTHS.map((_, index) => `2026-${String(index + 1).padStart(2, "0")}-01`);

describe("report chart month labels (FIN-18)", () => {
  it("runs west of UTC, where a UTC parse would shift the month", () => {
    expect(new Date(2026, 9, 1).getTimezoneOffset()).toBeGreaterThan(0);
  });

  it("formats an ISO day as its own calendar month", () => {
    expect(shortMonthLabel("2026-10-01")).toBe("Oct");
    expect(shortMonthLabel("2026-01-01")).toBe("Jan");
    expect(shortMonthLabel("2026-12-31")).toBe("Dec");
  });

  it("never parses a formatted label and never renders Invalid Date", () => {
    expect(shortMonthLabel("Oct 2026")).toBe("");
    expect(shortMonthLabel("")).toBe("");
    expect(shortMonthLabel("2026-13-01")).toBe("");
  });

  it("gives twelve distinct savings-rate months from periodStart, ignoring the label", () => {
    const series = periodStarts.map((periodStart, index) => ({
      periodStart, periodEnd: periodStart, label: `${MONTHS[index]} 2026`, savingsRate: index,
      income: money("10.00"), expenses: money("5.00"), savings: money("5.00"),
    }));
    const bars = toSavingsRateBars(series);
    expect(bars.map((bar) => bar.month)).toEqual(MONTHS);
    expect(bars.map((bar) => bar.rate)).toEqual(MONTHS.map((_, index) => index));
  });

  it("keeps a savings-rate row without periodStart unlabelled rather than parsing its label", () => {
    const [bar] = toSavingsRateBars([{ periodStart: "", periodEnd: "", label: "Oct 2026", savingsRate: 3,
      income: money("1.00"), expenses: money("1.00"), savings: money("0.00") }]);
    expect(bar.month).toBe("");
  });

  it("labels the last six cash-flow months and net-worth points by their own month", () => {
    const series = periodStarts.map((periodStart) => ({
      periodStart, periodEnd: periodStart, label: "ignored", income: money("100.00"), expenses: money("40.00"),
      savings: money("60.00"), savingsRate: 60, debt: money("0.00"),
    }));
    expect(toCashflowBars(series).map((bar) => bar.month)).toEqual(MONTHS.slice(6));
    expect(toNetWorthPoints([{ x: "2026-10-01", y: money("41577.69") }])).toEqual([{ x: "Oct", y: 41577.69 }]);
  });
});
