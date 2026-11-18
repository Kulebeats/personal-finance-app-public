/**
 * Goal Assignments Controller
 *
 * Handles account assignment endpoints for goals.
 * Extracted from goals.controller.ts for LOC compliance.
 *
 * @module modules/goals/goals.assignments.controller
 */

import { Request, Response } from "express";
import { goalAccountAssignmentService } from "./goals.service";
import { success, created } from "../../core/http";
import { ValidationError } from "../../core/errors";
import { assignAccountSchema } from "./goals.validation";
import { businessAuditService } from "../../services/BusinessAuditService";
import { mapAssignmentMoney, mapAvailableFundsMoney } from "./goals.helpers";

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
  // FIX AUTH-GOAL-ASSIGN-001: Pass userId for privacy filtering
  const { householdId, userId } = req.householdContext!;

  const assignments =
    await goalAccountAssignmentService.getAssignmentsForHousehold(
      householdId,
      userId
    );

  success(res, assignments.map(mapAssignmentMoney));
}

/**
 * Get assignments for a specific goal
 * GET /api/goals/:id/assignments
 * FIX AUTH-GOAL-ASSIGN-001: Pass userId for privacy filtering
 */
export async function getAssignments(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const assignments = await goalAccountAssignmentService.getAssignments(
    id,
    householdId,
    userId
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

  const result = await goalAccountAssignmentService.assignAccount(
    id,
    householdId,
    userId,
    parseResult.data
  );

  await businessAuditService.logUpdate({
    userId,
    householdId,
    entityId: id,
    entityType: "goal",
    newValue: {
      accountId: result.assignment.accountId,
      assignmentType: result.assignment.assignmentType,
      partialAmount: result.assignment.partialAmount,
      autoUpdate: result.assignment.autoUpdate,
    },
    ipAddress: businessAuditService.getIpAddress(req),
    metadata: { operation: "assignAccount" },
  });

  created(res, result);
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

  // FIX AUTH-GOAL-ASSIGN-001: Pass userId for privacy filtering
  const existingAssignments = await goalAccountAssignmentService.getAssignments(
    id,
    householdId,
    userId
  );
  const existingAssignment = existingAssignments.find(
    (assignment) => assignment.accountId === accountId
  );

  const result = await goalAccountAssignmentService.updateAssignment(
    id,
    accountId,
    householdId,
    userId,
    parseResult.data
  );

  await businessAuditService.logUpdate({
    userId,
    householdId,
    entityId: id,
    entityType: "goal",
    oldValue: existingAssignment
      ? {
          accountId: existingAssignment.accountId,
          assignmentType: existingAssignment.assignmentType,
          partialAmount: existingAssignment.partialAmount,
          autoUpdate: existingAssignment.autoUpdate,
        }
      : undefined,
    newValue: {
      accountId: result.assignment.accountId,
      assignmentType: result.assignment.assignmentType,
      partialAmount: result.assignment.partialAmount,
      autoUpdate: result.assignment.autoUpdate,
    },
    ipAddress: businessAuditService.getIpAddress(req),
    metadata: { operation: "updateAssignment", accountId },
  });

  success(res, result);
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

  // FIX AUTH-GOAL-ASSIGN-001: Pass userId for privacy filtering
  const existingAssignments = await goalAccountAssignmentService.getAssignments(
    id,
    householdId,
    userId
  );
  const existingAssignment = existingAssignments.find(
    (assignment) => assignment.accountId === accountId
  );

  const result = await goalAccountAssignmentService.removeAssignment(
    id,
    accountId,
    householdId,
    userId
  );

  await businessAuditService.logUpdate({
    userId,
    householdId,
    entityId: id,
    entityType: "goal",
    oldValue: existingAssignment
      ? {
          accountId: existingAssignment.accountId,
          assignmentType: existingAssignment.assignmentType,
          partialAmount: existingAssignment.partialAmount,
          autoUpdate: existingAssignment.autoUpdate,
        }
      : undefined,
    newValue: undefined,
    ipAddress: businessAuditService.getIpAddress(req),
    metadata: { operation: "removeAssignment", accountId },
  });

  success(res, result);
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
