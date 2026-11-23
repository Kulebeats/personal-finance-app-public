/**
 * A-17: committing an amount from the budget detail dialog only opens the
 * scope chooser. The commit reports what the chooser did: true once the save
 * succeeded, false when the chooser was closed without one (cancel, or after a
 * failed save), so the detail dialog never treats an unsaved amount as saved.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCreateBudget, useMoveBudgetAmount, useUpdateBudget, useUpdateBudgetForecast } from "@/hooks/useBudgets";
import { clearCsrfToken } from "@/lib/csrf";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";
import { useBudgetGroups } from "../hooks/useBudgetGroups";
import { useBudgetModals } from "../hooks/useBudgetModals";
import type { BudgetCategory, BudgetGroup, BudgetWithProgress } from "../types";

vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({ currency: "USD", formatCurrency: (value: number) => `$${value}` }),
}));

type Options = Parameters<typeof useBudgetModals>[0];
type Mutation = { mutate: ReturnType<typeof vi.fn>; isPending: boolean };
const mutation = (): Mutation => ({ mutate: vi.fn(), isPending: false });

function setup() {
  const updateBudgetForecast = mutation();
  const options = {
    selectedYear: 2026, selectedMonth: 2, moveMoneyOptions: [], householdCurrency: "ZMW",
    budgets: [{ id: "budget-zmw", currency: "ZMW" }],
    createBudget: mutation() as unknown as Options["createBudget"],
    updateBudget: mutation() as unknown as Options["updateBudget"],
    updateBudgetForecast: updateBudgetForecast as unknown as Options["updateBudgetForecast"],
    moveBudgetAmount: mutation() as unknown as Options["moveBudgetAmount"],
  };
  const { result } = renderHook(() => useBudgetModals(options));
  return { result, updateBudgetForecast };
}

const item = { id: "cat-1", budgetId: "budget-zmw", name: "Groceries" } as BudgetCategory;
const group = { id: "grp-1", name: "Food", items: [item] } as unknown as BudgetGroup;
const thisMonth = {
  budgetId: "budget-zmw", categoryId: "cat-1", categoryName: "Groceries", year: 2026, month: 2,
  amount: "750.00", applyScope: "this_month" as const,
};

describe("useBudgetModals commit outcome (A-17)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports false when the scope chooser is cancelled", async () => {
    const { result } = setup();
    let outcome: unknown;
    act(() => { outcome = result.current.handleCommitItemBudget(item, group, 750); });
    expect(result.current.budgetEdit).toMatchObject({ amount: "750.00" });

    act(() => result.current.closeBudgetEdit());

    await expect(outcome).resolves.toBe(false);
  });

  it("reports false when the chooser is closed after a failed save", async () => {
    const { result, updateBudgetForecast } = setup();
    let outcome: unknown;
    act(() => { outcome = result.current.handleCommitItemBudget(item, group, 750); });
    act(() => result.current.handleBudgetEditSave(thisMonth));
    expect(updateBudgetForecast.mutate).toHaveBeenCalledTimes(1);

    // The save failed (onSuccess never runs), so the user closes the chooser.
    act(() => result.current.closeBudgetEdit());

    await expect(outcome).resolves.toBe(false);
  });

  it("reports true once the save succeeds", async () => {
    const { result, updateBudgetForecast } = setup();
    let outcome: unknown;
    act(() => { outcome = result.current.handleCommitItemBudget(item, group, 750); });
    act(() => result.current.handleBudgetEditSave(thisMonth));

    act(() => updateBudgetForecast.mutate.mock.calls[0][1].onSuccess());

    await expect(outcome).resolves.toBe(true);
    expect(result.current.budgetEdit).toBeNull();
  });

  it("finishes an all-future category save when a delayed flexible save overlaps it", async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: Infinity } } });
    const currency = "ZMW";
    const amount = { amount: thisMonth.amount, currency };
    const flexAmount = { amount: "1500.00", currency };
    const householdId = "h-1";
    const scope = {
      householdId, householdCurrency: currency, selectedYear: thisMonth.year, selectedMonth: thisMonth.month,
    };
    const categoryBudget: BudgetWithProgress = {
      id: thisMonth.budgetId, householdId, name: item.name, categoryId: item.id, period: "monthly",
      amount: { amount: "500.00", currency }, spent: { amount: "0.00", currency },
      remaining: { amount: "500.00", currency }, percentUsed: 0, rolloverEnabled: false,
      isActive: true, createdAt: "", updatedAt: "",
    };
    const flexBudget = {
      ...categoryBudget, id: "flex-1", name: "Flexible Budget", categoryId: null,
      amount: { amount: "0.00", currency }, isFlexBucket: true,
    };
    const groupsOptions = {
      ...scope, apiBudgets: [categoryBudget], budgetSystem: "flex" as const, isBudgetView: true,
      reportingCurrency: currency, setLocation: vi.fn(),
      categories: [{
        id: item.id, householdId, groupId: group.id, name: item.name, icon: null, color: null,
        includeInBudget: true, isArchived: false, displayOrder: 0, createdAt: "", updatedAt: "",
      }],
      categoryGroups: [{
        id: group.id, householdId, name: group.name, type: "expense", budgetMode: "by_category",
        rolloverEnabled: false, isArchived: false, displayOrder: 0, createdAt: "", updatedAt: "",
      }],
    };
    const success = (data: object) => Response.json({ success: true, data });
    const ensureFlex = Promise.withResolvers<Response>();
    const categoryPut = Promise.withResolvers<Response>();
    const flexPut = Promise.withResolvers<Response>();
    const forecastPut = vi.fn((_init?: RequestInit) => success({ budgetId: categoryBudget.id }));
    const write = vi.fn((method: string | undefined, path: string, init?: RequestInit) => {
      switch ([method, path].join(" ")) {
        case "POST /api/budgets/flex": return ensureFlex.promise;
        case "PUT /api/budgets/budget-zmw": return categoryPut.promise;
        case "PUT /api/budgets/flex-1": return flexPut.promise;
        case "PUT /api/budgets/forecast/budget-zmw": return forecastPut(init);
        default: throw new Error(["Unexpected request", method, path].join(" "));
      }
    });
    clearCsrfToken();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === "/api/csrf-token"
        ? Response.json({ csrfToken: "test-csrf" })
        : write(init?.method, String(input), init),
    );
    const operation = createOperationLifetime({ subject: "actor", household: householdId });
    activateOperationLifetime(operation);
    const { result, unmount } = renderHook(() => {
      const createBudget = useCreateBudget();
      const updateBudget = useUpdateBudget();
      const updateBudgetForecast = useUpdateBudgetForecast();
      const moveBudgetAmount = useMoveBudgetAmount();
      return {
        groups: useBudgetGroups({ ...groupsOptions, createBudget }),
        modals: useBudgetModals({
          ...scope, budgets: groupsOptions.apiBudgets, moveMoneyOptions: [],
          createBudget, updateBudget, updateBudgetForecast, moveBudgetAmount,
        }),
      };
    }, {
      wrapper: ({ children }: { children: ReactNode }) =>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });

    const categoryOutcome = vi.fn<(saved: boolean) => void>();
    try {
      // Let the Flex handler reach ensure, then use the category chooser while it waits.
      act(() => result.current.groups.commitGroupBudget("flexible-expenses", 1500));
      await waitFor(() => expect(write).toHaveBeenCalledWith("POST", "/api/budgets/flex", expect.any(Object)));
      const foodGroup = result.current.groups.groups.find(({ id }) => id === group.id);
      const category = foodGroup?.items.find(({ id }) => id === item.id);
      if (!foodGroup || !category) throw new Error("Expected a budgeted category in the Food group");
      expect(category.budgetId).toBe(categoryBudget.id);
      act(() => {
        void result.current.modals.handleCommitItemBudget(category, foodGroup, 750).then(categoryOutcome);
      });
      expect(result.current.modals.budgetEdit).toMatchObject({ budgetId: categoryBudget.id, amount: amount.amount });
      act(() => result.current.modals.handleBudgetEditSave({ ...thisMonth, applyScope: "all_future" }));
      await waitFor(() => expect(write).toHaveBeenCalledWith("PUT", "/api/budgets/budget-zmw", expect.any(Object)));

      await act(async () => { ensureFlex.resolve(success(flexBudget)); });
      await waitFor(() => expect(write).toHaveBeenCalledWith("PUT", "/api/budgets/flex-1", expect.any(Object)));
      const updates = client.getMutationCache().getAll();
      expect(updates.map(({ state }) => state.variables)).toEqual([
        { id: categoryBudget.id, data: { amount } },
        expect.objectContaining({ id: flexBudget.id, data: { amount: flexAmount } }),
      ]);
      expect(updates.map(({ state }) => state.status)).toEqual(["pending", "pending"]);
      expect(forecastPut).not.toHaveBeenCalled();
      expect(categoryOutcome).not.toHaveBeenCalled();

      await act(async () => { flexPut.resolve(success({ ...flexBudget, amount: flexAmount })); });
      await waitFor(() => expect(updates.map(({ state }) => state.status)).toEqual(["pending", "success"]));
      await act(async () => { categoryPut.resolve(success({ ...categoryBudget, amount })); });
      await waitFor(() => expect(updates.map(({ state }) => state.status)).toEqual(["success", "success"]));

      await waitFor(() => {
        expect({
          forecastCalls: forecastPut.mock.calls.length,
          outcomes: categoryOutcome.mock.calls,
          chooser: result.current.modals.budgetEdit,
        }).toEqual({ forecastCalls: 1, outcomes: [[true]], chooser: null });
      });
      expect(JSON.parse(String(forecastPut.mock.calls[0]?.[0]?.body))).toEqual({
        year: thisMonth.year, month: thisMonth.month, amount, applyScope: "all_future", months: 12,
      });
    } finally {
      await act(async () => {
        result.current.modals.closeBudgetEdit();
        ensureFlex.resolve(success(flexBudget));
        categoryPut.resolve(success({ ...categoryBudget, amount }));
        flexPut.resolve(success({ ...flexBudget, amount: flexAmount }));
      });
      unmount();
      client.clear();
      retireOperationLifetime(operation);
      clearCsrfToken();
      vi.unstubAllGlobals();
    }
  });
});
