/**
 * @vitest-environment jsdom
 *
 * NEW-15: the household's own calendar zone decides financial periods for
 * every member; a member's display zone only fills in when it is unset.
 *
 * Runs in the client-tz-new-york project. At 2026-09-30T22:30Z it is already
 * 1 October in Lusaka and still 30 September in New York.
 */
import { StrictMode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calendarMonthRange, setCalendarTimeZone, setHouseholdCalendarTimeZone } from "@/lib/calendarZone";
import { HouseholdCalendarZone } from "../HouseholdCalendarZone";

const household = vi.hoisted(() => ({ current: { data: undefined as unknown } }));
vi.mock("@/hooks/use-settings", () => ({ useHousehold: () => household.current }));

function MonthProbe() {
  return <p data-testid="month">{calendarMonthRange().from}</p>;
}

describe("HouseholdCalendarZone", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T22:30:00Z"));
    setCalendarTimeZone("America/New_York");
  });

  afterEach(() => {
    cleanup();
    setHouseholdCalendarTimeZone(null);
    setCalendarTimeZone(null);
    vi.useRealTimers();
  });

  it("children count the household's month, not the member's display month", () => {
    household.current = { data: { household: { id: "h1", timeZone: "Africa/Lusaka" } } };
    render(<HouseholdCalendarZone><MonthProbe /></HouseholdCalendarZone>);
    expect(screen.getByTestId("month").textContent).toBe("2026-10-01");
  });

  it("falls back to the display zone when the household has no zone", () => {
    household.current = { data: { household: { id: "h1", timeZone: null } } };
    render(<HouseholdCalendarZone><MonthProbe /></HouseholdCalendarZone>);
    expect(screen.getByTestId("month").textContent).toBe("2026-09-01");
  });

  it("keeps the household zone through StrictMode's effect replay", async () => {
    household.current = { data: { household: { id: "h1", timeZone: "Africa/Lusaka" } } };
    render(<StrictMode><HouseholdCalendarZone><MonthProbe /></HouseholdCalendarZone></StrictMode>);
    await act(async () => {});
    expect(calendarMonthRange().from).toBe("2026-10-01");
  });

  it("keeps the household zone when a new session's provider replaces the old one with cached data", async () => {
    household.current = { data: { household: { id: "h1", timeZone: "Africa/Lusaka" } } };
    const view = render(<HouseholdCalendarZone key="session-1"><MonthProbe /></HouseholdCalendarZone>);
    view.rerender(<HouseholdCalendarZone key="session-2"><MonthProbe /></HouseholdCalendarZone>);
    await act(async () => {});
    expect(calendarMonthRange().from).toBe("2026-10-01");
  });

  it("drops the household zone when the household session ends", () => {
    household.current = { data: { household: { id: "h1", timeZone: "Africa/Lusaka" } } };
    const view = render(<HouseholdCalendarZone><MonthProbe /></HouseholdCalendarZone>);
    view.unmount();
    expect(calendarMonthRange().from).toBe("2026-09-01");
  });
});
