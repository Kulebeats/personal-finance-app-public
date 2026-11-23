import { db } from "../db";
import { goals } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "../utils/logger";
import { Money } from "../core/money";
import { buildGoalBalanceUpdate, calculatePercentComplete } from "../services/goalCalculations";
import { goalActivityLogService } from "../services/GoalActivityLogService";
import { HouseholdCalendarUnavailable, householdToday } from "../services/householdCalendarToday";

/**
 * Each household's calendar date for this run, read once per household (NEW-15).
 * Null when the household's zone is unusable: its goals are left as saved
 * rather than recomputed on another calendar.
 */
function householdDates() {
  const dates = new Map<string, string | null>();
  return async (householdId: string): Promise<string | null> => {
    if (dates.has(householdId)) return dates.get(householdId) ?? null;
    let today: string | null = null;
    try {
      today = await householdToday(db, householdId);
    } catch (error) {
      if (!(error instanceof HouseholdCalendarUnavailable)) throw error;
      logger.error("Goal status recalculation skipped a household with an unusable time zone", {
        job: "goal-status", householdId, error: error.message,
      });
    }
    dates.set(householdId, today);
    return today;
  };
}

// Small threshold for detecting meaningful changes (half cent)
const CHANGE_THRESHOLD = "0.005";

function hasGoalUpdate(goal: typeof goals.$inferSelect, update: ReturnType<typeof buildGoalBalanceUpdate>) {
  // Use Money class for amount comparison (no parseFloat)
  const previousAmount = Money.from(goal.currentAmount);
  const nextAmount = Money.from(update.currentAmount);
  const amountDiff = previousAmount.subtract(nextAmount).abs();
  const amountChanged = amountDiff.gt(CHANGE_THRESHOLD);

  // Handle projection comparison with Money class
  const previousProjection = goal.monthlyProjection
    ? Money.from(goal.monthlyProjection)
    : null;
  const nextProjection = update.monthlyProjection
    ? Money.from(update.monthlyProjection)
    : null;

  let projectionChanged = false;
  if ((previousProjection === null) !== (nextProjection === null)) {
    projectionChanged = true;
  } else if (previousProjection !== null && nextProjection !== null) {
    const projectionDiff = previousProjection.subtract(nextProjection).abs();
    projectionChanged = projectionDiff.gt(CHANGE_THRESHOLD);
  }

  const projectedDateChanged =
    String(goal.projectedCompletionDate ?? "") !==
    String(update.projectedCompletionDate ?? "");

  const statusChanged = update.status !== goal.status;
  const completionChanged = update.isCompleted !== goal.isCompleted;

  return (
    amountChanged ||
    projectionChanged ||
    projectedDateChanged ||
    statusChanged ||
    completionChanged
  );
}

export async function runGoalStatusRecalculation() {
  const activeGoals = await db
    .select()
    .from(goals)
    .where(and(eq(goals.isArchived, false)));

  let updatedCount = 0;
  let statusChanges = 0;
  const todayFor = householdDates();

  for (const goal of activeGoals) {
    // The household's calendar date, never the host's or UTC's (NEW-15).
    const today = await todayFor(goal.householdId);
    if (today === null) continue;
    // Keep Money throughout - buildGoalBalanceUpdate accepts Money directly (FIX: DATA-MONEY-CROSS-001)
    const currentBalanceMoney = Money.from(goal.currentAmount);
    const update = buildGoalBalanceUpdate(goal, currentBalanceMoney, today);

    if (!hasGoalUpdate(goal, update)) {
      continue;
    }

    const [updatedGoal] = await db
      .update(goals)
      .set({
        currentAmount: update.currentAmount,
        status: update.status,
        monthlyProjection: update.monthlyProjection,
        projectedCompletionDate: update.projectedCompletionDate,
        isCompleted: update.isCompleted,
        completedAt: update.completedAt,
        updatedAt: new Date(),
      })
      .where(eq(goals.id, goal.id))
      .returning();

    updatedCount += 1;

    if (update.status !== goal.status) {
      statusChanges += 1;
      await goalActivityLogService.log({
        goalId: goal.id,
        activityType: "status_changed",
        amount: null,
        // Use Money class for previous/new balance (safe toNumber for logging)
        previousBalance: Money.from(goal.currentAmount).toNumber(),
        newBalance: Money.from(updatedGoal.currentAmount).toNumber(),
        metadata: {
          previousStatus: goal.status,
          newStatus: update.status,
          percentComplete: calculatePercentComplete(updatedGoal),
        },
        createdBy: null,
      });
    }
  }

  logger.info("Goal status recalculation complete", {
    job: "goal-status", outcome: "success",
    totalGoals: activeGoals.length,
    updatedCount,
    statusChanges,
  });

  return { totalGoals: activeGoals.length, updatedCount, statusChanges };
}
