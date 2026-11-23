/**
 * Transaction Tag Operations
 *
 * Tag validation and association logic for transactions.
 * Split from transaction/service.ts to maintain LOC limits.
 *
 * @module services/transaction/tags
 */

import { db } from "../../db";
import type { TransactionType } from "../../utils/withTransaction";
import { tags } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { ValidationError } from "../../utils/errorHandler";
import { can } from "../../core/authz/capabilities";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { tagWriteRepository } from "../../repositories/TagWriteRepository";
import { ForbiddenError } from "../../core/errors";

/**
 * R-10: Validate that all tag IDs belong to the specified household
 */
export async function validateTagIds(
  tagIds: string[],
  householdId: string,
  executor: typeof db | TransactionType = db
): Promise<void> {
  if (!tagIds || tagIds.length === 0) return;

  const validTags = await executor
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.householdId, householdId), inArray(tags.id, tagIds)));

  const validTagIds = new Set(validTags.map((t) => t.id));
  const invalidTagIds = tagIds.filter((id) => !validTagIds.has(id));

  if (invalidTagIds.length > 0) {
    throw new ValidationError(
      `Invalid tag IDs: ${invalidTagIds.join(", ")} do not belong to this household`
    );
  }
}

/**
 * Add tags to a transaction
 * Creates entries in the transaction_tags junction table
 */
export async function addTagsToTransaction(
  transactionId: string,
  tagIds: string[],
  householdId: string,
  userId: string,
  ipAddress?: string
): Promise<void> {
  const membership = await householdRepository.findMember(householdId, userId);
  if (!membership || !can(membership.role, "financial.write")) throw new ForbiddenError("Financial write access required");
  // The shared writer rechecks membership and visibility under locks, and commits
  // links, exact counter deltas and audit together. Never bypass its conflict path.
  await tagWriteRepository.write({ householdId, userId, role: membership.role },
    { operation: "add", transactionId, tagIds }, ipAddress);
}
