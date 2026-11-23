/**
 * Cash-flow series buckets as calendar days (NEW-34, Astra 6.2).
 *
 * The SQL groups rows by `date_trunc(interval, date)`: the 1st of the month,
 * the Monday of the ISO week, or the day itself. The series must step through
 * exactly those keys, starting from the bucket that holds `from`, or a range
 * starting mid-month never matches a bucket. Keys are "YYYY-MM-DD" strings
 * stepped with UTC calendar arithmetic, so the server's own zone (and its
 * clock changes) cannot move a key to the day before.
 *
 * @module repositories/reports/cashflowBuckets
 */
import type { ReportsInterval } from "@shared/reports";

const DAY_MS = 86_400_000;
const DAYS_PER_WEEK = 7;

const utcDay = (key: string): Date => new Date(`${key}T00:00:00Z`);
const dayKey = (date: Date): string => date.toISOString().slice(0, 10);

/** The start of the bucket holding `day`, as `date_trunc` computes it. */
export function bucketStart(day: string, interval: ReportsInterval): string {
  const date = utcDay(day);
  if (interval === "month") return dayKey(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)));
  if (interval === "week") {
    const daysSinceMonday = (date.getUTCDay() + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK;
    return dayKey(new Date(date.getTime() - daysSinceMonday * DAY_MS));
  }
  return dayKey(date);
}

function nextBucket(key: string, interval: ReportsInterval): string {
  const date = utcDay(key);
  if (interval === "month") return dayKey(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)));
  return dayKey(new Date(date.getTime() + (interval === "week" ? DAYS_PER_WEEK : 1) * DAY_MS));
}

/** Every bucket start from the one holding `from` through the one holding `to`. */
export function bucketKeys(from: string, to: string, interval: ReportsInterval): string[] {
  const keys: string[] = [];
  for (let key = bucketStart(from, interval); key <= to; key = nextBucket(key, interval)) keys.push(key);
  return keys;
}

/** "Sep 2026" for a month, "Sep" otherwise, read from the calendar day itself. */
export function bucketLabel(key: string, interval: ReportsInterval): string {
  return utcDay(key).toLocaleDateString("en-US", {
    timeZone: "UTC", month: "short", year: interval === "month" ? "numeric" : undefined,
  });
}
