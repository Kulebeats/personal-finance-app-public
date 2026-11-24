/**
 * Job Service
 *
 * Background job queue with scheduling, retry, and idempotency.
 *
 * @module core/jobs/service
 */

import { db } from "../../db";
import { jobs, type Job, type InsertJob } from "../../../shared/schema";
import { eq, and, lte, or, sql, ne, isNull, notLike } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { SCHEDULER_CATALOGUED_PREFIX, SCHEDULER_START_MARKER } from "../scheduling/jobJournal";

/**
 * Known job types
 */
export const JobTypes = {
  DAILY_SNAPSHOTS: "daily_snapshots",
  RECURRING_TRANSACTIONS: "recurring_transactions",
  RECURRING_REMINDERS: "recurring_reminders",
  BUDGET_ROLLOVER: "budget_rollover",
  BUDGET_ALERTS: "budget_alerts",
  GOALS_STATUS: "goals_status",
  GOALS_DEADLINES: "goals_deadlines",
  MARKET_DATA: "market_data",
  WEEKLY_RECAP: "weekly_recap",
  CLEANUP: "cleanup",
} as const;

export type JobType = (typeof JobTypes)[keyof typeof JobTypes];

/**
 * Job handler function type
 */
export type JobHandler = (job: Job) => Promise<Record<string, unknown> | void>;

/**
 * Job service for managing background jobs
 */
class JobService {
  private handlers = new Map<string, JobHandler>();

  /**
   * Register a job handler
   */
  registerHandler(jobName: string, handler: JobHandler): void {
    this.handlers.set(jobName, handler);
    logger.debug("Job handler registered", { jobName });
  }

  /**
   * Enqueue a new job
   */
  async enqueue(
    name: string,
    options?: {
      payload?: Record<string, unknown>;
      runAt?: Date;
      priority?: number;
      maxAttempts?: number;
      idempotencyKey?: string;
    }
  ): Promise<Job> {
    const {
      payload,
      runAt,
      priority = 0,
      maxAttempts = 3,
      idempotencyKey,
    } = options || {};

    /**
     * BUSINESS RULE: Job Idempotency
     *
     * Idempotency prevents duplicate job execution when:
     * - A job is enqueued multiple times accidentally
     * - A retry mechanism re-enqueues the same job
     * - Multiple workers try to process the same work
     *
     * If a job with the same idempotencyKey exists and is pending/running,
     * we return the existing job instead of creating a duplicate.
     * This ensures "exactly once" semantics for business operations.
     */
    if (idempotencyKey) {
      const existing = await db
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.idempotencyKey, idempotencyKey),
            or(eq(jobs.status, "pending"), eq(jobs.status, "running"))
          )
        )
        .limit(1);

      if (existing.length > 0) {
        logger.debug("Duplicate job skipped (idempotency)", {
          name,
          idempotencyKey,
        });
        return existing[0];
      }
    }

    const [job] = await db
      .insert(jobs)
      .values({
        name,
        payload,
        runAt: runAt || new Date(),
        priority,
        maxAttempts,
        idempotencyKey,
        status: "pending",
      })
      .returning();

    logger.info("Job enqueued", { jobId: job.id, name, runAt: job.runAt });
    return job;
  }

  /**
   * Get pending jobs ready to run
   */
  async getPendingJobs(limit = 10): Promise<Job[]> {
    const now = new Date();
    return db
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "pending"), lte(jobs.runAt, now)))
      .orderBy(sql`${jobs.priority} DESC, ${jobs.runAt} ASC`)
      .limit(limit);
  }

  /**
   * Atomically claim and run a single job (prevents race conditions)
   *
   * Uses FOR UPDATE SKIP LOCKED to atomically:
   * 1. Find a pending job
   * 2. Lock it (other workers skip locked rows)
   * 3. Mark it as running
   * 4. Execute handler
   *
   * This prevents multiple workers from processing the same job.
   */
  async run(job: Job): Promise<void> {
    const handler = this.handlers.get(job.name);

    if (!handler) {
      logger.warn("No handler for job", { jobId: job.id, name: job.name });
      await this.fail(job.id, "No handler registered for job type");
      return;
    }

    // Atomically claim the job - increment attempts BEFORE running
    // This ensures attempt count is correct even if job crashes mid-execution
    const claimResult = await db
      .update(jobs)
      .set({
        status: "running",
        startedAt: new Date(),
        attempts: job.attempts + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, "pending")))
      .returning();

    // If no rows updated, job was claimed by another worker
    if (claimResult.length === 0) {
      logger.debug("Job already claimed by another worker", { jobId: job.id });
      return;
    }

    try {
      const result = await handler(job);

      // Mark as completed
      await db
        .update(jobs)
        .set({
          status: "completed",
          completedAt: new Date(),
          result: result || {},
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, job.id));

      logger.info("Job completed", { jobId: job.id, name: job.name });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.handleFailure(job, errorMessage);
    }
  }

  /**
   * BUSINESS RULE: Job Retry with Exponential Backoff
   *
   * Failed jobs are retried with increasing delays:
   * - Attempt 1 failure: wait 1 minute
   * - Attempt 2 failure: wait 5 minutes (1m * 5^1)
   * - Attempt 3 failure: wait 25 minutes (1m * 5^2)
   * - Maximum delay capped at 1 hour
   *
   * This prevents overwhelming services during outages while
   * ensuring eventual recovery for transient failures.
   */
  private async handleFailure(job: Job, error: string): Promise<void> {
    const attempts = job.attempts + 1;
    const shouldRetry = attempts < job.maxAttempts;

    if (shouldRetry) {
      // Exponential backoff: 1m, 5m, 25m...
      const delayMs = Math.min(60000 * Math.pow(5, attempts - 1), 3600000);
      const runAt = new Date(Date.now() + delayMs);

      await db
        .update(jobs)
        .set({
          status: "pending",
          lastError: error,
          runAt,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, job.id));

      logger.warn("Job failed, will retry", {
        jobId: job.id,
        name: job.name,
        attempts,
        nextRunAt: runAt,
      });
    } else {
      await this.fail(job.id, error);
    }
  }

  /**
   * Mark job as permanently failed
   */
  private async fail(jobId: string, error: string): Promise<void> {
    await db
      .update(jobs)
      .set({
        status: "failed",
        lastError: error,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    logger.error("Job permanently failed", { jobId, error });
  }

  /**
   * Cancel a pending job
   */
  async cancel(jobId: string): Promise<boolean> {
    const result = await db
      .update(jobs)
      .set({
        status: "cancelled",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "pending")));

    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Get job by ID
   */
  async getById(jobId: string): Promise<Job | null> {
    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);
    return job || null;
  }

  /**
   * Get job stats
   */
  async getStats(): Promise<{
    pending: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
  }> {
    const result = await db
      .select({
        status: jobs.status,
        count: sql<number>`count(*)::int`,
      })
      .from(jobs)
      .groupBy(jobs.status);

    const stats = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const row of result) {
      if (row.status in stats) {
        stats[row.status as keyof typeof stats] = row.count;
      }
    }
    return stats;
  }

  /**
   * Cleanup old completed/failed jobs. The scheduler's start marker and its
   * per-job catalogue records are kept: readiness measures never-run jobs from
   * them, so deleting them would renew their grace (OPS-002).
   */
  async cleanup(olderThanDays = 7): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const result = await db
      .delete(jobs)
      .where(
        and(
          ne(jobs.name, SCHEDULER_START_MARKER),
          notLike(jobs.name, `${SCHEDULER_CATALOGUED_PREFIX}%`),
          or(
            eq(jobs.status, "completed"),
            eq(jobs.status, "failed"),
            eq(jobs.status, "cancelled")
          ),
          lte(jobs.completedAt, cutoff)
        )
      );

    const deleted = result.rowCount ?? 0;
    logger.info("Cleaned up old jobs", { deleted, olderThanDays });
    return deleted;
  }
}

export const jobService = new JobService();
