/**
 * Goal progress adjustments (#222 review round 4).
 *
 * A goal transfer or a partial-balance assignment changes progress without a
 * link or a contribution. Each change is written as an adjustment at its
 * place in the goal's applied order and folded like every other source
 * (GoalProgressFold), so a later edit or removal of an earlier source replays
 * it where it happened instead of treating it as if it came first.
 *
 * Callers own the transaction and must already hold the goal row FOR UPDATE.
 *
 * @module services/goal/GoalProgressAdjustments
 */

import { goalProgressAdjustments, type Goal } from "@shared/schema";
import { Money } from "../../core/money";
import type { TransactionType } from "../../utils/withTransaction";
import { PENDING_EFFECT, refoldGoalProgress, sourceTimeSql, type RefoldResult } from "./GoalProgressFold";

export type GoalAdjustmentKind = "transfer_in" | "transfer_out" | "assignment";

export interface GoalAdjustment {
  kind: GoalAdjustmentKind;
  /** Signed, in the goal's currency: positive adds, negative takes back. */
  amount: Money;
  /** The goal transfer, or the assigned account. No foreign key: a removed assignment has no row. */
  refId: string;
  createdBy: string | null;
}

/** Records the change at the goal's next place and folds it; a zero change is refused. */
export async function applyProgressAdjustment(
  tx: TransactionType,
  goal: Goal,
  adjustment: GoalAdjustment,
): Promise<RefoldResult> {
  if (adjustment.amount.isZero()) throw new Error("A goal progress adjustment must change progress");
  const [inserted] = await tx.insert(goalProgressAdjustments).values({
    goalId: goal.id,
    kind: adjustment.kind,
    refId: adjustment.refId,
    amount: new Money(adjustment.amount.toString(), goal.currency).toString(),
    appliedDelta: PENDING_EFFECT,
    placedAt: sourceTimeSql(goal.id),
    createdBy: adjustment.createdBy,
  }).returning({ id: goalProgressAdjustments.id });
  return refoldGoalProgress(tx, goal, { from: inserted.id });
}
