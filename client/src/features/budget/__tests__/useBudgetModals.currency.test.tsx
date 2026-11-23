/**
 * C3-10: the inline budget edit must write in the budget's own currency on
 * update and the household's currency on create, never the viewer's display
 * currency (which falls back to a default while settings load).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useBudgetModals } from "../hooks/useBudgetModals";

vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({ currency: "USD", formatCurrency: (value: number) => `$${value}` }),
}));

type Options = Parameters<typeof useBudgetModals>[0];
type Mutation = { mutate: ReturnType<typeof vi.fn>; isPending: boolean };
const mutation = (): Mutation => ({ mutate: vi.fn(), isPending: false });

function setup(extra: { householdCurrency?: string; unavailableBudgets?: Options["unavailableBudgets"] }) {
  const createBudget = mutation(), updateBudget = mutation(), updateBudgetForecast = mutation(), moveBudgetAmount = mutation();
  // A variable (not a literal) so this file type-checks before and after the fix.
  const options = {
    selectedYear: 2026, selectedMonth: 2, moveMoneyOptions: [],
    budgets: [{ id: "budget-zmw", currency: "ZMW" }, { id: "budget-usd", currency: "USD" }],
    createBudget: createBudget as unknown as Options["createBudget"],
    updateBudget: updateBudget as unknown as Options["updateBudget"],
    updateBudgetForecast: updateBudgetForecast as unknown as Options["updateBudgetForecast"],
    moveBudgetAmount: moveBudgetAmount as unknown as Options["moveBudgetAmount"],
    ...extra,
  };
  const { result } = renderHook(() => useBudgetModals(options));
  return { result, createBudget, updateBudget, updateBudgetForecast };
}
const payload = (budgetId: string | undefined, applyScope: "all_future" | "this_month") => ({
  budgetId, categoryId: "cat-1", categoryName: "Groceries", year: 2026, month: 2, amount: "250.00", applyScope,
});

describe("useBudgetModals inline edit currency", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates an existing budget in the budget's own currency when the display currency differs", () => {
    const { result, updateBudget, updateBudgetForecast } = setup({ householdCurrency: "ZMW" });
    act(() => result.current.handleBudgetEditSave(payload("budget-zmw", "all_future")));
    expect(updateBudget.mutate).toHaveBeenCalledTimes(1);
    expect(updateBudget.mutate.mock.calls[0][0]).toEqual({ id: "budget-zmw", data: { amount: { amount: "250.00", currency: "ZMW" } } });
    act(() => updateBudget.mutate.mock.calls[0][1].onSuccess());
    expect(updateBudgetForecast.mutate.mock.calls[0][0].data.amount).toEqual({ amount: "250.00", currency: "ZMW" });
  });

  it("updates a budget held in another currency in that currency, not the household's", () => {
    const { result, updateBudget } = setup({ householdCurrency: "ZMW" });
    act(() => result.current.handleBudgetEditSave(payload("budget-usd", "all_future")));
    expect(updateBudget.mutate.mock.calls[0][0]).toEqual({ id: "budget-usd", data: { amount: { amount: "250.00", currency: "USD" } } });
  });

  it("never creates a second budget over one the server reported unavailable", () => {
    const { result, createBudget, updateBudgetForecast } = setup({ householdCurrency: "ZMW", unavailableBudgets: [{
      id: "budget-hidden", name: "Travel", categoryId: "cat-1", categoryGroupId: null, currency: "USD",
      reason: { code: "BUDGET_CURRENCY_MISMATCH", message: "This budget's limit is in USD." } }] });
    act(() => result.current.handleBudgetEditSave(payload(undefined, "all_future")));
    expect(createBudget.mutate).not.toHaveBeenCalled();
    expect(updateBudgetForecast.mutate).not.toHaveBeenCalled();
  });

  it("updates an existing budget's selected month in its own currency", () => {
    const { result, createBudget, updateBudget, updateBudgetForecast } = setup({ householdCurrency: "ZMW" });
    act(() => result.current.handleBudgetEditSave(payload("budget-usd", "this_month")));
    expect(updateBudgetForecast.mutate).toHaveBeenCalledTimes(1);
    expect(updateBudgetForecast.mutate.mock.calls[0][0]).toEqual({
      id: "budget-usd",
      data: { year: 2026, month: 2, amount: { amount: "250.00", currency: "USD" }, applyScope: "this_month" },
    });
    expect(createBudget.mutate).not.toHaveBeenCalled();
    expect(updateBudget.mutate).not.toHaveBeenCalled();
  });

  it("creates a new budget in the household currency", () => {
    const { result, createBudget, updateBudgetForecast } = setup({ householdCurrency: "ZMW" });
    act(() => result.current.handleBudgetEditSave(payload(undefined, "all_future")));
    expect(createBudget.mutate.mock.calls[0][0].amount).toEqual({ amount: "250.00", currency: "ZMW" });
    act(() => createBudget.mutate.mock.calls[0][1].onSuccess({ id: "budget-new", currency: "ZMW" }));
    expect(updateBudgetForecast.mutate.mock.calls[0][0]).toMatchObject({ id: "budget-new", data: { amount: { amount: "250.00", currency: "ZMW" } } });
  });

  it("creates a this-month-only budget in one call with no recurring default (A-16)", () => {
    const { result, createBudget, updateBudgetForecast } = setup({ householdCurrency: "ZMW" });
    act(() => result.current.handleBudgetEditSave(payload(undefined, "this_month")));
    expect(createBudget.mutate).toHaveBeenCalledTimes(1);
    expect(createBudget.mutate.mock.calls[0][0]).toEqual({ name: "Groceries", categoryId: "cat-1",
      amount: { amount: "250.00", currency: "ZMW" }, period: "monthly", onlyFor: { year: 2026, month: 2 } });
    act(() => createBudget.mutate.mock.calls[0][1].onSuccess({ id: "budget-new", currency: "ZMW" }));
    expect(updateBudgetForecast.mutate).not.toHaveBeenCalled();
  });

  it("sends nothing while the household currency is still unknown", () => {
    const { result, createBudget, updateBudgetForecast } = setup({});
    act(() => result.current.handleBudgetEditSave(payload(undefined, "all_future")));
    expect(createBudget.mutate).not.toHaveBeenCalled();
    expect(updateBudgetForecast.mutate).not.toHaveBeenCalled();
  });
});
