import { describe, expect, it, vi } from "vitest";
import type { ReportsCashflowResponse } from "@shared/reports";
import { executeCustomChart } from "../AnalyticsForecastRepository";

const range = { from: "2025-12-15", to: "2026-07-18", interval: "month", baseCurrency: "ZMW" } as const;
const money = (amount: string) => ({ amount, currency: "ZMW" });
const monthly = (periodStart: string, label: string, income: string, expenses: string, savings: string, savingsRate: number) => ({
  periodStart, periodEnd: periodStart, label,
  income: money(income), expenses: money(expenses), savings: money(savings), savingsRate, debt: money("0.00"),
});
const cashflow: ReportsCashflowResponse = {
  range,
  series: [
    monthly("2025-12-01", "Dec 2025", "2.00", "0.10", "1.90", 95),
    monthly("2026-01-01", "Jan 2026", "1.00", "0.10", "0.90", 90),
    monthly("2026-02-01", "Feb 2026", "9.00", "7.20", "1.80", 20),
    monthly("2026-04-01", "Apr 2026", "1.00", "0.30", "0.70", 70),
    monthly("2026-07-01", "Jul 2026", "1.00", "0.40", "0.60", 60),
  ],
  totals: { income: money("14.00"), expenses: money("8.10"), savings: money("5.90"), savingsRate: 42.14, debt: money("0.00") },
};

const context = {
  getHouseholdCurrency: async () => "ZMW",
  spending: { getSpendingBreakdown: vi.fn() },
  cashflow: { getCashflow: vi.fn().mockResolvedValue(cashflow) },
  netWorth: {
    getNetWorth: vi.fn().mockResolvedValue({
      series: [{ data: [
        { x: "2026-01-22", y: money("3.00") },
        { x: "2026-02-26", y: money("2.00") },
        { x: "2026-07-01", y: money("4.00") },
      ] }],
    }),
  },
};

describe("custom chart calendar buckets", () => {
  it.each([
    ["monthly", ["Dec 2025", "Jan 2026", "Feb 2026", "Apr 2026", "Jul 2026"], [0.1, 0.1, 7.2, 0.3, 0.4], [2, 1, 9, 1, 1]],
    ["quarterly", ["Q4 2025", "Q1 2026", "Q2 2026", "Q3 2026"], [0.1, 7.3, 0.3, 0.4], [2, 10, 1, 1]],
    ["biannual", ["H2 2025", "H1 2026", "H2 2026"], [0.1, 7.6, 0.4], [2, 11, 1]],
    ["annual", ["2025", "2026"], [0.1, 8], [2, 12]],
  ] as const)("uses %s calendar periods while retaining totals and precision", async (period, labels, primary, secondary) => {
    const config = { name: "Trends", chartType: "line", primaryMetric: "expenses", secondaryMetric: "income", period };
    const result = await executeCustomChart(context, "house-123",
      { config, from: range.from, to: range.to });

    expect(result.data.map(point => point.label)).toEqual(labels);
    expect(result.data.map(point => point.primary)).toEqual(primary);
    expect(result.data.map(point => point.secondary)).toEqual(secondary);
    expect(result.totals).toMatchObject({ primary: 8.1, secondary: 14 });
  });

  it("calculates a quarterly savings rate from the quarter's income and savings", async () => {
    const config = { name: "Savings rate", chartType: "line", primaryMetric: "savingsRate", period: "quarterly" as const };
    const result = await executeCustomChart(context, "house-123",
      { config, from: range.from, to: range.to });

    expect(result.data.find(point => point.label === "Q1 2026")).toEqual({ label: "Q1 2026", primary: 27 });
    expect(result.totals).toEqual({ primary: 42.14 });
  });

  it("takes the last available net worth observation in each quarter", async () => {
    const config = { name: "Net worth", chartType: "line", primaryMetric: "netWorth", period: "quarterly" as const };
    const result = await executeCustomChart(context, "house-123",
      { config, from: range.from, to: range.to });

    expect(result.data).toEqual([{ label: "Q1 2026", primary: 2 }, { label: "Q3 2026", primary: 4 }]);
  });

  it("returns only the named metric for a grouped breakdown", async () => {
    context.spending.getSpendingBreakdown.mockResolvedValue({
      total: money("3.00"),
      items: [{ label: "Food", entityId: "food", value: money("3.00") }],
    });
    const config = { name: "Spending", chartType: "bar", primaryMetric: "expenses", secondaryMetric: "income", groupBy: "category" };
    const result = await executeCustomChart(context, "house-123", { config, from: range.from, to: range.to });

    expect(result.data).toEqual([{ label: "Food", primary: 3, groupKey: "food" }]);
    expect(result.config.secondaryMetric).toBeUndefined();
    expect(result.totals.secondary).toBeUndefined();
  });
});
