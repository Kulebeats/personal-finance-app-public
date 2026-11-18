/**
 * Calculation Engine - Cashflow Module
 *
 * Re-exports all cashflow-related calculations.
 *
 * @module core/calculations/cashflow
 */

export { calculateSavingsRate } from "./savingsRate";
export { calculateNetSavings } from "./netSavings";
export { calculateNetSavingsRate } from "./netSavingsRate";
export {
  calculateNetWorth,
  calculateNetWorthBreakdown,
  type NetWorthBreakdown,
} from "./netWorth";
export {
  calculateIncomeAllocation,
  type IncomeAllocation,
  type AllocationItem,
  type ExpenseCategory,
} from "./incomeAllocation";
export {
  generateForecast,
  generateForecastWithConfidence,
  calculateConfidenceInterval,
  determineConfidenceLevel,
  normalizeToMonthly,
  normalizeBudgetToMonthly,
  getNextMonthStart,
  toForecastSeriesPoint,
  type ForecastConfig,
  type ForecastPoint,
  type ForecastResult,
  type RecurringRuleInput,
  type BudgetInput as ForecastBudgetInput,
  type CategoryAverageInput,
  type HistoricalVarianceInput,
  type ConfidenceInterval,
} from "./forecast";
export {
  normalizeBudgetToInterval,
  calculateVariance,
  compareBudgetsToActuals,
  compareBudgetsWithRollover,
  buildComparisonSummary,
  getUnbudgetedCategories,
  calculateRolloverAmount,
  calculateAccumulatedRollover,
  applyRolloverToComparison,
  getRolloverSummary,
  type BudgetPeriodType,
  type VarianceStatus,
  type BudgetInput as ComparisonBudgetInput,
  type ActualSpendingInput,
  type VarianceResult,
  type BudgetComparisonItem,
  type BudgetComparisonSummary,
  type RolloverPolicy,
  type RolloverConfig,
  type HistoricalBudgetUsage,
  type RolloverResult,
} from "./budgetComparison";
export {
  applyScenario,
  applyModification,
  compareScenarioToBaseline,
  compareMultipleScenarios,
  getScenarioTemplate,
  getAllScenarioTemplates,
  createCustomScenario,
  generateScenarioSummary,
  type ModificationType,
  type ModificationTarget,
  type ScenarioModification,
  type ForecastScenario,
  type ScenarioComparison,
  type ScenarioTemplate,
} from "./scenarios";
