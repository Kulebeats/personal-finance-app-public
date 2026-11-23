/**
 * Calculation Engine - Budget vs Actual Comparison
 *
 * Compares actual spending against budget allocations.
 * Handles interval normalization (monthly budgets viewed as weekly, etc.)
 *
 * @module core/calculations/cashflow/budgetComparison
 */

import { Money } from "../../money";

/**
 * Budget period type supported by the system.
 */
export type BudgetPeriodType = "monthly" | "yearly";

/**
 * Variance status classification.
 * - under: actual < 90% of budget (spending less than planned)
 * - on_track: actual 90-110% of budget (within acceptable range)
 * - over: actual > 110% of budget (spending more than planned)
 */
export type VarianceStatus = "under" | "on_track" | "over";

/**
 * Input budget for comparison calculations.
 */
export interface BudgetInput {
  categoryId: string;
  categoryName: string;
  amount: string;
  currency: string;
  periodType: BudgetPeriodType;
  /** Resolved against the report window, including explicit month limits. */
  periodAmount?: string;
}

/**
 * Actual spending input for a category.
 */
export interface ActualSpendingInput {
  categoryId: string;
  categoryName: string;
  amount: string;
  currency: string;
  period: string;
}

/**
 * Result of variance calculation.
 */
export interface VarianceResult {
  variance: Money;
  variancePercent: number;
  status: VarianceStatus;
}

/**
 * Full comparison result for a category.
 */
export interface BudgetComparisonItem {
  period: string;
  categoryId: string;
  categoryName: string;
  actual: Money;
  budgeted: Money;
  variance: Money;
  variancePercent: number;
  status: VarianceStatus | "unbudgeted";
}

/**
 * Summary statistics for budget comparison.
 */
export interface BudgetComparisonSummary {
  totalActual: Money;
  totalBudgeted: Money;
  totalVariance: Money;
  categoriesOverBudget: number;
  categoriesUnderBudget: number;
  categoriesOnTrack: number;
}

/**
 * Normalize budget amount to the requested interval.
 *
 * @param budget - Budget with amount and period type
 * @param targetInterval - The interval to normalize to
 * @param periodDays - Number of days in the target period
 * @param baseCurrency - Base currency for calculations
 * @returns Normalized budget amount as Money
 *
 * @formula
 * - Monthly budget → day: amount / daysInMonth * periodDays
 * - Monthly budget → week: amount / 4.33 (avg weeks/month)
 * - Monthly budget → month: amount as-is
 * - Yearly budget: divided by 12 first, then normalized
 */
export function normalizeBudgetToInterval(
  budget: BudgetInput,
  targetInterval: "day" | "week" | "month",
  periodDays: number
): Money {
  if (budget.periodAmount !== undefined) return new Money(budget.periodAmount, budget.currency);
  // Preserve the budget's currency so downstream Money arithmetic does not
  // mismatch against the report's base currency (defaulting drops it to ZMW).
  const budgetMoney = new Money(budget.amount, budget.currency);

  // First normalize yearly to monthly
  const monthlyAmount =
    budget.periodType === "yearly"
      ? budgetMoney.divide(12)
      : budgetMoney;

  // Then normalize to target interval
  switch (targetInterval) {
    case "day":
      // Monthly budget / 30 days * periodDays
      return monthlyAmount.divide(30).multiply(periodDays);

    case "week":
      // Monthly budget / 4.33 weeks per month
      return monthlyAmount.divide(4.33);

    case "month":
    default:
      return monthlyAmount;
  }
}

/**
 * Calculate variance between actual spending and budget.
 *
 * @param actual - Actual amount spent
 * @param budgeted - Budgeted amount
 * @returns Variance details with status classification
 *
 * @edge-cases
 * - budgeted is zero: returns 0% variance, status based on actual
 * - negative variance (over budget): variancePercent is negative
 */
export function calculateVariance(
  actual: Money,
  budgeted: Money
): VarianceResult {
  // Variance = budgeted - actual (positive = under budget)
  const variance = budgeted.subtract(actual);

  // Calculate percentage variance using Money methods
  const variancePercent = budgeted.isZero()
    ? actual.isZero()
      ? 0
      : -100 // If no budget but spending, 100% over
    : variance.divide(budgeted.toString()).multiply(100).toNumber();

  // Classify status with 10% tolerance
  let status: VarianceStatus;
  if (variancePercent < -10) {
    status = "over"; // More than 10% over budget
  } else if (variancePercent > 10) {
    status = "under"; // More than 10% under budget
  } else {
    status = "on_track"; // Within +/- 10%
  }

  return { variance, variancePercent, status };
}

/**
 * Compare actual spending against budgets for a list of categories.
 *
 * @param actuals - List of actual spending by category
 * @param budgets - List of budgets by category
 * @param targetInterval - The interval budgets should be normalized to
 * @param periodDays - Days in the period for day-level normalization
 * @param baseCurrency - Base currency for Money objects
 * @returns List of comparison items and summary
 */
export function compareBudgetsToActuals(
  actuals: ActualSpendingInput[],
  budgets: BudgetInput[],
  targetInterval: "day" | "week" | "month",
  periodDays: number,
  baseCurrency: string
): { items: BudgetComparisonItem[]; summary: BudgetComparisonSummary } {
  // Create a map of budgets by category ID for quick lookup
  const budgetMap = new Map(
    budgets.map((b) => [b.categoryId, b])
  );

  // Process each actual spending item
  const items: BudgetComparisonItem[] = actuals.map((actual) => {
    const budget = budgetMap.get(actual.categoryId);
    // Preserve the actual's currency so summary aggregation against the report
    // base currency does not mismatch (defaulting drops it to ZMW).
    const actualMoney = new Money(actual.amount, actual.currency);

    if (!budget) {
      // No budget for this category
      return {
        period: actual.period,
        categoryId: actual.categoryId,
        categoryName: actual.categoryName,
        actual: actualMoney,
        budgeted: Money.zero(baseCurrency),
        variance: actualMoney.negated(),
        variancePercent: -100,
        status: "unbudgeted" as const,
      };
    }

    const normalizedBudget = normalizeBudgetToInterval(
      budget,
      targetInterval,
      periodDays
    );

    const { variance, variancePercent, status } = calculateVariance(
      actualMoney,
      normalizedBudget
    );

    return {
      period: actual.period,
      categoryId: actual.categoryId,
      categoryName: actual.categoryName,
      actual: actualMoney,
      budgeted: normalizedBudget,
      variance,
      variancePercent,
      status,
    };
  });

  // Calculate summary
  const summary = buildComparisonSummary(items, baseCurrency);

  return { items, summary };
}

/**
 * Build summary statistics from comparison items.
 */
export function buildComparisonSummary(
  items: BudgetComparisonItem[],
  baseCurrency: string
): BudgetComparisonSummary {
  const budgetedItems = items.filter((i) => i.status !== "unbudgeted");

  const totalActual = items.reduce(
    (sum, item) => sum.add(item.actual),
    Money.zero(baseCurrency)
  );

  const totalBudgeted = budgetedItems.reduce(
    (sum, item) => sum.add(item.budgeted),
    Money.zero(baseCurrency)
  );

  const totalVariance = totalBudgeted.subtract(totalActual);

  return {
    totalActual,
    totalBudgeted,
    totalVariance,
    categoriesOverBudget: items.filter((i) => i.status === "over").length,
    categoriesUnderBudget: items.filter((i) => i.status === "under").length,
    categoriesOnTrack: items.filter((i) => i.status === "on_track").length,
  };
}

/**
 * Get list of categories that have spending but no budget.
 */
export function getUnbudgetedCategories(
  items: BudgetComparisonItem[]
): string[] {
  return items
    .filter((item) => item.status === "unbudgeted")
    .map((item) => item.categoryName);
}

// Re-export rollover logic from separate module for backwards compatibility
export {
  type RolloverPolicy,
  type RolloverConfig,
  type HistoricalBudgetUsage,
  type RolloverResult,
  calculateRolloverAmount,
  calculateAccumulatedRollover,
  applyRolloverToComparison,
  compareBudgetsWithRollover,
  getRolloverSummary,
} from "./budgetRollover";
