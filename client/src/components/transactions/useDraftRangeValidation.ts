import { differenceInDays } from "date-fns";
import { calendarTodayAsLocalDate, useCalendarTimeZone } from "@/lib/calendarZone";

export interface DraftRange {
  startDate: Date | undefined;
  endDate: Date | undefined;
}

/** Which draft dates came from the calendar (presets may end later this month or year). */
export interface PickedFields {
  start: boolean;
  end: boolean;
}

export interface DraftRangeValidation {
  valid: boolean;
  error: string | null;
}

export const NONE_PICKED: PickedFields = { start: false, end: false };
const MAX_RANGE_DAYS = 730;
const VALID: DraftRangeValidation = { valid: true, error: null };

/**
 * NEW-15: a day picked from the calendar must not be after the calendar zone's
 * today. Checked at every render, so a day picked before the household zone
 * loaded is refused once that zone makes it a future day.
 */
export function validateDraftRange(draft: DraftRange, picked: PickedFields): DraftRangeValidation {
  const { startDate, endDate } = draft;
  const today = calendarTodayAsLocalDate();
  const isFuture = (date: Date | undefined, wasPicked: boolean) => wasPicked && !!date && date > today;
  if (isFuture(startDate, picked.start) || isFuture(endDate, picked.end)) {
    return { valid: false, error: "Dates after today cannot be selected" };
  }
  if (!startDate || !endDate) return VALID;
  if (startDate > endDate) return { valid: false, error: "Start date must be before end date" };
  if (differenceInDays(endDate, startDate) > MAX_RANGE_DAYS) {
    return { valid: false, error: "Date range cannot exceed 730 days (2 years)" };
  }
  return VALID;
}

/** Re-validates when the calendar zone changes, as well as on every draft change. */
export function useDraftRangeValidation(draft: DraftRange, picked: PickedFields): DraftRangeValidation {
  useCalendarTimeZone();
  return validateDraftRange(draft, picked);
}
