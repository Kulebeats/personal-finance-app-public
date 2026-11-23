/**
 * The scheduled slot a run belongs to (OPS-013).
 *
 * A run is identified by the slot it was scheduled for, never by the moment it
 * happened to start: a tick that fires late, or a second instance whose tick
 * was delayed, still names the same period, so the journal can tell "this
 * period already ran" from "this is the next period". Only the shapes the
 * catalog uses are supported — a fixed UTC minute and hour, daily or on one
 * weekday — so the slot is computed exactly instead of guessed. Any other
 * expression is refused with UNSUPPORTED_SCHEDULE.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;
const MAX_MINUTE = 59;
const MAX_HOUR = 23;
const MAX_WEEKDAY = 6;
const NUMBER = /^\d{1,2}$/;

interface SlotShape {
  readonly minute: number;
  readonly hour: number;
  /** 0 (Sunday) to 6, or null for every day. */
  readonly weekday: number | null;
}

function unsupported(): never {
  throw new Error("UNSUPPORTED_SCHEDULE");
}

function bounded(field: string, max: number): number {
  if (!NUMBER.test(field)) return unsupported();
  const value = Number.parseInt(field, 10);
  return value <= max ? value : unsupported();
}

function parseShape(cron: string): SlotShape {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return unsupported();
  const [minute, hour, dayOfMonth, month, weekday] = fields;
  if (dayOfMonth !== "*" || month !== "*") return unsupported();
  return {
    minute: bounded(minute, MAX_MINUTE),
    hour: bounded(hour, MAX_HOUR),
    weekday: weekday === "*" ? null : bounded(weekday, MAX_WEEKDAY),
  };
}

/** The latest slot of `cron` (evaluated in UTC) at or before `now`. */
export function scheduledSlotAtOrBefore(cron: string, now: Date): Date {
  const shape = parseShape(cron);
  const sameDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), shape.hour, shape.minute);
  let slot = sameDay <= now.getTime() ? sameDay : sameDay - DAY_MS;
  if (shape.weekday !== null) {
    const back = (new Date(slot).getUTCDay() - shape.weekday + DAYS_PER_WEEK) % DAYS_PER_WEEK;
    slot -= back * DAY_MS;
  }
  return new Date(slot);
}

/** Durable identity of one scheduled period: the job and its slot. */
export function periodIdentity(jobName: string, slot: Date): string {
  return `${jobName}@${slot.toISOString()}`;
}

/** Recovery ends at UTC midnight on the day after the daily slot or the Monday after the weekly slot. */
export function isWithinScheduledWindow(slot: Date, now: Date, days: number): boolean {
  const end = Date.UTC(slot.getUTCFullYear(), slot.getUTCMonth(), slot.getUTCDate() + days);
  return now.getTime() >= slot.getTime() && now.getTime() < end;
}
