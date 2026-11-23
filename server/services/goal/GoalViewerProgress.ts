/**
 * Viewer-scoped goal progress (FIN-01 / OPS-005 leftovers).
 *
 * A shared goal and its target stay visible to every member who can read the
 * household's finances. Its stored progress is an aggregate of its sources
 * (linked or debt account, assignments, linked transactions, contributions,
 * retained activity, transferred goals). When any source is hidden from the
 * viewer, the progress is withheld, never shown as a number, and the hidden
 * account IDs are withheld too. So is everything derived from that progress:
 * completion, and a debt goal's target and original balance (they come from
 * the debt account's balance). This is the same verdict the AI goal readers
 * reach through `visibleGoalProgressSources` (ai.goal-readers.ts).
 *
 * @module services/goal/GoalViewerProgress
 */

import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { accounts, goals, type Goal } from "@shared/schema";
import { db } from "../../db";
import type { TransactionType } from "../../utils/withTransaction";
import { visibleGoalProgressSources } from "../../core/authz/goal-progress-visibility";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import type { HouseholdContext } from "../../middleware/householdGuard";

export type ProgressAvailability = "available" | "unavailable";

export interface GoalSourceVisibility {
  progressVisible: boolean;
  linkedAccountVisible: boolean;
  debtAccountVisible: boolean;
}

/** Fields whose value is derived from the goal's progress sources. */
interface ProgressFields {
  id: string;
  type: string;
  targetAmount: string;
  currentAmount: string;
  originalBalance: string | null;
  status: string;
  isCompleted: boolean;
  completedAt: Date | null;
  monthlyProjection: string | null;
  projectedCompletionDate: string | null;
  linkedAccountId: string | null;
  debtAccountId: string | null;
}

type RedactedField =
  | "targetAmount" | "currentAmount" | "originalBalance" | "status" | "isCompleted" | "completedAt"
  | "monthlyProjection" | "projectedCompletionDate" | "linkedAccountId" | "debtAccountId";

export type ViewerGoal<T extends ProgressFields> = Omit<T, RedactedField> & {
  targetAmount: string | null;
  currentAmount: string | null;
  originalBalance: string | null;
  status: T["status"] | null;
  isCompleted: boolean | null;
  completedAt: Date | null;
  monthlyProjection: string | null;
  projectedCompletionDate: string | null;
  linkedAccountId: string | null;
  debtAccountId: string | null;
  progressAvailability: ProgressAvailability;
};

const HIDDEN: GoalSourceVisibility = {
  progressVisible: false,
  linkedAccountVisible: false,
  debtAccountVisible: false,
};

/** True when the pointer is empty or names an account the viewer may see; NULL fails closed. */
function visiblePointer(actor: HouseholdContext, column: AnyPgColumn): SQL<boolean> {
  const visible = or(isNull(column), sql`exists (select 1 from ${accounts}
    where ${accounts.id} = ${column} and ${visibleAccountPredicate(actor)})`);
  return sql<boolean>`coalesce((${visible}), false)`;
}

function verdictColumns(actor: HouseholdContext) {
  return {
    progressVisible: sql<boolean>`coalesce((${visibleGoalProgressSources(actor)}), false)`,
    linkedAccountVisible: visiblePointer(actor, goals.linkedAccountId),
    debtAccountVisible: visiblePointer(actor, goals.debtAccountId),
  };
}

function toVerdict(row: { progressVisible: boolean; linkedAccountVisible: boolean; debtAccountVisible: boolean }): GoalSourceVisibility {
  return {
    progressVisible: row.progressVisible === true,
    linkedAccountVisible: row.linkedAccountVisible === true,
    debtAccountVisible: row.debtAccountVisible === true,
  };
}

/** One statement evaluates every goal's source visibility for this viewer. */
export async function readGoalSourceVisibility(
  actor: HouseholdContext,
  goalIds: readonly string[],
  executor: typeof db | TransactionType = db,
): Promise<Map<string, GoalSourceVisibility>> {
  if (!goalIds.length) return new Map();
  const rows = await executor
    .select({ id: goals.id, ...verdictColumns(actor) })
    .from(goals)
    .where(and(eq(goals.householdId, actor.householdId), inArray(goals.id, [...goalIds])));
  return new Map(rows.map(row => [row.id, toVerdict(row)]));
}

/**
 * For each goal, whether each viewer can see all of its progress, in viewer
 * order, judged in one statement (#235 R3-3). A goal not found is hidden from all.
 */
export async function progressVisibilityByGoal(
  householdId: string,
  goalIds: readonly string[],
  viewers: readonly HouseholdContext[],
  executor: typeof db | TransactionType = db,
): Promise<Map<string, boolean[]>> {
  if (!goalIds.length || !viewers.length) return new Map();
  const columns = Object.fromEntries(viewers.map((viewer, index) => [
    `viewer${index}`, sql<boolean>`coalesce((${visibleGoalProgressSources(viewer)}), false)`,
  ]));
  const rows = await executor
    .select({ ...columns, goalId: goals.id })
    .from(goals)
    .where(and(eq(goals.householdId, householdId), inArray(goals.id, [...goalIds])));
  return new Map(rows.map((row) => [
    row.goalId, viewers.map((_, index) => (row as Record<string, unknown>)[`viewer${index}`] === true),
  ]));
}

/** Whether each viewer can see all of this goal's progress, judged in one statement (#235 R3-3). */
export async function progressVisibleToEach(
  householdId: string,
  goalId: string,
  viewers: readonly HouseholdContext[],
  executor: typeof db | TransactionType = db,
): Promise<boolean[]> {
  const verdicts = await progressVisibilityByGoal(householdId, [goalId], viewers, executor);
  return viewers.map((_, index) => verdicts.get(goalId)?.[index] === true);
}

/** Goals among `goalIds` whose progress `viewer` cannot fully see; none for a system caller. */
export async function goalsWithHiddenProgress(
  viewer: HouseholdContext | undefined,
  goalIds: readonly string[],
  executor: typeof db | TransactionType = db,
): Promise<Set<string>> {
  if (!viewer || !goalIds.length) return new Set();
  const verdicts = await readGoalSourceVisibility(viewer, goalIds, executor);
  return new Set(goalIds.filter((id) => verdicts.get(id)?.progressVisible !== true));
}

export interface GoalRowFilter {
  goalId?: string;
  type?: Goal["type"];
  includeArchived?: boolean;
}

/**
 * Goal rows with this viewer's verdict on each, read in one statement, so
 * the row and the verdict describe the same snapshot (#184 finding 4).
 * Filters on progress-derived values (status, completion) are not applied
 * here: they run on the redacted goal, so they never select on hidden values.
 */
export async function readGoalsWithVisibility(
  actor: HouseholdContext,
  filter: GoalRowFilter,
): Promise<Array<{ goal: Goal; visibility: GoalSourceVisibility }>> {
  const conditions = [eq(goals.householdId, actor.householdId)];
  if (filter.goalId) conditions.push(eq(goals.id, filter.goalId));
  if (filter.type) conditions.push(eq(goals.type, filter.type));
  if (!filter.goalId && !filter.includeArchived) conditions.push(eq(goals.isArchived, false));
  const rows = await db
    .select({ goal: goals, ...verdictColumns(actor) })
    .from(goals)
    .where(and(...conditions))
    .orderBy(goals.createdAt);
  return rows.map(row => ({ goal: row.goal, visibility: toVerdict(row) }));
}

/** Pure: a missing verdict fails closed. */
export function toViewerGoal<T extends ProgressFields>(
  goal: T,
  visibility: GoalSourceVisibility | undefined,
): ViewerGoal<T> {
  const verdict = visibility ?? HIDDEN;
  const pointers = {
    linkedAccountId: verdict.linkedAccountVisible ? goal.linkedAccountId : null,
    debtAccountId: verdict.debtAccountVisible ? goal.debtAccountId : null,
  };
  if (verdict.progressVisible) {
    return { ...goal, ...pointers, progressAvailability: "available" };
  }
  return {
    ...goal,
    ...pointers,
    // A pay-down goal's target and original balance are its debt account's balance.
    targetAmount: goal.type === "pay_down" ? null : goal.targetAmount,
    currentAmount: null,
    originalBalance: null,
    status: null,
    isCompleted: null,
    completedAt: null,
    monthlyProjection: null,
    projectedCompletionDate: null,
    progressAvailability: "unavailable",
  };
}

export async function toViewerGoals<T extends ProgressFields>(
  actor: HouseholdContext,
  goalList: readonly T[],
): Promise<ViewerGoal<T>[]> {
  const visibility = await readGoalSourceVisibility(actor, goalList.map(goal => goal.id));
  return goalList.map(goal => toViewerGoal(goal, visibility.get(goal.id)));
}
