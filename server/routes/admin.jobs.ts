import type { NextFunction, Request, Response } from "express";
import { success } from "../core/http";
import { SCHEDULED_JOBS } from "../core/scheduling/jobRegistry";
import { listScheduledJobStatus } from "../core/scheduling/jobJournal";
import { isSchedulerRunning } from "../scheduler";

/**
 * GET /api/admin/jobs — operator view of scheduled work (R14.3): whether this
 * process runs the scheduler, each job's cadence, and its last run and last
 * success from the run journal. Mounted behind the admin router's system-role guard.
 */
export async function getScheduledJobs(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const statuses = await listScheduledJobStatus(SCHEDULED_JOBS.map((job) => job.name));
    success(res, {
      schedulerRunning: isSchedulerRunning(),
      jobs: SCHEDULED_JOBS.map((job, index) => ({ ...statuses[index], cron: job.cron, timezone: "UTC" })),
    });
  } catch (error) {
    next(error);
  }
}
