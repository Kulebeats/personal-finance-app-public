/**
 * Transaction Review Operations
 *
 * Methods for marking transactions as reviewed/unreviewed.
 *
 * @module services/transaction/review
 */

import { type Transaction } from "@shared/schema";

// Type for the update function to avoid circular dependency
type UpdateTransactionFn = (
  id: string,
  data: Partial<Transaction>,
  householdId: string,
  userId: string,
  expectedUpdatedAt?: Date,
  auditContext?: { ipAddress?: string; metadata?: Record<string, unknown> }
) => Promise<Transaction>;

/**
 * Mark a transaction as reviewed
 *
 * P8b: audits via updateTransaction's own UPDATE audit row (Rule 9) — do not
 * audit again in the controller, or a single request would double-audit.
 * `auditContext.metadata` lets bulk callers override the default operation
 * label/add a batchSize without losing that context.
 */
export async function markReviewed(
  updateTransaction: UpdateTransactionFn,
  id: string,
  householdId: string,
  userId: string,
  auditContext?: { ipAddress?: string; metadata?: Record<string, unknown> }
): Promise<Transaction> {
  return await updateTransaction(
    id,
    {
      reviewedAt: new Date(),
      reviewedBy: userId,
    },
    householdId,
    userId,
    undefined,
    {
      ipAddress: auditContext?.ipAddress,
      metadata: { operation: "markReviewed", ...auditContext?.metadata },
    }
  );
}

/**
 * Mark a transaction as unreviewed
 */
export async function markUnreviewed(
  updateTransaction: UpdateTransactionFn,
  id: string,
  householdId: string,
  userId: string,
  auditContext?: { ipAddress?: string; metadata?: Record<string, unknown> }
): Promise<Transaction> {
  return await updateTransaction(
    id,
    {
      reviewedAt: null,
      reviewedBy: null,
    },
    householdId,
    userId,
    undefined,
    {
      ipAddress: auditContext?.ipAddress,
      metadata: { operation: "markUnreviewed", ...auditContext?.metadata },
    }
  );
}
