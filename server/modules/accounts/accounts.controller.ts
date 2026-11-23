/**
 * Accounts Controller
 *
 * Thin HTTP layer - validates requests and delegates to service.
 *
 * @module modules/accounts/accounts.controller
 */

import { Request, Response } from "express";
import { isIP } from "node:net";
import { accountService } from "./accounts.service";
import { logger } from "../../utils/logger";
import { success, created } from "../../core/http";
import { ValidationError } from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import { Money } from "../../core/money";
import { CalculationError } from "../../core/calculations/errors";
import { AccountFinancialDataUnavailable } from "../../repositories/AccountReadAudience";
import {
  createAccountSchema,
  updateAccountSchema,
  balanceAdjustmentSchema,
  listAccountsQuerySchema,
  netWorthHistoryQuerySchema,
  accountSettingsSchema,
  type DateRange,
} from "./accounts.validation";
import { accountsImportController } from "./accounts.import.controller";

async function financialRead<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof CalculationError && error.code === "MISSING_FX_RATE") throw new AccountFinancialDataUnavailable();
    throw error;
  }
}

// ============================================================================
// ACCOUNT CRUD
// ============================================================================

/**
 * List all accounts
 * GET /api/accounts
 */
export async function list(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;

  const queryResult = listAccountsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    throw new ValidationError(
      "Invalid query parameters",
      queryResult.error.errors,
    );
  }

  const accounts = await accountService.getAccounts(
    householdId,
    userId,
    queryResult.data,
  );

  success(res, accounts);
}

/**
 * Get net worth summary
 * GET /api/accounts/summary
 */
export async function getSummary(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;

  const summary = await financialRead(() => accountService.getNetWorthSummary(householdId, userId));

  success(res, summary);
}

/**
 * Export accounts summary as CSV
 * GET /api/accounts/summary/export
 */
export async function exportSummary(
  req: Request,
  res: Response,
): Promise<void> {
  const { householdId, userId } = req.householdContext!;

  const csvData = await financialRead(() => accountService.exportSummary(householdId, userId));

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="accounts-summary.csv"',
  );
  res.send(csvData);
}

/**
 * Get net worth history
 * GET /api/accounts/summary/history
 */
export async function getNetWorthHistory(
  req: Request,
  res: Response,
): Promise<void> {
  const { householdId, userId } = req.householdContext!;

  const queryResult = netWorthHistoryQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    throw new ValidationError(
      "Invalid query parameters",
      queryResult.error.errors,
    );
  }

  const { dateRange, scope, includeAccounts, ownerUserId } = queryResult.data;

  const args = [householdId, userId, dateRange as DateRange, scope] as const;
  const history = includeAccounts ? ownerUserId === undefined ? await accountService.getNetWorthHistory(...args, true)
    : await accountService.getNetWorthHistory(...args, true, ownerUserId)
    : await accountService.getNetWorthHistory(...args);

  success(res, history);
}

/**
 * Get single account by ID
 * GET /api/accounts/:id
 */
export async function getById(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const account = await accountService.getAccountById(id, householdId, userId);

  success(res, account);
}

/**
 * Create a new account
 * POST /api/accounts
 */
export async function create(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;

  const parseResult = createAccountSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError("Invalid account data", parseResult.error.errors);
  }

  // Express applies the configured proxy trust policy; an arbitrary forwarding
  // chain is not an inet value and must not abort the mandatory financial audit.
  const requestIp = req.ip?.split("%")[0];
  const account = await accountService.createAccount(
    parseResult.data,
    householdId,
    userId,
    { ipAddress: requestIp && isIP(requestIp) ? requestIp : undefined },
  );

  logger.request(req, "Created account");

  created(res, account);
}

/**
 * Update an existing account
 * PUT /api/accounts/:id
 */
export async function update(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const parseResult = updateAccountSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError("Invalid update data", parseResult.error.errors);
  }

  const { updatedAt, ...updateData } = parseResult.data;

  // NEW-32: the update and its one audit row commit in one transaction.
  const account = await accountService.updateAccountAudited(
    id,
    updateData,
    householdId,
    userId,
    updatedAt ? new Date(updatedAt) : undefined,
    businessAuditService.getIpAddress(req),
  );

  logger.request(req, "Updated account");

  success(res, account);
}

/**
 * Delete an account
 * DELETE /api/accounts/:id
 */
export async function remove(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  // NEW-32: the soft delete and its one audit row commit in one transaction.
  await accountService.deleteAccountAudited(id, householdId, userId, businessAuditService.getIpAddress(req));

  logger.request(req, "Deleted account");

  success(res, { message: "Account deleted successfully" });
}

// ============================================================================
// BALANCE OPERATIONS
// ============================================================================

/**
 * Adjust account balance
 * POST /api/accounts/:id/adjust-balance
 */
export async function adjustBalance(
  req: Request,
  res: Response,
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const parseResult = balanceAdjustmentSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError(
      "Invalid balance adjustment",
      parseResult.error.errors,
    );
  }

  // FIX DATA-ACCOUNT-001: Pass amount as string to preserve precision.
  // NEW-32 / FIN-13: the ledger row, the balance change and the row's one
  // CREATE audit commit in one transaction under the account lock.
  const result = await accountService.adjustBalance(
    id,
    parseResult.data.amount,
    parseResult.data.isIncrease,
    householdId,
    userId,
    parseResult.data.notes,
    businessAuditService.getIpAddress(req),
  );

  logger.request(req, "Adjusted account balance");

  success(res, result);
}

/**
 * Archive an account
 * POST /api/accounts/:id/archive
 */
export async function archive(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  // One audit row, written by the service in the archive's transaction.
  const account = await accountService.archiveAccount(id, householdId, userId, businessAuditService.getIpAddress(req));

  success(res, account);
}

/**
 * Unarchive an account
 * POST /api/accounts/:id/unarchive
 */
export async function unarchive(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  // One audit row, written by the service in the unarchive's transaction.
  const account = await accountService.unarchiveAccount(id, householdId, userId, businessAuditService.getIpAddress(req));

  success(res, account);
}

// ============================================================================
// SETTINGS
// ============================================================================

/**
 * Update account visibility settings
 * PATCH /api/accounts/:id/settings
 */
export async function updateSettings(
  req: Request,
  res: Response,
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const parseResult = accountSettingsSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError(
      "Invalid settings data",
      parseResult.error.errors,
    );
  }

  // NEW-32: the settings change and its one audit row commit in one transaction.
  const account = await accountService.updateAccountSettingsAudited(
    id,
    parseResult.data,
    householdId,
    userId,
    businessAuditService.getIpAddress(req),
  );

  logger.request(req, "Updated account settings");

  success(res, account);
}

// Export all controller methods
export const accountsController = {
  list,
  getSummary,
  exportSummary,
  getNetWorthHistory,
  getById,
  create,
  update,
  remove,
  adjustBalance,
  archive,
  unarchive,
  updateSettings,
  // Re-export from import controller
  ...accountsImportController,
};
