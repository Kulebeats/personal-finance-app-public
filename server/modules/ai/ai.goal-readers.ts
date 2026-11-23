/**
 * AI goal readers (C3-08).
 *
 * A shared goal and its target stay visible to every member who can read the
 * household's finances. Progress is derived from sources (linked or debt
 * account, assignments, linked transactions, contributions, retained activity).
 * When any of those sources is hidden from the current member, the progress is
 * reported as unavailable, never as a number, and the source account is withheld.
 * A pay-down goal's target is its debt account's balance, so it is withheld
 * too, and completion (derived from progress) never filters a hidden goal out,
 * as on the goal screens (#235 M4).
 *
 * @module ai/ai.goal-readers
 */

import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { accounts, goals } from "@shared/schema";
import { db } from "../../db";
import { Money } from "../../core/money";
import { visibleGoalProgressSources } from "../../core/authz/goal-progress-visibility";
import {
  readableMembershipPredicate,
  visibleAccountPredicate,
} from "../../core/authz/transaction-visibility";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { GoalAssignmentResult, GoalStatusResult } from "./ai.types";
import { goalPrivacyFilters } from "./ai.privacy-filters";

type GoalProgressStatus = "on_track" | "behind" | "ahead" | "completed";

const AHEAD_PROGRESS = "0.8";
const ON_TRACK_PROGRESS = "0.5";

/** True only when every progress source is visible to the actor; NULL fails closed. */
function progressVisibleColumn(actor: HouseholdContext) {
  return sql<boolean>`coalesce((${visibleGoalProgressSources(actor)}), false)`;
}

/** Completed goals drop out only where completion is visible; a hidden goal always stays listed. */
function goalScope(actor: HouseholdContext): SQL {
  return and(
    readableMembershipPredicate(actor),
    ...goalPrivacyFilters(actor.householdId, { includeCompleted: true }),
    sql`(${goals.isCompleted} = false or ${progressVisibleColumn(actor)} is not true)`,
  )!;
}

/** A shared target, or none when it is the hidden debt balance of a pay-down goal. */
function visibleTarget(type: string, targetAmount: string, progressVisible: boolean, currency: string): Money | null {
  if (!progressVisible && type === "pay_down") return null;
  return Money.from(targetAmount, currency);
}

function progressStatus(current: Money, target: Money): GoalProgressStatus {
  if (current.gte(target)) return "completed";
  if (!target.isPositive()) return "behind";
  const progress = current.divide(target.toString());
  if (progress.gte(AHEAD_PROGRESS)) return "ahead";
  if (progress.gte(ON_TRACK_PROGRESS)) return "on_track";
  return "behind";
}

export async function readGoalsStatus(
  actor: HouseholdContext,
  currency: string,
): Promise<GoalStatusResult[]> {
  const rows = await db
    .select({ goal: goals, progressVisible: progressVisibleColumn(actor) })
    .from(goals)
    .where(goalScope(actor))
    .orderBy(desc(goals.createdAt));

  return rows.map(({ goal, progressVisible }): GoalStatusResult => {
    const base = {
      goalId: goal.id,
      name: goal.name,
      projectedCompletion: goal.targetDate,
    };
    if (progressVisible !== true) {
      return {
        ...base, target: visibleTarget(goal.type, goal.targetAmount, false, currency),
        progressAvailability: "unavailable", current: null, status: null, monthlyContribution: null,
      };
    }
    const target = Money.from(goal.targetAmount, currency);
    const current = Money.from(goal.currentAmount, currency);
    return {
      ...base,
      target,
      progressAvailability: "available",
      current,
      status: progressStatus(current, target),
      monthlyContribution: goal.monthlyProjection
        ? Money.from(goal.monthlyProjection, currency)
        : Money.zero(currency),
    };
  });
}

export async function readGoalAssignments(
  actor: HouseholdContext,
  currency: string,
): Promise<GoalAssignmentResult[]> {
  const rows = await db
    .select({
      goalId: goals.id,
      goalName: goals.name,
      goalType: goals.type,
      targetAmount: goals.targetAmount,
      currentAmount: goals.currentAmount,
      accountId: accounts.id,
      accountName: accounts.name,
      progressVisible: progressVisibleColumn(actor),
    })
    .from(goals)
    .leftJoin(accounts, and(eq(goals.linkedAccountId, accounts.id), visibleAccountPredicate(actor)))
    .where(goalScope(actor))
    // A stable order keeps each `account_N` label on the same goal between requests.
    .orderBy(goals.createdAt, goals.id);

  return rows.map((row): GoalAssignmentResult => {
    const base = {
      goalId: row.goalId,
      goalName: row.goalName,
    };
    if (row.progressVisible !== true) {
      return {
        ...base, target: visibleTarget(row.goalType, row.targetAmount, false, currency),
        progressAvailability: "unavailable", accountId: null, accountName: null, current: null,
      };
    }
    return {
      ...base,
      target: Money.from(row.targetAmount, currency),
      progressAvailability: "available",
      accountId: row.accountId,
      accountName: row.accountName,
      current: Money.from(row.currentAmount, currency),
    };
  });
}
