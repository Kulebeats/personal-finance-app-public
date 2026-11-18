/**
 * Cron Job Routes
 *
 * Endpoints to trigger scheduled jobs manually or via external cron services.
 * Protected by a CRON_SECRET header for security.
 */
import { Router, type Request, type Response } from "express";
import { runDailySnapshots } from "../jobs/snapshotWorker";
import { runGoalStatusRecalculation } from "../jobs/goalStatusWorker";
import {
  runGoalDeadlineReminders,
  runWeeklyGoalReport,
} from "../jobs/goalReminderWorker";
import { recurringService } from "../services/RecurringService";
import { notificationService } from "../services/NotificationService";
import { budgetService } from "../services/BudgetService";
import { db } from "../db";
import { households, recurringTransactions } from "@shared/schema";
import { logger } from "../utils/logger";
import { and, eq, gte, lte, isNull } from "drizzle-orm";
import { strictLimiter } from "../middleware/rateLimit";

const router = Router();

// SEC-RATE-005: Apply rate limiting to cron endpoints to prevent abuse
router.use(strictLimiter);

// Middleware to verify cron secret
function verifyCronSecret(req: Request, res: Response, next: Function) {
  const cronSecret = process.env.CRON_SECRET;
  const providedSecret = req.headers["x-cron-secret"];

  // If no CRON_SECRET is set, allow in development only
  if (!cronSecret) {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({
        success: false,
        error: "CRON_SECRET not configured",
      });
    }
    return next();
  }

  if (providedSecret !== cronSecret) {
    return res.status(403).json({
      success: false,
      error: "Invalid cron secret",
    });
  }

  next();
}

router.use(verifyCronSecret);

/**
 * POST /api/cron/snapshots
 * Triggers daily net worth snapshot calculation
 */
router.post("/snapshots", async (_req: Request, res: Response) => {
  try {
    logger.info("Cron: Starting daily snapshots via API");
    await runDailySnapshots();

    return res.json({
      success: true,
      message: "Daily snapshots completed successfully",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Cron: Snapshot job failed", { error });
    return res.status(500).json({
      success: false,
      error: "Snapshot job failed",
    });
  }
});

/**
 * POST /api/cron/recurring
 * Processes due recurring transactions
 */
router.post("/recurring", async (_req: Request, res: Response) => {
  try {
    logger.info("Cron: Processing recurring transactions via API");

    // Get all households and process recurring for each
    const allHouseholds = await db
      .select({ id: households.id })
      .from(households);

    let totalProcessed = 0;
    let totalFailed = 0;

    for (const household of allHouseholds) {
      try {
        const result = await recurringService.processRecurring(household.id);
        totalProcessed += result.created;
        totalFailed += result.errors.length;
      } catch (error) {
        logger.error("Failed to process recurring for household", {
          householdId: household.id,
          error,
        });
        totalFailed++;
      }
    }

    return res.json({
      success: true,
      message: "Recurring transactions processed",
      processed: totalProcessed,
      failed: totalFailed,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Cron: Recurring job failed", { error });
    return res.status(500).json({
      success: false,
      error: "Recurring job failed",
    });
  }
});

/**
 * POST /api/cron/recurring-reminders
 * Sends notifications for upcoming recurring transactions based on reminder_days setting
 */
router.post("/recurring-reminders", async (_req: Request, res: Response) => {
  try {
    logger.info("Cron: Processing recurring due reminders via API");

    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];

    // Calculate max reminder window (e.g., 14 days ahead)
    const maxReminderDate = new Date(today);
    maxReminderDate.setDate(maxReminderDate.getDate() + 14);
    const maxDateStr = maxReminderDate.toISOString().split("T")[0];

    // Find all active, non-paused recurring rules with upcoming due dates
    const upcomingRules = await db
      .select()
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.isActive, true),
          eq(recurringTransactions.isPaused, false),
          gte(recurringTransactions.nextDueDate, todayStr),
          lte(recurringTransactions.nextDueDate, maxDateStr)
        )
      );

    let sentCount = 0;

    for (const rule of upcomingRules) {
      // Calculate if we're within the reminder window
      const dueDate = new Date(rule.nextDueDate);
      const daysUntilDue = Math.ceil(
        (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );
      const reminderDays = rule.reminderDays || 3;

      // Only send if we're exactly at the reminder threshold
      if (daysUntilDue === reminderDays) {
        try {
          await notificationService.triggerRecurringDue(
            rule.householdId,
            rule.id,
            rule.name,
            parseFloat(String(rule.amount)),
            rule.nextDueDate
          );
          sentCount++;
        } catch (error) {
          logger.error("Failed to send recurring reminder", {
            ruleId: rule.id,
            error,
          });
        }
      }
    }

    return res.json({
      success: true,
      message: "Recurring reminders processed",
      checked: upcomingRules.length,
      sent: sentCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Cron: Recurring reminders job failed", { error });
    return res.status(500).json({
      success: false,
      error: "Recurring reminders job failed",
    });
  }
});

/**
 * POST /api/cron/budget-rollover
 * Closes expired budget periods and creates new ones
 */
router.post("/budget-rollover", async (_req: Request, res: Response) => {
  try {
    logger.info("Cron: Processing budget period rollover via API");

    const allHouseholds = await db
      .select({ id: households.id })
      .from(households);

    let processedHouseholds = 0;
    let createdCount = 0;
    let updatedCount = 0;

    for (const household of allHouseholds) {
      try {
        const result = await budgetService.processBudgetRollover(
          household.id,
          new Date()
        );
        if (result.total > 0) {
          processedHouseholds += 1;
        }
        createdCount += result.created;
        updatedCount += result.updated;
      } catch (error) {
        logger.warn("Cron: Budget rollover failed for household", {
          householdId: household.id,
          error,
        });
      }
    }

    return res.json({
      success: true,
      message: "Budget rollover processed",
      householdsChecked: allHouseholds.length,
      processedHouseholds,
      createdCount,
      updatedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Cron: Budget rollover job failed", { error });
    return res.status(500).json({
      success: false,
      error: "Budget rollover job failed",
    });
  }
});

/**
 * POST /api/cron/budget-alerts
 * Checks all households' budgets and sends notifications for warnings/exceeded
 */
router.post("/budget-alerts", async (_req: Request, res: Response) => {
  try {
    logger.info("Cron: Processing budget alerts");

    // Import budget service
    const { budgetService } = await import("../services/BudgetService");

    // Get current month/year
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    // Get all households
    const allHouseholds = await db
      .select({ id: households.id })
      .from(households);

    let totalAlerts = 0;
    let notificationsSent = 0;

    for (const household of allHouseholds) {
      try {
        // Get budget alerts for this household
        const alerts = await budgetService.getBudgetAlerts(
          household.id,
          year,
          month
        );
        totalAlerts += alerts.length;

        // Send notification for each alert
        for (const alert of alerts) {
          await notificationService.triggerBudgetAlert(
            household.id,
            alert.budget.id,
            alert.budget.name,
            alert.percentUsed,
            alert.alertLevel,
            year,
            month
          );
          notificationsSent++;
        }
      } catch (householdError) {
        logger.warn("Cron: Budget alert check failed for household", {
          householdId: household.id,
          error: householdError,
        });
      }
    }

    logger.info("Cron: Budget alerts check completed", {
      households: allHouseholds.length,
      totalAlerts,
      notificationsSent,
    });

    return res.json({
      success: true,
      message: "Budget alerts checked",
      householdsChecked: allHouseholds.length,
      totalAlerts,
      notificationsSent,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Cron: Budget alerts job failed", { error });
    return res.status(500).json({
      success: false,
      error: "Budget alerts job failed",
    });
  }
});

/**
 * POST /api/cron/goals-status
 * Recalculates goal status and projections for all households
 */
router.post("/goals-status", async (_req: Request, res: Response) => {
  try {
    logger.info("Cron: Recalculating goal status");

    const result = await runGoalStatusRecalculation();

    return res.json({
      success: true,
      message: "Goal status recalculation completed",
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Cron: Goal status recalculation failed", { error });
    return res.status(500).json({
      success: false,
      error: "Goal status recalculation failed",
    });
  }
});

/**
 * POST /api/cron/goals-weekly
 * Sends weekly goal summary notifications
 */
router.post("/goals-weekly", async (_req: Request, res: Response) => {
  try {
    logger.info("Cron: Sending weekly goal report");

    const result = await runWeeklyGoalReport();

    return res.json({
      success: true,
      message: "Weekly goal report sent",
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Cron: Weekly goal report failed", { error });
    return res.status(500).json({
      success: false,
      error: "Weekly goal report failed",
    });
  }
});

/**
 * POST /api/cron/goals-deadlines
 * Sends goal deadline reminder notifications
 */
router.post("/goals-deadlines", async (_req: Request, res: Response) => {
  try {
    logger.info("Cron: Sending goal deadline reminders");

    const result = await runGoalDeadlineReminders();

    return res.json({
      success: true,
      message: "Goal deadline reminders sent",
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Cron: Goal deadline reminders failed", { error });
    return res.status(500).json({
      success: false,
      error: "Goal deadline reminders failed",
    });
  }
});

/**
 * POST /api/cron/market-data
 * Refreshes all investment market data (prices and FX)
 */
router.post("/market-data", async (_req: Request, res: Response) => {
  try {
    const { marketDataService } = await import("../services/MarketDataService");
    const { priceAlertService } = await import("../services/PriceAlertService");
    logger.info("Cron: Refreshing market data");

    const fx = await marketDataService.updateFXRates();
    const prices = await marketDataService.updateSecurityPrices();
    const priceAlerts = await priceAlertService.checkPriceAlerts();
    const stalePrices = await priceAlertService.checkStalePrices();

    return res.json({
      success: true,
      message: "Market data refreshed successfully",
      fx,
      prices,
      priceAlerts,
      stalePrices,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Cron: Market data refresh failed", { error });
    return res.status(500).json({
      success: false,
      error: "Market data refresh failed",
    });
  }
});

/**
 * POST /api/cron/investment-automation
 * Executes due recurring investments (SIPs)
 */
router.post("/investment-automation", async (_req: Request, res: Response) => {
  try {
    const { investmentAutomationService } = await import(
      "../services/InvestmentAutomationService"
    );
    logger.info("Cron: Processing T-Bill maturities and recurring investments");

    // 1. Process Maturities (Liquidity Event)
    const maturityResults =
      await investmentAutomationService.processTBillMaturities();

    // 2. Process Investments (Spending Event)
    const executionResults =
      await investmentAutomationService.processDueInvestments();

    return res.json({
      success: true,
      message: "Investment automation cycle completed",
      results: {
        maturities: maturityResults,
        executions: executionResults,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Cron: Investment automation failed", { error });
    return res.status(500).json({
      success: false,
      error: "Investment automation failed",
    });
  }
});

export default router;
