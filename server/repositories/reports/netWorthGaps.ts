/**
 * NEW-34: which months of a net-worth history have no snapshot.
 *
 * Snapshots are daily, so a month counts as recorded when any snapshot falls
 * in it. Dates are calendar strings ("YYYY-MM-DD"); the arithmetic is on UTC
 * month starts, so it never depends on the server's zone.
 */

/** "YYYY-MM" of a calendar date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

function monthStart(month: string): Date {
  return new Date(`${month}-01T00:00:00Z`);
}

/** Whole calendar months from `from`'s month to `to`'s month (0 within one month). */
export function monthsBetween(from: string, to: string): number {
  const start = monthStart(monthOf(from));
  const end = monthStart(monthOf(to));
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
}

/** Months from `from` through `through` (inclusive) in which no recorded date falls. */
export function missingMonths(from: string, through: string, recordedDates: readonly string[]): string[] {
  // A range that has not started yet has no month to miss (compared as days, not months).
  if (through < from) return [];
  const recorded = new Set(recordedDates.map(monthOf));
  const missing: string[] = [];
  const cursor = monthStart(monthOf(from));
  const last = monthOf(through);
  for (let month = monthOf(from); month <= last; month = cursor.toISOString().slice(0, 7)) {
    if (!recorded.has(month)) missing.push(month);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return missing;
}
