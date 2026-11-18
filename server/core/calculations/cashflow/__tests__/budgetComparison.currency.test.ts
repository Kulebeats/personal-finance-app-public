/**
 * Budget comparison — currency correctness (CLAUDE.md Rule 1)
 *
 * Regression test for the hardcoded "ZMW" leak: `compareBudgetsToActuals` and
 * `normalizeBudgetToInterval` used to construct Money without a currency,
 * defaulting every actual/budget to ZMW. For a non-ZMW household this:
 *   1. logged "Money currency mismatch in add operation" when the summary
 *      aggregated ZMW items into a household-currency (e.g. USD) accumulator, and
 *   2. mislabeled the comparison output currency as ZMW.
 *
 * These tests assert the result to the cent in the household currency and that
 * NO currency-mismatch warning is emitted.
 *
 * @module core/calculations/cashflow/__tests__/budgetComparison.currency
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  compareBudgetsToActuals,
  type ActualSpendingInput,
  type BudgetInput,
} from "../budgetComparison";
import { logger } from "../../../../utils/logger";

describe("compareBudgetsToActuals — currency correctness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const actuals: ActualSpendingInput[] = [
    {
      categoryId: "cat-groceries",
      categoryName: "Groceries",
      amount: "400.00",
      currency: "USD",
      period: "2026-01-01/2026-01-31",
    },
  ];

  const budgets: BudgetInput[] = [
    {
      categoryId: "cat-groceries",
      categoryName: "Groceries",
      amount: "500.00",
      currency: "USD",
      periodType: "monthly",
    },
  ];

  it("keeps every Money in the household currency (no ZMW leak)", () => {
    const warnSpy = vi.spyOn(logger, "warn");

    const { items, summary } = compareBudgetsToActuals(
      actuals,
      budgets,
      "month",
      31,
      "USD",
    );

    // Output currencies are the household currency, NOT the ZMW default.
    expect(items).toHaveLength(1);
    expect(items[0].actual.currency).toBe("USD");
    expect(items[0].budgeted.currency).toBe("USD");
    expect(items[0].variance.currency).toBe("USD");
    expect(summary.totalActual.currency).toBe("USD");
    expect(summary.totalBudgeted.currency).toBe("USD");
    expect(summary.totalVariance.currency).toBe("USD");

    // No currency-mismatch warning was logged during aggregation.
    const mismatchWarnings = warnSpy.mock.calls.filter(([msg]) =>
      String(msg).includes("currency mismatch"),
    );
    expect(mismatchWarnings).toEqual([]);
  });

  it("computes the variance to the cent", () => {
    const { items, summary } = compareBudgetsToActuals(
      actuals,
      budgets,
      "month",
      31,
      "USD",
    );

    // monthly budget viewed monthly => as-is; 500 - 400 = 100 under budget
    // (20% under the 500 budget => "under", outside the +/-10% tolerance).
    expect(items[0].budgeted.toString()).toBe("500.00");
    expect(items[0].actual.toString()).toBe("400.00");
    expect(items[0].variance.toString()).toBe("100.00");
    expect(items[0].status).toBe("under");

    expect(summary.totalBudgeted.toString()).toBe("500.00");
    expect(summary.totalActual.toString()).toBe("400.00");
    expect(summary.totalVariance.toString()).toBe("100.00");
  });
});
