/**
 * Calculation Engine - Date Utilities
 *
 * Date calculation helpers for financial calculations.
 *
 * @module core/calculations/dates
 */

/**
 * Period type for date calculations.
 */
export type PeriodType = "day" | "week" | "month" | "quarter" | "year";

/**
 * Date range type.
 */
export interface DateRange {
  start: string;
  end: string;
}

/**
 * Gets the start and end dates for a period.
 *
 * @param period - Period type
 * @param referenceDate - Reference date (default today)
 * @returns Start and end dates as ISO strings
 */
export function getPeriodDates(
  period: PeriodType,
  referenceDate: Date = new Date()
): DateRange {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const date = referenceDate.getDate();
  const dayOfWeek = referenceDate.getDay();

  let start: Date;
  let end: Date;

  switch (period) {
    case "day":
      start = new Date(year, month, date);
      end = new Date(year, month, date);
      break;

    case "week":
      // Week starts on Monday
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      start = new Date(year, month, date + mondayOffset);
      end = new Date(start);
      end.setDate(end.getDate() + 6);
      break;

    case "month":
      start = new Date(year, month, 1);
      end = new Date(year, month + 1, 0);
      break;

    case "quarter":
      const quarterStart = Math.floor(month / 3) * 3;
      start = new Date(year, quarterStart, 1);
      end = new Date(year, quarterStart + 3, 0);
      break;

    case "year":
      start = new Date(year, 0, 1);
      end = new Date(year, 11, 31);
      break;

    default:
      start = referenceDate;
      end = referenceDate;
  }

  return {
    start: formatDate(start),
    end: formatDate(end),
  };
}

/**
 * Gets the previous period's date range.
 */
export function getPreviousPeriodDates(
  period: PeriodType,
  referenceDate: Date = new Date()
): DateRange {
  const current = getPeriodDates(period, referenceDate);
  const startDate = new Date(current.start);

  switch (period) {
    case "day":
      startDate.setDate(startDate.getDate() - 1);
      break;
    case "week":
      startDate.setDate(startDate.getDate() - 7);
      break;
    case "month":
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case "quarter":
      startDate.setMonth(startDate.getMonth() - 3);
      break;
    case "year":
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
  }

  return getPeriodDates(period, startDate);
}

/**
 * Calculates days between two dates.
 */
export function daysBetween(start: string | Date, end: string | Date): number {
  const startDate = typeof start === "string" ? new Date(start) : start;
  const endDate = typeof end === "string" ? new Date(end) : end;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((endDate.getTime() - startDate.getTime()) / msPerDay);
}

/**
 * Calculates months between two dates.
 */
export function monthsBetween(
  start: string | Date,
  end: string | Date
): number {
  const startDate = typeof start === "string" ? new Date(start) : start;
  const endDate = typeof end === "string" ? new Date(end) : end;

  const yearDiff = endDate.getFullYear() - startDate.getFullYear();
  const monthDiff = endDate.getMonth() - startDate.getMonth();

  return yearDiff * 12 + monthDiff;
}

/**
 * Formats a date to ISO date string (YYYY-MM-DD) in local timezone.
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parses a date string to Date object in local timezone.
 */
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Gets start of month for a date.
 */
export function startOfMonth(date: Date | string): string {
  const d = typeof date === "string" ? parseLocalDate(date) : date;
  return formatDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

/**
 * Gets end of month for a date.
 */
export function endOfMonth(date: Date | string): string {
  const d = typeof date === "string" ? parseLocalDate(date) : date;
  return formatDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/**
 * Adds months to a date.
 */
export function addMonths(date: Date | string, months: number): string {
  const d = typeof date === "string" ? parseLocalDate(date) : new Date(date);
  d.setMonth(d.getMonth() + months);
  return formatDate(d);
}
