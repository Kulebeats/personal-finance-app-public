/**
 * Client Date Utilities
 *
 * Centralized date parsing, formatting, and manipulation for the client.
 * Uses date-fns for all operations.
 * Per spec: ENTERPRISE REFACTORING SPECIFICATION.md - "Date Utilities (B6)"
 *
 * @module lib/dates
 */

import {
  format,
  parse,
  parseISO,
  isValid,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  subDays,
  subMonths,
  subYears,
  differenceInDays,
  addDays,
} from "date-fns";

// ============================================
// PARSING
// ============================================

/**
 * Parse a date string from API (ISO format)
 * @param dateStr ISO date string (e.g., "2026-01-11T00:00:00Z")
 * @returns Date object or null if invalid
 */
export function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;

  try {
    const date = parseISO(dateStr);
    return isValid(date) ? date : null;
  } catch {
    return null;
  }
}

/**
 * Parse a date with a specific format
 */
export function parseDateWithFormat(
  dateStr: string,
  formatStr: string
): Date | null {
  try {
    const date = parse(dateStr, formatStr, new Date());
    return isValid(date) ? date : null;
  } catch {
    return null;
  }
}

/**
 * Check if a value is a valid date
 */
export function isValidDate(date: unknown): date is Date {
  return date instanceof Date && isValid(date);
}

// ============================================
// FORMATTING
// ============================================

/**
 * Format date for display (e.g., "Jan 11, 2026")
 */
export function formatDisplayDate(date: Date | string): string {
  const d = typeof date === "string" ? parseDate(date) : date;
  if (!d) return "";
  return format(d, "MMM d, yyyy");
}

/**
 * Format date for short display (e.g., "Jan 11")
 */
export function formatShortDate(date: Date | string): string {
  const d = typeof date === "string" ? parseDate(date) : date;
  if (!d) return "";
  return format(d, "MMM d");
}

/**
 * Format date for API requests (ISO 8601)
 */
export function formatISODate(date: Date): string {
  return date.toISOString();
}

/**
 * Format date for URL params (YYYY-MM-DD)
 */
export function formatDateParam(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/**
 * Format relative date (e.g., "Today", "Yesterday", "3 days ago")
 */
export function formatRelativeDate(date: Date | string): string {
  const d = typeof date === "string" ? parseDate(date) : date;
  if (!d) return "";

  const now = new Date();
  const daysDiff = differenceInDays(startOfDay(now), startOfDay(d));

  if (daysDiff === 0) return "Today";
  if (daysDiff === 1) return "Yesterday";
  if (daysDiff < 0) {
    // Future dates
    if (daysDiff === -1) return "Tomorrow";
    return `In ${Math.abs(daysDiff)} days`;
  }
  if (daysDiff < 7) return `${daysDiff} days ago`;
  if (daysDiff < 30) return `${Math.floor(daysDiff / 7)} weeks ago`;
  if (daysDiff < 365) return `${Math.floor(daysDiff / 30)} months ago`;
  return `${Math.floor(daysDiff / 365)} years ago`;
}

/**
 * Format date for month display (e.g., "January 2026")
 */
export function formatMonthYear(date: Date | string): string {
  const d = typeof date === "string" ? parseDate(date) : date;
  if (!d) return "";
  return format(d, "MMMM yyyy");
}

// ============================================
// DATE RANGES
// ============================================

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export type DateRangeName =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "last30Days"
  | "last90Days"
  | "thisYear"
  | "lastYear"
  | "allTime";

/**
 * Get predefined date range
 */
export function getDateRange(range: DateRangeName): DateRange {
  const now = new Date();

  switch (range) {
    case "today":
      return { startDate: startOfDay(now), endDate: endOfDay(now) };
    case "yesterday":
      return {
        startDate: startOfDay(subDays(now, 1)),
        endDate: endOfDay(subDays(now, 1)),
      };
    case "thisWeek":
      return { startDate: startOfWeek(now), endDate: endOfDay(now) };
    case "lastWeek":
      return {
        startDate: startOfWeek(subDays(now, 7)),
        endDate: endOfWeek(subDays(now, 7)),
      };
    case "thisMonth":
      return { startDate: startOfMonth(now), endDate: endOfDay(now) };
    case "lastMonth":
      return {
        startDate: startOfMonth(subMonths(now, 1)),
        endDate: endOfMonth(subMonths(now, 1)),
      };
    case "last30Days":
      return { startDate: subDays(now, 30), endDate: endOfDay(now) };
    case "last90Days":
      return { startDate: subDays(now, 90), endDate: endOfDay(now) };
    case "thisYear":
      return { startDate: startOfYear(now), endDate: endOfDay(now) };
    case "lastYear":
      return {
        startDate: startOfYear(subYears(now, 1)),
        endDate: endOfYear(subYears(now, 1)),
      };
    case "allTime":
      return { startDate: new Date(2000, 0, 1), endDate: endOfDay(now) };
  }
}

/**
 * Format a date range for display
 */
export function formatDateRange(range: DateRange): string {
  return `${formatDisplayDate(range.startDate)} - ${formatDisplayDate(
    range.endDate
  )}`;
}

// ============================================
// UTILITIES
// ============================================

/**
 * Get array of dates between start and end
 */
export function getDatesBetween(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  let current = startOfDay(start);
  const endDate = startOfDay(end);

  while (current <= endDate) {
    dates.push(current);
    current = addDays(current, 1);
  }

  return dates;
}

/**
 * Check if two dates are the same day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return startOfDay(date1).getTime() === startOfDay(date2).getTime();
}

/**
 * Get start of current financial year (configurable - defaults to Jan 1)
 */
export function getFinancialYearStart(referenceDate = new Date()): Date {
  // Most common: Jan 1 - Dec 31
  // Can be modified for different financial year starts (e.g., Apr 1 for UK)
  return startOfYear(referenceDate);
}
