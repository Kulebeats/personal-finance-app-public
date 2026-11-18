/**
 * The merchant breakdown now includes a synthetic "No merchant" bucket
 * (id "no-merchant", not a uuid). It can be the largest item, but it must
 * never become the trend query's merchantId, or the server rejects it (400).
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportsSpendingBreakdownResponse } from "@shared/reports";

type Item = ReportsSpendingBreakdownResponse["items"][number];

const mocks = vi.hoisted(() => ({
  merchantItems: [] as Item[],
  trend: vi.fn(),
}));

vi.mock("@/hooks/use-reports", () => ({
  useReportsSpendingBreakdown: (params: { groupBy: string }) => ({
    data:
      params.groupBy === "merchant"
        ? { items: mocks.merchantItems, total: { amount: "0", currency: "ZMW" } }
        : { items: [], total: { amount: "0", currency: "ZMW" } },
    isLoading: false,
  }),
  useReportsSpendingTrend: (...args: unknown[]) => {
    mocks.trend(...args);
    return { data: undefined, isLoading: false };
  },
  useCurrentMonthRange: () => ({ from: "2026-11-01", to: "2026-11-30" }),
  useLastNMonthsRange: () => ({ from: "2026-09-01", to: "2026-11-30" }),
}));

vi.mock("@/hooks/use-settings", () => ({
  useMerchants: () => ({ data: [] }),
}));

import { NO_MERCHANT_ID, useMerchantFilters } from "../useMerchantFilters";

function item(id: string, label: string, amount: string): Item {
  return {
    id,
    entityId: id,
    label,
    value: { amount, currency: "ZMW" },
    percent: 0,
    entityType: "merchant",
  };
}

const REAL_MERCHANT_ID = "8b1c4e52-6a0f-4d2e-9a51-3f7c2d9e1b40";
const YEAR = { from: "2026-01-01", to: "2026-12-31" };

function lastTrendCall() {
  const calls = mocks.trend.mock.calls;
  return calls[calls.length - 1] as [
    { merchantId?: string },
    { enabled?: boolean },
  ];
}

describe("useMerchantFilters with the No merchant bucket", () => {
  beforeEach(() => {
    mocks.trend.mockClear();
  });

  it("auto-selects the top real merchant even when No merchant is larger", () => {
    mocks.merchantItems = [
      item(NO_MERCHANT_ID, "No merchant", "900.00"),
      item(REAL_MERCHANT_ID, "Shoprite", "100.00"),
    ];

    renderHook(() => useMerchantFilters({ yearRange: YEAR }));

    const [params, options] = lastTrendCall();
    expect(params.merchantId).toBe(REAL_MERCHANT_ID);
    expect(options.enabled).toBe(true);
  });

  it("never sends the synthetic id when No merchant is the only item", () => {
    mocks.merchantItems = [item(NO_MERCHANT_ID, "No merchant", "900.00")];

    renderHook(() => useMerchantFilters({ yearRange: YEAR }));

    for (const [params] of mocks.trend.mock.calls as Array<
      [{ merchantId?: string }]
    >) {
      expect(params.merchantId).not.toBe(NO_MERCHANT_ID);
    }
    expect(lastTrendCall()[1].enabled).toBe(false);
  });
});
