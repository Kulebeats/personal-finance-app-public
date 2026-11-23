/**
 * Goal Assignments Controller
 *
 * Handles account assignment endpoints for goals.
 * Extracted from goals.controller.ts for LOC compliance.
 *
 * @module modules/goals/goals.assignments.controller
 */

import { Request, Response } from "express";
import { goalAccountAssignmentService, goalService } from "./goals.service";
import { success, created } from "../../core/http";
import { ValidationError } from "../../core/errors";
import { assignAccountSchema } from "./goals.validation";
import { businessAuditService } from "../../services/BusinessAuditService";
import { mapAssignmentMoney, mapAvailableFundsMoney, mapGoalMoney } from "./goals.helpers";

/** The write's own goal row is never returned: the caller gets the redacted read model (#235 M1). */
async function withViewerGoal<T extends { goal: unknown }>(req: Request, goalId: string, result: T) {
  return { ...result, goal: mapGoalMoney(await goalService.getViewerGoal(goalId, req.householdContext!)) };
}

/**
 * Get available funds for assignment
 * GET /api/goals/available-funds
 */
export async function getAvailableFunds(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId } = req.householdContext!;

  const availableFunds = await goalAccountAssignmentService.getAvailableFunds(
    householdId,
    userId
  );

  success(res, availableFunds.map(mapAvailableFundsMoney));
}

/**
 * Get all assignments for household
 * GET /api/goals/assignments
 */
export async function getAllAssignments(
  req: Request,
  res: Response
): Promise<void> {
  const assignments = await goalAccountAssignmentService.getAssignmentsForHousehold(
    req.householdContext!,
  );

  success(res, assignments.map(mapAssignmentMoney));
}

/**
 * Get assignments for a specific goal
 * GET /api/goals/:id/assignments
 * Enforce current actor and account visibility in the assignment query.
 */
export async function getAssignments(
  req: Request,
  res: Response
): Promise<void> {
  const { id } = req.params;

  const assignments = await goalAccountAssignmentService.getVisibleAssignments(
    id,
    req.householdContext!,
  );

  success(res, assignments.map(mapAssignmentMoney));
}

/**
 * Assign an account to a goal
 * POST /api/goals/:id/assignments
 */
export async function assignAccount(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const parseResult = assignAccountSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError(
      "Invalid assignment data",
      parseResult.error.errors
    );
  }

  // The goal's UPDATE audit row is written inside the assignment's transaction (FIN-13).
  const result = await goalAccountAssignmentService.assignAccount(
    id,
    householdId,
    userId,
    parseResult.data,
    { ipAddress: businessAuditService.getIpAddress(req) },
  );

  created(res, await withViewerGoal(req, id, result));
}

/**
 * Update an existing assignment
 * PUT /api/goals/:id/assignments/:accountId
 */
export async function updateAssignment(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id, accountId } = req.params;

  const parseResult = assignAccountSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError(
      "Invalid assignment data",
      parseResult.error.errors
    );
  }

  // The goal's UPDATE audit row, with the old and new assignment, is written
  // inside the update's transaction (FIN-13).
  const result = await goalAccountAssignmentService.updateAssignment(
    id,
    accountId,
    householdId,
    userId,
    parseResult.data,
    { ipAddress: businessAuditService.getIpAddress(req) },
  );

  success(res, await withViewerGoal(req, id, result));
}

/**
 * Remove an assignment
 * DELETE /api/goals/:id/assignments/:accountId
 */
export async function removeAssignment(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id, accountId } = req.params;

  // The goal's UPDATE audit row, with the removed assignment, is written
  // inside the removal's transaction (FIN-13).
  const result = await goalAccountAssignmentService.removeAssignment(
    id,
    accountId,
    householdId,
    userId,
    { ipAddress: businessAuditService.getIpAddress(req) },
  );

  success(res, await withViewerGoal(req, id, result));
}

// Export all assignment controller methods
export const goalAssignmentsController = {
  getAvailableFunds,
  getAllAssignments,
  getAssignments,
  assignAccount,
  updateAssignment,
  removeAssignment,
};
