/**
 * Calendar-date helpers for the profile birthday.
 *
 * users.birthday is a Postgres `date`, sent and returned as "YYYY-MM-DD". The
 * picker produces a local-midnight Date. Going through toISOString() turns
 * that into the previous day in UTC+ zones (Lusaka), and `new Date("YYYY-MM-DD")`
 * is UTC midnight, which shows the previous day in UTC- zones. Both helpers
 * stay in local calendar fields so the picked day is the stored day.
 */

const DATE_ONLY_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/** Local calendar day of `date` as "YYYY-MM-DD". */
export function formatLocalDate(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "YYYY-MM-DD" (or a string starting with it) as local midnight of that day. */
export function parseLocalDate(value: string): Date | null {
  const match = DATE_ONLY_PREFIX.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
  return Number.isNaN(date.getTime()) ? null : date;
}
