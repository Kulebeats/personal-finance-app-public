/**
 * Calculation Engine - Time-Weighted Return (TWR)
 *
 * Calculates investment returns using the time-weighted method.
 *
 * @module core/calculations/investments/twr
 */

import { Percentage, toPercentage } from "../types";
import { roundToDecimals, preciseMultiply, preciseDivide } from "../helpers";

/**
 * A period for TWR calculation.
 */
export interface TWRPeriod {
  /** Start date of the period */
  startDate: string;
  /** End date of the period */
  endDate: string;
  /** Portfolio value at start of period */
  startValue: number;
  /** Portfolio value at end of period (before any cashflows) */
  endValue: number;
  /** Cash flow during period (positive = inflow) */
  cashFlow: number;
}

/**
 * TWR calculation result.
 */
export interface TWRResult {
  /** Time-weighted return as percentage */
  twr: Percentage;
  /** Annualized TWR */
  annualizedTwr: Percentage;
  /** Number of periods used */
  periodCount: number;
  /** Total days in calculation */
  totalDays: number;
}

/**
 * Calculates Time-Weighted Return (TWR).
 *
 * The TWR method eliminates the impact of cash flows on portfolio performance,
 * making it suitable for comparing fund manager performance.
 *
 * @formula TWR = (1 + HPR1) × (1 + HPR2) × ... × (1 + HPRn) - 1
 * @formula HPR = (End Value - Cash Flow) / Start Value - 1
 *
 * @param periods - Array of period data
 * @returns TWR result with annualized value
 */
export function calculateTimeWeightedReturn(periods: TWRPeriod[]): TWRResult {
  if (periods.length === 0) {
    return {
      twr: toPercentage(0),
      annualizedTwr: toPercentage(0),
      periodCount: 0,
      totalDays: 0,
    };
  }

  // Calculate holding period returns for each period
  let cumulativeReturn = 1;
  let totalDays = 0;

  for (const period of periods) {
    const startValue = period.startValue;

    // End value is adjusted for cash flow
    // Cash flow assumed at end of period
    const adjustedEndValue = period.endValue - period.cashFlow;

    // Holding period return
    if (startValue <= 0) continue;

    const hpr = preciseDivide(adjustedEndValue, startValue);
    cumulativeReturn = preciseMultiply(cumulativeReturn, hpr);

    // Calculate days
    const start = new Date(period.startDate);
    const end = new Date(period.endDate);
    totalDays += Math.round(
      (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)
    );
  }

  // TWR as percentage
  const twr = (cumulativeReturn - 1) * 100;

  // Annualize if more than 365 days
  let annualizedTwr: number;
  if (totalDays <= 0) {
    annualizedTwr = twr;
  } else if (totalDays >= 365) {
    // Compound annual growth rate
    const years = totalDays / 365;
    annualizedTwr = (Math.pow(cumulativeReturn, 1 / years) - 1) * 100;
  } else {
    // Simple annualization for partial year
    annualizedTwr = twr * (365 / totalDays);
  }

  return {
    twr: toPercentage(roundToDecimals(twr, 2)),
    annualizedTwr: toPercentage(roundToDecimals(annualizedTwr, 2)),
    periodCount: periods.length,
    totalDays,
  };
}

/**
 * Calculates simple return (for quick calculations).
 *
 * @formula return = (endValue - startValue - netCashFlow) / startValue * 100
 *
 * @param startValue - Starting portfolio value
 * @param endValue - Ending portfolio value
 * @param netCashFlow - Net cash flows (positive = inflows)
 * @returns Simple return as percentage
 */
export function calculateSimpleReturn(
  startValue: number,
  endValue: number,
  netCashFlow: number = 0
): Percentage {
  if (startValue <= 0) {
    return toPercentage(0);
  }

  const adjustedGain = endValue - startValue - netCashFlow;
  const returnPct = (adjustedGain / startValue) * 100;

  return toPercentage(roundToDecimals(returnPct, 2));
}
