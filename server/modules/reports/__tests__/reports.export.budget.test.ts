import { describe, it, expect, vi, beforeEach } from "vitest";
import { reportsExportService } from "../reports.export.service";
import { cashflowBudgetComparisonRepository } from "../../../repositories/reports";
import type { ExportReportInput } from "../reports.validation";

/**
 * Unit test for the "budget" CSV export type.
 *
 * Verifies that exporting from the CashFlow Budget view produces a
 * budget-vs-actual comparison CSV (not a cashflow export). The budget
 * comparison repository is stubbed so this runs without a database.
 */
describe("ReportsExportService - budget export", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("builds a budget-comparison CSV from getBudgetComparison", async () => {
    const spy = vi
      .spyOn(cashflowBudgetComparisonRepository, "getBudgetComparison")
      .mockResolvedValue({
        comparison: [
          {
            period: "2026-01",
            categoryId: "cat1",
            categoryName: "Groceries",
            actual: { amount: "450", currency: "USD" },
            budgeted: { amount: "500", currency: "USD" },
            variance: { amount: "50", currency: "USD" },
            variancePercent: 10,
            status: "under",
          },
        ],
        summary: {
          totalActual: { amount: "450", currency: "USD" },
          totalBudgeted: { amount: "500", currency: "USD" },
          totalVariance: { amount: "50", currency: "USD" },
          categoriesOverBudget: 0,
          categoriesUnderBudget: 1,
        },
        metadata: {
          budgetsCovered: 1,
          categoriesWithoutBudget: [],
          periodNormalization: "full",
        },
      });

    const input: ExportReportInput = {
      reportType: "budget",
      format: "csv",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      includeCharts: false,
      includeForecast: false,
      forecastMonths: 3,
      interval: "month",
    };

    const { content, fileName } = await reportsExportService.generateExportFile(
      "hh1",
      "user1",
      "household",
      input,
    );

    // Correct file name and budget-comparison columns/rows
    expect(fileName).toBe("budget_comparison_2026-01-01_2026-01-31.csv");
    for (const col of [
      "period",
      "category",
      "budgeted",
      "actual",
      "variance",
      "variancePercent",
      "status",
      "currency",
    ]) {
      expect(content).toContain(col);
    }
    expect(content).toContain("Groceries");
    expect(content).toContain("500");
    expect(content).toContain("450");
    expect(content).toContain("under");

    // Repository was queried with the export's date range / scope / user
    expect(spy).toHaveBeenCalledWith(
      "hh1",
      expect.objectContaining({
        from: "2026-01-01",
        to: "2026-01-31",
        interval: "month",
        scope: "household",
        userId: "user1",
      }),
    );
  });
});
