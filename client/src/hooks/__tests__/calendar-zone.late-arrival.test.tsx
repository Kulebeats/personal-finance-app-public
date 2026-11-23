/**
 * @vitest-environment jsdom
 *
 * NEW-15: financial periods re-derive when the household zone arrives after
 * the first render, and the household zone wins over the display zone.
 *
 * Runs in the client-tz-new-york project. At 2026-09-30T22:30Z it is already
 * 1 October in Lusaka and still 30 September in New York.
 */
import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calendarMonthRange, setCalendarTimeZone, setHouseholdCalendarTimeZone } from "@/lib/calendarZone";
import { useCurrentMonthRange, useLastNMonthsRange } from "../use-reports";
import { useCurrentMonthBudgets } from "../useBudgets";

vi.mock("@/lib/api", () => ({ apiCall: vi.fn(() => new Promise(() => {})) }));

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("financial periods in the household calendar zone", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T22:30:00Z"));
  });

  afterEach(() => {
    cleanup();
    setHouseholdCalendarTimeZone(null);
    setCalendarTimeZone(null);
    vi.useRealTimers();
  });

  it("the household zone wins over the member's display zone", () => {
    setCalendarTimeZone("America/New_York");
    setHouseholdCalendarTimeZone("Africa/Lusaka");
    expect(calendarMonthRange()).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    setHouseholdCalendarTimeZone(null);
    expect(calendarMonthRange()).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("report month and rolling ranges follow a household zone that arrives late", async () => {
    const month = renderHook(() => useCurrentMonthRange());
    const lastThree = renderHook(() => useLastNMonthsRange(3));
    expect(month.result.current).toEqual({ from: "2026-09-01", to: "2026-09-30" });

    await act(async () => setHouseholdCalendarTimeZone("Africa/Lusaka"));
    expect(month.result.current).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(lastThree.result.current).toEqual({ from: "2026-08-01", to: "2026-10-01" });
  });

  it("the current budget month follows a household zone that arrives late", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useCurrentMonthBudgets(), { wrapper: wrapperFor(client) });
    const progressMonths = () => client.getQueryCache().getAll()
      .map((query) => query.queryKey).filter((key) => key.includes("progress")).map((key) => key.slice(-2));
    expect(progressMonths()).toEqual([[2026, 9]]);

    await act(async () => setHouseholdCalendarTimeZone("Africa/Lusaka"));
    expect(progressMonths()).toContainEqual([2026, 10]);
    client.clear();
  });
});
