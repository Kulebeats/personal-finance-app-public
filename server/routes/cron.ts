/**
 * Cron Job Routes
 *
 * Endpoints to trigger scheduled jobs from an external cron service. Protected
 * by a CRON_SECRET header, compared in constant time with no development
 * bypass. The in-process scheduler (server/scheduler.ts) runs the same jobs by
 * itself; these routes are the external trigger door.
 *
 * Each route runs its catalogued jobs through the scheduler's own runner
 * (`runScheduledJob`), under the same advisory locks and job journal. So a
 * period the scheduler completed is not run again, a run cannot overlap the
 * scheduler's, and every door run is journaled like a scheduled one. Jobs held
 * back from the scheduler (jobCatalog.ts) are refused.
 *
 * The door never waits for the job lock: while another period of the job runs
 * it answers 409 JOB_BUSY at once, instead of holding a pool connection for
 * the scheduler's wait bound. Call again later.
 */
import { Router, type Request, type Response } from "express";
import { verifyCronSecret } from "../core/scheduling/cronSecret";
import { recoveryWindowDays, type ScheduledJobName } from "../core/scheduling/jobCatalog";
import { SCHEDULED_JOBS } from "../core/scheduling/jobRegistry";
import {
  JOB_OUTCOME_UNKNOWN, JobOutcomeUnknownError, runScheduledJob, type JobRunOutcome, type ScheduledJobDefinition,
  type ScheduledRunOptions,
} from "../core/scheduling/scheduledJob";
import { isWithinScheduledWindow, scheduledSlotAtOrBefore } from "../core/scheduling/schedulePeriod";
import { logger } from "../utils/logger";
import { isPostgresError } from "../utils/postgresError";
import { strictLimiter } from "../middleware/rateLimit";

const router = Router();

// SEC-RATE-005: Apply rate limiting to cron endpoints to prevent abuse
router.use(strictLimiter);

router.use(verifyCronSecret);

/** Each door route and the catalogued jobs it runs, in order. */
export const DOOR_ROUTES: Readonly<Record<string, readonly ScheduledJobName[]>> = Object.freeze({
  "snapshots": ["snapshots.daily"],
  "recurring": ["recurring.materialize"],
  "recurring-reminders": ["recurring.remind"],
  "budget-rollover": ["budget.rollover"],
  "budget-alerts": ["budget.alerts"],
  "goals-weekly": ["goals.weekly-report"],
  "goals-deadlines": ["goals.deadlines"],
  // Maturities (cash in) before recurring purchases (cash out), as the schedule orders them.
  "investment-automation": ["investments.tbill-maturity", "investments.recurring-purchase"],
});

/**
 * Routes whose work is held back from the scheduler: goals.status, and the
 * price refresh and price alerts inside market-data (jobCatalog.ts). FX and
 * stale-price alerts run on the scheduler.
 */
const HELD_ROUTES: readonly string[] = Object.freeze(["goals-status", "market-data"]);

/**
 * WINDOW_CLOSED: the job's latest slot is past its recovery window (before
 * today's slot, the latest is yesterday's). Its work never runs for a closed
 * slot, so the door runs nothing and journals nothing; call again after the slot.
 */
type DoorSkip = { readonly status: "skipped"; readonly reason: "WINDOW_CLOSED" };
type DoorJobResult = { readonly name: string } & (JobRunOutcome | DoorSkip);

function catalogued(name: ScheduledJobName): ScheduledJobDefinition {
  const job = SCHEDULED_JOBS.find((candidate) => candidate.name === name);
  if (!job) throw new Error(`Cron door names an uncatalogued job: ${name}`);
  return job;
}

/** Fails at load, not at the first request, if a route names an unknown job. */
const DOOR_JOBS: ReadonlyMap<string, readonly ScheduledJobDefinition[]> = new Map(
  Object.entries(DOOR_ROUTES).map(([route, names]) => [route, names.map(catalogued)]),
);

/** A failed run is 500; a lock held elsewhere is 409, retry later; completed or already done is 200. */
function statusFor(results: readonly DoorJobResult[]): number {
  if (results.some((result) => result.status === "failed")) return 500;
  if (results.some((result) => result.status === "skipped" && result.reason !== "PERIOD_DONE")) return 409;
  return 200;
}

/**
 * The lock or the journal was unavailable before the work ran. Holds only
 * while runScheduledJob throws nothing after the work starts except
 * JobOutcomeUnknownError: its attempt() catches the job's own errors, and the
 * lock release after the work logs instead of throwing.
 */
const RUNNER_UNAVAILABLE = "JOB_RUNNER_UNAVAILABLE";
const DOOR_RUN_OPTIONS: ScheduledRunOptions = Object.freeze({ jobLockWaitMs: 0 });

async function runDoorJob(job: ScheduledJobDefinition): Promise<DoorJobResult> {
  const now = new Date();
  const days = recoveryWindowDays(job.name);
  if (days !== undefined && !isWithinScheduledWindow(scheduledSlotAtOrBefore(job.cron, now), now, days)) {
    return { name: job.name, status: "skipped", reason: "WINDOW_CLOSED" };
  }
  try {
    return { name: job.name, ...await runScheduledJob(job, undefined, now, DOOR_RUN_OPTIONS) };
  } catch (error) {
    // Unknown: the work ran and its journal row may still read "running".
    const errorCode = error instanceof JobOutcomeUnknownError
      ? JOB_OUTCOME_UNKNOWN
      : isPostgresError(error, "23505") ? "PG_23505" : RUNNER_UNAVAILABLE;
    logger.error("Cron: scheduled job runner failed", { jobName: job.name, errorCode, error });
    return { name: job.name, status: "failed", errorCode, summary: null };
  }
}

/**
 * Runs every job of the route, even after one fails or its runner throws: the
 * scheduler runs them independently.
 */
async function runDoorJobs(jobs: readonly ScheduledJobDefinition[]): Promise<DoorJobResult[]> {
  const results: DoorJobResult[] = [];
  for (const job of jobs) results.push(await runDoorJob(job));
  return results;
}

for (const route of HELD_ROUTES) {
  router.post(`/${route}`, (_req: Request, res: Response) => {
    logger.warn("Cron: refused a job held back from the scheduler", { route });
    res.status(409).json({
      success: false,
      error: { code: "JOB_HELD", message: "This job is held back from the scheduler" },
    });
  });
}

for (const [route, jobs] of DOOR_JOBS) {
  router.post(`/${route}`, async (_req: Request, res: Response) => {
    try {
      logger.info("Cron: running scheduled jobs via API", { route });
      const results = await runDoorJobs(jobs);
      const status = statusFor(results);
      res.status(status).json({ success: status === 200, jobs: results, timestamp: new Date().toISOString() });
    } catch (error) {
      // Each job's runner errors are its own result above; this is anything else.
      logger.error("Cron: the door failed", { route, error });
      res.status(500).json({
        success: false,
        error: { code: "CRON_DOOR_FAILED", message: "The cron door failed; check the job journal for each job's outcome" },
      });
    }
  });
}

export default router;
