/**
 * Transaction Tag Operations
 *
 * Tag validation and association logic for transactions.
 * Split from transaction/service.ts to maintain LOC limits.
 *
 * @module services/transaction/tags
 */

import { db } from "../../db";
import { tags, transactionTags } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { ValidationError, NotFoundError } from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import { transactionRepository } from "../../repositories/TransactionRepository";

/**
 * R-10: Validate that all tag IDs belong to the specified household
 */
export async function validateTagIds(
  tagIds: string[],
  householdId: string
): Promise<void> {
  if (!tagIds || tagIds.length === 0) return;

  const validTags = await db
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
  userId: string
): Promise<void> {
  // Verify transaction exists and user has access
  const transaction = await transactionRepository.findByIdWithVisibility(
    transactionId,
    householdId,
    userId
  );

  if (!transaction) {
    throw new NotFoundError("Transaction not found");
  }

  // Validate tags belong to household
  await validateTagIds(tagIds, householdId);

  // Insert tag links (ignore duplicates)
  for (const tagId of tagIds) {
    await db
      .insert(transactionTags)
      .values({
        transactionId,
        tagId,
      })
      .onConflictDoNothing();
  }

  logger.info("Tags added to transaction", {
    householdId,
    transactionId,
    tagCount: tagIds.length,
  });
}
