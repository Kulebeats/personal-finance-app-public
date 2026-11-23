/**
 * Household notice loops shared by the in-process scheduler and the HTTP cron
 * door (A-21), so the two triggers cannot drift apart. Each loop keeps going
 * past one rule's or one recipient's failure but counts it, so a scheduled run
 * with any failure is journaled PARTIAL_FAILURE. The bill recovery tick
 * rechecks the same period. Per-recipient keys and channel receipts prevent
 * re-sending a delivered or uncertain notice.
 */
import { and, eq, gte, lte } from "drizzle-orm";
import { accounts, households, householdMembers, recurringTransactions } from "@shared/schema";
import { db } from "../../db";
import { isHouseholdRole } from "../authz/capabilities";
import { notificationService } from "../../services/NotificationService";
import { logger } from "../../utils/logger";

const DAY_MS = 1000 * 60 * 60 * 24;
/** The recurring create and update schemas allow up to 30 calendar days. */
const MAX_REMINDER_WINDOW_DAYS = 30;
const DEFAULT_REMINDER_DAYS = 3;
/** Roles that never receive household budget alerts. */
const BUDGET_ALERT_EXCLUDED_ROLES: readonly string[] = ["view_only", "professional"];

export type RecurringReminderTotals = { readonly checked: number; readonly sent: number; readonly failed: number };

/** Reminds each rule within its reminder window (default 3 days), including the due date. */
export async function processRecurringReminders(
  today: Date = new Date(), assertWindow?: () => void,
): Promise<RecurringReminderTotals> {
  const todayStr = today.toISOString().slice(0, 10);
  const todayUtc = Date.parse(todayStr);
  const maxDateStr = new Date(todayUtc + MAX_REMINDER_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);

  // Active, non-paused rules with an upcoming due date; the account join keeps
  // only rules whose destination account exists.
  const upcomingRules = await db
    .select({ rule: recurringTransactions })
    .from(recurringTransactions)
    .innerJoin(accounts, eq(accounts.id, recurringTransactions.accountId))
    .where(and(
      eq(recurringTransactions.isActive, true),
      eq(recurringTransactions.isPaused, false),
      gte(recurringTransactions.nextDueDate, todayStr),
      lte(recurringTransactions.nextDueDate, maxDateStr),
    ));
  assertWindow?.();

  let sent = 0;
  let failed = 0;
  for (const { rule } of upcomingRules) {
    const daysUntilDue = (Date.parse(rule.nextDueDate) - todayUtc) / DAY_MS;
    if (daysUntilDue > (rule.reminderDays ?? DEFAULT_REMINDER_DAYS)) continue;
    try {
      assertWindow?.();
      // Identifiers only: each recipient's content is read under their own authorization.
      const delivered = await notificationService.triggerRecurringDue({
        householdId: rule.householdId, recurringId: rule.id, dueDate: rule.nextDueDate,
      }, assertWindow);
      if (delivered > 0) sent++;
    } catch (error) {
      failed++;
      logger.error("Failed to send recurring reminder", { ruleId: rule.id, error });
    }
  }
  return { checked: upcomingRules.length, sent, failed };
}

export type BudgetAlertTotals = {
  readonly householdsChecked: number;
  readonly totalAlerts: number;
  readonly notificationsSent: number;
  readonly failed: number;
};

/** One generic budget review per notifiable member and month when any budget crossed its alert level. */
export async function processBudgetAlerts(now: Date = new Date()): Promise<BudgetAlertTotals> {
  const { budgetService } = await import("../../services/BudgetService");
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const allHouseholds = await db.select({ id: households.id }).from(households);

  let totalAlerts = 0;
  let notificationsSent = 0;
  let failed = 0;
  for (const household of allHouseholds) {
    try {
      const members = await db.select({ userId: householdMembers.userId, role: householdMembers.role }).from(householdMembers)
        .where(eq(householdMembers.householdId, household.id));
      for (const member of members) {
        if (!member.userId || !isHouseholdRole(member.role) || BUDGET_ALERT_EXCLUDED_ROLES.includes(member.role)) continue;
        const recipientId = member.userId;
        try {
          const alerts = await budgetService.getBudgetAlerts(household.id, year, month,
            { kind: "actor", actor: { householdId: household.id, userId: recipientId, role: member.role } });
          totalAlerts += alerts.length;
          // One generic review per recipient/month, regardless of how many
          // budgets crossed. Denials and existing claims are not deliveries.
          const alert = alerts[0];
          if (alert && await notificationService.triggerBudgetAlert(household.id, alert.budget.id, alert.budget.name,
            alert.percentUsed, alert.alertLevel, year, month, recipientId)) notificationsSent++;
        } catch (memberError) {
          failed++;
          logger.warn("Cron: Budget alert check failed for recipient", { householdId: household.id, error: memberError });
        }
      }
    } catch (householdError) {
      failed++;
      logger.warn("Cron: Budget alert check failed for household", { householdId: household.id, error: householdError });
    }
  }

  logger.info("Cron: Budget alerts check completed", {
    job: "budget-alerts", households: allHouseholds.length, totalAlerts, notificationsSent, failed,
  });
  return { householdsChecked: allHouseholds.length, totalAlerts, notificationsSent, failed };
}
