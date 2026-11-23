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
import { readGoalSourceVisibility, toViewerGoal } from "../../services/goal/GoalViewerProgress";
import {
  mapGoalMoney,
  mapGoalTransferMoney,
  mapViewerTransferMoney,
  mapLinkResponseMoney,
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
  contributeFromAccount,
  reverseContribution,
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
  const queryResult = listGoalsQuerySchema.safeParse(req.query);
  const options = queryResult.success ? queryResult.data : {};

  const goals = await goalService.getGoalsForViewer(req.householdContext!, options);

  logger.request(req, "Listed goals", { count: goals.length });

  success(res, goals.map(mapGoalMoney));
}

export async function getById(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const goal = await goalService.getGoalWithProgress(id, req.householdContext!);

  success(res, mapGoalMoney(goal));
}

export async function create(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;

  const parseResult = createGoalSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError("Invalid goal data", parseResult.error.errors);
  }

  // Service validates all goal types and writes the CREATE audit row in the
  // goal's own transaction (FIN-13).
  const goal = await goalService.createGoal(
    normalizeCreateGoalInput(parseResult.data),
    householdId,
    userId,
    req.householdContext!,
    { ipAddress: businessAuditService.getIpAddress(req) },
  );

  logger.request(req, "Created goal");

  created(res, mapGoalMoney(goal));
}

export async function update(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  // Select the update schema by the goal's immutable type.
  const { type } = await goalService.getGoalById(id, householdId);

  let parsedUpdate;
  if (type === "save_up") {
    parsedUpdate = updateSaveUpGoalSchema.safeParse(req.body);
  } else if (type === "pay_down") {
    parsedUpdate = updatePayDownGoalSchema.safeParse(req.body);
  } else {
    parsedUpdate = updateInvestmentGoalSchema.safeParse(req.body);
  }

  if (!parsedUpdate.success) {
    throw new ValidationError("Invalid goal update", parsedUpdate.error.errors);
  }

  const normalizedUpdate = normalizeUpdateGoalInput(type, parsedUpdate.data);

  await goalService.updateGoal(
    id,
    normalizedUpdate,
    householdId,
    userId,
    req.householdContext!,
    { ipAddress: businessAuditService.getIpAddress(req) },
  );

  logger.request(req, "Updated goal");

  success(res, mapGoalMoney(await goalService.getViewerGoal(id, req.householdContext!)));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  // The service locks the goal, deletes it and writes the DELETE audit row
  // with its last values in one transaction (FIN-13).
  await goalService.deleteGoal(id, householdId, { userId, ipAddress: businessAuditService.getIpAddress(req) });

  logger.request(req, "Deleted goal");

  success(res, { message: "Goal deleted successfully" });
}

// ============================================================================
// TRANSFERS
// ============================================================================

export async function getTransfers(req: Request, res: Response): Promise<void> {
  const { householdId } = req.householdContext!;

  const transfers = await goalTransferService.getTransfers(householdId, req.householdContext!);
  const household = await householdRepository.findById(householdId);
  const currency = household?.currency ?? "ZMW";

  success(
    res,
    transfers.map((transfer) => mapViewerTransferMoney(transfer, currency))
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
    householdId,
    req.householdContext!,
  );
  const goal = await goalService.getGoalById(id, householdId);
  const currency = goal.currency ?? "ZMW";

  success(
    res,
    transfers.map((transfer) => mapViewerTransferMoney(transfer, currency))
  );
}

export async function createTransfer(
  req: Request,
  res: Response
): Promise<void> {
  const actor = req.householdContext!;
  const { householdId, userId } = actor;

  const parseResult = goalTransferSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError(
      "Invalid transfer data",
      parseResult.error.errors
    );
  }

  // A-23: the service writes the goal_transfer audit row inside the transfer's transaction.
  const result = await goalTransferService.transfer(
    householdId,
    userId,
    parseResult.data,
    actor,
    businessAuditService.getIpAddress(req),
  );

  const transferCurrency =
    result.fromGoal.currency ?? result.toGoal.currency ?? "ZMW";
  created(res, {
    transfer: mapGoalTransferMoney(result.transfer, transferCurrency),
    fromGoal: mapGoalMoney(toViewerGoal(result.fromGoal, result.visibility.get(result.fromGoal.id))),
    toGoal: mapGoalMoney(toViewerGoal(result.toGoal, result.visibility.get(result.toGoal.id))),
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

  // The LINK audit row is written inside the link's own transaction (Rule 9).
  const result = await transactionGoalLinkService.linkTransaction(
    id,
    householdId,
    userId,
    { ...parseResult.data, viewer: req.householdContext! },
    undefined,
    { userId, ipAddress: businessAuditService.getIpAddress(req) },
  );

  const currency = result.goal.currency ?? "ZMW";
  // FIN-01: the goal and the link as this member may see them, read after the commit.
  const visibility = (await readGoalSourceVisibility(req.householdContext!, [id])).get(id);
  created(res, {
    link: mapLinkResponseMoney(result.link, currency, visibility?.progressVisible === true),
    goal: mapGoalMoney(toViewerGoal(result.goal, visibility)),
  });
}

export async function unlinkTransaction(
  req: Request,
  res: Response
): Promise<void> {
  const { userId } = req.householdContext!;
  const { id, txId } = req.params;

  // The UNLINK audit row is written inside the unlink's own transaction (Rule 9).
  await transactionGoalLinkService.unlinkTransaction(
    id,
    txId,
    req.householdContext!,
    { userId, ipAddress: businessAuditService.getIpAddress(req) },
  );

  res.json({ success: true, data: { message: "Transaction unlinked" } });
}

// ============================================================================
// ACTIVITY LOG
// ============================================================================

export async function getActivity(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { limit, offset } = req.query;

  const activity = await goalActivityLogService.getActivity(id, req.householdContext!, {
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
  contributeFromAccount,
  reverseContribution,
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
