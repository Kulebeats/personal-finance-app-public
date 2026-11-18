/**
 * useBudgetCategoryHistory Unit Tests (R11 - audit v2 finding B4)
 *
 * The Budget category detail modal used to render a hardcoded 6-month
 * chart. This hook replaces that fabrication with real per-category
 * spend, sourced from the same `/budgets/progress` endpoint the Budget
 * page already uses (one request per trailing month).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useBudgetCategoryHistory } from "../hooks/useBudgetCategoryHistory";

const mockApiCall = vi.fn();
vi.mock("@/lib/api", () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe("useBudgetCategoryHistory", () => {
  beforeEach(() => {
    mockApiCall.mockReset();
  });

  it("fetches one budgets/progress request per trailing month and extracts the category's real spend", async () => {
    mockApiCall.mockImplementation((endpoint: string) => {
      const match = /year=(\d+)&month=(\d+)/.exec(endpoint);
      const year = Number(match?.[1]);
      const month = Number(match?.[2]);
      return Promise.resolve({
        success: true,
        data: [
          {
            id: `b-${year}-${month}`,
            categoryId: "cat-1",
            isFlexBucket: false,
            spent: { amount: `${100 + month}.00`, currency: "USD" },
          },
          {
            id: `flex-${year}-${month}`,
            categoryId: null,
            isFlexBucket: true,
            spent: { amount: "999.00", currency: "USD" },
          },
        ],
      });
    });

    const { result } = renderHook(
      () => useBudgetCategoryHistory("cat-1", 2026, 3, 3),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.points).toEqual([
      { year: 2026, month: 1, label: "JAN", actual: 101 },
      { year: 2026, month: 2, label: "FEB", actual: 102 },
      { year: 2026, month: 3, label: "MAR", actual: 103 },
    ]);
    expect(result.current.hasData).toBe(true);
    expect(mockApiCall).toHaveBeenCalledWith(
      "/budgets/progress?year=2026&month=1",
    );
    expect(mockApiCall).toHaveBeenCalledWith(
      "/budgets/progress?year=2026&month=2",
    );
    expect(mockApiCall).toHaveBeenCalledWith(
      "/budgets/progress?year=2026&month=3",
    );
  });

  it("wraps year boundaries correctly when walking backward from January", async () => {
    mockApiCall.mockResolvedValue({ success: true, data: [] });

    renderHook(() => useBudgetCategoryHistory("cat-1", 2026, 1, 2), {
      wrapper: createWrapper(),
    });

    await waitFor(() =>
      expect(mockApiCall).toHaveBeenCalledWith(
        "/budgets/progress?year=2025&month=12",
      ),
    );
    expect(mockApiCall).toHaveBeenCalledWith(
      "/budgets/progress?year=2026&month=1",
    );
  });

  it("reports no real history and zeroed points when the category has no budget row in any month", async () => {
    mockApiCall.mockResolvedValue({ success: true, data: [] });

    const { result } = renderHook(
      () => useBudgetCategoryHistory("cat-1", 2026, 3, 2),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.points.every((point) => point.actual === 0)).toBe(
      true,
    );
    expect(result.current.hasData).toBe(false);
  });

  it("does not fetch when categoryId is undefined", () => {
    renderHook(() => useBudgetCategoryHistory(undefined, 2026, 3, 2), {
      wrapper: createWrapper(),
    });

    expect(mockApiCall).not.toHaveBeenCalled();
  });
});
