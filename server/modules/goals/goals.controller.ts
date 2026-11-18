/**
 * Goals Controller
 *
 * Thin HTTP layer consolidating 4 goal services.
 * Delegates to: goalService, goalAccountAssignmentService,
 * goalTransferService, goalActivityLogService
 *
 * @module modules/goals/goals.controller
 */

import { Request, Response } from "express";
import {
  goalService,
  goalActivityLogService,
  goalTransferService,
  transactionGoalLinkService,
} from "./goals.service";
import { logger } from "../../utils/logger";
import { success, created } from "../../core/http";
import { ValidationError } from "../../core/errors";
import { householdRepository } from "../../repositories/HouseholdRepository";
import {
  createGoalSchema,
  updateSaveUpGoalSchema,
  updatePayDownGoalSchema,
  updateInvestmentGoalSchema,
  listGoalsQuerySchema,
  linkTransactionSchema,
  goalTransferSchema,
} from "./goals.validation";
import { businessAuditService } from "../../services/BusinessAuditService";
import {
  mapGoalMoney,
  mapGoalTransferMoney,
  mapGoalLinkMoney,
  normalizeCreateGoalInput,
  normalizeUpdateGoalInput,
} from "./goals.helpers";
// Import assignment controller functions
import {
  getAvailableFunds,
  getAllAssignments,
  getAssignments,
  assignAccount,
  updateAssignment,
  removeAssignment,
} from "./goals.assignments.controller";
import {
  getSummary,
  getProjection,
  getContributions,
  addContribution,
  getGoalTransactions,
  completeGoal,
  archiveGoal,
  unarchiveGoal,
  calculatePayoff,
  getPayoffScenarios,
  calculateDebtStrategy,
  calculateProjection,
} from "./goals.extra.controller";
import { getImages, uploadImage } from "./goals.images.controller";

// ============================================================================
// GOAL CRUD
// ============================================================================

export async function list(req: Request, res: Response): Promise<void> {
  const { householdId } = req.householdContext!;

  const queryResult = listGoalsQuerySchema.safeParse(req.query);
  const options = queryResult.success ? queryResult.data : {};

  const goals = await goalService.getGoals(householdId, options);

  logger.request(req, "Listed goals", { count: goals.length });

  success(res, goals.map(mapGoalMoney));
}

export async function getById(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const goal = await goalService.getGoalWithProgress(id, householdId, userId);

  success(res, mapGoalMoney(goal));
}

export async function create(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;

  const parseResult = createGoalSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError("Invalid goal data", parseResult.error.errors);
  }

  // Service validates all goal types
  const goal = await goalService.createGoal(
    normalizeCreateGoalInput(parseResult.data),
    householdId,
    userId
  );

  await businessAuditService.logCreate({
    userId,
    householdId,
    entityId: goal.id,
    entityType: "goal",
    newValue: { name: goal.name, targetAmount: goal.targetAmount },
    ipAddress: businessAuditService.getIpAddress(req),
  });

  logger.request(req, "Created goal");

  created(res, mapGoalMoney(goal));
}

export async function update(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  // Fetch before state for audit
  const beforeGoal = await goalService.getGoalById(id, householdId);

  let parsedUpdate;
  if (beforeGoal.type === "save_up") {
    parsedUpdate = updateSaveUpGoalSchema.safeParse(req.body);
  } else if (beforeGoal.type === "pay_down") {
    parsedUpdate = updatePayDownGoalSchema.safeParse(req.body);
  } else {
    parsedUpdate = updateInvestmentGoalSchema.safeParse(req.body);
  }

  if (!parsedUpdate.success) {
    throw new ValidationError("Invalid goal update", parsedUpdate.error.errors);
  }

  const normalizedUpdate = normalizeUpdateGoalInput(
    beforeGoal.type,
    parsedUpdate.data
  );

  const goal = await goalService.updateGoal(
    id,
    normalizedUpdate,
    householdId,
    userId
  );

  await businessAuditService.logUpdate({
    userId,
    householdId,
    entityId: id,
    entityType: "goal",
    oldValue: {
      name: beforeGoal.name,
      targetAmount: beforeGoal.targetAmount,
      currentAmount: beforeGoal.currentAmount,
      status: beforeGoal.status,
    },
    newValue: {
      name: goal.name,
      targetAmount: goal.targetAmount,
      currentAmount: goal.currentAmount,
      status: goal.status,
    },
    ipAddress: businessAuditService.getIpAddress(req),
  });

  logger.request(req, "Updated goal");

  success(res, mapGoalMoney(goal));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  // Capture entity snapshot before deletion for audit
  const deletedGoal = await goalService.getGoalById(id, householdId);

  await goalService.deleteGoal(id, householdId);

  await businessAuditService.logDelete({
    userId,
    householdId,
    entityId: id,
    entityType: "goal",
    oldValue: {
      name: deletedGoal.name,
      targetAmount: deletedGoal.targetAmount,
      currentAmount: deletedGoal.currentAmount,
      type: deletedGoal.type,
    },
    ipAddress: businessAuditService.getIpAddress(req),
  });

  logger.request(req, "Deleted goal");

  success(res, { message: "Goal deleted successfully" });
}

// ============================================================================
// TRANSFERS
// ============================================================================

export async function getTransfers(req: Request, res: Response): Promise<void> {
  const { householdId } = req.householdContext!;

  const transfers = await goalTransferService.getTransfers(householdId);
  const household = await householdRepository.findById(householdId);
  const currency = household?.currency ?? "ZMW";

  success(
    res,
    transfers.map((transfer) => mapGoalTransferMoney(transfer, currency))
  );
}

export async function getGoalTransfers(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId } = req.householdContext!;
  const { id } = req.params;

  const transfers = await goalTransferService.getTransfersForGoal(
    id,
    householdId
  );
  const goal = await goalService.getGoalById(id, householdId);
  const currency = goal.currency ?? "ZMW";

  success(
    res,
    transfers.map((transfer) => mapGoalTransferMoney(transfer, currency))
  );
}

export async function createTransfer(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId } = req.householdContext!;

  const parseResult = goalTransferSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError(
      "Invalid transfer data",
      parseResult.error.errors
    );
  }

  const result = await goalTransferService.transfer(
    householdId,
    userId,
    parseResult.data
  );

  await businessAuditService.logCreate({
    userId,
    householdId,
    entityId: result.transfer.id,
    entityType: "goal_transfer",
    newValue: parseResult.data,
    ipAddress: businessAuditService.getIpAddress(req),
  });

  const transferCurrency =
    result.fromGoal.currency ?? result.toGoal.currency ?? "ZMW";
  created(res, {
    ...result,
    transfer: mapGoalTransferMoney(result.transfer, transferCurrency),
    fromGoal: mapGoalMoney(result.fromGoal),
    toGoal: mapGoalMoney(result.toGoal),
  });
}

// ============================================================================
// TRANSACTION LINKS
// ============================================================================

export async function linkTransaction(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const parseResult = linkTransactionSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError("Invalid link data", parseResult.error.errors);
  }

  const result = await transactionGoalLinkService.linkTransaction(
    id,
    householdId,
    userId,
    parseResult.data
  );

  await businessAuditService.log({
    userId,
    householdId,
    action: "LINK",
    entityType: "goal",
    entityId: id,
    details: {
      transactionId: parseResult.data.transactionId,
      linkId: result.link.id,
      linkType: parseResult.data.linkType,
      amount: result.link.amount,
    },
    ipAddress: businessAuditService.getIpAddress(req),
  });

  const currency = result.goal.currency ?? "ZMW";
  created(res, {
    ...result,
    link: mapGoalLinkMoney(result.link, currency),
    goal: mapGoalMoney(result.goal),
  });
}

export async function unlinkTransaction(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id, txId } = req.params;

  await transactionGoalLinkService.unlinkTransaction(
    id,
    txId,
    householdId,
    userId
  );

  await businessAuditService.log({
    userId,
    householdId,
    action: "UNLINK",
    entityType: "goal",
    entityId: id,
    details: {
      transactionId: txId,
    },
    ipAddress: businessAuditService.getIpAddress(req),
  });

  res.json({ success: true, data: { message: "Transaction unlinked" } });
}

// ============================================================================
// ACTIVITY LOG
// ============================================================================

export async function getActivity(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { limit, offset } = req.query;

  const activity = await goalActivityLogService.getActivity(id, {
    limit: limit ? Number(limit) : undefined,
    offset: offset ? Number(offset) : undefined,
  });

  success(res, activity);
}

// Export all controller methods
export const goalsController = {
  list,
  getById,
  create,
  update,
  remove,
  getSummary,
  getProjection,
  getContributions,
  addContribution,
  getGoalTransactions,
  completeGoal,
  archiveGoal,
  unarchiveGoal,
  calculatePayoff,
  getPayoffScenarios,
  calculateDebtStrategy,
  calculateProjection,
  getImages,
  uploadImage,
  getAvailableFunds,
  getAllAssignments,
  getAssignments,
  assignAccount,
  updateAssignment,
  removeAssignment,
  getTransfers,
  getGoalTransfers,
  createTransfer,
  linkTransaction,
  unlinkTransaction,
  getActivity,
};
