/**
 * Calculation Engine - Recurring Dates
 *
 * Logic for calculating next occurrence dates based on frequency.
 */

import type { Frequency, RecurrenceOptions } from "./types";

/**
 * Calculates the next occurrence date for a recurring rule.
 *
 * @param currentDate - The reference date (e.g., last occurrence or current due date)
 * @param frequency - Recurrence frequency
 * @param options - Additional options for custom/specific scheduling
 * @returns Next occurrence date as ISO string (YYYY-MM-DD)
 */
export function calculateNextDate(
  currentDate: string,
  frequency: Frequency,
  options?: RecurrenceOptions
): string {
  // A due date names a calendar day. UTC arithmetic keeps the host timezone out of it.
  const date = new Date(currentDate);
  const intervalValue = Math.max(options?.intervalValue ?? 1, 1);

  switch (frequency) {
    case "daily":
      date.setUTCDate(date.getUTCDate() + 1);
      break;

    case "weekly":
      date.setUTCDate(date.getUTCDate() + 7);
      if (options?.dayOfWeek !== undefined && options.dayOfWeek !== null) {
        const delta = (options.dayOfWeek - date.getUTCDay() + 7) % 7;
        date.setUTCDate(date.getUTCDate() + delta);
      }
      break;

    case "biweekly":
      date.setUTCDate(date.getUTCDate() + 14);
      if (options?.dayOfWeek !== undefined && options.dayOfWeek !== null) {
        const delta = (options.dayOfWeek - date.getUTCDay() + 7) % 7;
        date.setUTCDate(date.getUTCDate() + delta);
      }
      break;

    case "monthly":
      applyMonthJump(date, 1, options?.dayOfMonth);
      break;

    case "quarterly":
      applyMonthJump(date, 3, options?.dayOfMonth);
      break;

    case "semi_annually":
      applyMonthJump(date, 6, options?.dayOfMonth);
      break;

    case "annually":
    case "yearly":
      applyYearJump(date, 1, options?.dayOfMonth);
      break;

    case "custom":
      switch (options?.intervalUnit) {
        case "days":
          date.setUTCDate(date.getUTCDate() + intervalValue);
          break;
        case "weeks":
          date.setUTCDate(date.getUTCDate() + intervalValue * 7);
          if (options?.dayOfWeek !== undefined && options.dayOfWeek !== null) {
            const delta = (options.dayOfWeek - date.getUTCDay() + 7) % 7;
            date.setUTCDate(date.getUTCDate() + delta);
          }
          break;
        case "months":
          applyMonthJump(date, intervalValue, options?.dayOfMonth);
          break;
        case "years":
          applyYearJump(date, intervalValue, options?.dayOfMonth);
          break;
        default:
          applyMonthJump(date, 1, options?.dayOfMonth);
      }
      break;

    default:
      // Default to monthly if unknown
      applyMonthJump(date, 1, options?.dayOfMonth);
  }

  return date.toISOString().split("T")[0];
}

function applyMonthJump(date: Date, months: number, dayOfMonth?: number) {
  const targetDay = dayOfMonth ?? date.getUTCDate();
  // Day zero of the following month is the last valid day of the target month.
  date.setUTCMonth(date.getUTCMonth() + months + 1, 0);
  date.setUTCDate(Math.min(targetDay, date.getUTCDate()));
}

function applyYearJump(date: Date, years: number, dayOfMonth?: number) {
  const targetDay = dayOfMonth ?? date.getUTCDate();
  date.setUTCFullYear(date.getUTCFullYear() + years, date.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(targetDay, date.getUTCDate()));
}
