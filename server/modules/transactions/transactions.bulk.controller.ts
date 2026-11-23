/**
 * Bulk Operations Controller
 *
 * Handles bulk transaction operations (≤100 items per request).
 * Follows CLAUDE.md bulk operation patterns.
 *
 * @module modules/transactions/transactions.bulk.controller
 */

import { Request, Response } from "express";
import { transactionService as legacyTransactionService } from "../../services/TransactionService";
import { ValidationError, NotFoundError } from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import { mapVisibleTransactionMoney } from "./transactions.helpers";
import { categoryRepository } from "../../repositories/CategoryRepository";
import { bulkSetTransactionOwnerSchema } from "./transactions.validation";

export const transactionService = legacyTransactionService;

/**
 * Bulk update transaction ownership
 * PUT /api/transactions/bulk-owner
 *
 * PERF: Parallel audit logging (fixes N+1 pattern)
 */
export async function bulkUpdateOwner(
  req: Request,
  res: Response,
): Promise<void> {
  const { householdId, userId } = req.householdContext!;

  // SCP-331: Validate body + enforce batch-size cap (max 100 ids) BEFORE
  // processing. Without this the endpoint 500s on malformed input and does
  // unbounded-parallel work (DOS risk).
  const parseResult = bulkSetTransactionOwnerSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError(
      "Invalid bulk owner update data",
      parseResult.error.errors,
    );
  }
  const { transactionIds, ownerUserId } = parseResult.data;

  // Rule 9 (P8b): each per-transaction update writes its own UPDATE audit row
  // atomically at the service layer (transactionService.updateTransaction, via
  // bulkUpdateOwner). Do not batch-audit again here, or every successful
  // update would double-audit.
  const ipAddress = businessAuditService.getIpAddress(req);
  const transactions = await transactionService.bulkUpdateOwner(
    transactionIds,
    ownerUserId,
    householdId,
    userId,
    { ipAddress },
  );

  const responseTransactions = await Promise.all(transactions.map(row => mapVisibleTransactionMoney(row.id, req.householdContext!)));

  res.json({
    success: true,
    data: responseTransactions,
    message: `${responseTransactions.length} transactions updated successfully`,
  });
}

/**
 * Bulk update transaction category
 * PUT /api/transactions/bulk-category
 *
 * PERF: Uses Promise.allSettled for parallel execution (fixes N+1 pattern)
 */
export async function bulkUpdateCategory(
  req: Request,
  res: Response,
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { transactionIds, categoryId } = req.body;

  if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
    throw new ValidationError("transactionIds must be a non-empty array");
  }
  if (transactionIds.length > 100) {
    throw new ValidationError(
      "Cannot update more than 100 transactions at once",
    );
  }

  // FIX DATA-TRANS-CAT-001: Validate categoryId belongs to household
  if (categoryId !== null && categoryId !== undefined) {
    const category = await categoryRepository.findByIdAndHousehold(
      categoryId,
      householdId
    );
    if (!category) {
      throw new NotFoundError("Category not found");
    }
  }

  const ipAddress = businessAuditService.getIpAddress(req);

  // Rule 9 (P8b): each per-transaction update writes its own UPDATE audit row
  // atomically at the service layer (transactionService.updateTransaction).
  // Do not batch-audit again here, or every successful update would
  // double-audit.
  // PERF: Parallel execution with Promise.allSettled (fixes N+1)
  const updateResults = await Promise.allSettled(
    transactionIds.map((id: string) =>
      transactionService.updateTransaction(
        id,
        { categoryId },
        householdId,
        userId,
        undefined,
        {
          ipAddress,
          metadata: {
            operation: "bulkUpdateCategory",
            batchSize: transactionIds.length,
          },
        },
      )
    )
  );

  // Build results and collect successful IDs
  const results: Array<{ id: string; success: boolean }> = [];
  const successfulIds: string[] = [];

  updateResults.forEach((result, index) => {
    const id = transactionIds[index];
    if (result.status === "fulfilled") {
      results.push({ id, success: true });
      successfulIds.push(id);
    } else {
      results.push({ id, success: false });
    }
  });

  const successCount = results.filter((r) => r.success).length;
  res.json({
    success: true,
    data: { results, successCount, totalCount: transactionIds.length },
    message: `${successCount} of ${transactionIds.length} transactions updated`,
  });
}

/**
 * Bulk add tags to transactions
 * PUT /api/transactions/bulk-tags
 *
 * PERF: Uses Promise.allSettled for parallel execution (fixes N+1 pattern)
 */
export async function bulkAddTags(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { transactionIds, tagIds } = req.body;

  if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
    throw new ValidationError("transactionIds must be a non-empty array");
  }
  if (!Array.isArray(tagIds) || tagIds.length === 0) {
    throw new ValidationError("tagIds must be a non-empty array");
  }
  if (transactionIds.length > 100) {
    throw new ValidationError(
      "Cannot update more than 100 transactions at once",
    );
  }

  const ipAddress = businessAuditService.getIpAddress(req);

  // PERF: Parallel execution with Promise.allSettled (fixes N+1)
  const tagResults = await Promise.allSettled(
    transactionIds.map((id: string) =>
      transactionService.addTagsToTransaction(id, tagIds, householdId, userId, ipAddress)
    )
  );

  // The atomic writer owns the sole audit, including the actual link delta.
  const results: Array<{ id: string; success: boolean }> = [];

  tagResults.forEach((result, index) => {
    const id = transactionIds[index];
    if (result.status === "fulfilled") {
      results.push({ id, success: true });
    } else {
      results.push({ id, success: false });
    }
  });

  const successCount = results.filter((r) => r.success).length;
  res.json({
    success: true,
    data: { results, successCount, totalCount: transactionIds.length },
    message: `${successCount} of ${transactionIds.length} transactions tagged`,
  });
}

/**
 * Bulk mark transactions as reviewed
 * PUT /api/transactions/bulk-review
 *
 * PERF: Uses Promise.allSettled for parallel execution (fixes N+1 pattern)
 */
export async function bulkReview(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { transactionIds, reviewed = true } = req.body;

  if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
    throw new ValidationError("transactionIds must be a non-empty array");
  }
  if (transactionIds.length > 100) {
    throw new ValidationError(
      "Cannot update more than 100 transactions at once",
    );
  }

  const ipAddress = businessAuditService.getIpAddress(req);
  const bulkAuditContext = {
    ipAddress,
    metadata: { operation: "bulkReview", batchSize: transactionIds.length },
  };

  // Rule 9 (P8b): each per-transaction update writes its own UPDATE audit row
  // atomically at the service layer (transactionService.updateTransaction, via
  // markReviewed/markUnreviewed). Do not batch-audit again here, or every
  // successful update would double-audit.
  // PERF: Parallel execution with Promise.allSettled (fixes N+1)
  const reviewResults = await Promise.allSettled(
    transactionIds.map((id: string) =>
      reviewed
        ? transactionService.markReviewed(id, householdId, userId, bulkAuditContext)
        : transactionService.markUnreviewed(id, householdId, userId, bulkAuditContext)
    )
  );

  // Build results and collect successful IDs
  const results: Array<{ id: string; success: boolean }> = [];
  const successfulIds: string[] = [];

  reviewResults.forEach((result, index) => {
    const id = transactionIds[index];
    if (result.status === "fulfilled") {
      results.push({ id, success: true });
      successfulIds.push(id);
    } else {
      results.push({ id, success: false });
    }
  });

  const successCount = results.filter((r) => r.success).length;
  res.json({
    success: true,
    data: { results, successCount, totalCount: transactionIds.length },
    message: `${successCount} of ${transactionIds.length} transactions marked as ${reviewed ? "reviewed" : "unreviewed"}`,
  });
}

/**
 * Bulk delete transactions
 * DELETE /api/transactions/bulk
 *
 * PERF: Uses Promise.allSettled for parallel execution (fixes N+1 pattern)
 */
export async function bulkDelete(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { transactionIds } = req.body;

  if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
    throw new ValidationError("transactionIds must be a non-empty array");
  }
  if (transactionIds.length > 100) {
    throw new ValidationError(
      "Cannot delete more than 100 transactions at once",
    );
  }

  const ipAddress = businessAuditService.getIpAddress(req);

  // Rule 9: each DELETE audit row is now written atomically at the
  // repository layer inside transactionService.deleteTransaction (same path
  // the single-delete controller uses), so no separate batch audit call is
  // needed here — that would double-audit every successful delete.
  // PERF: Parallel execution with Promise.allSettled (fixes N+1)
  const deleteResults = await Promise.allSettled(
    transactionIds.map((id: string) =>
      transactionService.deleteTransaction(id, householdId, userId, {
        ipAddress,
        metadata: { operation: "bulkDelete", batchSize: transactionIds.length },
      })
    )
  );

  // Build results and collect successful IDs
  const results: Array<{ id: string; success: boolean }> = [];
  const successfulIds: string[] = [];

  deleteResults.forEach((result, index) => {
    const id = transactionIds[index];
    if (result.status === "fulfilled") {
      results.push({ id, success: true });
      successfulIds.push(id);
    } else {
      results.push({ id, success: false });
    }
  });

  const successCount = results.filter((r) => r.success).length;
  res.json({
    success: true,
    data: { results, successCount, totalCount: transactionIds.length },
    message: `${successCount} of ${transactionIds.length} transactions deleted`,
  });
}

// Export all bulk controller methods
export const transactionsBulkController = {
  bulkUpdateOwner,
  bulkUpdateCategory,
  bulkAddTags,
  bulkReview,
  bulkDelete,
};
