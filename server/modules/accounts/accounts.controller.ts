/**
 * Accounts Controller
 *
 * Thin HTTP layer - validates requests and delegates to service.
 *
 * @module modules/accounts/accounts.controller
 */

import { Request, Response } from "express";
import { accountService } from "./accounts.service";
import { logger } from "../../utils/logger";
import { success, created } from "../../core/http";
import { ValidationError } from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import { Money } from "../../core/money";
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

  const summary = await accountService.getNetWorthSummary(householdId, userId);

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

  const csvData = await accountService.exportSummary(householdId, userId);

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

  const { dateRange, scope } = queryResult.data;

  const history = await accountService.getNetWorthHistory(
    householdId,
    userId,
    dateRange as DateRange,
    scope,
  );

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

  const account = await accountService.createAccount(
    parseResult.data,
    householdId,
    userId,
  );

  await businessAuditService.logCreate({
    userId,
    householdId,
    entityId: account.id,
    entityType: "account",
    newValue: {
      name: account.name,
      type: account.type,
      balance: account.balance,
      currency: account.currency,
    },
    ipAddress: businessAuditService.getIpAddress(req),
  });

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

  const beforeAccount = await accountService.getAccountById(
    id,
    householdId,
    userId,
  );

  const { updatedAt, ...updateData } = parseResult.data;

  const account = await accountService.updateAccount(
    id,
    updateData,
    householdId,
    userId,
    updatedAt ? new Date(updatedAt) : undefined,
  );

  // TODO-010: Include privacy/ownership fields in audit log
  await businessAuditService.logUpdate({
    userId,
    householdId,
    entityId: id,
    entityType: "account",
    oldValue: {
      name: beforeAccount.name,
      type: beforeAccount.type,
      balance: beforeAccount.balance,
      currency: beforeAccount.currency,
      isArchived: beforeAccount.isArchived,
      isPrivate: beforeAccount.isPrivate,
      ownerUserId: beforeAccount.ownerUserId,
      institution: beforeAccount.institution,
      notes: beforeAccount.notes,
    },
    newValue: {
      name: account.name,
      type: account.type,
      balance: account.balance,
      currency: account.currency,
      isArchived: account.isArchived,
      isPrivate: account.isPrivate,
      ownerUserId: account.ownerUserId,
      institution: account.institution,
      notes: account.notes,
    },
    ipAddress: businessAuditService.getIpAddress(req),
  });

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

  const deletedAccount = await accountService.getAccountById(
    id,
    householdId,
    userId,
  );

  await accountService.deleteAccount(id, householdId, userId);

  await businessAuditService.logDelete({
    userId,
    householdId,
    entityId: id,
    entityType: "account",
    oldValue: {
      name: deletedAccount.name,
      type: deletedAccount.type,
      balance: deletedAccount.balance,
      currency: deletedAccount.currency,
      isArchived: deletedAccount.isArchived,
    },
    ipAddress: businessAuditService.getIpAddress(req),
  });

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

  const beforeAccount = await accountService.getAccountById(
    id,
    householdId,
    userId,
  );

  // FIX DATA-ACCOUNT-001: Pass amount as string to preserve precision
  // The Money class in the service will handle validation with currency context
  const result = await accountService.adjustBalance(
    id,
    parseResult.data.amount,
    parseResult.data.isIncrease,
    householdId,
    userId,
    parseResult.data.notes,
  );

  await businessAuditService.logUpdate({
    userId,
    householdId,
    entityId: id,
    entityType: "account",
    oldValue: {
      balance: beforeAccount.balance,
    },
    newValue: {
      balance: result.account.balance,
    },
    ipAddress: businessAuditService.getIpAddress(req),
    metadata: {
      operation: "adjustBalance",
      amount: parseResult.data.amount,
      isIncrease: parseResult.data.isIncrease,
      transactionId: result.transactionId,
    },
  });

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

  const beforeAccount = await accountService.getAccountById(
    id,
    householdId,
    userId,
  );

  const account = await accountService.archiveAccount(id, householdId, userId);

  await businessAuditService.logUpdate({
    userId,
    householdId,
    entityId: id,
    entityType: "account",
    oldValue: {
      isArchived: beforeAccount.isArchived,
    },
    newValue: {
      isArchived: account.isArchived,
    },
    ipAddress: businessAuditService.getIpAddress(req),
    metadata: { operation: "archive" },
  });

  success(res, account);
}

/**
 * Unarchive an account
 * POST /api/accounts/:id/unarchive
 */
export async function unarchive(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const beforeAccount = await accountService.getAccountById(
    id,
    householdId,
    userId,
  );

  const account = await accountService.unarchiveAccount(
    id,
    householdId,
    userId,
  );

  await businessAuditService.logUpdate({
    userId,
    householdId,
    entityId: id,
    entityType: "account",
    oldValue: {
      isArchived: beforeAccount.isArchived,
    },
    newValue: {
      isArchived: account.isArchived,
    },
    ipAddress: businessAuditService.getIpAddress(req),
    metadata: { operation: "unarchive" },
  });

  success(res, account);
}

// ============================================================================
// SETTINGS
// ============================================================================

/**
 * Update account visibility settings
 * PATCH /api/accounts/:id/settings
 * TODO-010: Added audit logging for compliance
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

  // Get before state for audit logging
  const beforeAccount = await accountService.getAccountById(
    id,
    householdId,
    userId,
  );

  const account = await accountService.updateAccountSettings(
    id,
    parseResult.data,
    householdId,
    userId,
  );

  // Audit log the settings update (TODO-010)
  await businessAuditService.logUpdate({
    userId,
    householdId,
    entityId: id,
    entityType: "account",
    oldValue: {
      isHidden: beforeAccount.isHidden,
      excludeFromNetWorth: beforeAccount.excludeFromNetWorth,
      hideTransactions: beforeAccount.hideTransactions,
    },
    newValue: {
      isHidden: account.isHidden,
      excludeFromNetWorth: account.excludeFromNetWorth,
      hideTransactions: account.hideTransactions,
    },
    ipAddress: businessAuditService.getIpAddress(req),
    metadata: { operation: "updateSettings" },
  });

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
