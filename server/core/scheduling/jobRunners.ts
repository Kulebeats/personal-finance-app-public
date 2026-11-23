import { households, users } from "@shared/schema";
import { db } from "../../db";
import { authSecurityReportService } from "../../modules/auth/auth.security.report";
import { processWeeklyRecapEmails } from "../../modules/weekly-recap/weekly-recap.email.service";
import { notificationRepository } from "../../repositories/NotificationRepository";
import { budgetService } from "../../services/BudgetService";
import { calendarClock } from "../../services/householdCalendarToday";
import { recurringService } from "../../services/RecurringService";
import { runDailySnapshots } from "../../jobs/snapshotWorker";
import { sweepOrphanMerchantLogos } from "../../modules/merchants/merchants.logo-sweep";
import { logger } from "../../utils/logger";
import { processBudgetAlerts, processRecurringReminders } from "./householdNoticeRunners";
import type { JobSummary, ScheduledPeriod } from "./jobJournal";
import { isWithinScheduledWindow } from "./schedulePeriod";

/**
 * The work behind each scheduled job. The HTTP cron routes call the same
 * household loops, so the two trigger doors cannot drift apart.
 */
const READ_NOTIFICATION_ARCHIVE_DAYS = 30;
const ARCHIVED_NOTIFICATION_RETENTION_DAYS = 90;

// Type aliases (not interfaces) so the totals stay assignable to JobSummary's index signature.
export type RecurringRunTotals = { readonly processed: number; readonly failed: number };

export async function processRecurringForAllHouseholds(): Promise<RecurringRunTotals> {
  const allHouseholds = await db.select({ id: households.id }).from(households);
  let processed = 0;
  let failed = 0;
  for (const household of allHouseholds) {
    try {
      const result = await recurringService.processRecurring(household.id);
      processed += result.created;
      failed += result.errors.length;
    } catch (error) {
      logger.error("Failed to process recurring for household", { householdId: household.id, error });
      failed++;
    }
  }
  return { processed, failed };
}

export type RolloverRunTotals = {
  readonly householdsChecked: number;
  readonly processedHouseholds: number;
  readonly createdCount: number;
  readonly updatedCount: number;
  readonly failed: number;
};

export async function processBudgetRolloverForAllHouseholds(now: Date = calendarClock.now()): Promise<RolloverRunTotals> {
  const allHouseholds = await db.select({ id: households.id }).from(households);
  let processedHouseholds = 0;
  let createdCount = 0;
  let updatedCount = 0;
  let failed = 0;
  for (const household of allHouseholds) {
    try {
      const result = await budgetService.processBudgetRollover(household.id, now);
      if (result.total > 0) processedHouseholds += 1;
      createdCount += result.created;
      updatedCount += result.updated;
    } catch (error) {
      logger.warn("Cron: Budget rollover failed for household", { householdId: household.id, error });
      failed++;
    }
  }
  return { householdsChecked: allHouseholds.length, processedHouseholds, createdCount, updatedCount, failed };
}

export async function runRecurringMaterialization(): Promise<JobSummary> {
  return processRecurringForAllHouseholds();
}

export async function runBudgetRollover(): Promise<JobSummary> {
  return processBudgetRolloverForAllHouseholds();
}

export async function runTBillMaturities(): Promise<JobSummary> {
  const { investmentAutomationService } = await import("../../services/InvestmentAutomationService");
  const result = await investmentAutomationService.processTBillMaturities();
  return { matured: result.matured, skipped: result.skipped, notDue: result.notDue, failed: result.failed };
}

/** Scheduled purchases: books each overdue occurrence once, capped per run (FIN-12). */
export async function runSipCatchUp(): Promise<JobSummary> {
  const { investmentAutomationService } = await import("../../services/InvestmentAutomationService");
  const result = await investmentAutomationService.processDueInvestments();
  return { held: result.held, skipped: result.skipped, failed: result.failed };
}

export async function runFxRefresh(): Promise<JobSummary> {
  const { marketDataService } = await import("../../services/MarketDataService");
  const result = await marketDataService.updateFXRates();
  return { refreshed: result.success ? 1 : 0, failed: result.success ? 0 : 1 };
}

/**
 * A-15: a failed or lock-busy household makes the run failed (PARTIAL_FAILURE),
 * so a recovery tick can try that day again. A committed aggregate capture
 * allows a household to be skipped on a later attempt.
 */
export async function runSnapshots(period: ScheduledPeriod): Promise<JobSummary> {
  const totals = await runDailySnapshots(period.scheduledFor.toISOString().slice(0, 10));
  return { processed: totals.processed, busy: totals.busy, failed: totals.failed + totals.busy };
}

export async function runWeeklyRecap(): Promise<JobSummary> {
  const result = await processWeeklyRecapEmails();
  return { sent: result.sent, failed: result.failed, skipped: result.skipped };
}

export async function runDailySecurityReport(): Promise<JobSummary> {
  const allUsers = await db.select({ id: users.id }).from(users);
  logger.info("Processing security reports", { job: "daily-security-report", count: allUsers.length });
  let failed = 0;
  for (const user of allUsers) {
    try {
      await authSecurityReportService.sendDailySecurityReport(user.id);
    } catch (err) {
      failed++;
      logger.error("Security report generation failed", {
        job: "daily-security-report", userId: user.id, outcome: "failure", error: err,
      });
    }
  }
  return { processed: allUsers.length - failed, failed };
}

export async function runNotificationCleanup(): Promise<JobSummary> {
  const archived = await notificationRepository.autoArchiveOldRead(READ_NOTIFICATION_ARCHIVE_DAYS);
  const purged = await notificationRepository.purgeArchived(ARCHIVED_NOTIFICATION_RETENTION_DAYS);
  logger.info("Notification cleanup completed", { job: "notification-cleanup", outcome: "success", archived, purged });
  return { archived, purged };
}

/** Retire merchant logo files no merchant references any more (counts only). */
export async function runMerchantLogoCleanup(): Promise<JobSummary> {
  return sweepOrphanMerchantLogos();
}

// A-21: jobs that had only the HTTP cron door and no scheduled caller.

function noticeClock(period: ScheduledPeriod, days: number): () => Date {
  return () => {
    const now = new Date();
    if (!isWithinScheduledWindow(period.scheduledFor, now, days)) {
      throw Object.assign(new Error("Scheduled notice window expired"), { code: "PERIOD_EXPIRED" });
    }
    return now;
  };
}

/** Bill reminders from reminderDays before the due date through the due date. */
export async function runRecurringReminders(period: ScheduledPeriod): Promise<JobSummary> {
  const now = noticeClock(period, 1);
  return processRecurringReminders(now(), now);
}

/** One budget review per notifiable member and month; deduplicated by its monthly claim. */
export async function runBudgetAlerts(): Promise<JobSummary> {
  return processBudgetAlerts();
}

export async function runGoalWeeklyReport(period: ScheduledPeriod): Promise<JobSummary> {
  const { runWeeklyGoalReport } = await import("../../jobs/goalReminderWorker");
  const now = noticeClock(period, 7);
  const result = await runWeeklyGoalReport(now(), now);
  return { households: result.households, notificationsSent: result.notificationsSent, failed: result.failed };
}

export async function runGoalDeadlines(period: ScheduledPeriod): Promise<JobSummary> {
  const { runGoalDeadlineReminders } = await import("../../jobs/goalReminderWorker");
  const now = noticeClock(period, 1);
  const result = await runGoalDeadlineReminders(now(), now);
  return { remindersSent: result.remindersSent, failed: result.failed };
}

/** Uses the custody and delivery guards on the existing stale-price service (A-57). */
export async function runStalePriceAlerts(): Promise<JobSummary> {
  const { priceAlertService } = await import("../../services/PriceAlertService");
  return priceAlertService.checkStalePrices();
}

/** Expire personal-data exports past retention and remove orphan export files (counts only). */
export async function runPersonalExportCleanup(): Promise<JobSummary> {
  const { sweepPersonalExports } = await import("../../modules/settings/settings.privacy-export.retention");
  return sweepPersonalExports();
}
