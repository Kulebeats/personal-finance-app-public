import { describe, expect, it } from "vitest";
import { generateForecast, type BudgetInput } from "../forecast";
import { compareBudgetsToActuals } from "../budgetComparison";

const budget = (amount: string, targetPeriod?: string): BudgetInput => ({
  categoryId: "transport", categoryName: "Transport", amount, currency: "ZMW", periodType: "monthly", ...(targetPeriod ? { targetPeriod } : {}),
});
const forecast = (budgets: BudgetInput[]) => generateForecast({ startDate: "2026-10-01", horizonMonths: 3, baseCurrency: "ZMW" }, [], budgets, []).points;

describe("confirmed month limits preserve unbudgeted forecast months", () => {
  it("does not repeat a one-month limit in past or future forecast points", () => {
    expect(forecast([budget("40.00", "2026-11")]).map(row => row.sources.budgetedExpenses.toString()))
      .toEqual(["0.00", "40.00", "0.00"]);
  });
  it("replaces a recurring default only for the override month", () => {
    expect(forecast([budget("500.00"), budget("40.00", "2026-11")]).map(row => row.expenses.toString()))
      .toEqual(["500.00", "40.00", "500.00"]);
  });
  it("keeps an explicit zero distinct from absent limits and historical-average fallback", () => {
    const points = generateForecast({ startDate: "2026-10-01", horizonMonths: 3, baseCurrency: "ZMW" }, [], [budget("0.00", "2026-11")],
      [{ categoryId: "transport", categoryName: "Transport", type: "expense", monthlyAverage: "90.00", currency: "ZMW" }]).points;
    expect(points.map(row => row.expenses.toString())).toEqual(["90.00", "0.00", "90.00"]);
  });
  it("uses the resolved report-window amount without applying monthly normalization again", () => {
    const result = compareBudgetsToActuals([{ categoryId: "transport", categoryName: "Transport", amount: "15", currency: "ZMW", period: "2026-11" }],
      [{ ...budget("500"), periodAmount: "40.00" }], "week", 7, "ZMW");
    expect(result.items[0].budgeted.toString()).toBe("40.00");
  });
});
