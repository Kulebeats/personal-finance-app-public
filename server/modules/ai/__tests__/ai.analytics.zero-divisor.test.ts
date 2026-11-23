/**
 * NEW-23: zero is not positive. Each AI analytics ratio guards its divisor
 * with isPositive(); a zero divisor gives a 0% ratio, never NaN or Infinity
 * (which reach the model as null), and the status or trend it implies is kept.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readLimits } = vi.hoisted(() => ({ readLimits: vi.fn() }));
vi.mock("../../../db", () => ({ db: { select: vi.fn(), execute: vi.fn() } }));
vi.mock("../../../repositories/BudgetCurrentLimitRepository", () => ({
  readCurrentCategoryBudgetLimits: readLimits,
}));
vi.mock("../../../services/householdCalendarToday", async (original) => ({
  ...await original<typeof import("../../../services/householdCalendarToday")>(),
  householdToday: async () => "2026-03-31",
}));

import { db } from "../../../db";
import { AIAnalyticsService } from "../ai.analytics.service";
import type { QueryContext } from "../ai.types";

const context: QueryContext = {
  userId: "user-1",
  householdId: "household-1",
  currency: "ZMW",
  actor: { householdId: "household-1", userId: "user-1", role: "owner" },
};

// A drizzle select chain whose every step returns itself and resolves to rows.
function rows(data: readonly object[]) {
  const chain: Record<string, unknown> = {};
  for (const step of ["from", "leftJoin", "innerJoin", "where", "groupBy", "orderBy", "limit"]) {
    chain[step] = () => chain;
  }
  chain.then = (resolve: (value: readonly object[]) => unknown) => Promise.resolve(data).then(resolve);
  return chain;
}

function selectReturns(...results: readonly (readonly object[])[]) {
  for (const result of results) vi.mocked(db.select).mockReturnValueOnce(rows(result) as never);
}

const limit = (amount: string, spent: string) => ({
  categoryId: "gifts", categoryName: "Gifts", amount, currency: "ZMW", spent, missingConversion: false,
});

const service = new AIAnalyticsService();
const sameCurrency = { sourceCurrency: "ZMW", rate: "1", count: 1 };

describe("AI analytics ratios over a zero divisor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gives each category 0% of a spending total that nets to zero", async () => {
    selectReturns([{ ...sameCurrency, groupId: "fees", groupName: "Fees", total: "0.00" }]);

    const [fees] = await service.getSpendingByCategory(context, "30d");

    expect(fees.percentOfTotal).toBe(0);
  });

  it("reads spending against a zero budget as 0% used and over budget", async () => {
    readLimits.mockResolvedValueOnce([limit("0.00", "40.00")]);

    const [gifts] = await service.getBudgetStatus(context);

    expect(gifts.percentUsed).toBe(0);
    expect(gifts.status).toBe("over_budget");
  });

  it("reads no spending against a zero budget as 0% used and under budget", async () => {
    readLimits.mockResolvedValueOnce([limit("0.00", "0.00")]);

    const [gifts] = await service.getBudgetStatus(context);

    expect(gifts.percentUsed).toBe(0);
    expect(gifts.status).toBe("under_budget");
  });

  it("calls a trend up from no spending, and flat while spending stays at zero", async () => {
    const month = (groupId: string, value: string, total: string) => ({
      ...sameCurrency, groupId, groupName: groupId, date: value + "-01", total,
    });
    selectReturns([
      month("new", "2026-01", "0.00"), month("new", "2026-02", "50.00"),
      month("none", "2026-01", "0.00"), month("none", "2026-02", "0.00"),
    ]);

    const trends = await service.getCategoryTrends(context, 6);

    expect(Object.fromEntries(trends.map((t) => [t.categoryId, t.trendDirection]))).toEqual({ new: "up", none: "flat" });
  });

  it("gives a 0% savings rate for a month with spending and no income", async () => {
    selectReturns([{ ...sameCurrency, type: "expense", total: "120.00" }]);

    const summary = await service.getMonthlySummary(context, "2026-03");

    expect(summary.savingsRate).toBe(0);
    expect(summary.netSavings?.toString()).toBe("-120.00");
  });
});
