import { and, eq, isNull, or, sql } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import { accounts, goalAccountAssignments, goalActivityLog, goalContributions, goals, transactionGoalLinks, transactions } from "@shared/schema";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { visibleGoalActivitySources } from "./goal-activity-visibility";
import { readableMembershipPredicate, retainedAccountPredicate, retainedTransactionPredicate } from "./transaction-visibility";

interface GoalSourceColumns {
  id: AnyPgColumn;
  householdId: AnyPgColumn;
  linkedAccountId: AnyPgColumn;
  debtAccountId: AnyPgColumn;
}

/**
 * The goal's own sources: accounts, assignments, linked transactions,
 * contributions, retained activity. Each is judged by its privacy, with soft
 * deletion ignored: a deleted account or transaction still fed the goal, and
 * deleting it must not hide the goal from the members who could see it
 * (#235 M5, R2-3).
 */
function visibleOwnGoalSources(actor: HouseholdContext, goal: GoalSourceColumns) {
  const accountVisible = retainedAccountPredicate(actor);
  const transactionVisible = retainedTransactionPredicate(actor);
  return and(
    eq(goal.householdId, actor.householdId),
    or(isNull(goal.linkedAccountId), sql`exists (select 1 from ${accounts}
      where ${accounts.id} = ${goal.linkedAccountId} and ${accountVisible})`),
    or(isNull(goal.debtAccountId), sql`exists (select 1 from ${accounts}
      where ${accounts.id} = ${goal.debtAccountId} and ${accountVisible})`),
    sql`not exists (select 1 from ${goalAccountAssignments}
      where ${goalAccountAssignments.goalId} = ${goal.id} and not exists (
        select 1 from ${accounts} where ${accounts.id} = ${goalAccountAssignments.accountId}
          and ${accountVisible}))`,
    sql`not exists (select 1 from ${transactionGoalLinks}
      where ${transactionGoalLinks.goalId} = ${goal.id} and not exists (
        select 1 from ${transactions} where ${transactions.id} = ${transactionGoalLinks.transactionId}
          and ${transactionVisible}))`,
    sql`not exists (select 1 from ${goalContributions}
      where ${goalContributions.goalId} = ${goal.id} and ${goalContributions.transactionId} is not null
        and not exists (select 1 from ${transactions}
          where ${transactions.id} = ${goalContributions.transactionId} and ${transactionVisible}))`,
    sql`not exists (select 1 from ${goalActivityLog}
      where ${goalActivityLog.goalId} = ${goal.id}
        and (${visibleGoalActivitySources(actor)}) is not true)`,
  )!;
}

/** A goal transfer moves stored progress, so every goal that ever funded this one
 * (directly or through a chain of transfers) must have visible sources too. */
function visibleTransferredGoalSources(actor: HouseholdContext) {
  const source = alias(goals, "transfer_source_goal");
  return sql`not exists (
    with recursive transfer_closure(to_goal_id, from_goal_id) as (
      select gt.to_goal_id, gt.from_goal_id from goal_transfers gt
        where gt.household_id = ${actor.householdId}
      union
      select closure.to_goal_id, gt.from_goal_id from transfer_closure closure
        join goal_transfers gt on gt.to_goal_id = closure.from_goal_id
          and gt.household_id = ${actor.householdId}
    )
    select 1 from transfer_closure
      left join ${goals} as ${source} on ${source.id} = transfer_closure.from_goal_id
      where transfer_closure.to_goal_id = ${goals.id}
        and (${visibleOwnGoalSources(actor, source)}) is not true
  )`;
}

/** A stored goal balance includes retained history as well as live allocations.
 * A visible trigger alone does not authorize that aggregate. */
export function visibleGoalProgressSources(actor: HouseholdContext) {
  return and(
    readableMembershipPredicate(actor),
    visibleOwnGoalSources(actor, goals),
    visibleTransferredGoalSources(actor),
  )!;
}
