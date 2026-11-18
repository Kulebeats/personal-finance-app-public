/**
 * Transactions Controller
 *
 * Thin HTTP layer - validates requests and delegates to service.
 * Follows the pattern: Request -> Validation -> Service -> Response
 *
 * @module modules/transactions/transactions.controller
 */

import { Request, Response } from "express";
import { z } from "zod";
import { transactionService as legacyTransactionService } from "../../services/TransactionService";
import { transactionGoalLinkService } from "../../services/TransactionGoalLinkService";
import {
  uploadAttachment,
  listAttachments,
  downloadAttachment,
  deleteAttachment,
} from "./transactions.attachments.controller";
import {
  createTransfer,
  updateTransfer,
} from "./transactions.transfer.controller";
import { logger } from "../../utils/logger";
import { success, created } from "../../core/http";
import { ValidationError } from "../../core/errors";
import { toMoneyDto } from "../../core/money";
// Use legacy schemas for type compatibility with TransactionService
import {
  createTransactionSchema,
  updateTransactionSchema,
  transactionQuerySchema as listTransactionsQuerySchema,
  summaryQuerySchema,
} from "./transactions.validation";
import { businessAuditService } from "../../services/BusinessAuditService";
import { householdRepository } from "../../repositories/HouseholdRepository";
import {
  mapTransactionMoney,
  mapTransactionLinkMoney,
} from "./transactions.helpers";

// SEC-VALID-005: Validation schemas for owner and review updates
const updateOwnerSchema = z.object({
  ownerUserId: z.string().uuid("Invalid user ID format").nullable(),
});

const markReviewedSchema = z.object({
  reviewed: z.boolean(),
});

/**
 * Export service for use in controller
 */
export const transactionService = legacyTransactionService;

/**
 * List transactions with pagination and filtering
 * GET /api/transactions
 */
export async function list(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;

  const queryResult = listTransactionsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    throw new ValidationError(
      "Invalid query parameters",
      queryResult.error.errors,
    );
  }

  const { limit, offset, sortBy, sortOrder, tagIds, ...countOptions } =
    queryResult.data;

  // R-10: Validate tag IDs via service layer (not direct DB access)
  if (tagIds && tagIds.length > 0) {
    await transactionService.validateTagIds(tagIds, householdId);
  }

  // R-07: Fetch household preferences for pending transaction visibility
  const prefs = await householdRepository.findPreferences(householdId);
  const includePending = prefs?.showPendingTransactions ?? true;

  // Fetch transactions and total count in parallel
  const [transactions, totalCount] = await Promise.all([
    transactionService.getTransactions(householdId, userId, {
      ...queryResult.data,
      tagIds,
      includePending,
    }),
    transactionService.getTransactionsCount(householdId, userId, {
      ...countOptions,
      tagIds,
      includePending,
    }),
  ]);

  logger.request(req, "Listed transactions", {
    count: transactions.length,
    totalCount,
  });

  const responseTransactions = transactions.map(mapTransactionMoney);

  res.json({
    success: true,
    data: responseTransactions,
    pagination: {
      // Legacy fields (deprecate after clients migrate)
      limit,
      offset,
      count: totalCount, // Fixed: was page length, now total count for consistency
      totalCount,
      // V7 format (CLAUDE.md Response Format Rules)
      total: totalCount,
      page: Math.floor(offset / limit),
      pageSize: responseTransactions.length,
      hasNext: offset + responseTransactions.length < totalCount,
      hasPrev: offset > 0,
    },
  });
}

/**
 * Get transaction summary for a period
 * GET /api/transactions/summary
 */
export async function getSummary(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;

  const queryResult = summaryQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    throw new ValidationError(
      "Invalid query parameters",
      queryResult.error.errors,
    );
  }

  const { startDate, endDate, ownerUserId, accountId, tagIds } =
    queryResult.data;

  if (tagIds && tagIds.length > 0) {
    await transactionService.validateTagIds(tagIds, householdId);
  }

  // Apply pending visibility preference to match list behavior
  const prefs = await householdRepository.findPreferences(householdId);
  const includePending = prefs?.showPendingTransactions ?? true;

  const summary = await transactionService.getTransactionSummary(
    householdId,
    userId,
    startDate,
    endDate,
    {
      ownerUserId,
      accountId,
      tagIds,
      includePending,
    },
  );

  success(res, {
    ...summary,
    totalIncome: toMoneyDto(summary.totalIncome),
    totalExpenses: toMoneyDto(summary.totalExpenses),
    netFlow: toMoneyDto(summary.netFlow),
  });
}

/**
 * Get a single transaction by ID
 * GET /api/transactions/:id
 */
export async function getById(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const transaction = await transactionService.getTransactionById(
    id,
    householdId,
    userId,
  );

  success(res, mapTransactionMoney(transaction));
}

/**
 * Get goal links for a transaction
 * GET /api/transactions/:id/goals
 */
export async function getGoalLinks(req: Request, res: Response): Promise<void> {
  const { householdId } = req.householdContext!;
  const { id } = req.params;

  const links = await transactionGoalLinkService.getLinksForTransaction(
    id,
    householdId,
  );

  success(
    res,
    links.map((link) => mapTransactionLinkMoney(link)),
  );
}

/**
 * Create a new transaction
 * POST /api/transactions
 */
export async function create(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;

  const parseResult = createTransactionSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError(
      "Invalid transaction data",
      parseResult.error.errors,
    );
  }

  const { idempotencyKey, ...data } = parseResult.data;

  // Rule 9: the CREATE audit row is now written atomically at the
  // repository layer (see transactionRepository.create's `audit` option,
  // wired through transactionService.createTransaction), so every caller of
  // the service is audited — not just this controller. Do not audit here
  // too, or every HTTP create would write two rows.
  const { transaction, isDuplicate } =
    await transactionService.createTransaction(
      data,
      householdId,
      userId,
      idempotencyKey,
      { ipAddress: businessAuditService.getIpAddress(req) },
    );

  logger.request(req, "Created transaction", { isDuplicate });

  res.status(isDuplicate ? 200 : 201).json({
    success: true,
    data: mapTransactionMoney(transaction),
    isDuplicate,
  });
}

/**
 * Update an existing transaction
 * PUT /api/transactions/:id
 */
export async function update(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const parseResult = updateTransactionSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError("Invalid update data", parseResult.error.errors);
  }

  const { updatedAt, ...updateData } = parseResult.data;

  // Rule 9 (P8b): the UPDATE audit row is now written atomically at the
  // service layer (transactionService.updateTransaction diffs before/after
  // itself, covering every changed field — a superset of what this controller
  // used to hand-build), so every caller of the service is audited — not just
  // this controller. Do not audit here too, or every HTTP update would write
  // two rows.
  const transaction = await transactionService.updateTransaction(
    id,
    updateData,
    householdId,
    userId,
    updatedAt ? new Date(updatedAt) : undefined,
    { ipAddress: businessAuditService.getIpAddress(req) },
  );

  logger.request(req, "Updated transaction");

  success(res, mapTransactionMoney(transaction));
}

/**
 * Delete a transaction
 * DELETE /api/transactions/:id
 */
export async function remove(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  // Rule 9: the DELETE audit row (snapshot + entityId) is now written
  // atomically at the repository layer inside transactionService.deleteTransaction
  // (see TransactionRepository.softDelete / TransactionTransferRepository.
  // softDeleteTransferPair `audit` options), so every caller of the service
  // is audited — not just this controller. Do not audit here too.
  await transactionService.deleteTransaction(id, householdId, userId, {
    ipAddress: businessAuditService.getIpAddress(req),
  });

  logger.request(req, "Deleted transaction");

  success(res, { message: "Transaction deleted successfully" });
}

/**
 * Update transaction owner
 * PUT /api/transactions/:id/owner
 */
export async function updateOwner(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  // SEC-VALID-005: Validate ownerUserId is a valid UUID or null
  const parseResult = updateOwnerSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError("Invalid owner user ID", parseResult.error.errors);
  }
  const { ownerUserId } = parseResult.data;

  // Rule 9 (P8b): updateOwner routes through transactionService.updateTransaction,
  // which writes the UPDATE audit row atomically at the service layer. Do not
  // audit here too, or this would double-audit alongside it.
  const transaction = await transactionService.updateOwner(
    id,
    ownerUserId,
    householdId,
    userId,
    { ipAddress: businessAuditService.getIpAddress(req) },
  );

  success(res, mapTransactionMoney(transaction));
}

/**
 * Mark transaction as reviewed
 * PUT /api/transactions/:id/review
 */
export async function markReviewed(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  // SEC-VALID-005: Validate reviewed is a boolean
  const parseResult = markReviewedSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError("Invalid review status", parseResult.error.errors);
  }
  const { reviewed } = parseResult.data;

  // Rule 9 (P8b): markReviewed/markUnreviewed route through
  // transactionService.updateTransaction, which writes the UPDATE audit row
  // atomically at the service layer. Do not audit here too, or this would
  // double-audit alongside it.
  const auditContext = { ipAddress: businessAuditService.getIpAddress(req) };
  const transaction =
    reviewed === false
      ? await transactionService.markUnreviewed(
          id,
          householdId,
          userId,
          auditContext,
        )
      : await transactionService.markReviewed(
          id,
          householdId,
          userId,
          auditContext,
        );

  success(res, mapTransactionMoney(transaction));
}

// Re-export attachment methods for external use
export {
  uploadAttachment,
  listAttachments,
  downloadAttachment,
  deleteAttachment,
};

// Export all controller methods (bulk methods moved to transactions.bulk.controller.ts)
export const transactionsController = {
  list,
  getSummary,
  getById,
  getGoalLinks,
  create,
  createTransfer,
  updateTransfer,
  update,
  remove,
  updateOwner,
  markReviewed,
  uploadAttachment,
  listAttachments,
  downloadAttachment,
  deleteAttachment,
};
