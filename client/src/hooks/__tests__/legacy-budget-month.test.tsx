import { renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useBudgets } from "../use-finance-data";

const mocks = vi.hoisted(() => ({ progress: vi.fn(), listing: vi.fn(), refresh: vi.fn() }));
vi.mock("@/contexts/SettingsContext", () => ({ useFormatters: () => ({ currency: "ZMW" }) }));
vi.mock("../useBudgets", () => ({
  useBudgets: mocks.listing, useBudgetProgress: mocks.progress,
  useCreateBudget: () => ({}), useUpdateBudget: () => ({}), useDeleteBudget: () => ({}),
}));
afterEach(() => vi.useRealTimers());

it("exposes only the current month's effective limits and preserves an explicit zero", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T00:30:00Z"));
  const money = (amount: string) => ({ amount, currency: "ZMW" });
  const base = { name: "Budget", categoryId: "groceries", period: "monthly" };
  mocks.listing.mockReturnValue({ data: [
    { ...base, id: "manual", amount: money("500") }, { ...base, id: "current", amount: null },
    { ...base, id: "other-month", amount: null },
  ] });
  mocks.progress.mockReturnValue({ data: [
    { ...base, id: "manual", amount: money("0"), spent: money("12") },
    { ...base, id: "current", amount: money("183.33"), spent: money("3") },
  ], refetch: mocks.refresh });
  const { result } = renderHook(() => useBudgets());
  expect(mocks.progress).toHaveBeenCalledWith(2026, 11);
  expect(result.current.data.map(({ id, amount, spent }) => ({ id, amount, spent }))).toEqual([
    { id: "manual", amount: 0, spent: 12 }, { id: "current", amount: 183.33, spent: 3 },
  ]);
  expect(result.current.getByMonth(2026, 11)).toEqual(result.current.data);
  expect(result.current.getByMonth(2026, 12)).toEqual([]);
  result.current.updateAllSpent(2026, 11);
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
