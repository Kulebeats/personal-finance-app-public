/**
 * @vitest-environment jsdom
 *
 * NEW-15: screens that ask for "this month" or "this year" use the household
 * calendar, never the browser's. At 2026-12-31T12:00Z it is already
 * 1 January 2027 in Kiritimati (UTC+14) while every runner zone up to UTC+11
 * is still on 31 December 2026, so the expected values differ from the browser's.
 */
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setHouseholdCalendarTimeZone, useCalendarYearMonth } from "@/lib/calendarZone";
import { useCategoriesState } from "@/pages/settings/sections/CategoriesSection/hooks/useCategoriesState";
import AnnualSummaryWidget from "@/components/dashboard/AnnualSummaryWidget";

const categories = vi.hoisted(() => vi.fn((_query: { month: number; year: number }) => ({ data: undefined, isLoading: false })));
const annual = vi.hoisted(() => vi.fn((_query: { year: number; compareYear: number }) => ({ data: undefined, isLoading: true, error: null, refetch: vi.fn() })));
const mutation = vi.hoisted(() => () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }));

vi.mock("@/hooks/use-settings", () => ({
  useCategories: categories,
  useCreateCategory: mutation,
  useUpdateCategory: mutation,
  useDeleteCategory: mutation,
  useSeedCategories: mutation,
  useCreateCategoryGroup: mutation,
  useUpdateCategoryGroup: mutation,
  useArchiveCategoryGroup: mutation,
  useRestoreCategoryGroup: mutation,
  useReorderCategories: mutation,
}));
vi.mock("@/hooks/use-reports", () => ({ useReportsAnnual: annual }));
vi.mock("@/contexts/SettingsContext", () => ({ useFormatters: () => ({ formatCurrency: (value: number) => String(value) }) }));

const NOW = new Date("2026-12-31T12:00:00Z");

describe("household calendar year and month (NEW-15)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(NOW);
    categories.mockClear();
    annual.mockClear();
    setHouseholdCalendarTimeZone("Pacific/Kiritimati");
  });
  afterEach(async () => {
    cleanup();
    await act(async () => { setHouseholdCalendarTimeZone(null); });
    vi.useRealTimers();
  });

  it("is the household zone's year and month, not the browser's", () => {
    expect(new Date().getFullYear()).toBe(2026);
    const { result } = renderHook(() => useCalendarYearMonth());
    expect(result.current).toEqual({ year: 2027, month: 1 });
  });

  it("asks for the household month's category stats", () => {
    renderHook(() => useCategoriesState());
    expect(categories).toHaveBeenLastCalledWith(expect.objectContaining({ month: 1, year: 2027, includeStats: true }));
  });

  it("the dashboard annual summary asks for the household year and the one before", () => {
    render(<AnnualSummaryWidget />);
    expect(annual).toHaveBeenLastCalledWith({ year: 2027, compareYear: 2026 });
  });

  it("updates mounted category stats at Lusaka midnight while UTC is still in the previous month", () => {
    vi.setSystemTime(new Date("2026-09-30T21:59:59.900Z"));
    setHouseholdCalendarTimeZone("Africa/Lusaka");
    renderHook(() => useCategoriesState());
    expect(categories).toHaveBeenLastCalledWith(expect.objectContaining({ month: 9, year: 2026 }));
    act(() => { vi.advanceTimersByTime(99); });
    expect(categories).toHaveBeenLastCalledWith(expect.objectContaining({ month: 9, year: 2026 }));
    act(() => { vi.advanceTimersByTime(1); });
    expect(new Date().toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(categories).toHaveBeenLastCalledWith(expect.objectContaining({ month: 10, year: 2026 }));
  });

  it("moves a mounted annual widget from the old year on the household's New Year", () => {
    vi.setSystemTime(new Date("2026-12-31T09:59:59.900Z"));
    render(<AnnualSummaryWidget />);
    expect(annual).toHaveBeenLastCalledWith({ year: 2026, compareYear: 2025 });
    act(() => { vi.advanceTimersByTime(100); });
    expect(annual).toHaveBeenLastCalledWith({ year: 2027, compareYear: 2026 });
  });

  it("resynchronizes on focus after the clock moves past the pending timer", () => {
    vi.setSystemTime(new Date("2026-11-30T09:59:59Z"));
    const { result, unmount } = renderHook(() => useCalendarYearMonth());
    expect(result.current).toEqual({ year: 2026, month: 11 });
    act(() => {
      vi.setSystemTime(new Date("2026-12-01T15:00:00Z"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(result.current).toEqual({ year: 2026, month: 12 });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
