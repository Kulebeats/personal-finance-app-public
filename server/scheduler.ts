import cron, { type ScheduledTask } from "node-cron";
import { logger } from "./utils/logger";
import { startProcessor, stopProcessor } from "./core/events/processor";
import { recoveryWindowDays } from "./core/scheduling/jobCatalog";
import { recordSchedulerStart } from "./core/scheduling/jobJournal";
import { SCHEDULED_JOBS } from "./core/scheduling/jobRegistry";
import { runScheduledJob, type ScheduledJobDefinition } from "./core/scheduling/scheduledJob";
import { isSchedulerEnabled } from "./core/scheduling/schedulerConfig";
import { isWithinScheduledWindow, scheduledSlotAtOrBefore } from "./core/scheduling/schedulePeriod";

/**
 * In-process scheduler (OPS-003, NEW-38).
 *
 * On the declared single instance (SCP-306) this one process drives every
 * scheduled financial and notification job, and the outbox event processor
 * that delivers security notices. Each job runs under its own Postgres
 * advisory lock and journals its outcome, so an overlapping tick or a second
 * instance skips instead of double-running. SCHEDULER_ENABLED controls both
 * halves; see core/scheduling/schedulerConfig.ts.
 */
const SCHEDULER_TIMEZONE = "UTC";
const RECOVERY_CRON = "7,22,37,52 * * * *";
const RECOVERY_TASK = "scheduler.retry-incomplete";

let scheduledTasks: readonly ScheduledTask[] = [];
let isStarted = false;

function scheduleJob(job: ScheduledJobDefinition): ScheduledTask {
  if (!cron.validate(job.cron)) throw new Error(`Invalid cron expression for scheduled job ${job.name}`);
  return cron.schedule(job.cron, () => runTick(job, new Date()), {
    name: job.name, timezone: SCHEDULER_TIMEZONE, noOverlap: true,
  });
}

async function runTick(job: ScheduledJobDefinition, now: Date): Promise<void> {
  try {
    await runScheduledJob(job, undefined, now);
  } catch (error) {
    logger.error("Scheduled job tick failed", { jobName: job.name, outcome: "error", error });
  }
}

function scheduleRecovery(jobs: readonly ScheduledJobDefinition[]): ScheduledTask {
  return cron.schedule(RECOVERY_CRON, async () => {
    for (const job of jobs) {
      const now = new Date();
      const slot = scheduledSlotAtOrBefore(job.cron, now);
      // A slot's recovery uses its own UTC day (or Monday–Sunday report week).
      // The worker never reconstructs a past day/week using current balances.
      if (isWithinScheduledWindow(slot, now, recoveryWindowDays(job.name) ?? 0)) await runTick(job, now);
    }
  }, { name: RECOVERY_TASK, timezone: SCHEDULER_TIMEZONE, noOverlap: true });
}

async function recordStart(): Promise<void> {
  try {
    await recordSchedulerStart();
  } catch (error) {
    logger.error("Scheduler start could not be recorded", { outcome: "error", error });
  }
}

/** Returns whether scheduled work was started. */
export function initScheduler(
  env: Readonly<Record<string, string | undefined>> = process.env,
  jobs: readonly ScheduledJobDefinition[] = SCHEDULED_JOBS,
): boolean {
  if (!isSchedulerEnabled(env)) {
    logger.info("Scheduler disabled; no scheduled jobs or outbox processing in this process");
    return false;
  }
  if (isStarted) {
    logger.warn("Scheduler already running");
    return true;
  }
  const tasks = jobs.map(scheduleJob);
  const recoverable = jobs.filter(job => recoveryWindowDays(job.name) !== undefined);
  if (recoverable.length > 0) tasks.push(scheduleRecovery(recoverable));
  scheduledTasks = Object.freeze(tasks);
  startProcessor();
  isStarted = true;
  // Readiness measures never-run jobs from the first recorded start (OPS-002).
  // A failure here must not stop the jobs; readiness then reads the journal alone.
  void recordStart();
  logger.info("Scheduler initialized", { count: scheduledTasks.length });
  return true;
}

export async function stopScheduler(): Promise<void> {
  const tasks = scheduledTasks;
  scheduledTasks = [];
  isStarted = false;
  for (const task of tasks) await task.stop();
  stopProcessor();
}

export function isSchedulerRunning(): boolean {
  return isStarted;
}
