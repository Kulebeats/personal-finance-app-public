/**
 * The merchant totals carry the report's own currency. While that currency is
 * unknown (the breakdown is still loading, or names no currency) a total is a
 * bare zero, never a guessed "USD" that would show as US$0.00 to a kwacha
 * household.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportsSpendingBreakdownResponse } from "@shared/reports";

type Breakdown = Partial<ReportsSpendingBreakdownResponse> | undefined;

const mocks = vi.hoisted(() => ({
  merchant: undefined as unknown,
  category: undefined as unknown,
}));

vi.mock("@/hooks/use-reports", () => ({
  useReportsSpendingBreakdown: (params: { groupBy: string }) => ({
    data: params.groupBy === "merchant" ? mocks.merchant : mocks.category,
    isLoading: false,
  }),
  useReportsSpendingTrend: () => ({ data: undefined, isLoading: false }),
  useCurrentMonthRange: () => ({ from: "2026-11-01", to: "2026-11-30" }),
  useLastNMonthsRange: () => ({ from: "2026-09-01", to: "2026-11-30" }),
}));

vi.mock("@/hooks/use-settings", () => ({
  useMerchants: () => ({ data: [] }),
}));

import { useMerchantFilters } from "../useMerchantFilters";

const YEAR = { from: "2026-01-01", to: "2026-12-31" };

function zmwBreakdown(): Breakdown {
  return {
    items: [],
    total: { amount: "0.00", currency: "ZMW" },
    range: { baseCurrency: "ZMW" } as ReportsSpendingBreakdownResponse["range"],
  };
}

describe("useMerchantFilters currency", () => {
  beforeEach(() => {
    mocks.merchant = undefined;
    mocks.category = undefined;
  });

  it("guesses no currency for either total while the breakdowns load", () => {
    const { result } = renderHook(() => useMerchantFilters({ yearRange: YEAR }));

    expect(result.current.total).toBe("0.00");
    expect(result.current.categoryTotal).toBe("0.00");
  });

  it("guesses no currency when a loaded breakdown names none", () => {
    mocks.merchant = { items: [] };
    mocks.category = { items: [] };

    const { result } = renderHook(() => useMerchantFilters({ yearRange: YEAR }));

    expect(result.current.total).toBe("0.00");
    expect(result.current.categoryTotal).toBe("0.00");
  });

  it("gives an empty category total the merchant report's currency", () => {
    mocks.merchant = zmwBreakdown();
    mocks.category = { items: [] };

    const { result } = renderHook(() => useMerchantFilters({ yearRange: YEAR }));

    expect(result.current.total).toEqual({ amount: "0.00", currency: "ZMW" });
    expect(result.current.categoryTotal).toEqual({ amount: "0.00", currency: "ZMW" });
  });
});
