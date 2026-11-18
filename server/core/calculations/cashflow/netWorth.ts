/**
 * Calculation Engine - Net Worth Calculation
 *
 * Calculates net worth (assets minus liabilities).
 *
 * @module core/calculations/cashflow/netWorth
 */

import { Money, toMoney } from "../types";

/**
 * Calculates net worth.
 *
 * @formula netWorth = totalAssets - totalLiabilities
 * @compliance GAAP/IFRS balance sheet identity
 * @edge-cases
 *   - Can be negative (liabilities > assets)
 *
 * @param assets - Total value of all assets in base currency
 * @param liabilities - Total value of all liabilities in base currency
 * @returns Net worth (can be negative)
 *
 * @example
 * ```ts
 * const nw = calculateNetWorth(toMoney(500000), toMoney(200000));
 * // nw = 300000
 * ```
 */
export function calculateNetWorth(assets: Money, liabilities: Money): Money {
  return toMoney(assets - liabilities);
}

/**
 * Detailed net worth result with component breakdown.
 */
export interface NetWorthBreakdown {
  /** Total net worth (assets - liabilities) */
  netWorth: Money;
  /** Total assets */
  totalAssets: Money;
  /** Total liabilities */
  totalLiabilities: Money;
  /** Net worth as of date (ISO string) */
  asOfDate: string;
}

/**
 * Calculates net worth with detailed breakdown.
 *
 * @param assets - Total value of all assets
 * @param liabilities - Total value of all liabilities
 * @param asOfDate - Date for this calculation
 * @returns Net worth with breakdown
 */
export function calculateNetWorthBreakdown(
  assets: Money,
  liabilities: Money,
  asOfDate: string = new Date().toISOString().split("T")[0]
): NetWorthBreakdown {
  return {
    netWorth: toMoney(assets - liabilities),
    totalAssets: assets,
    totalLiabilities: liabilities,
    asOfDate,
  };
}
