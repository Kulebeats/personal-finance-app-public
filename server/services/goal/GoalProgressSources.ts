/**
 * Goal progress sources (R10.3, FIN-09).
 *
 * Every source that moves a goal's progress stores the signed change it
 * actually applied (`appliedDelta`, after the zero floor), so taking the
 * source away restores the exact prior progress instead of re-deriving it
 * from the source amount. A source in another currency is converted at the
 * household's rate for the source's own date (the R12 lookup); a missing
 * rate refuses the write with MISSING_FX_RATE, never a silent 1.
 *
 * Callers own the transaction and must already hold the goal row FOR UPDATE.
 *
 * @module services/goal/GoalProgressSources
 */

import { eq, sql } from "drizzle-orm";
import { goalContributions, goals, transactionGoalLinks, type Goal, type TransactionGoalLink } from "@shared/schema";
import { Money } from "../../core/money";
import { CalculationError } from "../../core/calculations/errors";
import { ConflictError } from "../../utils/errorHandler";
import { resolvedFxRate } from "../../repositories/reports/fxRateExpr";
import { buildGoalBalanceUpdate, calculatePercentComplete } from "../goalCalculations";
import { householdToday } from "../householdCalendarToday";
import { notificationService } from "../NotificationService";
import type { TransactionType } from "../../utils/withTransaction";

export type GoalLinkType = "contribution" | "spending";
/** Where a link's amount came from: the whole transaction, or an amount the user chose. */
export type GoalAmountBasis = "transaction" | "explicit";

export interface GoalCurrencyAmount {
  /** The amount in the goal's currency; this is what counts toward progress. */
  goalAmount: Money;
  /** The same amount in the source's own currency. */
  sourceAmount: Money;
  /** The dated rate used, or null when the currencies already match. */
  fxRate: string | null;
}

export interface GoalProgressWrite {
  goal: Goal;
  previous: Money;
  next: Money;
}

/**
 * Converts a source amount into the goal currency at the household's rate
 * for `date`. Throws CalculationError("MISSING_FX_RATE"), a 422, when no
 * household or shared rate covers that date.
 */
export async function toGoalCurrency(
  tx: TransactionType,
  householdId: string,
  source: Money,
  goalCurrency: string,
  date: string,
): Promise<GoalCurrencyAmount> {
  if (source.currency === goalCurrency) {
    return { goalAmount: new Money(source.toString(), goalCurrency), sourceAmount: source, fxRate: null };
  }
  const rateExpr = resolvedFxRate(householdId, sql`${source.currency}::text`, goalCurrency, sql`${date}::date`);
  const result = await tx.execute(sql`SELECT (${rateExpr})::text AS rate`);
  const rate = (result.rows[0] as { rate: string | null } | undefined)?.rate ?? null;
  if (rate === null) {
    throw new CalculationError(
      "MISSING_FX_RATE",
      { from: source.currency, to: goalCurrency, date },
      `Exchange rate unavailable for ${source.currency} -> ${goalCurrency} on ${date}`,
    );
  }
  return {
    goalAmount: new Money(source.multiply(rate).toString(), goalCurrency),
    sourceAmount: source,
    fxRate: rate,
  };
}

/**
 * The signed change a source applies to `current`. A contribution adds its
 * amount; spending subtracts it, but never below zero.
 */
export function sourceDelta(current: Money, linkType: GoalLinkType, amount: Money): Money {
  if (linkType === "contribution") return amount;
  return current.lt(amount) ? current.negated() : amount.negated();
}

/**
 * The one answer to a contribution or an edit by a member who cannot see all
 * of the goal's progress. Completion follows that progress, so a refusal that
 * depended on it would reveal it (#235 R2-5); this depends on nothing hidden.
 */
export const HIDDEN_GOAL_WRITE_REFUSAL =
  "This goal's progress includes sources you cannot see, so you cannot add to it or edit it. " +
  "Ask the member who owns those sources to make this change.";

/** What is being recorded into the goal, as the over-fund refusal names it. */
export type GoalInflow = "contribution" | "transfer";

/**
 * NEW-29: a contribution that would take progress past the target needs an
 * explicit confirmation. A member who cannot see the goal's progress (FIN-01)
 * must always confirm, so the answer never reveals the hidden progress.
 */
export function assertWithinTarget(
  goal: Goal, amount: Money, confirmed: boolean, progressHidden: boolean, inflow: GoalInflow = "contribution",
): void {
  if (confirmed) return;
  if (progressHidden) {
    throw new ConflictError(
      "This goal's progress includes sources you cannot see, so it may already be at its target. " +
        `Confirm overfunding to record this ${inflow}.`
    );
  }
  const target = new Money(goal.targetAmount, goal.currency);
  const next = new Money(goal.currentAmount, goal.currency).add(amount);
  if (!next.gt(target)) return;
  throw new ConflictError(
    `This ${inflow} of ${amount.format()} would take the goal past its target of ${target.format()}. ` +
      "Confirm overfunding to record it anyway."
  );
}

/** The delta a link applied; rows written before R10.3 fall back to their amount. */
export function storedLinkDelta(link: TransactionGoalLink, currency: string): Money {
  if (link.appliedDelta !== null) return new Money(link.appliedDelta, currency);
  const amount = new Money(link.amount, currency);
  return link.linkType === "spending" ? amount.negated() : amount;
}

/** Applies `delta` to the locked goal and recomputes its status and projections. */
export async function writeGoalProgress(
  tx: TransactionType,
  goal: Goal,
  delta: Money,
): Promise<GoalProgressWrite> {
  const previous = new Money(goal.currentAmount, goal.currency);
  const next = previous.add(delta);
  // NEW-15: the saved forecast counts from the household's calendar date.
  const today = await householdToday(tx, goal.householdId);
  const [updated] = await tx
    .update(goals)
    .set({ ...buildGoalBalanceUpdate(goal, next, today), updatedAt: new Date() })
    .where(eq(goals.id, goal.id))
    .returning();
  return { goal: updated, previous, next };
}

/**
 * Decides the milestone audience on the writer's transaction (#235 R2-1) and
 * sends the notice once it commits (R3-1). An error deciding the audience
 * rolls the write back; a failed send after commit is only logged.
 */
export async function notifyGoalMilestone(tx: TransactionType, householdId: string, before: Goal, after: Goal): Promise<void> {
  await notificationService.triggerGoalMilestone(
    householdId, after.id, after.name, calculatePercentComplete(before), calculatePercentComplete(after), tx,
  );
}

/** The goal already counts progress from a transaction link or a manual contribution. */
export async function hasCountedSources(tx: TransactionType, goalId: string): Promise<boolean> {
  const result = await tx.execute(sql`SELECT (
    EXISTS (SELECT 1 FROM ${transactionGoalLinks} WHERE ${transactionGoalLinks.goalId} = ${goalId})
    OR COALESCE((SELECT SUM(${goalContributions.amount}) FROM ${goalContributions}
      WHERE ${goalContributions.goalId} = ${goalId}), 0) <> 0
  ) AS counted`);
  return (result.rows[0] as { counted: boolean } | undefined)?.counted === true;
}
