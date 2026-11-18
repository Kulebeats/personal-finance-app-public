/**
 * Calculation Engine - Savings Rate Calculation
 *
 * Calculates savings rate using the Savings Contributions method.
 *
 * @module core/calculations/cashflow/savingsRate
 */

import { Money, Percentage, toPercentage } from "../types";
import { roundToDecimals } from "../helpers";

/**
 * Calculates savings rate (Savings Contributions method).
 *
 * @formula savingsRate = (savingsContributions / income) * 100
 * @rounding 2 decimal places
 * @edge-cases
 *   - income <= 0: returns 0%
 *   - savingsContributions < 0: returns negative %
 * @compliance GAAP - consistent with personal finance reporting standards
 *
 * @param income - Total income in base currency
 * @param savingsContributions - Transfers into savings/investment accounts
 * @returns Savings rate as percentage (0-100+)
 *
 * @example
 * ```ts
 * const rate = calculateSavingsRate(toMoney(5000), toMoney(1000));
 * // rate = 20 (20%)
 * ```
 */
export function calculateSavingsRate(
  income: Money,
  savingsContributions: Money
): Percentage {
  if (income <= 0) {
    return toPercentage(0);
  }

  return toPercentage(
    roundToDecimals((savingsContributions / income) * 100, 2)
  );
}
