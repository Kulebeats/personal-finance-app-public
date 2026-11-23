/**
 * Custom Forecast Scenarios Module
 *
 * Provides "what-if" analysis capabilities for cashflow forecasting.
 * Users can create hypothetical scenarios to understand the impact
 * of potential changes to their income or expenses.
 *
 * @module core/calculations/cashflow/scenarios
 */

import { Money } from "../../money";
import type { ForecastPoint, ForecastResult, ForecastConfig } from "./forecast";

// ============================================================================
// Types
// ============================================================================

/**
 * Type of modification to apply to a scenario.
 */
export type ModificationType =
  | "percentage_change" // Increase/decrease by percentage
  | "fixed_change" // Add/subtract fixed amount
  | "fixed_value" // Set to specific value
  | "category_change"; // Change specific category

/**
 * Target of the modification.
 */
export type ModificationTarget =
  | "income"
  | "expenses"
  | "savings_rate"
  | "category";

/**
 * A single modification to apply in a scenario.
 */
export interface ScenarioModification {
  id: string;
  name: string;
  description?: string;
  target: ModificationTarget;
  type: ModificationType;
  /** For percentage_change: positive = increase, negative = decrease */
  percentageChange?: number;
  /** For fixed_change: positive = increase, negative = decrease */
  fixedChange?: string;
  /** For fixed_value: the new value */
  fixedValue?: string;
  /** For category_change: which category to modify */
  categoryId?: string;
  categoryName?: string;
  /** Which months to apply (0-indexed), empty = all months */
  applicableMonths?: number[];
}

/**
 * A complete scenario with multiple modifications.
 */
export interface ForecastScenario {
  id: string;
  name: string;
  description?: string;
  modifications: ScenarioModification[];
  isBaseline: boolean;
  createdAt: string;
}

/**
 * Comparison of a scenario against baseline.
 */
export interface ScenarioComparison {
  scenario: ForecastScenario;
  baselineResult: ForecastResult;
  scenarioResult: ForecastResult;
  impact: {
    totalIncomeDiff: Money;
    totalExpensesDiff: Money;
    totalSavingsDiff: Money;
    savingsRateDiff: number;
    monthlyImpact: Array<{
      period: string;
      incomeDiff: Money;
      expensesDiff: Money;
      savingsDiff: Money;
    }>;
  };
}

// Re-export scenario template type from separate module
export type { ScenarioTemplate } from "./scenarioTemplates";

// ============================================================================
// Core Scenario Logic
// ============================================================================

/**
 * Apply a single modification to a forecast point.
 *
 * @param point - Original forecast point
 * @param mod - Modification to apply
 * @param baseCurrency - Currency for calculations
 * @returns Modified forecast point
 */
export function applyModification(
  point: ForecastPoint,
  mod: ScenarioModification,
  baseCurrency: string
): ForecastPoint {
  const result = { ...point };

  switch (mod.target) {
    case "income":
      result.income = applyValueModification(
        point.income,
        mod,
        baseCurrency
      );
      break;

    case "expenses":
      result.expenses = applyValueModification(
        point.expenses,
        mod,
        baseCurrency
      );
      break;

    case "savings_rate":
      // For savings rate, we adjust expenses to achieve target rate
      if (mod.type === "fixed_value" && mod.fixedValue) {
        // FIX Money Rule 1: Use Money/Decimal for rate calculation
        const targetRateMoney = new Money(mod.fixedValue, baseCurrency);
        const targetRateDecimal = targetRateMoney.divide("100").toNumber();
        // savings_rate = (income - expenses) / income
        // expenses = income * (1 - target_rate)
        result.expenses = result.income.multiply(1 - targetRateDecimal);
      }
      break;

    case "category":
      // Category changes affect expenses by default
      result.expenses = applyValueModification(
        point.expenses,
        mod,
        baseCurrency
      );
      break;
  }

  // Recalculate savings and rate
  result.savings = result.income.subtract(result.expenses);
  // FIX Money Rule 1: Keep Money through calculation
  result.savingsRate = result.income.isZero()
    ? 0
    : Number(
        result.savings
          .divide(result.income.toString())
          .multiply(100)
          .toNumber()
          .toFixed(2)
      );

  // Update sources to reflect modification
  result.sources = {
    ...point.sources,
    // Mark that this is a modified scenario
  };

  return result;
}

/**
 * Apply modification to a money value based on type.
 */
function applyValueModification(
  value: Money,
  mod: ScenarioModification,
  baseCurrency: string
): Money {
  switch (mod.type) {
    case "percentage_change":
      const percentChange = mod.percentageChange ?? 0;
      const multiplier = 1 + percentChange / 100;
      return value.multiply(multiplier);

    case "fixed_change":
      const changeAmount = new Money(mod.fixedChange ?? "0", baseCurrency);
      return value.add(changeAmount);

    case "fixed_value":
      return new Money(mod.fixedValue ?? "0", baseCurrency);

    case "category_change":
      // Same as fixed_change but for specific category
      const catChange = new Money(mod.fixedChange ?? "0", baseCurrency);
      return value.add(catChange);

    default:
      return value;
  }
}

/**
 * Apply a complete scenario to a forecast.
 *
 * @param baseline - Baseline forecast result
 * @param scenario - Scenario to apply
 * @param baseCurrency - Currency for calculations
 * @returns Modified forecast result
 */
export function applyScenario(
  baseline: ForecastResult,
  scenario: ForecastScenario,
  baseCurrency: string
): ForecastResult {
  if (scenario.isBaseline) {
    return baseline;
  }

  const modifiedPoints = baseline.points.map((point, monthIndex) => {
    let modifiedPoint = { ...point };

    // Apply each modification
    for (const mod of scenario.modifications) {
      // Check if modification applies to this month
      if (
        mod.applicableMonths &&
        mod.applicableMonths.length > 0 &&
        !mod.applicableMonths.includes(monthIndex)
      ) {
        continue;
      }

      modifiedPoint = applyModification(modifiedPoint, mod, baseCurrency);
    }

    return modifiedPoint;
  });

  return {
    ...baseline,
    points: modifiedPoints,
    warnings: [
      ...baseline.warnings,
      `Scenario "${scenario.name}" applied with ${scenario.modifications.length} modification(s)`,
    ],
  };
}

/**
 * Compare a scenario against the baseline forecast.
 *
 * @param baseline - Baseline forecast result
 * @param scenario - Scenario to compare
 * @param baseCurrency - Currency for calculations
 * @returns Detailed comparison with impact analysis
 */
export function compareScenarioToBaseline(
  baseline: ForecastResult,
  scenario: ForecastScenario,
  baseCurrency: string
): ScenarioComparison {
  const scenarioResult = applyScenario(baseline, scenario, baseCurrency);

  // Calculate monthly impact
  const monthlyImpact = baseline.points.map((basePoint, index) => {
    const scenarioPoint = scenarioResult.points[index];
    return {
      period: basePoint.period,
      incomeDiff: scenarioPoint.income.subtract(basePoint.income),
      expensesDiff: scenarioPoint.expenses.subtract(basePoint.expenses),
      savingsDiff: scenarioPoint.savings.subtract(basePoint.savings),
    };
  });

  // Calculate totals
  const totalIncomeDiff = monthlyImpact.reduce(
    (sum, m) => sum.add(m.incomeDiff),
    Money.zero(baseCurrency)
  );

  const totalExpensesDiff = monthlyImpact.reduce(
    (sum, m) => sum.add(m.expensesDiff),
    Money.zero(baseCurrency)
  );

  const totalSavingsDiff = monthlyImpact.reduce(
    (sum, m) => sum.add(m.savingsDiff),
    Money.zero(baseCurrency)
  );

  // Calculate average savings rate diff
  const baseAvgRate =
    baseline.points.reduce((sum, p) => sum + p.savingsRate, 0) /
    baseline.points.length;
  const scenarioAvgRate =
    scenarioResult.points.reduce((sum, p) => sum + p.savingsRate, 0) /
    scenarioResult.points.length;
  const savingsRateDiff = scenarioAvgRate - baseAvgRate;

  return {
    scenario,
    baselineResult: baseline,
    scenarioResult,
    impact: {
      totalIncomeDiff,
      totalExpensesDiff,
      totalSavingsDiff,
      savingsRateDiff,
      monthlyImpact,
    },
  };
}

// Re-export template functions from separate module for backwards compatibility
export {
  getScenarioTemplate,
  getAllScenarioTemplates,
  createCustomScenario,
} from "./scenarioTemplates";

/**
 * Compare multiple scenarios at once.
 *
 * @param baseline - Baseline forecast
 * @param scenarios - List of scenarios to compare
 * @param baseCurrency - Currency for calculations
 * @returns Array of comparisons sorted by savings impact
 */
export function compareMultipleScenarios(
  baseline: ForecastResult,
  scenarios: ForecastScenario[],
  baseCurrency: string
): ScenarioComparison[] {
  const comparisons = scenarios.map((scenario) =>
    compareScenarioToBaseline(baseline, scenario, baseCurrency)
  );

  // Sort by total savings difference (best scenario first)
  // Use Money comparison methods instead of .toNumber() arithmetic
  return comparisons.sort((a, b) => {
    if (b.impact.totalSavingsDiff.gt(a.impact.totalSavingsDiff)) return 1;
    if (b.impact.totalSavingsDiff.lt(a.impact.totalSavingsDiff)) return -1;
    return 0;
  });
}

/**
 * Generate a scenario summary report.
 */
export function generateScenarioSummary(
  comparison: ScenarioComparison,
  baseCurrency: string
): {
  scenarioName: string;
  totalSavingsImpact: string;
  savingsRateChange: string;
  recommendation: string;
} {
  const { scenario, impact } = comparison;

  // Use Money comparison methods instead of .toNumber() for threshold checks
  const savingsDiff = impact.totalSavingsDiff;
  const isPositive = savingsDiff.isPositiveOrZero();

  let recommendation: string;
  if (savingsDiff.gt(1000)) {
    recommendation = "Highly beneficial - consider implementing";
  } else if (savingsDiff.gt(0)) {
    recommendation = "Moderately beneficial - worth considering";
  } else if (savingsDiff.gt(-500)) {
    recommendation = "Minor negative impact - evaluate trade-offs";
  } else {
    recommendation = "Significant negative impact - proceed with caution";
  }

  return {
    scenarioName: scenario.name,
    totalSavingsImpact: `${isPositive ? "+" : ""}${impact.totalSavingsDiff.toString()} ${baseCurrency}`,
    savingsRateChange: `${impact.savingsRateDiff >= 0 ? "+" : ""}${impact.savingsRateDiff.toFixed(1)}%`,
    recommendation,
  };
}
