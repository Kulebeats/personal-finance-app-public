/**
 * Goal Account Assignment Sync
 *
 * Account sync and balance recalculation operations.
 *
 * @module services/goal/assignment.sync
 */

import { db } from "../../db";
import {
  accounts,
  goalAccountAssignments,
  goals,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { goalActivityLogService } from "../GoalActivityLogService";
import { notificationService } from "../NotificationService";
import {
  buildGoalBalanceUpdate,
  calculatePercentComplete,
} from "../goalCalculations";
import { Money } from "../../core/money";
import { calculateAssignmentBalance, hasBalanceUpdate } from "./assignment.calculations";

/**
 * Sync all goals linked to an account (triggered by account balance changes)
 */
export async function syncGoalsForAccount(
  accountId: string,
  trigger: string
): Promise<void> {
  const assignments = await db
    .select()
    .from(goalAccountAssignments)
    .where(
      and(
        eq(goalAccountAssignments.accountId, accountId),
        eq(goalAccountAssignments.assignmentType, "full_balance"),
        eq(goalAccountAssignments.autoUpdate, true)
      )
    );

  const linkedGoals = await db
    .select({ id: goals.id })
    .from(goals)
    .where(
      and(
        eq(goals.linkedAccountId, accountId),
        eq(goals.progressSource, "holdings")
      )
    );

  const goalIds = Array.from(
    new Set([
      ...assignments.map((a) => a.goalId),
      ...linkedGoals.map((g) => g.id),
    ])
  );

  for (const goalId of goalIds) {
    await recalculateGoalBalance(goalId, trigger, accountId);
  }

  await recalculateDebtGoalsForAccount(accountId, trigger);
}

/**
 * Recalculate a single goal's balance from its assignments
 */
export async function recalculateGoalBalance(
  goalId: string,
  trigger: string,
  accountId?: string
) {
  const [goal] = await db.select().from(goals).where(eq(goals.id, goalId));

  if (!goal) return;

  const previousBalanceMoney = new Money(goal.currentAmount);
  const newBalanceMoney = await calculateAssignmentBalance(goalId);
  const previousBalance = previousBalanceMoney.toNumber();
  const newBalance = newBalanceMoney.toNumber();

  const update = buildGoalBalanceUpdate(goal, newBalance);
  if (!hasBalanceUpdate(goal, update)) {
    return goal;
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
    .where(eq(goals.id, goalId))
    .returning();

  await goalActivityLogService.log({
    goalId,
    activityType: "balance_synced",
    amount: null,
    previousBalance,
    newBalance,
    metadata: { trigger, accountId: accountId ?? null },
    tx: undefined,
  });

  const percentBefore = calculatePercentComplete(goal, previousBalance);
  const percentAfter = calculatePercentComplete(goal, newBalance);
  notificationService
    .triggerGoalMilestone(
      goal.householdId,
      updatedGoal.id,
      updatedGoal.name,
      percentBefore,
      percentAfter
    )
    .catch(() => undefined);

  return updatedGoal;
}

/**
 * Recalculate debt goals when their linked account balance changes
 */
export async function recalculateDebtGoalsForAccount(
  accountId: string,
  trigger: string
): Promise<void> {
  const [account] = await db
    .select({ balance: accounts.balance })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);

  if (!account) return;

  const debtGoals = await db
    .select()
    .from(goals)
    .where(eq(goals.debtAccountId, accountId));

  if (!debtGoals.length) return;

  const newBalanceMoney = new Money(account.balance).abs();
  const newBalance = newBalanceMoney.toNumber();

  for (const goal of debtGoals) {
    const previousBalance = new Money(goal.currentAmount).toNumber();
    const update = buildGoalBalanceUpdate(goal, newBalance);

    if (!hasBalanceUpdate(goal, update)) {
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

    await goalActivityLogService.log({
      goalId: goal.id,
      activityType: "balance_synced",
      amount: null,
      previousBalance,
      newBalance,
      metadata: { trigger, accountId },
      tx: undefined,
    });

    const percentBefore = calculatePercentComplete(goal, previousBalance);
    const percentAfter = calculatePercentComplete(goal, newBalance);
    notificationService
      .triggerGoalMilestone(
        goal.householdId,
        updatedGoal.id,
        updatedGoal.name,
        percentBefore,
        percentAfter
      )
      .catch(() => undefined);
  }
}
