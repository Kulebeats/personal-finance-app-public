import cron from "node-cron";
import { logger } from "./utils/logger";
import { authSecurityReportService } from "./modules/auth/auth.security.report";
import { notificationRepository } from "./repositories/NotificationRepository";
import { processWeeklyRecapEmails } from "./modules/weekly-recap/weekly-recap.email.service";
import { db } from "./db";
import { users } from "../shared/schema";
import { withRedisLock } from "./config/redis";

/**
 * Distributed-lock TTLs for scheduled jobs (SCP-308).
 *
 * Each cron job is registered on every instance, so without coordination it
 * would double-fire under horizontal scaling. `withRedisLock` ensures exactly
 * one instance runs each job per tick. The TTL is a safety net: if the holder
 * crashes mid-run, the lock auto-expires so the next tick can proceed. It is
 * sized comfortably below the job's cron interval (all daily/weekly) so a slow
 * run never blocks the following scheduled run.
 *
 * When REDIS_URL is unset in local dev/test, `withRedisLock` runs the job
 * directly. Production requires Redis at startup.
 */
const SCHEDULER_LOCK_TTL_SECONDS = 10 * 60; // 10 minutes

/**
 * Daily security report generation for all active users.
 */
async function runDailySecurityReport(): Promise<void> {
  logger.info("Starting daily security report generation");
  try {
    // Get all active users
    // Optimization: In a real app, we might process in batches or queues
    const allUsers = await db.select({ id: users.id }).from(users);

    logger.info(`Processing security reports for ${allUsers.length} users`);

    for (const user of allUsers) {
      try {
        await authSecurityReportService.sendDailySecurityReport(user.id);
      } catch (err) {
        logger.error(`Failed to generate report for user ${user.id}`, {
          error: err,
        });
      }
    }

    logger.info("Daily security report generation completed");
  } catch (error) {
    logger.error("Failed to run daily security report job", { error });
  }
}

/**
 * Daily notification cleanup: archive old read, purge old archived.
 */
async function runNotificationCleanup(): Promise<void> {
  logger.info("Starting notification cleanup job");
  try {
    // Auto-archive old read notifications (30 days)
    const archivedCount = await notificationRepository.autoArchiveOldRead(30);
    logger.info(`Auto-archived ${archivedCount} old read notifications`);

    // Purge archived notifications older than retention period (90 days)
    const purgedCount = await notificationRepository.purgeArchived(90);
    logger.info(`Purged ${purgedCount} archived notifications`);

    logger.info("Notification cleanup completed", {
      archived: archivedCount,
      purged: purgedCount,
    });
  } catch (error) {
    logger.error("Failed to run notification cleanup job", { error });
  }
}

/**
 * Weekly recap email digest for the previous week (Monday-Sunday).
 */
async function runWeeklyRecap(): Promise<void> {
  logger.info("Starting weekly recap email job");
  try {
    // dayOfWeek: 1 = Monday (week starts on Monday)
    const result = await processWeeklyRecapEmails(1);
    logger.info("Weekly recap email job completed", {
      sent: result.sent,
      failed: result.failed,
    });
  } catch (error) {
    logger.error("Failed to run weekly recap email job", { error });
  }
}

/**
 * Wraps a scheduled job in a distributed lock so it runs once cluster-wide.
 * Falls back to running directly when Redis is not configured (single instance).
 *
 * Exported for testing the lock-wrapping behaviour without standing up cron.
 */
export async function runScheduledJob(
  jobName: string,
  job: () => Promise<void>,
): Promise<void> {
  const lockKey = `scheduler:lock:${jobName}`;
  const { ran } = await withRedisLock(
    lockKey,
    SCHEDULER_LOCK_TTL_SECONDS,
    job,
  );
  if (!ran) {
    logger.info("Scheduled job skipped; running on another instance", {
      jobName,
    });
  }
}

/**
 * Initialize scheduled jobs
 */
export function initScheduler() {
  logger.info("Initializing scheduler...");

  // Daily Security Report - Runs at 8:00 AM every day
  cron.schedule("0 8 * * *", () => {
    runScheduledJob("daily-security-report", runDailySecurityReport).catch(
      (error) => {
        logger.error("Scheduled job failed", {
          jobName: "daily-security-report",
          error,
        });
      },
    );
  });

  // Daily Notification Cleanup - Runs at 2:00 AM every day
  cron.schedule("0 2 * * *", () => {
    runScheduledJob("notification-cleanup", runNotificationCleanup).catch(
      (error) => {
        logger.error("Scheduled job failed", {
          jobName: "notification-cleanup",
          error,
        });
      },
    );
  });

  // Weekly Recap Email Digest - Runs every Monday at 9:00 AM
  // Sends recap for the previous week (Monday-Sunday)
  cron.schedule("0 9 * * 1", () => {
    runScheduledJob("weekly-recap", runWeeklyRecap).catch((error) => {
      logger.error("Scheduled job failed", {
        jobName: "weekly-recap",
        error,
      });
    });
  });

  logger.info("Scheduler initialized");
}
