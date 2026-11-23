/**
 * Goal milestone forecasts in real calendar months (NEW-15).
 *
 * A forecast of "n months away" used to become `n * 30` days. It now counts
 * the household calendar: whole months land on the same day-of-month (clamped
 * to the month's last day), and a part month is that share of the month it
 * falls in. Dates are "YYYY-MM-DD" calendar dates, never instants.
 *
 * @module services/goal/goalCalendarDays
 */

const MS_PER_DAY = 86_400_000;
/** Absorbs float noise in a ratio such as 2.9999999999 months before rounding a part month up. */
const PART_MONTH_EPSILON = 1e-9;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(date: string): [number, number, number] {
  const match = CALENDAR_DATE.exec(date);
  if (!match) throw new Error("Calendar date must be YYYY-MM-DD");
  return [Number.parseInt(match[1], 10), Number.parseInt(match[2], 10), Number.parseInt(match[3], 10)];
}

/** Epoch day of a calendar date: whole days only, no zone. */
function epochDay(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

/** The epoch day `months` calendar months after `date`, clamped to the target month's last day. */
function epochDayAfterMonths(date: string, months: number): number {
  const [year, month, day] = parts(date);
  const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
  return epochDay(year, month + months, Math.min(day, lastDay));
}

/** The calendar date `months` whole months after `date`, clamped to that month's last day (31 Jan + 1 = 28 or 29 Feb). */
export function addCalendarMonths(date: string, months: number): string {
  return new Date(epochDayAfterMonths(date, months) * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Whole calendar months from `from` to `to`: the most months that can be
 * added to `from` without passing `to`. Negative when `to` is earlier.
 */
export function wholeCalendarMonthsBetween(from: string, to: string): number {
  if (to < from) return -wholeCalendarMonthsBetween(to, from);
  const [fromYear, fromMonth] = parts(from);
  const [toYear, toMonth] = parts(to);
  const months = (toYear - fromYear) * 12 + (toMonth - fromMonth);
  return addCalendarMonths(from, months) <= to ? months : months - 1;
}

/** Calendar days from `today` until `months` (may be fractional) calendar months later, rounded up. */
export function calendarDaysForMonths(today: string, months: number): number {
  if (!Number.isFinite(months) || months <= 0) return 0;
  const [year, month, day] = parts(today);
  const start = epochDay(year, month, day);
  const whole = Math.floor(months + PART_MONTH_EPSILON);
  const fraction = Math.max(0, months - whole);
  const wholeEnd = epochDayAfterMonths(today, whole);
  const monthLength = epochDayAfterMonths(today, whole + 1) - wholeEnd;
  return wholeEnd - start + Math.ceil(fraction * monthLength - PART_MONTH_EPSILON);
}
