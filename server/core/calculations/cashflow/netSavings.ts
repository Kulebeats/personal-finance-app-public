/**
 * Calculation Engine - Net Savings Calculation
 *
 * Calculates net savings (income minus expenses minus debt payments).
 *
 * @module core/calculations/cashflow/netSavings
 */

import { Money, toMoney } from "../types";

/**
 * Calculates net savings.
 *
 * @formula netSavings = income - expenses - debtPayments
 * @rounding No rounding (preserves precision)
 * @edge-cases
 *   - Can be negative (spending more than earning)
 *   - debtPayments can be 0 or omitted
 *
 * @param income - Total income in base currency
 * @param expenses - Total expenses in base currency
 * @param debtPayments - Debt principal payments (optional, default 0)
 * @returns Net savings (can be negative)
 *
 * @example
 * ```ts
 * const net = calculateNetSavings(toMoney(5000), toMoney(3500), toMoney(500));
 * // net = 1000
 * ```
 */
export function calculateNetSavings(
  income: Money,
  expenses: Money,
  debtPayments: Money = toMoney(0)
): Money {
  return toMoney(income - expenses - debtPayments);
}
