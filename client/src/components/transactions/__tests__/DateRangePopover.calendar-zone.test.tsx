/**
 * @vitest-environment jsdom
 *
 * NEW-15: the date picker's "no future dates" cutoff is the household's
 * today, not the browser clock.
 *
 * Runs in the client-tz-new-york project. At 2026-09-30T22:30Z it is 18:30 on
 * 30 September in New York but already 1 October in Lusaka.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCalendarTimeZone, setHouseholdCalendarTimeZone } from "@/lib/calendarZone";
import { DateRangePopover } from "../DateRangePopover";

const calendarProps = vi.hoisted(() => ({
  disabled: undefined as undefined | ((date: Date) => boolean),
  onSelect: undefined as undefined | ((date: Date | undefined) => void),
  // Like the real day picker, which works out each day's disabled state as it renders.
  october1DisabledAtRender: undefined as undefined | boolean,
}));
vi.mock("@/components/ui/calendar", () => ({
  Calendar: (props: { disabled?: (date: Date) => boolean; onSelect?: (date: Date | undefined) => void }) => {
    calendarProps.disabled = props.disabled;
    calendarProps.onSelect = props.onSelect;
    calendarProps.october1DisabledAtRender = props.disabled?.(new Date(2026, 9, 1));
    return <div data-testid="calendar" />;
  },
}));

/** The local-midnight Date the picker passes for a calendar day. */
const pickerDay = (year: number, month: number, day: number) => new Date(year, month - 1, day);

describe("DateRangePopover future-date cutoff", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T22:30:00Z"));
    calendarProps.disabled = undefined;
    calendarProps.october1DisabledAtRender = undefined;
  });

  afterEach(() => {
    cleanup();
    setHouseholdCalendarTimeZone(null);
    setCalendarTimeZone(null);
    vi.useRealTimers();
  });

  it("allows the household's today and disables the day after it", () => {
    setHouseholdCalendarTimeZone("Africa/Lusaka");
    render(<DateRangePopover value={{ startDate: undefined, endDate: undefined }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /date/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /MM\/DD\/YYYY/ })[0]);

    expect(screen.getByTestId("calendar")).toBeTruthy();
    const disabled = calendarProps.disabled!;
    expect(disabled(pickerDay(2026, 9, 30))).toBe(false);
    expect(disabled(pickerDay(2026, 10, 1))).toBe(false);
    expect(disabled(pickerDay(2026, 10, 2))).toBe(true);
  });

  it("an open picker moves its cutoff when the household zone arrives", async () => {
    render(<DateRangePopover value={{ startDate: undefined, endDate: undefined }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /date/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /MM\/DD\/YYYY/ })[0]);
    // Browser zone (New York): 1 October has not started yet.
    expect(calendarProps.october1DisabledAtRender).toBe(true);

    await act(async () => { setHouseholdCalendarTimeZone("Africa/Lusaka"); });

    expect(calendarProps.october1DisabledAtRender).toBe(false);
  });

  it("a day picked before the household zone loads cannot be applied once that zone makes it future", async () => {
    // The display zone (Lusaka) says today is 1 October; the household is in New York, where it is still 30 September.
    setCalendarTimeZone("Africa/Lusaka");
    const onChange = vi.fn();
    render(<DateRangePopover value={{ startDate: undefined, endDate: undefined }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /date/i }));
    // Start, then end: once a field shows its date, the other is the only empty one.
    for (let pick = 0; pick < 2; pick++) {
      fireEvent.click(screen.getAllByRole("button", { name: /MM\/DD\/YYYY/ })[0]);
      act(() => { calendarProps.onSelect!(pickerDay(2026, 10, 1)); });
    }
    expect(screen.getByRole("button", { name: "Apply" }).hasAttribute("disabled")).toBe(false);

    await act(async () => { setHouseholdCalendarTimeZone("America/New_York"); });

    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply.hasAttribute("disabled")).toBe(true);
    fireEvent.click(apply);
    expect(onChange).not.toHaveBeenCalled();
  });
});
