/**
 * Weekly Recap Module - Recap weeks (R16.3, NEW-31)
 *
 * A recap week is exactly seven calendar dates of the household's own
 * calendar. Every window is plain YYYY-MM-DD arithmetic, never a host-clock
 * Date, so a server in another zone cannot shift or stretch a week.
 *
 * @module modules/weekly-recap/recap-week
 */

import { eq } from "drizzle-orm";
import { households, userDisplaySettings } from "@shared/schema";
import { householdCalendarDate, normalizeHouseholdTimeZone } from "@shared/household-calendar";
import { isCanonicalImportDate } from "@shared/import-date";
import { db } from "../../db";

export const RECAP_WEEK_DAYS = 7;
// Legacy households never chose a zone (no default or backfill); they keep the
// UTC calendar the scheduler has always used.
const UNSET_HOUSEHOLD_TIME_ZONE = "UTC";
const WEEKDAY_NUMBERS: Readonly<Record<string, number>> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};

export interface RecapWeek {
  from: string;
  to: string;
}

export interface RecapCalendar {
  /** Today's date in the household's time zone. */
  today: string;
  /** The user's first day of the week, 0 = Sunday. */
  firstDay: number;
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** 0 (Sunday) to 6 for a YYYY-MM-DD date. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** The seven dates beginning on `firstDay` that include `date`. */
export function weekContaining(date: string, firstDay: number): RecapWeek {
  const from = addDays(date, -((weekdayOf(date) - firstDay + RECAP_WEEK_DAYS) % RECAP_WEEK_DAYS));
  return { from, to: addDays(from, RECAP_WEEK_DAYS - 1) };
}

/** The last complete week beginning on `firstDay` before `today`. */
export function previousCompleteWeek(today: string, firstDay: number): RecapWeek {
  const current = weekContaining(today, firstDay);
  return { from: addDays(current.from, -RECAP_WEEK_DAYS), to: addDays(current.from, -1) };
}

/**
 * The seven household dates from `today` on: the window of a digest's upcoming
 * bills (A-26). It is not the spending week, which has already ended, and the
 * daily recurring job has moved its posted bills' next due dates past it.
 */
export function upcomingBillsWindow(today: string): RecapWeek {
  return { from: today, to: addDays(today, RECAP_WEEK_DAYS - 1) };
}

/** `count` consecutive weeks, newest first, the first one including `today`. */
export function recentWeeks(calendar: RecapCalendar, count: number): RecapWeek[] {
  const current = weekContaining(calendar.today, calendar.firstDay);
  return Array.from({ length: count }, (_, index) => ({
    from: addDays(current.from, -RECAP_WEEK_DAYS * index),
    to: addDays(current.to, -RECAP_WEEK_DAYS * index),
  }));
}

/** The week when both values are real dates spanning exactly seven of them. */
export function parseRecapWeek(from: unknown, to: unknown): RecapWeek | null {
  if (typeof from !== "string" || typeof to !== "string") return null;
  if (!isCanonicalImportDate(from) || !isCanonicalImportDate(to)) return null;
  return addDays(from, RECAP_WEEK_DAYS - 1) === to ? { from, to } : null;
}

export function recapTimeZone(stored: string | null | undefined): string {
  if (!stored) return UNSET_HOUSEHOLD_TIME_ZONE;
  try {
    return normalizeHouseholdTimeZone(stored);
  } catch {
    return UNSET_HOUSEHOLD_TIME_ZONE;
  }
}

export async function readHouseholdToday(householdId: string, now: Date = new Date()): Promise<string> {
  const [household] = await db.select({ timeZone: households.timeZone }).from(households)
    .where(eq(households.id, householdId));
  return householdCalendarDate(now, recapTimeZone(household?.timeZone));
}

export async function readRecapCalendar(householdId: string, userId: string): Promise<RecapCalendar> {
  const [display] = await db.select({ firstDayOfWeek: userDisplaySettings.firstDayOfWeek })
    .from(userDisplaySettings).where(eq(userDisplaySettings.userId, userId));
  return {
    today: await readHouseholdToday(householdId),
    firstDay: WEEKDAY_NUMBERS[display?.firstDayOfWeek ?? ""] ?? 0,
  };
}
