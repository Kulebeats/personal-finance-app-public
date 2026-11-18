/**
 * Calculation Engine - Budget Module
 *
 * Re-exports all budget-related calculations.
 *
 * @module core/calculations/budget
 */

export {
  calculateBudgetProgress,
  calculateProRatedBudgetProgress,
  type BudgetProgress,
} from "./progress";

export {
  determineBudgetStatus,
  shouldTriggerAlert,
  DEFAULT_THRESHOLDS,
  type BudgetAlertLevel,
  type BudgetStatus,
  type AlertThresholds,
} from "./alerts";
