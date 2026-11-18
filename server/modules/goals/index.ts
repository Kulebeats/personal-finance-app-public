/**
 * Goals Module Index
 *
 * Consolidates 4 goal-related services into one module:
 * - GoalService
 * - GoalAccountAssignmentService
 * - GoalActivityLogService
 * - GoalTransferService
 *
 * @module modules/goals
 */

// Routes
export { default as goalsRoutes } from "./goals.routes";

// Controller
export { goalsController } from "./goals.controller";

// Services (re-export for convenience)
export { goalService } from "../../services/GoalService";
export { goalAccountAssignmentService } from "../../services/GoalAccountAssignmentService";
export { goalActivityLogService } from "../../services/GoalActivityLogService";
export { goalTransferService } from "../../services/GoalTransferService";
