/**
 * NEW-15: report ranges follow the calendar zone, not the browser's.
 *
 * Runs in the client-tz-new-york project: the browser is UTC-5 while the
 * calendar zone is Lusaka (UTC+2). At 00:30 on 1 October in Lusaka the
 * browser still reads 30 September, and the request must be for October.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useCurrentMonthRange, useCurrentYearRange, useLastNMonthsRange } from "../use-reports";

// They subscribe to the calendar zone, so they run as hooks (NEW-15).
const currentMonth = () => renderHook(() => useCurrentMonthRange()).result.current;
const lastMonths = (months: number) => renderHook(() => useLastNMonthsRange(months)).result.current;
import { setCalendarTimeZone } from "@/lib/calendarZone";

describe("report ranges in the calendar zone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T22:30:00Z"));
    setCalendarTimeZone("Africa/Lusaka");
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
    setCalendarTimeZone(null);
    vi.useRealTimers();
  });

  it("runs west of UTC (precondition: otherwise the assertions are vacuous)", () => {
    expect(new Date().getDate()).toBe(30);
  });

  it("a Lusaka household on 1 October requests 2026-10-01 to 2026-10-31", () => {
    expect(currentMonth()).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("the last three months end on the Lusaka today", () => {
    expect(lastMonths(3)).toEqual({ from: "2026-08-01", to: "2026-10-01" });
  });

  it("falls back to the browser zone when no calendar zone is set", () => {
    setCalendarTimeZone(null);
    expect(currentMonth()).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("updates report ranges at a household year boundary with the view mounted", () => {
    vi.setSystemTime(new Date("2026-12-31T21:59:59.900Z"));
    const { result } = renderHook(() => ({ month: useCurrentMonthRange(), year: useCurrentYearRange() }));
    expect(result.current).toEqual({
      month: { from: "2026-12-01", to: "2026-12-31" },
      year: { year: 2026, from: "2026-01-01", to: "2026-12-31" },
    });
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current).toEqual({
      month: { from: "2027-01-01", to: "2027-01-31" },
      year: { year: 2027, from: "2027-01-01", to: "2027-12-31" },
    });
  });

  it("preserves the explicit report year across the same boundary", () => {
    vi.setSystemTime(new Date("2026-12-31T21:59:59.900Z"));
    window.history.replaceState(null, "", "/reports?year=2024");
    const { result } = renderHook(() => useCurrentYearRange());
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current).toEqual({ year: 2024, from: "2024-01-01", to: "2024-12-31" });
  });
});
