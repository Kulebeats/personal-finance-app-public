/**
 * Calculation Engine - Goals Module
 *
 * Re-exports all goals-related calculations.
 *
 * @module core/calculations/goals
 */

export {
  calculateGoalProgress,
  calculatePercentComplete,
  calculateAnnualGoalProgress,
  type GoalProgress,
} from "./progress";

export {
  determineGoalStatus,
  type GoalStatus,
  type GoalStatusResult,
  type GoalInfo,
} from "./status";

export {
  calculateGoalProjection,
  calculateRequiredMonthlyContribution,
  type GoalProjection,
  type ProjectionInput,
} from "./projections";
