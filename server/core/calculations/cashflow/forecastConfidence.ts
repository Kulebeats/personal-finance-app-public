/**
 * Cashflow Forecast Confidence Interval Calculations
 *
 * Calculates confidence intervals for forecast predictions based on
 * historical variance data.
 *
 * @module core/calculations/cashflow/forecastConfidence
 */

import { Money } from "../../money";
import type {
  ForecastConfig,
  RecurringRuleInput,
  BudgetInput,
  CategoryAverageInput,
  ConfidenceInterval,
  ForecastResult,
} from "./forecast";
import { generateForecast } from "./forecast";

/**
 * Historical variance data for confidence calculations.
 */
export interface HistoricalVarianceInput {
  incomeStdDev: string; // Standard deviation of monthly income
  expenseStdDev: string; // Standard deviation of monthly expenses
  incomeMean: string;
  expenseMean: string;
  sampleMonths: number; // Number of months in historical data
  currency: string;
}

/**
 * Z-scores for common confidence levels
 */
const Z_SCORES: Record<number, number> = {
  90: 1.645,
  95: 1.96,
  99: 2.576,
};

/**
 * Calculate confidence intervals for a forecast based on historical variance.
 *
 * Uses the formula: CI = mean ± (z * stdDev / sqrt(n))
 * where n is adjusted for forecast uncertainty (decreases with horizon)
 *
 * @param value - Point estimate (mean)
 * @param stdDev - Historical standard deviation
 * @param sampleMonths - Number of months in historical data
 * @param forecastMonth - Which month into the future (1-based)
 * @param confidenceLevel - Confidence level (90, 95, or 99)
 * @param currency - Target currency
 * @returns Confidence interval with low, mid, and high bounds
 */
export function calculateConfidenceInterval(
  value: Money,
  stdDev: Money,
  sampleMonths: number,
  forecastMonth: number,
  confidenceLevel: number,
  currency: string
): ConfidenceInterval {
  const z = Z_SCORES[confidenceLevel] ?? Z_SCORES[90];

  // Increase uncertainty for further forecast months
  // Each month adds ~10% uncertainty
  const uncertaintyMultiplier = 1 + (forecastMonth - 1) * 0.1;

  // Standard error with adjustment for forecast horizon
  // Use sqrt(sampleMonths) as denominator, minimum 1
  const effectiveSample = Math.max(sampleMonths, 1);
  const standardError = stdDev.divide(Math.sqrt(effectiveSample));
  const adjustedError = standardError.multiply(uncertaintyMultiplier);

  // Margin of error
  const marginOfError = adjustedError.multiply(z);

  // Calculate bounds (ensure low isn't negative for income/expenses)
  const low = value.subtract(marginOfError);
  const high = value.add(marginOfError);

  return {
    low: low.isNegative() ? Money.zero(currency) : low,
    mid: value,
    high,
    confidenceLevel: confidenceLevel / 100,
  };
}

/**
 * Determine overall confidence level based on data quality factors.
 *
 * High: Has recurring rules + budgets + 6+ months historical data
 * Medium: Has at least 2 of the above factors
 * Low: Has only 1 or fewer factors
 */
export function determineConfidenceLevel(factors: {
  hasRecurringRules: boolean;
  hasBudgets: boolean;
  hasHistoricalData: boolean;
  sampleMonths: number;
}): { level: "high" | "medium" | "low"; reason: string } {
  const { hasRecurringRules, hasBudgets, hasHistoricalData, sampleMonths } = factors;

  let score = 0;
  const reasons: string[] = [];

  if (hasRecurringRules) {
    score += 2;
    reasons.push("recurring rules");
  }
  if (hasBudgets) {
    score += 1;
    reasons.push("budget data");
  }
  if (hasHistoricalData && sampleMonths >= 6) {
    score += 2;
    reasons.push(`${sampleMonths} months historical data`);
  } else if (hasHistoricalData && sampleMonths >= 3) {
    score += 1;
    reasons.push(`${sampleMonths} months historical data`);
  }

  if (score >= 4) {
    return {
      level: "high",
      reason: `High confidence based on: ${reasons.join(", ")}`,
    };
  } else if (score >= 2) {
    return {
      level: "medium",
      reason: `Medium confidence based on: ${reasons.join(", ")}`,
    };
  } else {
    return {
      level: "low",
      reason: reasons.length > 0
        ? `Low confidence - limited data: ${reasons.join(", ")}`
        : "Low confidence - insufficient historical data",
    };
  }
}

/**
 * Generate forecast with confidence intervals.
 *
 * @param config - Forecast configuration
 * @param recurringRules - Active recurring rules
 * @param budgets - Budget allocations
 * @param categoryAverages - Historical category averages
 * @param historicalVariance - Historical variance data for confidence calculation
 * @param confidenceLevel - Desired confidence level (90, 95, or 99)
 * @returns Forecast with confidence intervals
 */
export function generateForecastWithConfidence(
  config: ForecastConfig,
  recurringRules: RecurringRuleInput[],
  budgets: BudgetInput[],
  categoryAverages: CategoryAverageInput[],
  historicalVariance: HistoricalVarianceInput | null,
  confidenceLevel: number = 90
): ForecastResult {
  // Generate base forecast
  const baseForecast = generateForecast(config, recurringRules, budgets, categoryAverages);

  // If no historical variance data, return base forecast with low confidence
  if (!historicalVariance) {
    const confidenceFactors = {
      hasRecurringRules: recurringRules.some((r) => r.isActive && !r.isPaused),
      hasBudgets: budgets.length > 0,
      hasHistoricalData: false,
      sampleMonths: 0,
    };

    const { level, reason } = determineConfidenceLevel(confidenceFactors);

    return {
      ...baseForecast,
      confidenceMetadata: {
        overallLevel: level,
        confidencePercent: confidenceLevel,
        factors: confidenceFactors,
        description: reason,
      },
    };
  }

  const { baseCurrency } = config;
  const incomeStdDev = new Money(historicalVariance.incomeStdDev, baseCurrency);
  const expenseStdDev = new Money(historicalVariance.expenseStdDev, baseCurrency);

  // Add confidence intervals to each forecast point
  const pointsWithConfidence = baseForecast.points.map((point, index) => {
    const forecastMonth = index + 1;

    const incomeCI = calculateConfidenceInterval(
      point.income,
      incomeStdDev,
      historicalVariance.sampleMonths,
      forecastMonth,
      confidenceLevel,
      baseCurrency
    );

    const expenseCI = calculateConfidenceInterval(
      point.expenses,
      expenseStdDev,
      historicalVariance.sampleMonths,
      forecastMonth,
      confidenceLevel,
      baseCurrency
    );

    // Savings CI: optimistic = high income - low expenses, pessimistic = low income - high expenses
    const savingsLow = incomeCI.low.subtract(expenseCI.high);
    const savingsHigh = incomeCI.high.subtract(expenseCI.low);

    const savingsCI: ConfidenceInterval = {
      low: savingsLow.toNumber() < 0 ? savingsLow : savingsLow,
      mid: point.savings,
      high: savingsHigh,
      confidenceLevel: confidenceLevel / 100,
    };

    const confidenceFactors = {
      hasRecurringRules: baseForecast.dataSourcesUsed.includes("recurring"),
      hasBudgets: baseForecast.dataSourcesUsed.includes("budgets"),
      hasHistoricalData: historicalVariance.sampleMonths > 0,
      sampleMonths: historicalVariance.sampleMonths,
    };

    const { level, reason } = determineConfidenceLevel(confidenceFactors);

    return {
      ...point,
      confidence: {
        income: incomeCI,
        expenses: expenseCI,
        savings: savingsCI,
        level,
        reason,
      },
    };
  });

  const confidenceFactors = {
    hasRecurringRules: baseForecast.dataSourcesUsed.includes("recurring"),
    hasBudgets: baseForecast.dataSourcesUsed.includes("budgets"),
    hasHistoricalData: historicalVariance.sampleMonths > 0,
    sampleMonths: historicalVariance.sampleMonths,
  };

  const { level: overallLevel, reason: description } = determineConfidenceLevel(confidenceFactors);

  return {
    points: pointsWithConfidence,
    dataSourcesUsed: baseForecast.dataSourcesUsed,
    warnings: baseForecast.warnings,
    confidenceMetadata: {
      overallLevel,
      confidencePercent: confidenceLevel,
      factors: confidenceFactors,
      description,
    },
  };
}
