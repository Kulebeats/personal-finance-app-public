/**
 * Budget rollover - currency correctness (CLAUDE.md Rule 1)
 *
 * Regression test mirroring budgetComparison.currency.test.ts. `calculateAccumulatedRollover`
 * used to construct Money without a currency, defaulting `originalBudget`, each period's
 * `budgeted`/`actual`, and therefore the derived `effectiveBudget`/`rolloverHistory` to ZMW.
 * For a non-ZMW household this:
 *   1. logged "Money currency mismatch" warnings when the ZMW per-period rollover was
 *      aggregated into the household-currency (e.g. USD) accumulator, and
 *   2. mislabeled the rollover output currency as ZMW.
 *
 * These tests assert the result to the cent in the household currency and that NO
 * currency-mismatch warning is emitted.
 *
 * NOTE: `compareBudgetsWithRollover` / `calculateAccumulatedRollover` are exported from the
 * cashflow barrel but not yet wired into any route/service - this guards a latent bug.
 *
 * @module core/calculations/cashflow/__tests__/budgetRollover.currency
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  calculateAccumulatedRollover,
  type HistoricalBudgetUsage,
  type RolloverConfig,
} from "../budgetRollover";
import { type BudgetInput } from "../budgetComparison";
import { logger } from "../../../../utils/logger";

describe("calculateAccumulatedRollover - currency correctness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const budget: BudgetInput = {
    categoryId: "cat-groceries",
    categoryName: "Groceries",
    amount: "500.00",
    currency: "USD",
    periodType: "monthly",
  };

  // Two prior months, each under budget, so a "full" policy produces a real rollover
  // that gets aggregated into the (USD) accumulator - the path that warned on ZMW leak.
  const history: HistoricalBudgetUsage[] = [
    {
      period: "2026-01",
      categoryId: "cat-groceries",
      budgeted: "500.00",
      actual: "400.00",
      currency: "USD",
    },
    {
      period: "2026-02",
      categoryId: "cat-groceries",
      budgeted: "500.00",
      actual: "450.00",
      currency: "USD",
    },
  ];

  const config: RolloverConfig = { policy: "full" };

  it("keeps every rollover Money in the household currency (no ZMW leak)", () => {
    const warnSpy = vi.spyOn(logger, "warn");

    const result = calculateAccumulatedRollover(history, budget, config, "USD");

    // Top-level outputs carry the household currency, NOT the ZMW default.
    expect(result.originalBudget.currency).toBe("USD");
    expect(result.accumulatedRollover.currency).toBe("USD");
    expect(result.effectiveBudget.currency).toBe("USD");

    // Per-period history Money objects too.
    expect(result.rolloverHistory).toHaveLength(2);
    for (const entry of result.rolloverHistory) {
      expect(entry.unused.currency).toBe("USD");
      expect(entry.rolledOver.currency).toBe("USD");
    }

    // No currency-mismatch warning was logged during aggregation.
    const mismatchWarnings = warnSpy.mock.calls.filter(([msg]) =>
      String(msg).includes("currency mismatch"),
    );
    expect(mismatchWarnings).toEqual([]);
  });

  it("computes the accumulated rollover to the cent", () => {
    const result = calculateAccumulatedRollover(history, budget, config, "USD");

    // Jan unused 100 + Feb unused 50 = 150 accumulated; effective 500 + 150 = 650.
    expect(result.originalBudget.toString()).toBe("500.00");
    expect(result.accumulatedRollover.toString()).toBe("150.00");
    expect(result.effectiveBudget.toString()).toBe("650.00");

    expect(result.rolloverHistory[0].unused.toString()).toBe("100.00");
    expect(result.rolloverHistory[0].rolledOver.toString()).toBe("100.00");
    expect(result.rolloverHistory[1].unused.toString()).toBe("50.00");
    expect(result.rolloverHistory[1].rolledOver.toString()).toBe("50.00");
  });
});
