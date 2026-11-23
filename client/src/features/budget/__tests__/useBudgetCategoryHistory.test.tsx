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
import { render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Category, CategoryGroup } from "@/hooks/use-settings";
import type { BudgetWithProgress } from "@/hooks/useBudgets";
import { useBudgetCategoryHistory } from "../hooks/useBudgetCategoryHistory";
import { unbudgetedSpendKey } from "@/hooks/useUnbudgetedSpend";
import { BudgetHistoryChart } from "../components/BudgetHistoryChart";
import { BudgetDetailModal } from "../components/BudgetDetailModal";
import { buildBudgetGroupsFromApi } from "../hooks/budgetGroupUtils";

const mockApiCall = vi.fn();
vi.mock("@/lib/api", () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}));
vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({ formatCurrency: (amount: number) => `K${amount.toFixed(2)}` }),
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
    expect(result.current.currency).toBe("USD");
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

  it("keeps shared progress metadata when history loads the month and avoids a mixed-currency average", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const unbudgetedSpent = { expense: { amount: "17.50", currency: "ZMW" }, income: null };
    mockApiCall.mockImplementation(async (endpoint: string) => ({
      success: true,
      data: [{ categoryId: "cat-1", spent: { amount: "20.00", currency: endpoint.endsWith("month=2") ? "USD" : "ZMW" } }],
      meta: { unbudgetedSpent },
    }));
    const { result } = renderHook(() => useBudgetCategoryHistory("cat-1", 2026, 3, 2), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toMatchObject({ currency: null, hasData: false, average: null });
    expect(client.getQueryData(unbudgetedSpendKey(2026, 3))).toEqual(unbudgetedSpent);
  });

  it("keeps withheld and unreported months unknown while retaining observed spend", async () => {
    mockApiCall.mockImplementation(async (endpoint: string) => ({
      success: true,
      data: endpoint.endsWith("month=3") ? [{ categoryId: "cat-1", spent: { amount: "12.00", currency: "ZMW" } }] : [],
      meta: { unavailableBudgets: endpoint.endsWith("month=1") ? [{
        id: "older", name: "Synthetic category", categoryId: "cat-1", categoryGroupId: null, currency: "USD",
        reason: { code: "BUDGET_CURRENCY_MISMATCH", message: "Budget progress unavailable" },
      }] : [] },
    }));
    const { result } = renderHook(() => useBudgetCategoryHistory("cat-1", 2026, 3, 3), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.points.map(point => point.actual)).toEqual([null, null, 12]);
    expect(result.current.average).toBeNull();
    expect(result.current.currency).toBe("ZMW");
    render(<BudgetHistoryChart {...result.current} formatCurrency={amount => `K${amount.toFixed(2)}`} />);
    expect(screen.getByLabelText("JAN spending unavailable")).toBeInTheDocument();
    expect(screen.getByLabelText("FEB spending unavailable")).toBeInTheDocument();
    expect(screen.getByText(/3 month avg:/)).toHaveTextContent("Unavailable");
    expect(screen.getByText("K12.00")).toBeInTheDocument();
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

  it("reports unknown history when there is no valid category spending row", async () => {
    mockApiCall.mockImplementation(async (endpoint: string) => ({
      success: true,
      data: endpoint.endsWith("month=3")
        ? [{ categoryId: "cat-1", spent: { amount: "", currency: "ZMW" } }]
        : [],
    }));

    const { result } = renderHook(
      () => useBudgetCategoryHistory("cat-1", 2026, 3, 2),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.points.map(point => point.actual)).toEqual([null, null]);
    expect(result.current.hasData).toBe(false);
    expect(result.current.average).toBeNull();
  });

  it("does not fetch when categoryId is undefined", () => {
    renderHook(() => useBudgetCategoryHistory(undefined, 2026, 3, 2), {
      wrapper: createWrapper(),
    });

    expect(mockApiCall).not.toHaveBeenCalled();
  });
});

const zmw = (amount: string) => ({ amount, currency: "ZMW" });
const category: Category = {
  id: "cat-1", groupId: "group", householdId: "household", name: "Groceries", includeInBudget: true,
  icon: null, color: null, isArchived: false, displayOrder: 0, createdAt: "", updatedAt: "",
};
const householdGroup: CategoryGroup = {
  id: "group", householdId: "household", name: "Everyday", type: "expense", budgetMode: "by_group",
  rolloverEnabled: false, isArchived: false, displayOrder: 0, createdAt: "", updatedAt: "",
};
const groupProgress: BudgetWithProgress = {
  id: "group-budget", householdId: "household", name: "Everyday limit", categoryId: null,
  categoryGroupId: "group", amount: zmw("500.00"), spent: zmw("120.00"), remaining: zmw("380.00"),
  percentUsed: 24, period: "monthly", rolloverEnabled: false, isActive: true, createdAt: "", updatedAt: "",
};

function mountHistory(budgetMode: "by_group" | "by_category") {
  const progress = budgetMode === "by_group" ? [groupProgress] : [];
  const [group] = buildBudgetGroupsFromApi(progress, [category], [{ ...householdGroup, budgetMode }]);
  const [item] = group.items;
  render(<BudgetDetailModal
    selected={{ groupId: group.id, groupName: group.name, itemId: item.id, item }}
    year={2026} month={7} onClose={vi.fn()} onUpdate={vi.fn()}
  />, { wrapper: createWrapper() });
  return within(screen.getByRole("heading", { name: "History & Trends" }).parentElement!);
}

describe("mounted BudgetDetailModal category history", () => {
  beforeEach(() => {
    mockApiCall.mockReset();
  });

  it("leaves history unavailable for a group-covered category using group progress and withholding", async () => {
    mockApiCall.mockImplementation(async (endpoint: string) => ({
      success: true,
      data: endpoint.endsWith("month=6") ? [] : [groupProgress],
      meta: { unavailableBudgets: endpoint.endsWith("month=6") ? [{
        id: groupProgress.id, name: groupProgress.name, categoryId: null, categoryGroupId: "group", currency: "USD",
        reason: { code: "BUDGET_CURRENCY_MISMATCH", message: "Group progress unavailable" },
      }] : [] },
    }));

    const history = mountHistory("by_group");
    expect(await history.findByText("Spending history is unavailable for these months.")).toBeVisible();
    expect(history.queryByText(/No spending recorded|K120\.00|6 month avg/)).not.toBeInTheDocument();
  });

  it("reports a failed month as unknown while showing real spend and a reported zero", async () => {
    mockApiCall.mockImplementation(async (endpoint: string) => {
      if (endpoint.endsWith("month=5")) throw new Error("Progress request failed");
      const spent = endpoint.endsWith("month=7") ? "24.00" : "0.00";
      return {
        success: true,
        data: [{ ...groupProgress, categoryId: category.id, categoryGroupId: null, spent: zmw(spent) }],
      };
    });

    const history = mountHistory("by_category");
    expect(await history.findByRole("status")).toHaveTextContent("Some months could not be loaded.");
    expect(history.getByLabelText("MAY spending unavailable")).toBeVisible();
    expect(history.getByText(/6 month avg:/)).toHaveTextContent("Unavailable");
    expect(history.getByText(/Last month:/)).toHaveTextContent("K0.00");
    expect(history.getByText("K24.00")).toBeInTheDocument();
    expect(history.queryByText(/No spending recorded/)).not.toBeInTheDocument();
  });

  it("shows a real zero average when every requested month reported category spending of zero", async () => {
    mockApiCall.mockResolvedValue({
      success: true,
      data: [{ ...groupProgress, categoryId: category.id, categoryGroupId: null, spent: zmw("0.00") }],
    });

    const history = mountHistory("by_category");
    expect(await history.findByText(/6 month avg:/)).toHaveTextContent("K0.00");
    expect(history.queryByLabelText(/spending unavailable/)).not.toBeInTheDocument();
  });
});
