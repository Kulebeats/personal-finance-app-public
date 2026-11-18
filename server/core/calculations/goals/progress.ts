/**
 * Calculation Engine - Goal Progress Calculation
 *
 * Calculates goal progress including percentage complete and remaining amount.
 *
 * @module core/calculations/goals/progress
 */

import { Money, Percentage, toMoney, toPercentage } from "../types";
import { roundToDecimals } from "../helpers";

/**
 * Complete goal progress result.
 */
export interface GoalProgress {
  /** Current amount saved toward goal */
  currentAmount: Money;
  /** Target amount for the goal */
  targetAmount: Money;
  /** Remaining amount needed */
  remainingAmount: Money;
  /** Percentage complete (0-100+) */
  percentComplete: Percentage;
  /** Whether goal is complete */
  isComplete: boolean;
}

/**
 * Calculates goal progress including percentage and remaining amount.
 *
 * @formula percentComplete = (currentAmount / targetAmount) * 100
 * @rounding 2 decimal places
 * @edge-cases
 *   - targetAmount <= 0: returns 100% if currentAmount > 0, else 0%
 *   - currentAmount can exceed targetAmount (over-funded)
 *
 * @param currentAmount - Current amount saved toward goal
 * @param targetAmount - Target amount for the goal
 * @returns Complete goal progress data
 *
 * @example
 * ```ts
 * const progress = calculateGoalProgress(toMoney(5000), toMoney(10000));
 * // { percentComplete: 50, remainingAmount: 5000, isComplete: false }
 * ```
 */
export function calculateGoalProgress(
  currentAmount: Money,
  targetAmount: Money
): GoalProgress {
  const remainingAmount = toMoney(Math.max(0, targetAmount - currentAmount));

  // SCP-337: handle the three target signs distinctly. Round to 4dp so a tiny
  // overshoot (e.g. 10000.01/10000) still reports >100 instead of collapsing to
  // exactly 100 under 2dp rounding.
  let percentComplete: number;
  let isComplete: boolean;
  if (targetAmount > 0) {
    percentComplete = roundToDecimals((currentAmount / targetAmount) * 100, 4);
    isComplete = currentAmount >= targetAmount;
  } else if (targetAmount < 0) {
    // Debt-payoff goal: both amounts are negative, so current/target is a
    // positive percentage; "complete" once paid down to or past the target.
    percentComplete = roundToDecimals((currentAmount / targetAmount) * 100, 4);
    isComplete = currentAmount <= targetAmount;
  } else {
    // targetAmount === 0: a positive balance fully satisfies a zero target.
    percentComplete = currentAmount > 0 ? 100 : 0;
    isComplete = currentAmount > 0;
  }

  return {
    currentAmount,
    targetAmount,
    remainingAmount,
    percentComplete: toPercentage(percentComplete),
    isComplete,
  };
}

/**
 * Calculates just the percentage complete for a goal.
 * Simpler function for when full progress data isn't needed.
 *
 * @param currentAmount - Current amount
 * @param targetAmount - Target amount
 * @returns Percentage complete
 */
export function calculatePercentComplete(
  currentAmount: Money,
  targetAmount: Money
): Percentage {
  if (targetAmount <= 0) {
    return toPercentage(currentAmount > 0 ? 100 : 0);
  }

  return toPercentage(roundToDecimals((currentAmount / targetAmount) * 100, 2));
}

/**
 * Calculates progress for an annual goal with monthly tracking.
 *
 * @param currentAmount - Current amount for this year
 * @param monthlyTarget - Monthly contribution target
 * @param monthsElapsed - Number of months elapsed this year (1-12)
 * @returns Goal progress relative to pro-rated target
 */
export function calculateAnnualGoalProgress(
  currentAmount: Money,
  monthlyTarget: Money,
  monthsElapsed: number
): GoalProgress {
  // SCP-337: report progress against the pro-rated target — what you should have
  // saved by now at the monthly pace — so this answers "are you keeping pace?".
  // The target scales with months elapsed: zero at the start of the year, and a
  // full year of contributions by year end. (Previously it mixed a pro-rated base
  // with an annual target and percent, which disagreed across the month range.)
  const proRatedTarget = toMoney(monthlyTarget * monthsElapsed);
  return calculateGoalProgress(currentAmount, proRatedTarget);
}
