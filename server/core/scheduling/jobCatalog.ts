/**
 * The schedule of every job the in-process scheduler runs (OPS-003), without
 * the job code, so readiness can judge freshness without importing every
 * service. Times are UTC (Lusaka is UTC+2). The spec asks only for daily runs,
 * so the order is what matters: FX first, then the money movements, then the
 * snapshot that reads them. The stale-price check uses the A-57 custody guard
 * before delivery. Hold market.price-refresh until it validates quotes, and
 * market.price-alerts until it checks the recipient's custody (R6-03).
 * goals.status is held because it writes goal amounts read outside a transaction.
 * Names match the durable catalog
 * (server/core/jobs/durable/catalog.ts), except cleanup.merchant-logos,
 * cleanup.personal-exports and security.mfa-reminders, which postdate that frozen R14 list. Lock keys are fixed forever: changing
 * one lets an old and a new instance run the same job. `intervalMs` is the gap
 * between two scheduled runs; readiness calls a job stale past twice that.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export interface ScheduledJobSpec {
  readonly name: string;
  /** Five-field cron expression, evaluated in UTC. */
  readonly cron: string;
  /** Fixed advisory-lock key, unique per job. */
  readonly lockKey: number;
  readonly intervalMs: number;
}

export const SCHEDULED_JOB_SPECS = Object.freeze([
  { name: "market.fx-refresh", cron: "30 0 * * *", lockKey: 101, intervalMs: DAY_MS },
  // Lock keys 112 and 113 remain reserved for the held market jobs.
  { name: "market.stale-price-alerts", cron: "55 0 * * *", lockKey: 118, intervalMs: DAY_MS },
  { name: "recurring.materialize", cron: "0 1 * * *", lockKey: 102, intervalMs: DAY_MS },
  { name: "investments.tbill-maturity", cron: "15 1 * * *", lockKey: 103, intervalMs: DAY_MS },
  { name: "investments.recurring-purchase", cron: "30 1 * * *", lockKey: 104, intervalMs: DAY_MS },
  { name: "budget.rollover", cron: "45 1 * * *", lockKey: 105, intervalMs: DAY_MS },
  { name: "cleanup.notifications", cron: "0 2 * * *", lockKey: 106, intervalMs: DAY_MS },
  { name: "cleanup.merchant-logos", cron: "15 2 * * *", lockKey: 110, intervalMs: DAY_MS },
  { name: "cleanup.personal-exports", cron: "30 2 * * *", lockKey: 111, intervalMs: DAY_MS },
  { name: "snapshots.daily", cron: "0 3 * * *", lockKey: 107, intervalMs: DAY_MS },
  { name: "recurring.remind", cron: "0 6 * * *", lockKey: 114, intervalMs: DAY_MS },
  { name: "goals.deadlines", cron: "15 6 * * *", lockKey: 115, intervalMs: DAY_MS },
  { name: "budget.alerts", cron: "30 6 * * *", lockKey: 116, intervalMs: DAY_MS },
  { name: "security.daily-report", cron: "0 8 * * *", lockKey: 108, intervalMs: DAY_MS },
  // AH-11: e-mails members without MFA 7 days and 1 day before their grace ends. No cron door.
  { name: "security.mfa-reminders", cron: "45 8 * * *", lockKey: 119, intervalMs: DAY_MS },
  // OPS-007: daily; each user is sent on their own chosen day, by household time.
  { name: "recap.weekly", cron: "0 9 * * *", lockKey: 109, intervalMs: DAY_MS },
  { name: "goals.weekly-report", cron: "30 9 * * 1", lockKey: 117, intervalMs: WEEK_MS },
] as const satisfies readonly ScheduledJobSpec[]);

export type ScheduledJobName = (typeof SCHEDULED_JOB_SPECS)[number]["name"];

/**
 * Jobs whose incomplete period is retried within a window, in days from the
 * slot's UTC date: until UTC midnight after a daily slot, or the Monday after
 * the weekly slot. Their work for a slot never runs past it.
 */
const RECOVERY_WINDOW_DAYS: Readonly<Record<string, number>> = Object.freeze({
  "snapshots.daily": 1,
  "recurring.remind": 1,
  "goals.deadlines": 1,
  // Safe to re-run: the delivery ledger sends each reminder once and retries only a definite rejection.
  "security.mfa-reminders": 1,
  "goals.weekly-report": 7,
} satisfies Partial<Record<ScheduledJobName, number>>);

/** The job's recovery window in days, or undefined for a job that has none. */
export function recoveryWindowDays(jobName: string): number | undefined {
  return Object.hasOwn(RECOVERY_WINDOW_DAYS, jobName) ? RECOVERY_WINDOW_DAYS[jobName] : undefined;
}
