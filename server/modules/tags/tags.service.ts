/**
 * Tags Module - Service Layer
 *
 * Business logic for tags and transaction tagging.
 * Implements ARCH-001: Service layer separation from controller.
 *
 * @module modules/tags/tags.service
 */

import { tagRepository } from "../../repositories/TagRepository";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { NotFoundError, ConflictError, ValidationError } from "../../core/errors";
import { logger } from "../../utils/logger";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { tags, type Tag } from "@shared/schema";

export interface CreateTagInput {
  householdId: string;
  name: string;
  color?: string | null;
  icon?: string | null;
  memberSpecific?: boolean;
  memberId?: string | null;
}

export interface UpdateTagInput {
  name?: string;
  color?: string | null;
  icon?: string | null;
  memberSpecific?: boolean;
  memberId?: string | null;
}

export interface MergeTagsInput {
  sourceTagIds: string[];
  targetTagId: string;
  householdId: string;
}

export interface ArchiveTagInput {
  tagId: string;
  householdId: string;
}

/**
 * Default tags to create for new households (P3)
 */
const DEFAULT_TAGS = [
  { name: "Groceries", color: "#22C55E" }, // Green
  { name: "Dining Out", color: "#F97316" }, // Orange
  { name: "Transport", color: "#3B82F6" }, // Blue
  { name: "Shopping", color: "#EC4899" }, // Pink
  { name: "Utilities", color: "#06B6D4" }, // Cyan
  { name: "Entertainment", color: "#8B5CF6" }, // Purple
  { name: "Health", color: "#EF4444" }, // Red
  { name: "Travel", color: "#14B8A6" }, // Teal
  { name: "Subscriptions", color: "#6366F1" }, // Indigo
  { name: "Personal", color: "#A3A3A3" }, // Gray
] as const;

export class TagService {
  /**
   * Verify transaction access for security
   */
  async verifyTransactionAccess(
    transactionId: string,
    householdId: string,
    userId: string
  ) {
    const transaction = await transactionRepository.findByIdWithVisibility(
      transactionId,
      householdId,
      userId
    );
    if (!transaction) {
      throw new NotFoundError("Transaction not found");
    }
    return transaction;
  }

  /**
   * Get all tags for a household with optional search filtering
   * P3: Backend tag search filtering
   */
  async listTags(
    householdId: string,
    options?: { search?: string; limit?: number }
  ) {
    return await tagRepository.findByHousehold(householdId, options);
  }

  /**
   * Get a specific tag by ID
   */
  async getTagById(id: string, householdId: string) {
    const tag = await tagRepository.findById(id, householdId);
    if (!tag) {
      throw new NotFoundError("Tag not found");
    }
    return tag;
  }

  /**
   * Create a new tag
   */
  async createTag(data: CreateTagInput) {
    // Check for duplicate tag name
    const existingTag = await tagRepository.findByName(
      data.householdId,
      data.name
    );
    if (existingTag) {
      throw new ConflictError(
        "A tag with this name already exists in your household"
      );
    }

    // Validate color format if provided (CODE-006)
    if (data.color && !/^#[0-9A-Fa-f]{6}$/.test(data.color)) {
      throw new ValidationError("Invalid color format. Use hex format like #FF5733");
    }

    const tag = await tagRepository.create(data);
    logger.info("Created tag", { householdId: data.householdId, tagId: tag.id });
    return tag;
  }

  /**
   * Update an existing tag
   */
  async updateTag(id: string, householdId: string, data: UpdateTagInput) {
    // Verify tag exists
    const existingTag = await tagRepository.findById(id, householdId);
    if (!existingTag) {
      throw new NotFoundError("Tag not found");
    }

    // Check for duplicate name if name is being changed
    if (data.name && data.name !== existingTag.name) {
      const duplicateTag = await tagRepository.findByName(householdId, data.name);
      if (duplicateTag) {
        throw new ConflictError(
          "A tag with this name already exists in your household"
        );
      }
    }

    // Validate color format if provided (CODE-006)
    if (data.color && !/^#[0-9A-Fa-f]{6}$/.test(data.color)) {
      throw new ValidationError("Invalid color format. Use hex format like #FF5733");
    }

    const updatedTag = await tagRepository.update(id, householdId, data);
    return { oldValue: existingTag, newValue: updatedTag };
  }

  /**
   * Delete a tag
   */
  async deleteTag(id: string, householdId: string) {
    const existingTag = await tagRepository.findById(id, householdId);
    if (!existingTag) {
      throw new NotFoundError("Tag not found");
    }

    await tagRepository.delete(id, householdId);
    return existingTag;
  }

  /**
   * Get all tags on a transaction
   */
  async getTransactionTags(
    transactionId: string,
    householdId: string,
    userId: string
  ) {
    await this.verifyTransactionAccess(transactionId, householdId, userId);
    return await tagRepository.getTransactionTags(transactionId);
  }

  /**
   * Add tags to a transaction
   */
  async addTransactionTags(
    transactionId: string,
    tagIds: string[],
    householdId: string,
    userId: string
  ) {
    await this.verifyTransactionAccess(transactionId, householdId, userId);

    // Verify all tags belong to household (batch query for performance)
    if (tagIds.length > 0) {
      const foundTags = await tagRepository.findByIds(tagIds, householdId);
      const foundIds = new Set(foundTags.map((t) => t.id));
      const missingIds = tagIds.filter((id) => !foundIds.has(id));
      if (missingIds.length > 0) {
        throw new NotFoundError(`Tag(s) not found: ${missingIds.join(", ")}`);
      }
    }

    // Add tags and update usage counts (DATA-001).
    // SCP-335: only increment when the link was newly inserted — re-tagging an
    // already-tagged transaction must not inflate usageCount.
    for (const tagId of tagIds) {
      const { inserted } = await tagRepository.addTagToTransaction(
        transactionId,
        tagId
      );
      if (inserted) {
        await tagRepository.incrementUsageCount(tagId);
      }
    }

    return await tagRepository.getTransactionTags(transactionId);
  }

  /**
   * Remove a tag from a transaction
   */
  async removeTransactionTag(
    transactionId: string,
    tagId: string,
    householdId: string,
    userId: string
  ) {
    await this.verifyTransactionAccess(transactionId, householdId, userId);

    // Verify tag belongs to household
    const tag = await tagRepository.findById(tagId, householdId);
    if (!tag) {
      throw new NotFoundError("Tag not found");
    }

    await tagRepository.removeTagFromTransaction(transactionId, tagId);
    // Update usage count (DATA-001)
    await tagRepository.decrementUsageCount(tagId);

    return await tagRepository.getTransactionTags(transactionId);
  }

  /**
   * Set all tags on a transaction (replace existing)
   */
  async setTransactionTags(
    transactionId: string,
    tagIds: string[],
    householdId: string,
    userId: string
  ) {
    await this.verifyTransactionAccess(transactionId, householdId, userId);

    // Get current tags to update usage counts
    const currentTags = await tagRepository.getTransactionTags(transactionId);
    const currentTagIds = currentTags.map((t) => t.id);

    // Verify all new tags belong to household (batch query for performance)
    if (tagIds.length > 0) {
      const foundTags = await tagRepository.findByIds(tagIds, householdId);
      const foundIds = new Set(foundTags.map((t) => t.id));
      const missingIds = tagIds.filter((id) => !foundIds.has(id));
      if (missingIds.length > 0) {
        throw new NotFoundError(`Tag(s) not found: ${missingIds.join(", ")}`);
      }
    }

    // Set tags
    const updatedTags = await tagRepository.setTransactionTags(
      transactionId,
      tagIds
    );

    // Update usage counts (DATA-001)
    const addedTagIds = tagIds.filter((id) => !currentTagIds.includes(id));
    const removedTagIds = currentTagIds.filter((id) => !tagIds.includes(id));

    for (const tagId of addedTagIds) {
      await tagRepository.incrementUsageCount(tagId);
    }
    for (const tagId of removedTagIds) {
      await tagRepository.decrementUsageCount(tagId);
    }

    return updatedTags;
  }

  /**
   * Get all transactions with a specific tag
   */
  async getTagTransactions(
    tagId: string,
    householdId: string,
    userId: string,
    limit: number = 50,
    offset: number = 0
  ) {
    // Verify tag belongs to household
    const tag = await tagRepository.findById(tagId, householdId);
    if (!tag) {
      throw new NotFoundError("Tag not found");
    }

    const result = await tagRepository.findTransactionsByTag(
      tagId,
      householdId,
      userId,
      limit,
      offset
    );

    return { tag, transactions: result.transactions, count: result.count };
  }

  /**
   * Merge multiple tags into a single tag (FUNC-001)
   * Moves all transaction associations from source tags to target tag
   */
  async mergeTags(input: MergeTagsInput) {
    const { sourceTagIds, targetTagId, householdId } = input;

    // Validate input
    if (sourceTagIds.length === 0) {
      throw new ValidationError("At least one source tag is required");
    }

    // Filter out targetTagId from sourceTagIds if present (user may have selected it)
    const filteredSourceIds = sourceTagIds.filter(id => id !== targetTagId);
    if (filteredSourceIds.length === 0) {
      throw new ValidationError("No source tags to merge - select tags other than the target");
    }

    // Verify all tags exist and belong to household (batch query for performance)
    const allTagIds = [targetTagId, ...filteredSourceIds];
    const foundTags = await tagRepository.findByIds(allTagIds, householdId);
    const foundTagsMap = new Map(foundTags.map((t) => [t.id, t]));

    const targetTag = foundTagsMap.get(targetTagId);
    if (!targetTag) {
      throw new NotFoundError("Target tag not found");
    }

    const sourceTags: Tag[] = [];
    for (const sourceTagId of filteredSourceIds) {
      const tag = foundTagsMap.get(sourceTagId);
      if (!tag) {
        throw new NotFoundError(`Source tag not found: ${sourceTagId}`);
      }
      sourceTags.push(tag);
    }

    // Perform merge in transaction
    await db.transaction(async (tx) => {
      // For each source tag, move its transaction associations to target
      for (const sourceTagId of filteredSourceIds) {
        // Update transaction_tags: replace source tag with target tag
        // Use raw SQL to handle conflicts (some transactions may already have target tag)
        await tx.execute(sql`
          INSERT INTO transaction_tags (transaction_id, tag_id)
          SELECT DISTINCT transaction_id, ${targetTagId}
          FROM transaction_tags
          WHERE tag_id = ${sourceTagId}
          ON CONFLICT (transaction_id, tag_id) DO NOTHING
        `);

        // Delete old associations
        await tx.execute(sql`
          DELETE FROM transaction_tags
          WHERE tag_id = ${sourceTagId}
        `);

        // Delete the source tag
        await tx.execute(sql`
          DELETE FROM tags
          WHERE id = ${sourceTagId}
        `);
      }

      // Recalculate usage count for target tag
      const result = await tx.execute(sql`
        SELECT COUNT(*)::int as count
        FROM transaction_tags
        WHERE tag_id = ${targetTagId}
      `);
      const row = result.rows[0];
      const usageCount = row && typeof row === "object" && "count" in row
        ? Number(row.count) || 0
        : 0;

      await tx.execute(sql`
        UPDATE tags
        SET usage_count = ${usageCount}
        WHERE id = ${targetTagId}
      `);
    });

    logger.info("Merged tags", {
      householdId,
      sourceTagIds: filteredSourceIds,
      targetTagId,
      sourceTagCount: filteredSourceIds.length,
    });

    return {
      targetTag: await tagRepository.findById(targetTagId, householdId),
      mergedTagIds: filteredSourceIds,
      mergedTagNames: sourceTags.map((t) => t.name),
    };
  }

  /**
   * Archive a tag (FUNC-002)
   * Sets isArchived flag to true, preserving the tag and its history
   */
  async archiveTag(input: ArchiveTagInput) {
    const { tagId, householdId } = input;

    const tag = await tagRepository.findById(tagId, householdId);
    if (!tag) {
      throw new NotFoundError("Tag not found");
    }

    if (tag.isArchived) {
      throw new ConflictError("Tag is already archived");
    }

    // Set archived flag (preserves history)
    const archivedTag = await tagRepository.update(tagId, householdId, {
      isArchived: true,
    });

    logger.info("Archived tag", { householdId, tagId });
    return archivedTag;
  }

  /**
   * Get tag usage statistics for analytics (CODE-005)
   */
  async getTagAnalytics(householdId: string, limit: number = 20) {
    const allTags = await tagRepository.findByHousehold(householdId);

    // Sort by usage count
    const sortedTags = allTags
      .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
      .slice(0, limit);

    const totalTags = allTags.length;
    const totalUsage = allTags.reduce((sum, tag) => sum + (tag.usageCount || 0), 0);
    const averageUsage = totalTags > 0 ? totalUsage / totalTags : 0;

    return {
      topTags: sortedTags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        usageCount: tag.usageCount || 0,
        percentage: totalUsage > 0 ? ((tag.usageCount || 0) / totalUsage) * 100 : 0,
      })),
      summary: {
        totalTags,
        totalUsage,
        averageUsage: Number(averageUsage.toFixed(2)),
      },
    };
  }

  /**
   * Create default tags for a household (P3)
   * Skips tags that already exist with the same name
   */
  async createDefaultTags(
    householdId: string
  ): Promise<{ created: number; skipped: number; tags: Tag[] }> {
    const existingTags = await tagRepository.findByHousehold(householdId);
    const existingNames = new Set(
      existingTags.map((t) => t.name.toLowerCase())
    );

    let created = 0;
    let skipped = 0;
    const createdTags: Tag[] = [];

    for (const defaultTag of DEFAULT_TAGS) {
      if (existingNames.has(defaultTag.name.toLowerCase())) {
        skipped++;
        continue;
      }

      const tag = await tagRepository.create({
        householdId,
        name: defaultTag.name,
        color: defaultTag.color,
      });
      createdTags.push(tag);
      created++;
    }

    logger.info("Created default tags", {
      householdId,
      created,
      skipped,
    });

    return { created, skipped, tags: createdTags };
  }

  /**
   * Suggest tags based on transaction name or merchant (P3)
   * Uses pattern matching and frequency analysis
   */
  async suggestTags(
    householdId: string,
    options: {
      transactionName?: string;
      merchantName?: string;
      limit?: number;
    }
  ): Promise<
    Array<{
      id: string;
      name: string;
      color: string | null;
      confidence: number;
      reason: string;
    }>
  > {
    const { transactionName, merchantName, limit = 5 } = options;
    const suggestions: Array<{
      id: string;
      name: string;
      color: string | null;
      confidence: number;
      reason: string;
    }> = [];

    // Get all household tags
    const allTags = await tagRepository.findByHousehold(householdId);
    if (allTags.length === 0) {
      return [];
    }

    // Search terms to match against
    const searchTerms = [
      transactionName?.toLowerCase(),
      merchantName?.toLowerCase(),
    ].filter(Boolean) as string[];

    if (searchTerms.length === 0) {
      // No search terms - return most used tags
      const sortedTags = [...allTags].sort(
        (a, b) => (b.usageCount || 0) - (a.usageCount || 0)
      );
      return sortedTags.slice(0, limit).map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        confidence: 0.5,
        reason: "frequently_used",
      }));
    }

    // Score each tag based on name matching
    for (const tag of allTags) {
      const tagNameLower = tag.name.toLowerCase();
      let maxConfidence = 0;
      let reason = "no_match";

      for (const term of searchTerms) {
        // Exact match
        if (tagNameLower === term) {
          maxConfidence = Math.max(maxConfidence, 0.95);
          reason = "exact_match";
        }
        // Tag name contains search term
        else if (term.includes(tagNameLower)) {
          maxConfidence = Math.max(maxConfidence, 0.85);
          reason = "term_contains_tag";
        }
        // Search term contains tag name
        else if (tagNameLower.includes(term)) {
          maxConfidence = Math.max(maxConfidence, 0.75);
          reason = "tag_contains_term";
        }
        // Partial word match
        else {
          const tagWords = tagNameLower.split(/\s+/);
          const termWords = term.split(/\s+/);
          for (const tagWord of tagWords) {
            for (const termWord of termWords) {
              if (tagWord === termWord) {
                maxConfidence = Math.max(maxConfidence, 0.7);
                reason = "word_match";
              } else if (
                tagWord.includes(termWord) ||
                termWord.includes(tagWord)
              ) {
                maxConfidence = Math.max(maxConfidence, 0.5);
                reason = "partial_word_match";
              }
            }
          }
        }
      }

      // Boost confidence by usage (more used = more likely correct)
      const usageBoost = Math.min((tag.usageCount || 0) / 100, 0.1);
      maxConfidence = Math.min(maxConfidence + usageBoost, 0.99);

      if (maxConfidence > 0.3) {
        suggestions.push({
          id: tag.id,
          name: tag.name,
          color: tag.color,
          confidence: Number(maxConfidence.toFixed(2)),
          reason,
        });
      }
    }

    // Sort by confidence and return top N
    return suggestions
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }
}

export const tagService = new TagService();
