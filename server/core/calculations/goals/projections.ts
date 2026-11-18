/**
 * Calculation Engine - Goal Projections
 *
 * Projects when a goal will be completed based on contribution patterns.
 *
 * @module core/calculations/goals/projections
 */

import { Money, toMoney } from "../types";
import { roundToDecimals } from "../helpers";

/**
 * Goal projection result.
 */
export interface GoalProjection {
  /** Projected completion date (ISO string) */
  projectedCompletionDate: string;
  /** Days until projected completion */
  daysToCompletion: number;
  /** Monthly contribution required to meet target date */
  requiredMonthlySavings: Money;
  /** Is the goal achievable by target date with current rate? */
  isAchievable: boolean;
  /** Current monthly contribution rate */
  currentMonthlyRate: Money;
}

/**
 * Input for goal projection calculation.
 */
export interface ProjectionInput {
  currentAmount: Money;
  targetAmount: Money;
  targetDate: string;
  /** Contributions over a period for rate calculation */
  recentContributions: Money;
  /** Period for contributions in days */
  contributionPeriodDays: number;
  currentDate?: string;
}

/**
 * Calculates goal projection based on current contribution rate.
 *
 * @param input - Projection input data
 * @returns Goal projection
 *
 * @example
 * ```ts
 * const projection = calculateGoalProjection({
 *   currentAmount: toMoney(5000),
 *   targetAmount: toMoney(10000),
 *   targetDate: '2025-12-31',
 *   recentContributions: toMoney(1000),
 *   contributionPeriodDays: 30,
 * });
 * ```
 */
export function calculateGoalProjection(
  input: ProjectionInput
): GoalProjection {
  const {
    currentAmount,
    targetAmount,
    targetDate,
    recentContributions,
    contributionPeriodDays,
  } = input;
  const currentDate =
    input.currentDate ?? new Date().toISOString().split("T")[0];

  const remaining = Math.max(0, targetAmount - currentAmount);

  // Calculate current monthly rate
  const dailyRate =
    contributionPeriodDays > 0
      ? recentContributions / contributionPeriodDays
      : 0;
  const currentMonthlyRate = toMoney(roundToDecimals(dailyRate * 30, 2));

  // Calculate days to completion at current rate
  let daysToCompletion: number;
  if (remaining <= 0) {
    daysToCompletion = 0;
  } else if (dailyRate <= 0) {
    daysToCompletion = Infinity;
  } else {
    daysToCompletion = Math.ceil(remaining / dailyRate);
  }

  // Calculate projected completion date
  const currentDateObj = new Date(currentDate);
  let projectedCompletionDate: string;
  if (daysToCompletion === 0) {
    projectedCompletionDate = currentDate;
  } else if (!Number.isFinite(daysToCompletion)) {
    projectedCompletionDate = "never";
  } else {
    const projectedDate = new Date(currentDateObj);
    projectedDate.setDate(projectedDate.getDate() + daysToCompletion);
    projectedCompletionDate = projectedDate.toISOString().split("T")[0];
  }

  // Calculate required monthly savings to meet target date
  const targetDateObj = new Date(targetDate);
  const daysUntilTarget = Math.max(
    1,
    daysBetween(currentDateObj, targetDateObj)
  );
  const monthsUntilTarget = daysUntilTarget / 30;
  const requiredMonthlySavings = toMoney(
    roundToDecimals(remaining / Math.max(1, monthsUntilTarget), 2)
  );

  // Is achievable?
  const isAchievable =
    projectedCompletionDate !== "never" &&
    new Date(projectedCompletionDate) <= targetDateObj;

  return {
    projectedCompletionDate,
    daysToCompletion: Number.isFinite(daysToCompletion) ? daysToCompletion : -1,
    requiredMonthlySavings,
    isAchievable,
    currentMonthlyRate,
  };
}

/**
 * Helper to calculate days between two dates.
 */
function daysBetween(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((end.getTime() - start.getTime()) / msPerDay);
}

/**
 * Calculates required monthly contribution to reach a goal by a target date.
 *
 * @param remainingAmount - Amount still needed
 * @param monthsRemaining - Months until deadline
 * @returns Required monthly contribution
 */
export function calculateRequiredMonthlyContribution(
  remainingAmount: Money,
  monthsRemaining: number
): Money {
  // SCP-337: only zero months short-circuits (to avoid divide-by-zero). A
  // negative remaining (over-funded) or negative months (past due) legitimately
  // yields a negative figure, and a zero remaining divides to 0 on its own — so
  // don't collapse those to 0 the way the old `<= 0` guard did.
  if (monthsRemaining === 0) {
    return toMoney(0);
  }

  return toMoney(roundToDecimals(remainingAmount / monthsRemaining, 2));
}
