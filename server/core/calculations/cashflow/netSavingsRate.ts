/**
 * Calculation Engine - Net Savings Rate Calculation
 *
 * Calculates net savings rate as a percentage of income.
 *
 * @module core/calculations/cashflow/netSavingsRate
 */

import { Money, Percentage, toPercentage } from "../types";
import { roundToDecimals } from "../helpers";

/**
 * Calculates net savings rate.
 *
 * @formula netSavingsRate = ((income - expenses - debtPayments) / income) * 100
 * @rounding 2 decimal places
 * @edge-cases
 *   - income <= 0: returns 0%
 *   - Can be negative (spending more than earning)
 *
 * @param income - Total income in base currency
 * @param expenses - Total expenses in base currency
 * @param debtPayments - Debt principal payments (optional)
 * @returns Net savings rate as percentage (can be negative)
 *
 * @example
 * ```ts
 * const rate = calculateNetSavingsRate(toMoney(5000), toMoney(3500), toMoney(500));
 * // rate = 20 (20%)
 * ```
 */
export function calculateNetSavingsRate(
  income: Money,
  expenses: Money,
  debtPayments: Money = 0 as Money
): Percentage {
  if (income <= 0) {
    return toPercentage(0);
  }

  const netSavings = income - expenses - debtPayments;

  return toPercentage(roundToDecimals((netSavings / income) * 100, 2));
}
