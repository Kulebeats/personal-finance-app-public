import { isCanonicalImportDate } from "./import-date";

export const LEGACY_HOUSEHOLD_CALENDAR_ZONE = "UTC";

/** Owner-selected household policy. This never reads a user's or host's zone. */
export function normalizeHouseholdTimeZone(input: unknown): string {
  if (typeof input !== "string" || input.length === 0 || input.length > 100
      || !/^[A-Za-z][A-Za-z0-9_./+-]*$/.test(input)
      || /^(?:UTC|GMT)[+-]/i.test(input)) {
    throw new Error("A supported named household time zone is required");
  }
  try {
    const normalized = new Intl.DateTimeFormat("en-US", { timeZone: input }).resolvedOptions().timeZone;
    if (!normalized || /^[+-]/.test(normalized)) throw new Error("Unsupported named zone");
    return normalized;
  } catch {
    throw new Error("A supported named household time zone is required");
  }
}

/** PostgreSQL support is checked separately before the server persists a zone. */
export function householdCalendarDate(instant: Date, timeZone: string): string {
  const zone = normalizeHouseholdTimeZone(timeZone);
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) throw new Error("Invalid calendar instant");
  const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    timeZone: zone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    era: "short",
  });
  const parts = formatter.formatToParts(instant);
  const year = parts.find(part => part.type === "year")?.value;
  const month = parts.find(part => part.type === "month")?.value;
  const day = parts.find(part => part.type === "day")?.value;
  const era = parts.find(part => part.type === "era")?.value;
  if (!year || !/^[0-9]{1,4}$/.test(year) || !month || !day || era !== "AD") {
    throw new Error("Invalid household calendar date");
  }
  const date = `${year.padStart(4, "0")}-${month}-${day}`;
  if (date.startsWith("0000-") || !isCanonicalImportDate(date)) throw new Error("Invalid household calendar date");
  return date;
}

export interface CalendarDateRange {
  from: string;
  to: string;
}

const MONTHS_PER_YEAR = 12;

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * First and last day of the calendar month that contains `instant` in
 * `timeZone`, moved by `offsetMonths` whole months (NEW-15: "this month" is
 * the zone's month, never the UTC or browser month).
 */
export function householdMonthRange(instant: Date, timeZone: string, offsetMonths = 0): CalendarDateRange {
  if (!Number.isInteger(offsetMonths)) throw new Error("Month offset must be a whole number");
  const [year, month] = householdCalendarDate(instant, timeZone).split("-").map((part) => Number.parseInt(part, 10));
  const monthIndex = year * MONTHS_PER_YEAR + (month - 1) + offsetMonths;
  const targetYear = Math.floor(monthIndex / MONTHS_PER_YEAR);
  const targetMonth = monthIndex - targetYear * MONTHS_PER_YEAR + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const prefix = `${pad(targetYear, 4)}-${pad(targetMonth, 2)}`;
  return { from: `${prefix}-01`, to: `${prefix}-${pad(lastDay, 2)}` };
}

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Moves a calendar date ("YYYY-MM-DD") by whole days in calendar arithmetic,
 * so "30 days before today" never depends on the clock's zone (NEW-15).
 */
export function shiftCalendarDate(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new Error("Day offset must be a whole number");
  const match = CALENDAR_DATE_PATTERN.exec(date);
  if (!match) throw new Error("Calendar date must be YYYY-MM-DD");
  const [year, month, day] = match.slice(1).map((part) => Number.parseInt(part, 10));
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1, 2)}-${pad(shifted.getUTCDate(), 2)}`;
}
