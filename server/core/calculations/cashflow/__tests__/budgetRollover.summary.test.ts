/**
 * getRolloverSummary counts the categories that carry a rollover. A category
 * whose accumulated rollover is zero carries none (NEW-23: zero is not positive).
 */
import { describe, expect, it } from "vitest";
import { Money } from "../../../money";
import { getRolloverSummary, type RolloverResult } from "../budgetRollover";

function rollover(categoryId: string, accumulated: string): RolloverResult {
  const originalBudget = Money.from("100.00", "ZMW");
  const accumulatedRollover = Money.from(accumulated, "ZMW");
  return {
    categoryId,
    categoryName: categoryId,
    originalBudget,
    accumulatedRollover,
    effectiveBudget: originalBudget.add(accumulatedRollover),
    rolloverHistory: [],
  };
}

describe("getRolloverSummary", () => {
  it("counts only categories whose accumulated rollover is above zero", () => {
    const summary = getRolloverSummary([rollover("food", "25.00"), rollover("fuel", "0.00")], "ZMW");

    expect(summary.categoriesWithRollover).toBe(1);
    expect(summary.totalRollover.toString()).toBe("25.00");
  });
});
