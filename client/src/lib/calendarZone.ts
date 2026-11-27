/**
 * The calendar zone that decides "today" and "this month" (NEW-15).
 *
 * HouseholdCalendarZone publishes the household's zone and SettingsProvider
 * the user's saved display zone; the household zone wins, so every member
 * counts the same month. Until either loads, and in tests rendered without
 * providers, the browser's zone is used. It is read as a plain value so range helpers stay callable
 * outside React and need no provider. Components that keep state seeded from
 * the zone subscribe with `useCalendarTimeZone` to re-render when it changes.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  householdCalendarDate,
  householdMonthRange,
  LEGACY_HOUSEHOLD_CALENDAR_ZONE,
  normalizeHouseholdTimeZone,
  shiftCalendarDate,
  type CalendarDateRange,
} from "@shared/household-calendar";

// Financial periods follow the household's zone when the owner has set one;
// otherwise the user's saved display zone, then the browser's.
let householdTimeZone: string | null = null;
let displayTimeZone: string | null = null;
const listeners = new Set<() => void>();
const monthListeners = new Set<() => void>();
const DAY_MS = 24 * 60 * 60 * 1000;
let monthTimer: ReturnType<typeof setTimeout> | undefined;

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function normalizedOrNull(zone: string | null | undefined): string | null {
  if (!zone) return null;
  try {
    return normalizeHouseholdTimeZone(zone);
  } catch {
    return null;
  }
}

export function getCalendarTimeZone(): string {
  return householdTimeZone ?? displayTimeZone ?? browserTimeZone();
}

function getHouseholdCalendarTimeZone(): string {
  return householdTimeZone ?? LEGACY_HOUSEHOLD_CALENDAR_ZONE;
}

/**
 * Applies one zone input; an unset or unsupported zone counts as unset.
 * Subscribers hear of a change in a microtask, because providers set the zone
 * while they render and React forbids updating another component then.
 */
function updateZone(apply: (zone: string | null) => void, zone: string | null | undefined): void {
  const before = getCalendarTimeZone();
  const householdBefore = getHouseholdCalendarTimeZone();
  apply(normalizedOrNull(zone));
  if (getCalendarTimeZone() === before && getHouseholdCalendarTimeZone() === householdBefore) return;
  queueMicrotask(() => {
    listeners.forEach(listener => listener());
    refreshCalendarMonth();
  });
}

/** The user's saved display zone, used when the household has no zone. */
export function setCalendarTimeZone(zone: string | null | undefined): void {
  updateZone((next) => { displayTimeZone = next; }, zone);
}

/** The household's zone (`households.time_zone`); it wins over the display zone. */
export function setHouseholdCalendarTimeZone(zone: string | null | undefined): void {
  updateZone((next) => { householdTimeZone = next; }, zone);
}

function subscribeCalendarTimeZone(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The calendar zone, re-rendering the caller when the saved zone arrives or changes. */
export function useCalendarTimeZone(): string {
  return useSyncExternalStore(subscribeCalendarTimeZone, getCalendarTimeZone, getCalendarTimeZone);
}

/** For readers that follow the server's UTC fallback for legacy households. */
export function useHouseholdCalendarTimeZone(): string {
  return useSyncExternalStore(subscribeCalendarTimeZone, getHouseholdCalendarTimeZone, getHouseholdCalendarTimeZone);
}

function monthAt(timestamp: number, zone: string): string {
  return householdCalendarDate(new Date(timestamp), zone).slice(0, 7);
}

function getCalendarMonth(): string {
  return monthAt(Date.now(), getCalendarTimeZone());
}

/** Check daily until the next month boundary is in range, then find its
 * first instant in the effective zone without assuming a fixed UTC offset. */
function monthCheckDelay(now: number, zone: string): number {
  const month = monthAt(now, zone);
  let first = now, last = now + DAY_MS;
  if (monthAt(last, zone) === month) return DAY_MS;
  while (last - first > 1) {
    const middle = first + Math.floor((last - first) / 2);
    if (monthAt(middle, zone) === month) first = middle;
    else last = middle;
  }
  return last - now;
}

function refreshCalendarMonth(): void {
  clearTimeout(monthTimer);
  monthTimer = undefined;
  if (!monthListeners.size) return;
  monthTimer = setTimeout(refreshCalendarMonth, monthCheckDelay(Date.now(), getCalendarTimeZone()));
  monthListeners.forEach(listener => listener());
}

function onCalendarVisible(): void {
  if (document.visibilityState === "visible") refreshCalendarMonth();
}

function subscribeCalendarMonth(listener: () => void): () => void {
  monthListeners.add(listener);
  if (monthListeners.size === 1) {
    window.addEventListener("focus", refreshCalendarMonth);
    document.addEventListener("visibilitychange", onCalendarVisible);
    refreshCalendarMonth();
  }
  return () => {
    monthListeners.delete(listener);
    if (!monthListeners.size) {
      window.removeEventListener("focus", refreshCalendarMonth);
      document.removeEventListener("visibilitychange", onCalendarVisible);
      refreshCalendarMonth();
    }
  };
}

/**
 * The calendar zone's current year and month (1-12), for screens that ask the
 * server for "this month" or "this year".
 */
export function useCalendarYearMonth(): { year: number; month: number } {
  const calendarMonth = useSyncExternalStore(subscribeCalendarMonth, getCalendarMonth, getCalendarMonth);
  return useMemo(() => {
    const [year, month] = calendarMonth.split("-").map(part => Number.parseInt(part, 10));
    return { year, month };
  }, [calendarMonth]);
}

/** Today's date ("YYYY-MM-DD") in the calendar zone. */
export function calendarToday(now: Date = new Date()): string {
  return householdCalendarDate(now, getCalendarTimeZone());
}

/** The calendar-zone date `days` days before today, in calendar-date arithmetic. */
export function calendarDaysAgo(days: number, now: Date = new Date()): string {
  return shiftCalendarDate(calendarToday(now), -days);
}

/** This calendar month in the calendar zone, moved by `offsetMonths`. */
export function calendarMonthRange(offsetMonths = 0, now: Date = new Date()): CalendarDateRange {
  return householdMonthRange(now, getCalendarTimeZone(), offsetMonths);
}

/**
 * Local-midnight Date for the calendar zone's today, for date pickers and
 * date-fns arithmetic, which work in the browser's local calendar.
 */
export function calendarTodayAsLocalDate(now: Date = new Date()): Date {
  return calendarDateAsLocalDate(calendarToday(now));
}

/** Local-midnight Date for a "YYYY-MM-DD" calendar date, for date pickers. */
export function calendarDateAsLocalDate(date: string): Date {
  const [year, month, day] = date.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(year, month - 1, day);
}

/**
 * Today in the household's zone, or UTC for a legacy household with none:
 * the day the server defaults and bounds financial writes by (NEW-15). Form
 * defaults use this, not `calendarToday`, whose display-zone fallback can run
 * a day ahead of the server.
 */
export function useHouseholdCalendarToday(): string {
  return householdCalendarDate(new Date(), useHouseholdCalendarTimeZone());
}

export interface HouseholdDateDefault {
  /** The form's date ("YYYY-MM-DD"). */
  date: string;
  /** The member chose a date: it is never overwritten until the next `reset`. */
  choose: (date: string) => void;
  /** The date is now part of a sent request: keep it, as if the member chose it. */
  hold: () => void;
  /** Back to today's household date, computed now (not on an earlier render). */
  reset: () => void;
}

/**
 * A form date that defaults to the household's today (NEW-15). The form calls
 * `reset` when it opens. While the member has not chosen a date, and nothing
 * has been sent with it, a household zone that arrives late moves it.
 */
export function useHouseholdDateDefault(): HouseholdDateDefault {
  const zone = useHouseholdCalendarTimeZone();
  const zoneRef = useRef(zone);
  zoneRef.current = zone;
  const [state, setState] = useState(() => ({ date: householdCalendarDate(new Date(), zone), touched: false }));
  useEffect(() => {
    const next = householdCalendarDate(new Date(), zone);
    setState(current => (current.touched || current.date === next ? current : { date: next, touched: false }));
  }, [zone]);
  const choose = useCallback((date: string) => setState({ date, touched: true }), []);
  const hold = useCallback(() => setState(current => (current.touched ? current : { ...current, touched: true })), []);
  const reset = useCallback(() => setState({ date: householdCalendarDate(new Date(), zoneRef.current), touched: false }), []);
  return useMemo(() => ({ date: state.date, choose, hold, reset }), [state.date, choose, hold, reset]);
}
