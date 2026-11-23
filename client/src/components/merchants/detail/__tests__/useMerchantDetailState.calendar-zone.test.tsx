/**
 * @vitest-environment jsdom
 *
 * NEW-15: every merchant range counts from one calendar-zone today.
 *
 * Runs in the client-tz-new-york project. At 2026-09-30T22:30Z it is
 * already 1 October in Lusaka, still 30 September in UTC and New York.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCalendarTimeZone } from "@/lib/calendarZone";
import { useMerchantDetailState } from "../useMerchantDetailState";

const analytics = vi.hoisted(() => vi.fn((_id: string | undefined, _range: { startDate: string; endDate: string }) => ({ data: undefined })));
const query = vi.hoisted(() => () => ({ data: undefined }));
const mutation = vi.hoisted(() => () => ({ mutate: vi.fn(), isPending: false }));

vi.mock("@/hooks/use-settings", () => ({
  useCategories: query,
  useMerchantDetails: query,
  useMerchantAnalytics: analytics,
  useMerchantTransactions: query,
  useAddMerchantAlias: mutation,
  useDeleteMerchantAlias: mutation,
  useDeleteMerchant: mutation,
}));
vi.mock("@/hooks/use-reports", () => ({
  useReportsSpendingBreakdown: query,
  requestReportExport: vi.fn(),
  getReportsExportDownloadUrl: vi.fn(),
}));

/** The ranges of the most recent render: selected, last 30, last 90, last 365. */
function lastRenderRanges(): Array<{ startDate: string; endDate: string }> {
  return analytics.mock.calls.slice(-4).map(([, range]) => ({ startDate: range.startDate, endDate: range.endDate }));
}

describe("useMerchantDetailState in the calendar zone", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T22:30:00Z"));
    analytics.mockClear();
  });

  afterEach(() => {
    cleanup();
    setCalendarTimeZone(null);
    vi.useRealTimers();
  });

  it("the default and the last 30/90/365 ranges all end on the Lusaka today", () => {
    setCalendarTimeZone("Africa/Lusaka");
    renderHook(() => useMerchantDetailState("m1"));
    expect(lastRenderRanges()).toEqual([
      { startDate: "2026-05-01", endDate: "2026-10-01" },
      { startDate: "2026-09-01", endDate: "2026-10-01" },
      { startDate: "2026-07-03", endDate: "2026-10-01" },
      { startDate: "2025-10-01", endDate: "2026-10-01" },
    ]);
  });

  it("a quick range counts back from the Lusaka today", () => {
    setCalendarTimeZone("Africa/Lusaka");
    const { result } = renderHook(() => useMerchantDetailState("m1"));
    act(() => result.current.actions.applyQuickRange(30));
    expect(result.current.state).toMatchObject({ startDate: "2026-09-01", endDate: "2026-10-01" });
  });

  it("untouched defaults follow the saved zone when it arrives after the first render", async () => {
    const { result } = renderHook(() => useMerchantDetailState("m1"));
    expect(result.current.state).toMatchObject({ startDate: "2026-04-01", endDate: "2026-09-30" });
    await act(async () => setCalendarTimeZone("Africa/Lusaka"));
    expect(result.current.state).toMatchObject({ startDate: "2026-05-01", endDate: "2026-10-01" });
  });

  it("a range the user chose is not overwritten when the zone arrives", async () => {
    const { result } = renderHook(() => useMerchantDetailState("m1"));
    act(() => result.current.actions.setStartDate("2026-01-15"));
    await act(async () => setCalendarTimeZone("Africa/Lusaka"));
    expect(result.current.state).toMatchObject({ startDate: "2026-01-15", endDate: "2026-09-30" });
  });
});
