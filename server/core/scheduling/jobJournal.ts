import { and, desc, eq, inArray, min } from "drizzle-orm";
import { jobs } from "@shared/schema";
import { db } from "../../db";

/**
 * Run journal for scheduled jobs, kept in the existing `jobs` table.
 *
 * Each run is one row named `scheduled:<job>`, written `running` when the job
 * starts and closed as `completed` or `failed` with a bounded error code. Rows
 * are never `pending`, so the generic job queue never picks them up. Health and
 * the admin job view read the last success from here.
 *
 * A row carries its scheduled period (OPS-013): `run_at` is the slot and
 * `idempotency_key` is `<job>@<slot>`. Runs of one job are serialised by its
 * advisory lock, so "has this period completed?" read under that lock is
 * race-free without a unique index. While a run holds its lock the heartbeat
 * renews `updated_at`, so a `running` row with an old `updated_at` is a run
 * that died without closing.
 */
export const SCHEDULED_RUN_PREFIX = "scheduled:";

export type JobSummary = Readonly<Record<string, number>>;

export interface JobRunFinish {
  readonly isOk: boolean;
  readonly errorCode: string | null;
  readonly summary: JobSummary | null;
}

export interface ScheduledPeriod {
  readonly identity: string;
  readonly scheduledFor: Date;
}

export interface ScheduledJobStatus {
  readonly jobName: string;
  readonly lastStartedAt: string | null;
  readonly lastStatus: string | null;
  readonly lastErrorCode: string | null;
  readonly lastSuccessAt: string | null;
}

const journalName = (jobName: string): string => `${SCHEDULED_RUN_PREFIX}${jobName}`;

export async function startJobRun(jobName: string, period: ScheduledPeriod): Promise<string> {
  const now = new Date();
  const [row] = await db.insert(jobs).values({
    name: journalName(jobName), status: "running", attempts: 1, maxAttempts: 1,
    runAt: period.scheduledFor, startedAt: now, idempotencyKey: period.identity,
    payload: { scheduledFor: period.scheduledFor.toISOString() },
  }).returning({ id: jobs.id });
  return row.id;
}

/** Heartbeat renewal of a run that still holds its lock. */
export async function renewJobRun(runId: string): Promise<void> {
  await db.update(jobs).set({ updatedAt: new Date() }).where(and(eq(jobs.id, runId), eq(jobs.status, "running")));
}

/** Whether this period already has a completed run. A failed run may be retried. */
export async function hasCompletedPeriod(jobName: string, identity: string): Promise<boolean> {
  const [row] = await db.select({ id: jobs.id }).from(jobs).where(and(
    eq(jobs.name, journalName(jobName)), eq(jobs.idempotencyKey, identity), eq(jobs.status, "completed"),
  )).limit(1);
  return row !== undefined;
}

export async function finishJobRun(runId: string, finish: JobRunFinish): Promise<void> {
  const now = new Date();
  await db.update(jobs).set({
    status: finish.isOk ? "completed" : "failed",
    completedAt: now,
    updatedAt: now,
    lastError: finish.errorCode,
    result: finish.summary ?? null,
  }).where(and(eq(jobs.id, runId), eq(jobs.status, "running")));
}

const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

/**
 * One row, written the first time any process starts the scheduler against
 * this database and never again, so readiness can measure never-run jobs from
 * a fact a restart cannot renew. It is `completed`, never `pending`, so the
 * generic job queue never picks it up, and its name is outside the
 * `scheduled:` prefix, so no job status reads it.
 */
export const SCHEDULER_START_MARKER = "scheduler:started";

// Process-local: whether this process's last attempt to record its start failed.
let hasStartRecordFailed = false;

/** Whether this process tried to record its scheduler start and could not. */
export function didSchedulerStartRecordFail(): boolean {
  return hasStartRecordFailed;
}

export async function recordSchedulerStart(at: Date = new Date()): Promise<void> {
  try {
    // Two instances starting together may both insert; the epoch is the earliest row, so that is harmless.
    const [existing] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.name, SCHEDULER_START_MARKER)).limit(1);
    if (!existing) {
      await db.insert(jobs).values({
        name: SCHEDULER_START_MARKER, status: "completed", attempts: 1, maxAttempts: 1, runAt: at, startedAt: at, completedAt: at,
      });
    }
    hasStartRecordFailed = false;
  } catch (error) {
    hasStartRecordFailed = true;
    throw error;
  }
}

/**
 * When the scheduler could first have run these jobs: the earlier of its first
 * recorded start and the journal's first run of any of them. Null when neither
 * exists.
 */
export async function scheduledJournalEpoch(jobNames: readonly string[]): Promise<Date | null> {
  const names = [SCHEDULER_START_MARKER, ...jobNames.map(journalName)];
  const [row] = await db.select({ first: min(jobs.startedAt) }).from(jobs).where(inArray(jobs.name, names));
  return row?.first ?? null;
}

/** Latest run and latest success per job; never-run jobs report nulls. */
export async function listScheduledJobStatus(jobNames: readonly string[]): Promise<ScheduledJobStatus[]> {
  if (jobNames.length === 0) return [];
  const names = jobNames.map(journalName);
  const latest = await db.selectDistinctOn([jobs.name], {
    name: jobs.name, status: jobs.status, lastError: jobs.lastError, startedAt: jobs.startedAt,
  }).from(jobs).where(inArray(jobs.name, names)).orderBy(jobs.name, desc(jobs.startedAt));
  const succeeded = await db.selectDistinctOn([jobs.name], { name: jobs.name, completedAt: jobs.completedAt })
    .from(jobs).where(and(inArray(jobs.name, names), eq(jobs.status, "completed")))
    .orderBy(jobs.name, desc(jobs.completedAt));
  return jobNames.map((jobName) => {
    const run = latest.find((row) => row.name === journalName(jobName));
    const success = succeeded.find((row) => row.name === journalName(jobName));
    return {
      jobName,
      lastStartedAt: iso(run?.startedAt),
      lastStatus: run?.status ?? null,
      lastErrorCode: run?.lastError ?? null,
      lastSuccessAt: iso(success?.completedAt),
    };
  });
}
