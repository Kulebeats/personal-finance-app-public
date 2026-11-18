/**
 * Goal Services Index
 *
 * Re-exports all goal-related services.
 *
 * @module services/goal
 */

export {
  GoalAccountAssignmentService,
  goalAccountAssignmentService,
} from "./assignment.service";

// Re-export types and utilities
export type { AssignmentData } from "./assignment.validation";
export {
  validateAssignmentRules,
  ensureAssignmentConstraints,
} from "./assignment.validation";
export {
  calculateAssignmentBalance,
  hasAutoSyncAssignments,
  hasBalanceUpdate,
  calculateHoldingsValue,
} from "./assignment.calculations";
export {
  getGoal,
  getAccount,
  getAssignments,
  getAssignmentsForHousehold,
  getAvailableFunds,
  getExistingAssignment,
} from "./assignment.queries";
export {
  syncGoalsForAccount,
  recalculateGoalBalance,
  recalculateDebtGoalsForAccount,
} from "./assignment.sync";
