/**
 * Calculation Engine - Budget Alerts
 *
 * Determines budget status and generates alerts based on spending.
 *
 * @module core/calculations/budget/alerts
 */

import { Money, Percentage, toPercentage } from "../types";
import { roundToDecimals } from "../helpers";

/**
 * Budget alert level.
 */
export type BudgetAlertLevel = "safe" | "warning" | "danger" | "exceeded";

/**
 * Budget status result.
 */
export interface BudgetStatus {
  /** Current alert level */
  level: BudgetAlertLevel;
  /** Percentage of budget used */
  percentUsed: Percentage;
  /** Descriptive message */
  message: string;
  /** Suggested action */
  suggestion?: string;
}

/**
 * Alert thresholds configuration.
 */
export interface AlertThresholds {
  /** Warning threshold (default 75%) */
  warning: number;
  /** Danger threshold (default 90%) */
  danger: number;
}

/**
 * Default alert thresholds.
 */
export const DEFAULT_THRESHOLDS: AlertThresholds = {
  warning: 75,
  danger: 90,
};

/**
 * Determines budget status based on spending percentage.
 *
 * @param spentAmount - Amount spent
 * @param budgetAmount - Budget limit
 * @param thresholds - Alert thresholds
 * @returns Budget status with alert level
 */
export function determineBudgetStatus(
  spentAmount: Money,
  budgetAmount: Money,
  thresholds: AlertThresholds = DEFAULT_THRESHOLDS
): BudgetStatus {
  if (budgetAmount <= 0) {
    return {
      level: spentAmount > 0 ? "exceeded" : "safe",
      percentUsed: toPercentage(spentAmount > 0 ? 100 : 0),
      message: "No budget set",
    };
  }

  const percentUsed = roundToDecimals((spentAmount / budgetAmount) * 100, 2);

  if (percentUsed >= 100) {
    const overAmount = spentAmount - budgetAmount;
    return {
      level: "exceeded",
      percentUsed: toPercentage(percentUsed),
      message: `Over budget by ${formatMoney(overAmount)}`,
      suggestion: "Consider reviewing expenses or adjusting budget next period",
    };
  }

  if (percentUsed >= thresholds.danger) {
    const remaining = budgetAmount - spentAmount;
    return {
      level: "danger",
      percentUsed: toPercentage(percentUsed),
      message: `Only ${formatMoney(remaining)} remaining`,
      suggestion: "Be cautious with remaining spending",
    };
  }

  if (percentUsed >= thresholds.warning) {
    return {
      level: "warning",
      percentUsed: toPercentage(percentUsed),
      message: `${percentUsed.toFixed(0)}% of budget used`,
      suggestion: "Consider reducing discretionary spending",
    };
  }

  return {
    level: "safe",
    percentUsed: toPercentage(percentUsed),
    message: "On track",
  };
}

/**
 * Simple money formatter.
 */
function formatMoney(amount: Money | number): string {
  return Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Checks if a budget alert should be triggered.
 *
 * @param spentAmount - Amount spent
 * @param budgetAmount - Budget limit
 * @param alertLevel - Level to check against
 * @param thresholds - Alert thresholds
 * @returns Whether the alert should trigger
 */
export function shouldTriggerAlert(
  spentAmount: Money,
  budgetAmount: Money,
  alertLevel: BudgetAlertLevel,
  thresholds: AlertThresholds = DEFAULT_THRESHOLDS
): boolean {
  if (budgetAmount <= 0) return false;

  const percentUsed = (spentAmount / budgetAmount) * 100;

  switch (alertLevel) {
    case "warning":
      return (
        percentUsed >= thresholds.warning && percentUsed < thresholds.danger
      );
    case "danger":
      return percentUsed >= thresholds.danger && percentUsed < 100;
    case "exceeded":
      return percentUsed >= 100;
    case "safe":
      return percentUsed < thresholds.warning;
    default:
      return false;
  }
}
