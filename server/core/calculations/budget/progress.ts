/**
 * Calculation Engine - Budget Progress Calculation
 *
 * Calculates budget progress and spending status.
 *
 * @module core/calculations/budget/progress
 */

import { Money, Percentage, toMoney, toPercentage } from "../types";
import { roundToDecimals } from "../helpers";

/**
 * Budget progress result.
 */
export interface BudgetProgress {
  /** Budget limit */
  budgetAmount: Money;
  /** Amount spent so far */
  spentAmount: Money;
  /** Remaining budget */
  remainingAmount: Money;
  /** Percentage of budget used */
  percentUsed: Percentage;
  /** Is over budget? */
  isOverBudget: boolean;
}

/**
 * Calculates budget progress.
 *
 * @formula percentUsed = (spentAmount / budgetAmount) * 100
 * @edge-cases
 *   - budgetAmount <= 0: returns 0% used
 *   - Can exceed 100% (over budget)
 *
 * @param budgetAmount - The budget limit
 * @param spentAmount - Amount spent
 * @returns Budget progress data
 */
export function calculateBudgetProgress(
  budgetAmount: Money,
  spentAmount: Money
): BudgetProgress {
  const remainingAmount = toMoney(budgetAmount - spentAmount);

  // SCP-337-class fix: handle the three budget signs distinctly. A negative
  // budget is an income-category target; spent/budget there is a positive
  // percent (both negative), and "over" means exceeding the target (more
  // negative). Only a zero budget needs the special-case.
  let percentUsed: number;
  let isOverBudget: boolean;
  if (budgetAmount > 0) {
    percentUsed = roundToDecimals((spentAmount / budgetAmount) * 100, 2);
    isOverBudget = spentAmount > budgetAmount;
  } else if (budgetAmount < 0) {
    percentUsed = roundToDecimals((spentAmount / budgetAmount) * 100, 2);
    isOverBudget = spentAmount < budgetAmount;
  } else {
    percentUsed = spentAmount > 0 ? 100 : 0;
    isOverBudget = spentAmount > 0;
  }

  return {
    budgetAmount,
    spentAmount,
    remainingAmount,
    percentUsed: toPercentage(percentUsed),
    isOverBudget,
  };
}

/**
 * Calculates budget progress relative to the elapsed period.
 *
 * @param budgetAmount - Total budget for the period
 * @param spentAmount - Amount spent so far
 * @param daysElapsed - Days elapsed in the period
 * @param totalDays - Total days in the period
 * @returns Budget progress with pro-rated comparison
 */
export function calculateProRatedBudgetProgress(
  budgetAmount: Money,
  spentAmount: Money,
  daysElapsed: number,
  totalDays: number
): BudgetProgress & { proRatedBudget: Money; isAheadOfPace: boolean } {
  const progress = calculateBudgetProgress(budgetAmount, spentAmount);

  // SCP-337-class fix: with no period (totalDays <= 0) nothing is expected yet,
  // so the pro-rated budget is 0 — not the full budget (the old fallback of 1).
  const proRatedRatio = totalDays > 0 ? daysElapsed / totalDays : 0;
  const proRatedBudget = toMoney(
    roundToDecimals(budgetAmount * proRatedRatio, 2)
  );

  return {
    ...progress,
    proRatedBudget,
    // At-or-under the pro-rated budget = on pace (not behind); spending exactly
    // at pace counts as on pace, hence <= (was a strict <).
    isAheadOfPace: spentAmount <= proRatedBudget,
  };
}
