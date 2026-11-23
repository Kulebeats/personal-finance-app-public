import { logger } from "../../utils/logger";
import { withJobAdvisoryLock, type JobLease, type JobLockRequest, type LockOutcome, type LockSkipReason } from "./advisoryLock";
import {
  finishJobRun, hasCompletedPeriod, renewJobRun, RUN_SUPERSEDED, startJobRun, type JobRunFinish, type JobSummary, type ScheduledPeriod,
} from "./jobJournal";
import { periodIdentity, scheduledSlotAtOrBefore } from "./schedulePeriod";

export type { JobSummary } from "./jobJournal";
export { RUN_SUPERSEDED } from "./jobJournal";

/** A summary with `failed > 0` closes the run as failed with this code. */
export const PARTIAL_FAILURE = "PARTIAL_FAILURE";
/** The run's lock was lost while it worked; exclusivity was not guaranteed. */
export const LOCK_LOST = "LOCK_LOST";
/** The work ran, but the journal row could not be closed: its outcome is not recorded. */
export const JOB_OUTCOME_UNKNOWN = "JOB_OUTCOME_UNKNOWN";

/** Thrown when the work ran but closing its journal row failed; never retry it as "not started". */
export class JobOutcomeUnknownError extends Error {
  readonly code = JOB_OUTCOME_UNKNOWN;

  constructor(readonly jobName: string) {
    super(`Scheduled job ${jobName} ran, but its outcome could not be recorded`);
    this.name = "JobOutcomeUnknownError";
  }
}

export interface ScheduledRunOptions {
  /** Bounds the wait for the job lock (see JobLockRequest.maxWaitMs). */
  readonly jobLockWaitMs?: number;
}
const GENERIC_FAILURE = "JOB_FAILED";
const APP_ERROR_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const POSTGRES_ERROR_CODE = /^[0-9A-Z]{5}$/;

export interface ScheduledJobDefinition {
  readonly name: string;
  /** Five-field cron expression, evaluated in UTC. */
  readonly cron: string;
  /** Fixed advisory-lock key, unique per job. */
  readonly lockKey: number;
  readonly run: (period: ScheduledPeriod) => Promise<JobSummary>;
}

/** PERIOD_DONE: this scheduled period already has a completed run. */
export type JobSkipReason = LockSkipReason | "PERIOD_DONE";

export type JobRunOutcome =
  | { readonly status: "skipped"; readonly reason: JobSkipReason }
  | { readonly status: "completed"; readonly summary: JobSummary }
  | { readonly status: "failed"; readonly errorCode: string; readonly summary: JobSummary | null };

export interface JobRunDependencies {
  readonly withLock: <T>(request: JobLockRequest, work: (lease: JobLease) => Promise<T>) => Promise<LockOutcome<T>>;
  readonly hasCompletedPeriod: (jobName: string, identity: string) => Promise<boolean>;
  /** Null when the period completed meanwhile (see startJobRun). */
  readonly startRun: (jobName: string, period: ScheduledPeriod) => Promise<string | null>;
  readonly renewRun: (runId: string) => Promise<void>;
  readonly finishRun: (runId: string, finish: JobRunFinish) => Promise<void>;
}

export const defaultJobRunDependencies: JobRunDependencies = Object.freeze({
  withLock: <T>(request: JobLockRequest, work: (lease: JobLease) => Promise<T>) => withJobAdvisoryLock(request, work),
  hasCompletedPeriod,
  startRun: startJobRun,
  renewRun: renewJobRun,
  finishRun: finishJobRun,
});

/** A bounded code only: raw messages can carry SQL or financial detail. */
export function jobErrorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return GENERIC_FAILURE;
  const { code } = error as { code: unknown };
  if (typeof code !== "string") return GENERIC_FAILURE;
  if (APP_ERROR_CODE.test(code)) return code;
  if (POSTGRES_ERROR_CODE.test(code)) return `PG_${code}`;
  return GENERIC_FAILURE;
}

type Attempt = { readonly outcome: Exclude<JobRunOutcome, { status: "skipped" }>; readonly error?: unknown };

async function attempt(job: ScheduledJobDefinition, period: ScheduledPeriod): Promise<Attempt> {
  try {
    const summary = await job.run(period);
    if ((summary.failed ?? 0) > 0) return { outcome: { status: "failed", errorCode: PARTIAL_FAILURE, summary } };
    return { outcome: { status: "completed", summary } };
  } catch (error) {
    return { outcome: { status: "failed", errorCode: jobErrorCode(error), summary: null }, error };
  }
}

const isSuperseded = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === RUN_SUPERSEDED;

function closeLost(result: Attempt, lease: JobLease): Attempt {
  if (!lease.isLost()) return result;
  return { outcome: { status: "failed", errorCode: LOCK_LOST, summary: result.outcome.summary }, error: result.error };
}

async function runJournaled(
  job: ScheduledJobDefinition, period: ScheduledPeriod, lease: JobLease, deps: JobRunDependencies,
): Promise<JobRunOutcome> {
  // Read under both locks: no other runner of this job can be between this check and the insert.
  if (await deps.hasCompletedPeriod(job.name, period.identity)) return { status: "skipped", reason: "PERIOD_DONE" };
  const startedAt = Date.now();
  const runId = await deps.startRun(job.name, period);
  if (runId === null) return { status: "skipped", reason: "PERIOD_DONE" };
  lease.onRenewed(() => deps.renewRun(runId));
  const { outcome, error } = closeLost(await attempt(job, period), lease);
  try {
    await deps.finishRun(runId, {
      isOk: outcome.status === "completed",
      errorCode: outcome.status === "failed" ? outcome.errorCode : null,
      summary: outcome.summary,
    });
  } catch (journalError) {
    if (isSuperseded(journalError)) {
      // Fenced off: a newer run of this period took over while this one worked.
      logger.error("Scheduled job finished after a newer run of its period took over; its result is not recorded", {
        jobName: job.name, runId, runStatus: outcome.status,
      });
      return { status: "failed", errorCode: RUN_SUPERSEDED, summary: outcome.summary };
    }
    logger.error("Scheduled job ran, but its journal row could not be closed", {
      jobName: job.name, runId, runStatus: outcome.status, error: journalError,
    });
    throw new JobOutcomeUnknownError(job.name);
  }
  const context = { jobName: job.name, runId, scheduledFor: period.scheduledFor.toISOString(), outcome: outcome.status === "completed" ? "success" as const : "failure" as const, durationMs: Date.now() - startedAt };
  // The journal keeps only the bounded code; the log also carries the error,
  // whose message survives redaction scrubbed (OPS-014).
  if (outcome.status === "failed") logger.error("Scheduled job failed", {
    ...context, errorClass: outcome.errorCode, ...(error === undefined ? {} : { error }),
  });
  else logger.info("Scheduled job completed", context);
  return outcome;
}

/**
 * Run one scheduled job for the period `now` falls in, under its advisory
 * locks, and journal the run. A runner that cannot take the locks, or whose
 * period already completed, skips without running or journaling.
 */
export async function runScheduledJob(
  job: ScheduledJobDefinition,
  deps: JobRunDependencies = defaultJobRunDependencies,
  now: Date = new Date(),
  options: ScheduledRunOptions = {},
): Promise<JobRunOutcome> {
  const scheduledFor = scheduledSlotAtOrBefore(job.cron, now);
  const period: ScheduledPeriod = { identity: periodIdentity(job.name, scheduledFor), scheduledFor };
  const request: JobLockRequest = options.jobLockWaitMs === undefined
    ? { lockKey: job.lockKey, periodIdentity: period.identity }
    : { lockKey: job.lockKey, periodIdentity: period.identity, maxWaitMs: options.jobLockWaitMs };
  const locked = await deps.withLock(request, (lease) => runJournaled(job, period, lease, deps));
  const outcome: JobRunOutcome = locked.acquired ? locked.result : { status: "skipped", reason: locked.reason };
  if (outcome.status === "skipped") {
    logger.info("Scheduled job skipped", { jobName: job.name, scheduledFor: period.scheduledFor.toISOString(), reason: outcome.reason });
  }
  return outcome;
}
