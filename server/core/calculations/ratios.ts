/**
 * Calculation Engine - Financial Ratios
 *
 * Common financial health ratios for personal finance.
 *
 * @module core/calculations/ratios
 */

import { Money, Ratio, toRatio } from "./types";
import { roundToDecimals, preciseDivide } from "./helpers";
export {
  calculateDebtToIncome,
  calculateAffordableDebtPayment,
} from "./debt/dti";
export type { DTIResult } from "./debt/dti";

/**
 * Emergency fund ratio result.
 */
export interface EmergencyFundRatio {
  /** Ratio of emergency fund to monthly expenses */
  ratio: Ratio;
  /** Months of expenses covered */
  monthsCovered: number;
  /** Recommended minimum (usually 3-6 months) */
  recommendedMinimum: number;
  /** Is ratio adequate? */
  isAdequate: boolean;
}

/**
 * Calculates emergency fund ratio (months of coverage).
 *
 * @formula ratio = emergencyFund / monthlyExpenses
 *
 * @param emergencyFund - Current emergency fund balance
 * @param monthlyExpenses - Average monthly expenses
 * @param recommendedMinimum - Recommended months (default 3)
 * @returns Emergency fund ratio result
 */
export function calculateEmergencyFundRatio(
  emergencyFund: Money,
  monthlyExpenses: Money,
  recommendedMinimum: number = 3
): EmergencyFundRatio {
  if (monthlyExpenses <= 0) {
    // Use a large finite value instead of Infinity
    const largeValue = emergencyFund > 0 ? 999 : 0;
    return {
      ratio: toRatio(largeValue),
      monthsCovered: largeValue,
      recommendedMinimum,
      isAdequate: emergencyFund > 0,
    };
  }

  const monthsCovered = roundToDecimals(
    preciseDivide(emergencyFund, monthlyExpenses),
    1
  );

  return {
    ratio: toRatio(monthsCovered),
    monthsCovered,
    recommendedMinimum,
    isAdequate: monthsCovered >= recommendedMinimum,
  };
}

/**
 * Expense ratio result.
 */
export interface ExpenseRatio {
  /** Total expenses as percentage of income */
  percentage: number;
  /** Gross income */
  income: Money;
  /** Total expenses */
  expenses: Money;
}

/**
 * Calculates expense ratio (expenses as % of income).
 *
 * @param expenses - Total expenses
 * @param income - Gross income
 * @returns Expense ratio as percentage
 */
export function calculateExpenseRatio(
  expenses: Money,
  income: Money
): ExpenseRatio {
  const percentage =
    income > 0
      ? roundToDecimals((expenses / income) * 100, 2)
      : expenses > 0
      ? 100
      : 0;

  return {
    percentage,
    income,
    expenses,
  };
}

/**
 * Liquidity ratio (quick ratio for personal finance).
 *
 * @formula liquidityRatio = liquidAssets / monthlyExpenses
 *
 * @param liquidAssets - Cash and easily accessible assets
 * @param monthlyExpenses - Monthly expenses
 * @returns Months of expenses covered by liquid assets
 */
export function calculateLiquidityRatio(
  liquidAssets: Money,
  monthlyExpenses: Money
): Ratio {
  if (monthlyExpenses <= 0) {
    return toRatio(liquidAssets > 0 ? Infinity : 0);
  }

  return toRatio(
    roundToDecimals(preciseDivide(liquidAssets, monthlyExpenses), 2)
  );
}

/**
 * Housing ratio (housing costs as % of income).
 * Generally, housing should be 28% or less of gross income.
 *
 * @param housingCosts - Total monthly housing costs
 * @param monthlyIncome - Gross monthly income
 * @returns Housing cost percentage
 */
export function calculateHousingRatio(
  housingCosts: Money,
  monthlyIncome: Money
): { percentage: number; isWithinGuideline: boolean } {
  if (monthlyIncome <= 0) {
    return { percentage: housingCosts > 0 ? 100 : 0, isWithinGuideline: false };
  }

  const percentage = roundToDecimals((housingCosts / monthlyIncome) * 100, 2);

  return {
    percentage,
    isWithinGuideline: percentage <= 28,
  };
}
