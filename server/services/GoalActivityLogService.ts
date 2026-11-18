import { db } from "../db";
import { goalActivityLog, type GoalActivityLog } from "@shared/schema";
import { desc, eq, inArray, and } from "drizzle-orm";
import type { TransactionType } from "../utils/withTransaction";

type DbExecutor = typeof db | TransactionType;

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

export class GoalActivityLogService {
  async log(params: {
    goalId: string;
    activityType: GoalActivityType;
    amount?: number | null;
    previousBalance?: number | null;
    newBalance?: number | null;
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
        amount:
          params.amount !== undefined && params.amount !== null
            ? params.amount.toFixed(2)
            : null,
        previousBalance:
          params.previousBalance !== undefined &&
          params.previousBalance !== null
            ? params.previousBalance.toFixed(2)
            : null,
        newBalance:
          params.newBalance !== undefined && params.newBalance !== null
            ? params.newBalance.toFixed(2)
            : null,
        metadata: params.metadata ?? null,
        createdBy: params.createdBy ?? null,
      })
      .returning();

    return entry;
  }

  async getActivity(
    goalId: string,
    options?: { limit?: number; offset?: number; types?: GoalActivityType[] }
  ): Promise<GoalActivityLog[]> {
    const conditions = [eq(goalActivityLog.goalId, goalId)];

    if (options?.types?.length) {
      conditions.push(inArray(goalActivityLog.activityType, options.types));
    }

    const baseQuery = db
      .select()
      .from(goalActivityLog)
      .where(and(...conditions))
      .orderBy(desc(goalActivityLog.createdAt));

    if (options?.limit) {
      if (options.offset) {
        return baseQuery.limit(options.limit).offset(options.offset);
      }
      return baseQuery.limit(options.limit);
    }

    return baseQuery;
  }
}

export const goalActivityLogService = new GoalActivityLogService();
