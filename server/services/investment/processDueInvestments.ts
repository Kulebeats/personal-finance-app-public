import { db } from "../../db";
import { recurringInvestments, households, recurringExecutionLog } from "@shared/schema";
import { eq, and, lte } from "drizzle-orm";
import { shiftCalendarDate } from "@shared/household-calendar";
import { calculateNextDate as advanceRecurringDate } from "../../core/calculations/recurring/dates";
import { logger } from "../../utils/logger";
import { withTransaction } from "../../utils/withTransaction";
import { calendarClock } from "../householdCalendarToday";
import { materializeSipOccurrence } from "./sipOccurrenceMaterialization";
import { lockSipExecutionAuthorization, sipPendingCalendarDate, SIP_EXECUTION_REFUSAL } from "./sipExecutionAuthorization";

export interface SipExecutionResults {
  success: number;
  skipped: number;
  held: number;
  failed: number;
  errors: string[];
}

type ExecutionOutcome = { status: "held" } | { status: "skipped" };

/** Occurrences one plan may book in a single run; any further backlog waits
 * for the next run (FIN-12 bounded catch-up). */
export const SIP_CATCH_UP_LIMIT = 12;

/** Find recurring investment plans due today or overdue (unlocked candidate scan). */
export async function getDuePlans(instant = calendarClock.now()) {
  // UTC+1 is the latest calendar date any named zone can be on at this instant.
  const latest = shiftCalendarDate(instant.toISOString().slice(0, 10), 1);
  const candidates = await db
    .select({ plan: recurringInvestments, timeZone: households.timeZone })
    .from(recurringInvestments)
    .innerJoin(households, eq(households.id, recurringInvestments.householdId))
    .where(
      and(
        eq(recurringInvestments.isActive, true),
        lte(recurringInvestments.nextExecutionDate, latest),
      ),
    );
  return candidates.filter(({ plan, timeZone }) => plan.nextExecutionDate <= sipPendingCalendarDate(instant, timeZone))
    .map(({ plan }) => plan);
}

export function calculateNextDate(currentDate: Date, frequency: string, initialDate: string): Date {
  switch (frequency) {
    case "daily":
    case "weekly":
    case "biweekly":
    case "monthly":
    case "quarterly":
    case "semi_annually":
    case "annually":
    case "yearly":
      return new Date(advanceRecurringDate(currentDate.toISOString().slice(0, 10), frequency, {
        dayOfMonth: new Date(initialDate).getUTCDate(),
      }));
    default:
      throw new Error("Unsupported SIP schedule frequency");
  }
}

/**
 * Execute only a current record-only SIP mandate. Household, actual author,
 * plan and source locks protect pending materialization and cursor advance as
 * one transaction. Reference quotes never authorize an actual purchase.
 * Pending rollover terms confer no executable SIP authority.
 *
 * The stored cursor is the occurrence to book, whether due today or overdue.
 * Each occurrence books in its own transaction under fresh locks, at most
 * SIP_CATCH_UP_LIMIT per plan per run, and the (plan, original due date)
 * fence makes a re-run book nothing twice. The next date uses the grant's
 * anchor day and advances from the stored cursor.
 */
async function bookNextOccurrence(plan: { id: string; householdId: string }, instant: Date): Promise<ExecutionOutcome> {
  return withTransaction<ExecutionOutcome>(async tx => {
    const authority = await lockSipExecutionAuthorization(tx, plan, instant);
    if (!authority) return { status: "skipped" };
    const scheduledDate = authority.plan.nextExecutionDate;
    const nextDate = calculateNextDate(
      new Date(scheduledDate), authority.plan.frequency, authority.terms.initialDate,
    );
    const nextExecutionDate = nextDate.toISOString().split("T")[0];
    if (nextExecutionDate <= scheduledDate) throw new Error("Recurring schedule does not advance");
    const created = await materializeSipOccurrence(tx, authority, scheduledDate, nextExecutionDate);
    return { status: created ? "held" : "skipped" };
  });
}

export async function processDueInvestments(): Promise<SipExecutionResults> {
  const instant = calendarClock.now();
  const duePlans = await getDuePlans(instant);
  const results: SipExecutionResults = { success: 0, skipped: 0, held: 0, failed: 0, errors: [] };

  for (const plan of duePlans) {
    try {
      for (let booked = 0; booked < SIP_CATCH_UP_LIMIT; booked++) {
        const outcome = await bookNextOccurrence(plan, instant);
        if (outcome.status === "held") {
          results.held++;
          continue;
        }
        if (booked === 0) results.skipped++;
        break;
      }
    } catch {
      // Raw SQL/source diagnostics can contain hidden financial history. Keep
      // the public result and separately persisted failure log bounded alike.
      logger.error("Recurring plan execution refused", { planId: plan.id });
      results.failed++;
      results.errors.push(`Plan ${plan.id}: ${SIP_EXECUTION_REFUSAL}`);
      await withTransaction(async tx => {
        const [household] = await tx.select({ id: households.id }).from(households)
          .where(eq(households.id, plan.householdId)).for("share");
        if (!household) return;
        const [remaining] = await tx.select({ id: recurringInvestments.id }).from(recurringInvestments)
          .where(and(eq(recurringInvestments.id, plan.id), eq(recurringInvestments.householdId, plan.householdId))).for("share");
        if (!remaining) return;
        await tx.insert(recurringExecutionLog).values({ recurringInvestmentId: plan.id,
          status: "failed", amount: plan.amount, errorMessage: SIP_EXECUTION_REFUSAL, executionDate: new Date() });
      });
    }
  }
  return results;
}
