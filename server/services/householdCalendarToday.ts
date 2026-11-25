import { eq } from "drizzle-orm";
import { households } from "@shared/schema";
import { householdCalendarDate, LEGACY_HOUSEHOLD_CALENDAR_ZONE, normalizeHouseholdTimeZone } from "@shared/household-calendar";
import { HttpError } from "../core/errors";
import type { db } from "../db";

export class HouseholdCalendarUnavailable extends HttpError {
  readonly statusCode = 422;
  readonly code = "HOUSEHOLD_CALENDAR_UNAVAILABLE";
  constructor() { super("The household time zone is not a supported named zone. An owner can set it again."); }
}

/** The one instant source for household calendar dates; tests pin it, never the global Date. */
export const calendarClock = { now: (): Date => new Date() };

type CalendarReader = Pick<typeof db, "select">;

/** The household's calendar zone: its owner-chosen zone, else UTC for a legacy household. */
export async function householdCalendarZone(reader: CalendarReader, householdId: string): Promise<string> {
  const [row] = await reader.select({ timeZone: households.timeZone }).from(households).where(eq(households.id, householdId));
  return storedHouseholdCalendarZone(row?.timeZone);
}

export function storedHouseholdCalendarZone(timeZone: string | null | undefined): string {
  if (!timeZone) return LEGACY_HOUSEHOLD_CALENDAR_ZONE;
  try {
    return normalizeHouseholdTimeZone(timeZone);
  } catch {
    throw new HouseholdCalendarUnavailable();
  }
}

/** Today's date (YYYY-MM-DD) on the household's own calendar, never the host's or UTC's. */
export async function householdToday(reader: CalendarReader, householdId: string): Promise<string> {
  return householdCalendarDate(calendarClock.now(), await householdCalendarZone(reader, householdId));
}
