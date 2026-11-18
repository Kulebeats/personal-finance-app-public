/**
 * Calculation Engine - Recurring Dates
 *
 * Logic for calculating next occurrence dates based on frequency.
 */

import { formatDate } from "../dates";
import { Frequency, RecurrenceOptions } from "./types";

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
  const date = new Date(currentDate);
  const intervalValue = Math.max(options?.intervalValue ?? 1, 1);

  switch (frequency) {
    case "daily":
      date.setDate(date.getDate() + 1);
      break;

    case "weekly":
      date.setDate(date.getDate() + 7);
      if (options?.dayOfWeek !== undefined && options.dayOfWeek !== null) {
        const delta = (options.dayOfWeek - date.getDay() + 7) % 7;
        date.setDate(date.getDate() + delta);
      }
      break;

    case "biweekly":
      date.setDate(date.getDate() + 14);
      if (options?.dayOfWeek !== undefined && options.dayOfWeek !== null) {
        const delta = (options.dayOfWeek - date.getDay() + 7) % 7;
        date.setDate(date.getDate() + delta);
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
          date.setDate(date.getDate() + intervalValue);
          break;
        case "weeks":
          date.setDate(date.getDate() + intervalValue * 7);
          if (options?.dayOfWeek !== undefined && options.dayOfWeek !== null) {
            const delta = (options.dayOfWeek - date.getDay() + 7) % 7;
            date.setDate(date.getDate() + delta);
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

  return formatDate(date);
}

function applyMonthJump(date: Date, months: number, dayOfMonth?: number) {
  const targetDay = dayOfMonth ?? date.getDate();
  const targetMonth = date.getMonth() + months;
  date.setDate(1);
  date.setMonth(targetMonth);
  const daysInMonth = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0
  ).getDate();
  date.setDate(Math.min(targetDay, daysInMonth));
}

function applyYearJump(date: Date, years: number, dayOfMonth?: number) {
  const targetDay = dayOfMonth ?? date.getDate();
  const targetMonth = date.getMonth();
  date.setDate(1);
  date.setFullYear(date.getFullYear() + years, targetMonth, 1);
  const daysInMonth = new Date(
    date.getFullYear(),
    targetMonth + 1,
    0
  ).getDate();
  date.setDate(Math.min(targetDay, daysInMonth));
}
