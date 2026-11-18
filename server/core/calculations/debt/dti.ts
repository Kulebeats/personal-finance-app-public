/**
 * Calculation Engine - Debt-to-Income Ratio
 *
 * Calculates debt-to-income ratio for financial health assessment.
 *
 * @module core/calculations/debt/dti
 */

import { Money, Percentage, Ratio, toPercentage, toRatio } from "../types";
import { roundToDecimals } from "../helpers";

/**
 * DTI calculation result.
 */
export interface DTIResult {
  /** DTI as a ratio (0-1+) */
  dtiRatio: Ratio;
  /** DTI as a percentage */
  dtiPercentage: Percentage;
  /** Total monthly debt payments */
  totalDebtPayments: Money;
  /** Gross monthly income */
  monthlyIncome: Money;
  /** Health indicator */
  healthLevel: "excellent" | "good" | "fair" | "poor";
  /** Recommendation */
  recommendation: string;
}

/**
 * Default DTI thresholds.
 */
export const DTI_THRESHOLDS = {
  excellent: 20,
  good: 36,
  fair: 43,
  // Above 43 is poor
};

/**
 * Calculates debt-to-income ratio.
 *
 * @formula DTI = (totalMonthlyDebtPayments / grossMonthlyIncome) * 100
 *
 * DTI is a key metric for lenders and personal financial health:
 * - < 20%: Excellent - lots of room for savings/investments
 * - 20-36%: Good - manageable debt level
 * - 36-43%: Fair - may struggle to take on new debt
 * - > 43%: Poor - may have difficulty meeting payments
 *
 * @param totalDebtPayments - Total monthly debt payments
 * @param monthlyIncome - Gross monthly income
 * @returns DTI result with health indicator
 */
export function calculateDebtToIncome(
  totalDebtPayments: Money,
  monthlyIncome: Money
): DTIResult {
  if (monthlyIncome <= 0) {
    return {
      dtiRatio: toRatio(totalDebtPayments > 0 ? 1 : 0),
      dtiPercentage: toPercentage(totalDebtPayments > 0 ? 100 : 0),
      totalDebtPayments,
      monthlyIncome,
      healthLevel: totalDebtPayments > 0 ? "poor" : "excellent",
      recommendation:
        totalDebtPayments > 0
          ? "Income needed to assess debt burden"
          : "No debt payments recorded",
    };
  }

  const dtiRatio = roundToDecimals(totalDebtPayments / monthlyIncome, 4);
  const dtiPercentage = roundToDecimals(dtiRatio * 100, 2);

  let healthLevel: DTIResult["healthLevel"];
  let recommendation: string;

  if (dtiPercentage < DTI_THRESHOLDS.excellent) {
    healthLevel = "excellent";
    recommendation =
      "Excellent debt management. Consider increasing savings or investments.";
  } else if (dtiPercentage < DTI_THRESHOLDS.good) {
    healthLevel = "good";
    recommendation = "Good debt level. Continue current approach.";
  } else if (dtiPercentage < DTI_THRESHOLDS.fair) {
    healthLevel = "fair";
    recommendation =
      "Consider paying down debt before taking on new obligations.";
  } else {
    healthLevel = "poor";
    recommendation = "High debt burden. Focus on debt reduction strategies.";
  }

  return {
    dtiRatio: toRatio(dtiRatio),
    dtiPercentage: toPercentage(dtiPercentage),
    totalDebtPayments,
    monthlyIncome,
    healthLevel,
    recommendation,
  };
}

/**
 * Calculates how much additional monthly debt payment is affordable.
 *
 * @param currentDebtPayments - Current monthly debt payments
 * @param monthlyIncome - Gross monthly income
 * @param targetDTI - Target DTI percentage (default 36%)
 * @returns Additional affordable monthly payment
 */
export function calculateAffordableDebtPayment(
  currentDebtPayments: Money,
  monthlyIncome: Money,
  targetDTI: number = 36
): Money {
  if (monthlyIncome <= 0) {
    return 0 as Money;
  }

  const maxPayments = (monthlyIncome * targetDTI) / 100;
  const additional = maxPayments - currentDebtPayments;

  return Math.max(0, roundToDecimals(additional, 2)) as Money;
}
