/**
 * Date Utilities for Budget and Transaction Calculations
 * BUDGET-TIME-001: Ensure consistent timezone handling
 *
 * All date strings in the system should be in YYYY-MM-DD format (date-only, no time component).
 * This ensures timezone-independent date comparisons for budgets and transactions.
 *
 * @module utils/dateUtils
 */

/**
 * Get the start date of a month in YYYY-MM-DD format
 * BUDGET-TIME-001: Uses date-only format to avoid timezone issues
 *
 * @param year - The year (e.g., 2026)
 * @param month - The month (1-12)
 * @returns Date string in YYYY-MM-DD format (e.g., "2026-01-01")
 */
export function getMonthStart(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/**
 * Get the end date of a month in YYYY-MM-DD format
 * BUDGET-TIME-001: Uses date-only format to avoid timezone issues
 *
 * @param year - The year (e.g., 2026)
 * @param month - The month (1-12)
 * @returns Date string in YYYY-MM-DD format (e.g., "2026-01-31")
 */
export function getMonthEnd(year: number, month: number): string {
  // Get last day of month using UTC to avoid timezone issues
  // new Date(year, month, 0) gets the last day of the previous month
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

/**
 * Parse a date string (YYYY-MM-DD) to year and month
 * BUDGET-TIME-001: Parses date-only strings without timezone conversion
 *
 * @param dateString - Date string in YYYY-MM-DD format
 * @returns Object with year and month
 */
export function parseMonthFromDate(dateString: string): { year: number; month: number } {
  const parts = dateString.split("-");
  if (parts.length !== 3) {
    throw new Error(`Invalid date format: ${dateString}. Expected YYYY-MM-DD`);
  }
  return {
    year: parseInt(parts[0], 10),
    month: parseInt(parts[1], 10),
  };
}

/**
 * Get current year and month in UTC
 * BUDGET-TIME-001: Uses UTC to ensure consistency across timezones
 *
 * @returns Object with current year and month
 */
export function getCurrentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1, // getUTCMonth() returns 0-11
  };
}

/**
 * Format a Date object to YYYY-MM-DD string in UTC
 * BUDGET-TIME-001: Formats dates in UTC to avoid timezone conversion
 *
 * @param date - The date to format
 * @returns Date string in YYYY-MM-DD format
 */
export function formatDateUTC(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Check if a date string is valid YYYY-MM-DD format
 * BUDGET-TIME-001: Validates date format for consistency
 *
 * @param dateString - Date string to validate
 * @returns true if valid, false otherwise
 */
export function isValidDateString(dateString: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return false;
  }

  const parts = dateString.split("-");
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  // Check month range
  if (month < 1 || month > 12) {
    return false;
  }

  // Check day range (basic validation)
  if (day < 1 || day > 31) {
    return false;
  }

  // Check if date is valid using Date object
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
