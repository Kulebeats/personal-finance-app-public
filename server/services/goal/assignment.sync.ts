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
import { householdToday } from "../householdCalendarToday";
import { calculateAssignmentBalance, hasBalanceUpdate } from "./assignment.calculations";
import { isHouseholdSecurityPriceUnavailable } from "../investment/householdSecurityPriceRead";

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
    await syncGoal(goalId, trigger, { kind: "linked", accountId });
  }

  await recalculateDebtGoalsForAccount(accountId, trigger);
}

type SyncSource =
  | { kind: "assignments"; accountId?: string }
  | { kind: "linked" | "debt"; accountId: string };

async function syncGoal(goalId: string, trigger: string, source: SyncSource) {
  const result = await db.transaction(async (tx) => {
    // Compare with the last committed goal before reading its current balance sources.
    const [goal] = await tx.select().from(goals).where(eq(goals.id, goalId)).for("update");
    if (!goal) return;

    let balance: Money;
    if (source.kind === "debt") {
      if (goal.debtAccountId !== source.accountId) return;
      const [account] = await tx
        .select({ balance: accounts.balance })
        .from(accounts)
        .where(and(eq(accounts.id, source.accountId), eq(accounts.householdId, goal.householdId)));
      if (!account) return;
      balance = new Money(account.balance).abs();
    } else {
      // A link found before the lock may have been removed by an assignment edit.
      const usesLinkedHoldings = goal.linkedAccountId === source.accountId && goal.progressSource === "holdings";
      if (source.kind === "linked" && !usesLinkedHoldings) {
        const [assignment] = await tx
          .select({ id: goalAccountAssignments.id })
          .from(goalAccountAssignments)
          .where(and(
            eq(goalAccountAssignments.goalId, goalId),
            eq(goalAccountAssignments.accountId, source.accountId),
            eq(goalAccountAssignments.assignmentType, "full_balance"),
            eq(goalAccountAssignments.autoUpdate, true)
          ));
        if (!assignment) return;
      }
      const valued = await calculateAssignmentBalance(goalId, tx).catch((error: unknown) => {
        if (isHouseholdSecurityPriceUnavailable(error)) return null;
        throw error;
      });
      // A-30: an unpriced holding leaves the stored progress as it was; a zero is never stored for it.
      if (valued === null) return { goal };
      balance = valued;
    }

    // NEW-15: the saved forecast counts from the household's calendar date.
    const update = buildGoalBalanceUpdate(goal, balance, await householdToday(tx, goal.householdId));
    if (!hasBalanceUpdate(goal, update)) return { goal };

    const previousBalance = new Money(goal.currentAmount).toNumber();
    const newBalance = balance.toNumber();
    const [updatedGoal] = await tx.update(goals).set({ ...update, updatedAt: new Date() })
      .where(eq(goals.id, goalId)).returning();
    await goalActivityLogService.log({
      goalId, activityType: "balance_synced", previousBalance, newBalance,
      metadata: { trigger, accountId: source.accountId ?? null }, tx,
    });
    return {
      goal: updatedGoal,
      milestone: {
        before: calculatePercentComplete(goal, previousBalance),
        after: calculatePercentComplete(goal, newBalance),
      },
    };
  });

  if (result?.milestone) {
    const { goal, milestone } = result;
    notificationService.triggerGoalMilestone(goal.householdId, goal.id, goal.name, milestone.before, milestone.after)
      .catch(() => undefined);
  }
  return result?.goal;
}

export function recalculateGoalBalance(goalId: string, trigger: string, accountId?: string) {
  return syncGoal(goalId, trigger, { kind: "assignments", accountId });
}

export async function recalculateDebtGoalsForAccount(accountId: string, trigger: string): Promise<void> {
  const debtGoals = await db.select({ id: goals.id }).from(goals).where(eq(goals.debtAccountId, accountId));
  for (const goal of debtGoals) {
    await syncGoal(goal.id, trigger, { kind: "debt", accountId });
  }
}
