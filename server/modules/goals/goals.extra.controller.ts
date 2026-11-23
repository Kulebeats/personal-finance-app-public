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
import { mapCorrectionMoney, mapGoalMoney, mapLinkResponseMoney } from "./goals.helpers";
import { goalService, transactionGoalLinkService } from "./goals.service";
import { readGoalSourceVisibility, toViewerGoal, toViewerGoals } from "../../services/goal/GoalViewerProgress";
import { contributeFromAccount as contributeFromAccountService } from "../../services/goal/GoalAccountContribution";
import {
  accountContributionSchema,
  addContributionSchema,
  calculatePayoffSchema,
  debtStrategySchema,
  calculateProjectionSchema,
  reverseContributionSchema,
} from "./goals.validation";

/**
 * GET /api/goals/summary
 */
export async function getSummary(req: Request, res: Response): Promise<void> {
  const summary = await goalService.getSummary(req.householdContext!);
  success(res, summary);
}

/**
 * GET /api/goals/:id/projection
 */
export async function getProjection(
  req: Request,
  res: Response
): Promise<void> {
  const { id } = req.params;
  const projection = await goalService.getProjection(id, req.householdContext!);
  success(res, projection);
}

/**
 * GET /api/goals/:id/contributions
 */
export async function getContributions(
  req: Request,
  res: Response
): Promise<void> {
  const { id } = req.params;
  const contributions = await goalService.getContributions(id, req.householdContext!);
  // FIN-01: an applied effect is floored at the progress it found, so only a
  // member who can see all of the goal's progress receives it.
  const progressVisible = (await readGoalSourceVisibility(req.householdContext!, [id])).get(id)?.progressVisible === true;
  success(res, contributions.map((row) => ({ ...row, appliedDelta: progressVisible ? row.appliedDelta : null })));
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

  const { amount, date, notes, transactionId, confirmOverfund } = parseResult.data;

  // The audit row is written inside the contribution's own transaction (Rule 9).
  const result = await goalService.addContribution(
    id,
    householdId,
    userId,
    amount.amount,
    { date, notes, transactionId, currency: amount.currency, confirmOverfund,
      ipAddress: businessAuditService.getIpAddress(req), actor: req.householdContext! }
  );

  // FIN-01: the response shows the goal as this member may see it.
  const [goal] = await toViewerGoals(req.householdContext!, [result.goal]);
  created(res, {
    goal: mapGoalMoney(goal),
    contribution: result.contribution,
  });
}

/**
 * POST /api/goals/:id/contributions/from-account
 *
 * The expense and its contribution link commit together; a refusal commits
 * nothing, so the client retries the same request (#245, Astra round 2).
 */
export async function contributeFromAccount(req: Request, res: Response): Promise<void> {
  const parseResult = accountContributionSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError("Invalid contribution data", parseResult.error.errors);
  }
  const result = await contributeFromAccountService(
    req.params.id, req.householdContext!, parseResult.data, businessAuditService.getIpAddress(req),
  );
  const body = {
    transactionId: result.transactionId,
    replayed: result.replayed,
    goal: mapGoalMoney(await goalService.getViewerGoal(req.params.id, req.householdContext!)),
  };
  if (result.replayed) success(res, body);
  else created(res, body);
}

/**
 * POST /api/goals/:id/contributions/:contributionId/reverse
 *
 * Reverses a mistaken contribution with an audited correction row.
 */
export async function reverseContribution(
  req: Request,
  res: Response
): Promise<void> {
  const { id, contributionId } = req.params;
  const parseResult = reverseContributionSchema.safeParse(req.body ?? {});
  if (!parseResult.success) {
    throw new ValidationError("Invalid correction data", parseResult.error.errors);
  }

  const result = await goalService.reverseContribution(id, contributionId, req.householdContext!, {
    reason: parseResult.data.reason,
    ipAddress: businessAuditService.getIpAddress(req),
  });

  // FIN-01: the goal and the correction as this member may see them. Read
  // after the commit: a hidden source that landed while the reversal waited
  // for the goal lock is counted, and one that lands later did not affect it.
  const visibility = (await readGoalSourceVisibility(req.householdContext!, [id])).get(id);
  created(res, {
    goal: mapGoalMoney(toViewerGoal(result.goal, visibility)),
    correction: mapCorrectionMoney(result.correction, result.goal.currency, visibility?.progressVisible === true),
  });
}

/**
 * GET /api/goals/:id/transactions
 */
export async function getGoalTransactions(
  req: Request,
  res: Response
): Promise<void> {
  const actor = req.householdContext!;
  const { id } = req.params;

  const goal = await goalService.getGoalById(id, actor.householdId);
  const links = await transactionGoalLinkService.getLinkedTransactions(
    id,
    actor
  );
  const currency = goal.currency ?? "ZMW";
  // FIN-01: the same rule as the link response (mapLinkResponseMoney).
  const progressVisible = (await readGoalSourceVisibility(actor, [id])).get(id)?.progressVisible === true;

  success(res, links.map((link) => mapLinkResponseMoney(link, currency, progressVisible)));
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

  // The business audit row commits with the completion, inside the service (Rule 9).
  await goalService.completeGoal(id, householdId, userId, req.householdContext!, {
    ipAddress: businessAuditService.getIpAddress(req),
  });

  success(res, mapGoalMoney(await goalService.getViewerGoal(id, req.householdContext!)));
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

  // The UPDATE audit row is written inside the archive's transaction (FIN-13).
  await goalService.setArchived(id, householdId, userId, true, { ipAddress: businessAuditService.getIpAddress(req) });

  success(res, mapGoalMoney(await goalService.getViewerGoal(id, req.householdContext!)));
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

  // The UPDATE audit row is written inside the unarchive's transaction (FIN-13).
  await goalService.setArchived(id, householdId, userId, false, { ipAddress: businessAuditService.getIpAddress(req) });

  success(res, mapGoalMoney(await goalService.getViewerGoal(id, req.householdContext!)));
}

/**
 * POST /api/goals/:id/calculate-payoff
 */
export async function calculatePayoff(
  req: Request,
  res: Response
): Promise<void> {
  const { id } = req.params;

  const parseResult = calculatePayoffSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError("Invalid payoff data", parseResult.error.errors);
  }

  const result = await goalService.calculatePayoff(
    id,
    req.householdContext!,
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
  const { id } = req.params;

  const scenarios = await goalService.getPayoffScenarios(id, req.householdContext!);
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
