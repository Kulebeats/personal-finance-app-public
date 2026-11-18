/**
 * Calculation Engine - Budget Rollover Logic
 *
 * Handles rollover of unused budget amounts between periods.
 * Supports multiple rollover policies: none, full, capped, percentage.
 *
 * @module core/calculations/cashflow/budgetRollover
 */

import { Money } from "../../money";
import {
  BudgetInput,
  BudgetComparisonItem,
  BudgetComparisonSummary,
  ActualSpendingInput,
  calculateVariance,
  compareBudgetsToActuals,
  buildComparisonSummary,
} from "./budgetComparison";

/**
 * Rollover policy configuration.
 */
export type RolloverPolicy =
  | "none" // No rollover - unused budget expires
  | "full" // All unused budget rolls over
  | "capped" // Rollover up to a percentage of original budget
  | "percentage"; // Rollover a percentage of unused amount

/**
 * Configuration for budget rollover behavior.
 */
export interface RolloverConfig {
  policy: RolloverPolicy;
  /** For 'capped' policy: max rollover as percentage of original budget (e.g., 50 = 50%) */
  capPercent?: number;
  /** For 'percentage' policy: percentage of unused to rollover (e.g., 75 = 75%) */
  rolloverPercent?: number;
  /** Maximum number of periods to accumulate rollover */
  maxAccumulationPeriods?: number;
}

/**
 * Input for rollover calculation: historical budget usage.
 */
export interface HistoricalBudgetUsage {
  period: string; // YYYY-MM
  categoryId: string;
  budgeted: string;
  actual: string;
  currency: string;
}

/**
 * Result of rollover calculation for a category.
 */
export interface RolloverResult {
  categoryId: string;
  categoryName: string;
  originalBudget: Money;
  accumulatedRollover: Money;
  effectiveBudget: Money;
  rolloverHistory: Array<{
    period: string;
    unused: Money;
    rolledOver: Money;
  }>;
}

/**
 * Calculate rollover amount based on policy.
 *
 * @param unused - Amount unused from budget (positive = under budget)
 * @param originalBudget - Original budget amount for the period
 * @param config - Rollover configuration
 * @param baseCurrency - Base currency for calculations
 * @returns Amount to rollover (never negative)
 */
export function calculateRolloverAmount(
  unused: Money,
  originalBudget: Money,
  config: RolloverConfig,
  baseCurrency: string
): Money {
  // If over budget (negative unused), no rollover
  if (unused.isNegativeOrZero()) {
    return Money.zero(baseCurrency);
  }

  switch (config.policy) {
    case "none":
      return Money.zero(baseCurrency);

    case "full":
      return unused;

    case "capped": {
      const capPercent = config.capPercent ?? 50;
      const maxRollover = originalBudget.multiply(capPercent / 100);
      return unused.gt(maxRollover) ? maxRollover : unused;
    }

    case "percentage": {
      const rolloverPercent = config.rolloverPercent ?? 100;
      return unused.multiply(rolloverPercent / 100);
    }

    default:
      return Money.zero(baseCurrency);
  }
}

/**
 * Calculate accumulated rollover from historical budget usage.
 *
 * @param history - Historical budget usage for a category
 * @param budget - Current budget for the category
 * @param config - Rollover configuration
 * @param baseCurrency - Base currency for calculations
 * @returns Rollover result with effective budget
 */
export function calculateAccumulatedRollover(
  history: HistoricalBudgetUsage[],
  budget: BudgetInput,
  config: RolloverConfig,
  baseCurrency: string
): RolloverResult {
  const originalBudget = new Money(budget.amount, budget.currency);
  const maxPeriods = config.maxAccumulationPeriods ?? 12;

  // Sort history by period (oldest first) and limit to maxPeriods
  const sortedHistory = [...history]
    .sort((a, b) => a.period.localeCompare(b.period))
    .slice(-maxPeriods);

  const rolloverHistory: RolloverResult["rolloverHistory"] = [];
  let accumulatedRollover = Money.zero(baseCurrency);

  for (const entry of sortedHistory) {
    const budgeted = new Money(entry.budgeted, entry.currency);
    const actual = new Money(entry.actual, entry.currency);
    const unused = budgeted.subtract(actual);

    const rolledOver = calculateRolloverAmount(
      unused,
      budgeted,
      config,
      baseCurrency
    );

    // Add to accumulated (but cap at reasonable level)
    const maxAccumulation = originalBudget.multiply(maxPeriods);
    const newAccumulated = accumulatedRollover.add(rolledOver);
    accumulatedRollover = newAccumulated.gt(maxAccumulation)
      ? maxAccumulation
      : newAccumulated;

    rolloverHistory.push({
      period: entry.period,
      unused,
      rolledOver,
    });
  }

  return {
    categoryId: budget.categoryId,
    categoryName: budget.categoryName,
    originalBudget,
    accumulatedRollover,
    effectiveBudget: originalBudget.add(accumulatedRollover),
    rolloverHistory,
  };
}

/**
 * Apply rollover to budget comparison items.
 *
 * @param items - Original comparison items
 * @param rollovers - Calculated rollovers by category
 * @returns Updated comparison items with rollover applied
 */
export function applyRolloverToComparison(
  items: BudgetComparisonItem[],
  rollovers: Map<string, RolloverResult>
): BudgetComparisonItem[] {
  return items.map((item) => {
    const rollover = rollovers.get(item.categoryId);

    if (!rollover || item.status === "unbudgeted") {
      return item;
    }

    // Recalculate with effective budget
    const { variance, variancePercent, status } = calculateVariance(
      item.actual,
      rollover.effectiveBudget
    );

    return {
      ...item,
      budgeted: rollover.effectiveBudget,
      variance,
      variancePercent,
      status,
    };
  });
}

/**
 * Compare budgets to actuals with rollover support.
 *
 * @param actuals - List of actual spending by category
 * @param budgets - List of budgets by category
 * @param historicalUsage - Historical budget usage for rollover calculation
 * @param rolloverConfig - Rollover configuration
 * @param targetInterval - The interval budgets should be normalized to
 * @param periodDays - Days in the period for day-level normalization
 * @param baseCurrency - Base currency for Money objects
 * @returns Comparison with rollover applied
 */
export function compareBudgetsWithRollover(
  actuals: ActualSpendingInput[],
  budgets: BudgetInput[],
  historicalUsage: Map<string, HistoricalBudgetUsage[]>,
  rolloverConfig: RolloverConfig,
  targetInterval: "day" | "week" | "month",
  periodDays: number,
  baseCurrency: string
): {
  items: BudgetComparisonItem[];
  summary: BudgetComparisonSummary;
  rollovers: RolloverResult[];
} {
  // First calculate base comparison
  const baseComparison = compareBudgetsToActuals(
    actuals,
    budgets,
    targetInterval,
    periodDays,
    baseCurrency
  );

  // Calculate rollovers for each category
  const rollovers: RolloverResult[] = [];
  const rolloverMap = new Map<string, RolloverResult>();

  for (const budget of budgets) {
    const categoryHistory = historicalUsage.get(budget.categoryId) ?? [];
    const rollover = calculateAccumulatedRollover(
      categoryHistory,
      budget,
      rolloverConfig,
      baseCurrency
    );
    rollovers.push(rollover);
    rolloverMap.set(budget.categoryId, rollover);
  }

  // Apply rollovers to comparison items
  const itemsWithRollover = applyRolloverToComparison(
    baseComparison.items,
    rolloverMap
  );

  // Recalculate summary
  const summary = buildComparisonSummary(itemsWithRollover, baseCurrency);

  return {
    items: itemsWithRollover,
    summary,
    rollovers,
  };
}

/**
 * Get rollover summary statistics.
 */
export function getRolloverSummary(
  rollovers: RolloverResult[],
  baseCurrency: string
): {
  totalOriginalBudget: Money;
  totalRollover: Money;
  totalEffectiveBudget: Money;
  categoriesWithRollover: number;
} {
  const totalOriginalBudget = rollovers.reduce(
    (sum, r) => sum.add(r.originalBudget),
    Money.zero(baseCurrency)
  );

  const totalRollover = rollovers.reduce(
    (sum, r) => sum.add(r.accumulatedRollover),
    Money.zero(baseCurrency)
  );

  const totalEffectiveBudget = rollovers.reduce(
    (sum, r) => sum.add(r.effectiveBudget),
    Money.zero(baseCurrency)
  );

  const categoriesWithRollover = rollovers.filter(
    (r) => r.accumulatedRollover.isPositive()
  ).length;

  return {
    totalOriginalBudget,
    totalRollover,
    totalEffectiveBudget,
    categoriesWithRollover,
  };
}
