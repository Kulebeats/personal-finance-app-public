/**
 * Transaction Owner Operations
 *
 * Methods for updating transaction ownership.
 *
 * @module services/transaction/owner
 */

import { type Transaction } from "@shared/schema";
import { withTransaction } from "../../utils/withTransaction";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { NotFoundError } from "../../core/errors";

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
 * Update transaction ownership
 * FIX AUTH-TRANS-OWNER-001: Validate household membership
 *
 * P8b: audits via updateTransaction's own UPDATE audit row (Rule 9) — do not
 * audit again here, or the controller path would double-audit.
 */
export async function updateOwner(
  updateTransaction: UpdateTransactionFn,
  id: string,
  ownerUserId: string | null,
  householdId: string,
  userId: string,
  auditContext?: { ipAddress?: string }
): Promise<Transaction> {
  // FIX AUTH-TRANS-OWNER-001: Validate ownerUserId is a member of the household
  if (ownerUserId !== null) {
    const member = await householdRepository.findMember(householdId, ownerUserId);
    if (!member) {
      throw new NotFoundError("User is not a member of this household");
    }
  }

  return await updateTransaction(id, { ownerUserId }, householdId, userId, undefined, {
    ipAddress: auditContext?.ipAddress,
    metadata: { operation: "updateOwner" },
  });
}

/**
 * Bulk update transaction ownership
 * FIX AUTH-TRANS-OWNER-001: Validate household membership
 *
 * P8b: each per-id call to updateTransaction writes its own UPDATE audit row
 * (Rule 9) — do not batch-audit again in the controller.
 */
export async function bulkUpdateOwner(
  updateTransaction: UpdateTransactionFn,
  ids: string[],
  ownerUserId: string | null,
  householdId: string,
  userId: string,
  auditContext?: { ipAddress?: string }
): Promise<Transaction[]> {
  // FIX AUTH-TRANS-OWNER-001: Validate ownerUserId is a member of the household
  if (ownerUserId !== null) {
    const member = await householdRepository.findMember(householdId, ownerUserId);
    if (!member) {
      throw new NotFoundError("User is not a member of this household");
    }
  }

  const results: Transaction[] = [];

  await withTransaction(async () => {
    for (const id of ids) {
      const txn = await updateTransaction(
        id,
        { ownerUserId },
        householdId,
        userId,
        undefined,
        {
          ipAddress: auditContext?.ipAddress,
          metadata: { operation: "bulkUpdateOwner", batchSize: ids.length },
        }
      );
      results.push(txn);
    }
  });

  return results;
}
