import { db } from "../db";
import { goalActivityLog, goals, type GoalActivityLog } from "@shared/schema";
import { desc, eq, inArray, and, sql } from "drizzle-orm";
import type { TransactionType } from "../utils/withTransaction";
import type { HouseholdContext } from "../middleware/householdGuard";
import { readableMembershipPredicate } from "../core/authz/transaction-visibility";
import { visibleGoalActivitySources } from "../core/authz/goal-activity-visibility";
import { readGoalSourceVisibility } from "./goal/GoalViewerProgress";
import { NotFoundError } from "../core/errors";
import { Money } from "../core/money";

type DbExecutor = typeof db | TransactionType;
/** A logged amount: Money keeps exact decimals; numbers remain for older callers. */
type LoggedAmount = Money | number | null | undefined;

function loggedAmount(value: LoggedAmount): string | null {
  if (value === undefined || value === null) return null;
  return value instanceof Money ? value.toString() : value.toFixed(2);
}

export type GoalActivityType =
  | "goal_created"
  | "goal_updated"
  | "goal_archived"
  | "goal_unarchived"
  | "goal_completed"
  | "contribution_added"
  | "contribution_removed"
  | "transfer_in"
  | "transfer_out"
  | "transaction_linked"
  | "transaction_unlinked"
  | "account_assigned"
  | "account_unassigned"
  | "balance_synced"
  | "status_changed"
  | "milestone_reached"
  | "migrated_to_v3";

/** Metadata values derived from a goal's progress (a completion percent, a status, a former target). */
const PROGRESS_METADATA_KEYS = ["percentComplete", "previousPercent", "previousStatus", "newStatus"] as const;
const PROGRESS_PREVIOUS_VALUE_KEYS = ["targetAmount", "originalBalance", "currentAmount"] as const;

function withoutKeys(value: unknown, keys: readonly string[]): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

/**
 * An entry on a goal whose progress the viewer cannot see: no balance, no
 * amount (a spend's clamped effect is the progress it took, #235 M6), and no
 * metadata value derived from the progress.
 */
function redactHiddenActivity(entry: GoalActivityLog): GoalActivityLog {
  const metadata = withoutKeys(entry.metadata, PROGRESS_METADATA_KEYS) as Record<string, unknown> | null;
  const redacted = metadata && "previousValues" in metadata
    ? { ...metadata, previousValues: withoutKeys(metadata.previousValues, PROGRESS_PREVIOUS_VALUE_KEYS) }
    : metadata;
  return { ...entry, amount: null, previousBalance: null, newBalance: null, metadata: redacted };
}

export class GoalActivityLogService {
  async log(params: {
    goalId: string;
    activityType: GoalActivityType;
    amount?: LoggedAmount;
    previousBalance?: LoggedAmount;
    newBalance?: LoggedAmount;
    metadata?: Record<string, unknown> | null;
    createdBy?: string | null;
    tx?: TransactionType;
  }): Promise<GoalActivityLog> {
    const executor: DbExecutor = params.tx ?? db;
    const [entry] = await executor
      .insert(goalActivityLog)
      .values({
        goalId: params.goalId,
        activityType: params.activityType,
        amount: loggedAmount(params.amount),
        previousBalance: loggedAmount(params.previousBalance),
        newBalance: loggedAmount(params.newBalance),
        metadata: params.metadata ?? null,
        createdBy: params.createdBy ?? null,
      })
      .returning();

    return entry;
  }

  async getActivity(
    goalId: string,
    actor: HouseholdContext,
    options?: { limit?: number; offset?: number; types?: GoalActivityType[] }
  ): Promise<GoalActivityLog[]> {
    const readableGoal = and(
      eq(goals.id, goalId),
      eq(goals.householdId, actor.householdId),
      readableMembershipPredicate(actor)
    )!;
    const [goal] = await db.select({ id: goals.id }).from(goals).where(readableGoal).limit(1);
    if (!goal) throw new NotFoundError("Goal");

    // An entry naming a source hidden from this viewer is filtered out (Rule 11).
    const conditions = [
      eq(goalActivityLog.goalId, goalId),
      sql`exists (select 1 from ${goals} where ${readableGoal})`,
      visibleGoalActivitySources(actor),
    ];

    if (options?.types?.length) {
      conditions.push(inArray(goalActivityLog.activityType, options.types));
    }

    const baseQuery = db
      .select()
      .from(goalActivityLog)
      .where(and(...conditions))
      .orderBy(desc(goalActivityLog.createdAt));

    const entries = options?.limit
      ? await baseQuery.limit(options.limit).offset(options.offset ?? 0)
      : await baseQuery;

    // Running balances are the goal's aggregate progress; withhold them when
    // any progress source is hidden, as the goal detail does.
    const visibility = await readGoalSourceVisibility(actor, [goalId]);
    if (visibility.get(goalId)?.progressVisible) return entries;
    return entries.map(redactHiddenActivity);
  }
}

export const goalActivityLogService = new GoalActivityLogService();
