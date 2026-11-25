import { and, desc, eq, inArray, isNotNull, min } from "drizzle-orm";
import { jobs } from "@shared/schema";
import { db } from "../../db";
import { isPostgresError } from "../../utils/postgresError";
import { SCHEDULED_JOB_SPECS } from "./jobCatalog";
import { withTransaction } from "../../utils/withTransaction";

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
 * advisory lock. A run that loses its lock cannot be stopped, so the journal
 * fences it: a newer run of the period supersedes its row, and its late close
 * is rejected. Unique indexes (migration 0060) keep at most one running and one
 * completed row per period. While a run holds its lock the heartbeat renews
 * `updated_at`, so a `running` row with an old `updated_at` is a run that died
 * without closing.
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

/** A run whose period a newer run took over: its close is rejected (OPS-013 fencing). */
export const RUN_SUPERSEDED = "RUN_SUPERSEDED";
export const SCHEDULED_RUNNING_INDEX = "idx_jobs_scheduled_period_running";
const SCHEDULED_COMPLETED_INDEX = "idx_jobs_scheduled_period_completed";

export class RunSupersededError extends Error {
  readonly code = RUN_SUPERSEDED;

  constructor(readonly runId: string) {
    super("A newer run of this period took over; this run's result is not recorded");
    this.name = "RunSupersededError";
  }
}

const periodRows = (jobName: string, identity: string) =>
  and(eq(jobs.name, journalName(jobName)), eq(jobs.idempotencyKey, identity));

/**
 * Start a run of the period, or return null when the period already completed.
 * The caller holds the period's advisory locks, so a `running` row of this
 * period belongs to a run that lost them: it is closed as RUN_SUPERSEDED, and
 * its own late close is then rejected. The rows are locked first, so a close
 * racing this start either lands before it (and the period is done) or is
 * rejected after it.
 */
export async function startJobRun(jobName: string, period: ScheduledPeriod): Promise<string | null> {
  return withTransaction(async (tx) => {
    const open = await tx.select({ id: jobs.id, status: jobs.status }).from(jobs)
      .where(and(periodRows(jobName, period.identity), inArray(jobs.status, ["running", "completed"])))
      .for("update");
    if (open.some((row) => row.status === "completed")) return null;
    const now = new Date();
    if (open.length > 0) {
      await tx.update(jobs).set({ status: "failed", lastError: RUN_SUPERSEDED, completedAt: now, updatedAt: now })
        .where(inArray(jobs.id, open.map((row) => row.id)));
    }
    const [row] = await tx.insert(jobs).values({
      name: journalName(jobName), status: "running", attempts: 1, maxAttempts: 1,
      runAt: period.scheduledFor, startedAt: now, idempotencyKey: period.identity,
      payload: { scheduledFor: period.scheduledFor.toISOString() },
    }).returning({ id: jobs.id });
    return row.id;
  });
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

/** Close a running run; a run that is no longer `running` was superseded, and its close is rejected. */
export async function finishJobRun(runId: string, finish: JobRunFinish): Promise<void> {
  const now = new Date();
  const running = and(eq(jobs.id, runId), eq(jobs.status, "running"));
  try {
    const closed = await db.update(jobs).set({
      status: finish.isOk ? "completed" : "failed",
      completedAt: now,
      updatedAt: now,
      lastError: finish.errorCode,
      result: finish.summary ?? null,
    }).where(running).returning({ id: jobs.id });
    if (closed.length === 0) throw new RunSupersededError(runId);
  } catch (error) {
    if (!finish.isOk || !isPostgresError(error, "23505", SCHEDULED_COMPLETED_INDEX)) throw error;
    // The period already has a committed completion. Close only the obsolete
    // running row and keep the completed row and its outcome intact.
    await db.update(jobs).set({
      status: "failed", lastError: RUN_SUPERSEDED, completedAt: now, updatedAt: now,
    }).where(running);
    throw new RunSupersededError(runId);
  }
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

/**
 * One row per job, `scheduler:catalogued:<job>`, written the first time a
 * running scheduler has the job in its catalog. A job added after the
 * scheduler's first start is measured from here, not from that start, so a
 * deploy that adds a daily job does not read stale until its first slot.
 * Written once, so a restart never renews it.
 */
export const SCHEDULER_CATALOGUED_PREFIX = "scheduler:catalogued:";
const cataloguedName = (jobName: string): string => `${SCHEDULER_CATALOGUED_PREFIX}${jobName}`;

const markerRow = (name: string, at: Date): typeof jobs.$inferInsert =>
  ({ name, status: "completed", attempts: 1, maxAttempts: 1, runAt: at, startedAt: at, completedAt: at });

/** Record the jobs not yet catalogued. Two instances racing may both insert; the earliest row is read. */
export async function recordCataloguedJobs(jobNames: readonly string[], at: Date = new Date()): Promise<void> {
  if (jobNames.length === 0) return;
  const names = jobNames.map(cataloguedName);
  const existing = await db.select({ name: jobs.name }).from(jobs).where(inArray(jobs.name, names));
  const recorded = new Set(existing.map((row) => row.name));
  const missing = jobNames.filter((name) => !recorded.has(cataloguedName(name)));
  if (missing.length === 0) return;
  const attempts = await earliestStarts(missing.map(journalName));
  await db.insert(jobs).values(missing.map((name) => {
    const attempted = attempts.get(journalName(name));
    // Save the grace anchor in the retained marker before run retention can
    // remove the evidence. The marker's completion is still its record time.
    return { ...markerRow(cataloguedName(name), at), startedAt: attempted && attempted < at ? attempted : at };
  }));
}

async function earliestStarts(names: string[]) {
  const rows = await db.select({ name: jobs.name, first: min(jobs.startedAt) }).from(jobs)
    .where(inArray(jobs.name, names)).groupBy(jobs.name);
  return new Map(rows.map((row) => [row.name, row.first]));
}

/** Start of a catalogued job's grace period, including an earlier actual attempt. */
export async function cataloguedSince(jobNames: readonly string[]): Promise<ReadonlyMap<string, Date>> {
  if (jobNames.length === 0) return new Map();
  const names = jobNames.flatMap((name) => [cataloguedName(name), journalName(name)]);
  const firstByName = await earliestStarts(names);
  const since = new Map<string, Date>();
  for (const name of jobNames) {
    const catalogued = firstByName.get(cataloguedName(name));
    if (!catalogued) continue;
    const attempted = firstByName.get(journalName(name));
    since.set(name, attempted && attempted < catalogued ? attempted : catalogued);
  }
  return since;
}

export async function recordSchedulerStart(at: Date = new Date()): Promise<void> {
  try {
    // Two instances starting together may both insert; the epoch is the earliest row, so that is harmless.
    const [existing] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.name, SCHEDULER_START_MARKER)).limit(1);
    if (!existing) await db.insert(jobs).values(markerRow(SCHEDULER_START_MARKER, at));
    await recordCataloguedJobs(SCHEDULED_JOB_SPECS.map((spec) => spec.name), at);
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
    .from(jobs).where(and(inArray(jobs.name, names), eq(jobs.status, "completed"), isNotNull(jobs.completedAt)))
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
