/**
 * Goals Extra Controller
 *
 * Handlers for goal summary, projections, contributions, and payoff tools.
 *
 * @module modules/goals/goals.extra.controller
 */

import { Request, Response } from "express";
import { success, created } from "../../core/http";
import { ValidationError } from "../../core/errors";
import { Money } from "../../core/money";
import { businessAuditService } from "../../services/BusinessAuditService";
import { mapGoalLinkMoney, mapGoalMoney } from "./goals.helpers";
import { goalService, transactionGoalLinkService } from "./goals.service";
import {
  addContributionSchema,
  calculatePayoffSchema,
  debtStrategySchema,
  calculateProjectionSchema,
} from "./goals.validation";

/**
 * GET /api/goals/summary
 */
export async function getSummary(req: Request, res: Response): Promise<void> {
  const { householdId } = req.householdContext!;
  const summary = await goalService.getSummary(householdId);
  success(res, summary);
}

/**
 * GET /api/goals/:id/projection
 */
export async function getProjection(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;
  const projection = await goalService.getProjection(id, householdId, userId);
  success(res, projection);
}

/**
 * GET /api/goals/:id/contributions
 */
export async function getContributions(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId } = req.householdContext!;
  const { id } = req.params;
  const contributions = await goalService.getContributions(id, householdId);
  success(res, contributions);
}

/**
 * POST /api/goals/:id/contribute
 */
export async function addContribution(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const parseResult = addContributionSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError(
      "Invalid contribution data",
      parseResult.error.errors
    );
  }

  const { amount, date, notes, transactionId } = parseResult.data;

  const result = await goalService.addContribution(
    id,
    householdId,
    userId,
    amount,
    { date, notes, transactionId }
  );

  await businessAuditService.logUpdate({
    userId,
    householdId,
    entityId: id,
    entityType: "goal",
    newValue: { amount, date, notes, transactionId },
    metadata: { operation: "addContribution" },
    ipAddress: businessAuditService.getIpAddress(req),
  });

  created(res, {
    goal: mapGoalMoney(result.goal),
    contribution: result.contribution,
  });
}

/**
 * GET /api/goals/:id/transactions
 */
export async function getGoalTransactions(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId } = req.householdContext!;
  const { id } = req.params;

  const goal = await goalService.getGoalById(id, householdId);
  const links = await transactionGoalLinkService.getLinkedTransactions(
    id,
    householdId
  );
  const currency = goal.currency ?? "ZMW";

  success(res, links.map((link) => mapGoalLinkMoney(link, currency)));
}

/**
 * POST /api/goals/:id/complete
 */
export async function completeGoal(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const goal = await goalService.completeGoal(id, householdId, userId);

  await businessAuditService.logUpdate({
    userId,
    householdId,
    entityId: id,
    entityType: "goal",
    newValue: { status: "completed" },
    metadata: { operation: "completeGoal" },
    ipAddress: businessAuditService.getIpAddress(req),
  });

  success(res, mapGoalMoney(goal));
}

/**
 * POST /api/goals/:id/archive
 */
export async function archiveGoal(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const goal = await goalService.setArchived(id, householdId, userId, true);

  await businessAuditService.logUpdate({
    userId,
    householdId,
    entityId: id,
    entityType: "goal",
    newValue: { isArchived: true },
    metadata: { operation: "archiveGoal" },
    ipAddress: businessAuditService.getIpAddress(req),
  });

  success(res, mapGoalMoney(goal));
}

/**
 * POST /api/goals/:id/unarchive
 */
export async function unarchiveGoal(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const goal = await goalService.setArchived(id, householdId, userId, false);

  await businessAuditService.logUpdate({
    userId,
    householdId,
    entityId: id,
    entityType: "goal",
    newValue: { isArchived: false },
    metadata: { operation: "unarchiveGoal" },
    ipAddress: businessAuditService.getIpAddress(req),
  });

  success(res, mapGoalMoney(goal));
}

/**
 * POST /api/goals/:id/calculate-payoff
 */
export async function calculatePayoff(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId } = req.householdContext!;
  const { id } = req.params;

  const parseResult = calculatePayoffSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError("Invalid payoff data", parseResult.error.errors);
  }

  const result = await goalService.calculatePayoff(
    id,
    householdId,
    parseResult.data
  );
  success(res, result);
}

/**
 * GET /api/goals/:id/payoff-scenarios
 */
export async function getPayoffScenarios(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId } = req.householdContext!;
  const { id } = req.params;

  const scenarios = await goalService.getPayoffScenarios(id, householdId);
  success(res, scenarios);
}

/**
 * POST /api/goals/debt-strategy
 */
export async function calculateDebtStrategy(
  req: Request,
  res: Response
): Promise<void> {
  const parseResult = debtStrategySchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError(
      "Invalid debt strategy data",
      parseResult.error.errors
    );
  }

  const result = await goalService.calculateDebtStrategy(
    parseResult.data.method,
    parseResult.data.debts
  );
  success(res, result);
}

/**
 * POST /api/goals/calculate-projection
 *
 * Standalone "what-if" investment growth calculator — arbitrary
 * user-entered inputs, not tied to a saved goal (see
 * server/services/goal/GoalProjectionCalculator). GET /:id/projection is a
 * different feature: it projects an existing saved goal from its own
 * target/contribution history and takes no user-supplied assumptions.
 */
export async function calculateProjection(
  req: Request,
  res: Response
): Promise<void> {
  const parseResult = calculateProjectionSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError(
      "Invalid projection input",
      parseResult.error.errors
    );
  }

  const result = goalService.calculateProjection(parseResult.data);
  success(res, result);
}
