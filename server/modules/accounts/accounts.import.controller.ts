/**
 * Accounts Import/Export Controller
 *
 * Handles balance history and transaction import/export operations.
 *
 * @module modules/accounts/accounts.import.controller
 */

import { Request, Response } from "express";
import { accountService } from "./accounts.service";
import { businessAuditService } from "../../services/BusinessAuditService";
import { logger } from "../../utils/logger";
import { success } from "../../core/http";
import { ValidationError } from "../../core/errors";
import {
  balanceHistoryQuerySchema,
  balanceHistoryImportSchema,
  transactionImportSchema,
  transactionsExportQuerySchema,
  type DateRange,
} from "./accounts.validation";

// ============================================================================
// BALANCE HISTORY
// ============================================================================

/**
 * Get balance history for an account
 * GET /api/accounts/:id/balance-history
 */
export async function getBalanceHistory(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const queryResult = balanceHistoryQuerySchema.safeParse(req.query);
  const dateRange = queryResult.success ? queryResult.data.dateRange : "1m";

  const history = await accountService.getBalanceHistory(
    id,
    householdId,
    userId,
    dateRange as DateRange
  );

  success(res, history);
}

/**
 * Export balance history as CSV
 * GET /api/accounts/:id/balance-history/export
 */
export async function exportBalanceHistory(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const csvData = await accountService.exportBalanceHistory(
    id,
    householdId,
    userId
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="balance-history.csv"'
  );
  res.send(csvData);
}

/**
 * Import balance history from CSV
 * POST /api/accounts/:id/balance-history/import
 */
export async function importBalanceHistory(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const parseResult = balanceHistoryImportSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError("Invalid import data", parseResult.error.errors);
  }

  // The snapshots and their audit row commit in one transaction (NEW-32).
  const result = await accountService.importBalanceHistory(
    id,
    parseResult.data.data,
    householdId,
    userId,
    businessAuditService.getIpAddress(req),
  );

  logger.request(req, "Imported balance history", {
    accountId: id,
    count: parseResult.data.data.length,
  });

  success(res, result);
}

// ============================================================================
// TRANSACTIONS IMPORT/EXPORT
// ============================================================================

/**
 * Export account transactions as CSV
 * GET /api/accounts/:id/transactions/export
 */
export async function exportTransactions(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const queryResult = transactionsExportQuerySchema.safeParse(req.query);
  const options = queryResult.success ? queryResult.data : {};

  const csvData = await accountService.exportTransactions(
    id,
    householdId,
    userId,
    options
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="transactions.csv"'
  );
  res.send(csvData);
}

/**
 * Import transactions from CSV
 * POST /api/accounts/:id/transactions/import
 */
export async function importTransactions(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const parseResult = transactionImportSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError("Invalid import data", parseResult.error.errors);
  }

  const result = await accountService.importTransactions(
    id,
    parseResult.data.transactions,
    parseResult.data.adjustBalance,
    householdId,
    userId,
    parseResult.data.possibleDuplicateDecisions,
  );

  logger.request(req, "Imported transactions", {
    accountId: id,
    count: parseResult.data.transactions.length,
  });

  success(res, result);
}

// Export all import/export controller methods
export const accountsImportController = {
  getBalanceHistory,
  exportBalanceHistory,
  importBalanceHistory,
  exportTransactions,
  importTransactions,
};
