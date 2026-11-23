/**
 * Month ranges must be built from LOCAL calendar dates.
 *
 * `new Date(y, m, 1).toISOString()` is local midnight expressed in UTC, so in
 * a browser east of UTC (Lusaka is UTC+2) the 1st of the month became the
 * last day of the previous month and the server's month-keyed cashflow
 * lookups missed (dashboard budget card showed K0.00).
 *
 * The zone is set by the "client-tz-lusaka" project in client/vitest.config.ts
 * (a forked child spawned with TZ=Africa/Lusaka). Assigning process.env.TZ in
 * here would not work under the threads pool: a worker thread keeps the
 * process's zone, so on a UTC CI host the old code passed this test too.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCurrentMonthRange, useLastNMonthsRange } from "../use-reports";

// They subscribe to the calendar zone, so they run as hooks (NEW-15).
const currentMonth = () => renderHook(() => useCurrentMonthRange()).result.current;
const lastMonths = (months: number) => renderHook(() => useLastNMonthsRange(months)).result.current;

const LUSAKA_OFFSET_MINUTES = -120;

describe("report month ranges in a UTC+2 browser", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    // 15 Nov 2026, 01:00 in Lusaka (still 14 Nov in UTC).
    vi.setSystemTime(new Date(2026, 10, 15, 1, 0, 0));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("runs in UTC+2 (precondition: otherwise the assertions below are vacuous)", () => {
    expect(new Date(2026, 10, 1).getTimezoneOffset()).toBe(LUSAKA_OFFSET_MINUTES);
  });

  it("useCurrentMonthRange returns the local first and last day", () => {
    expect(currentMonth()).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
    });
  });

  it("useLastNMonthsRange starts on a local 1st and ends today", () => {
    expect(lastMonths(3)).toEqual({
      from: "2026-09-01",
      to: "2026-11-15",
    });
  });
});
