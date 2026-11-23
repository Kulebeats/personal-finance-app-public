/**
 * Tags Module - Service Layer
 *
 * Business logic for tags and transaction tagging.
 * Implements ARCH-001: Service layer separation from controller.
 *
 * @module modules/tags/tags.service
 */

import { tagRepository } from "../../repositories/TagRepository";
import { tagWriteRepository } from "../../repositories/TagWriteRepository";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { NotFoundError, ConflictError, ValidationError } from "../../core/errors";
import { logger } from "../../utils/logger";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { businessAuditService } from "../../services/BusinessAuditService";
import { tags, type Tag } from "@shared/schema";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { lockTagNames, normalizeTagName, rethrowTagNameClash, TAG_NAME_TAKEN } from "./tags.name-guard";

/** Refuse `name` if another tag in the household has it in any case (NEW-36). */
async function assertNameFree(householdId: string, name: string, tx: TransactionType, excludeTagId?: string) {
  if (await tagRepository.findByName(householdId, name, { excludeTagId, executor: tx })) {
    throw new ConflictError(TAG_NAME_TAKEN);
  }
}

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
  /** Who merged; the audit row is written inside the merge transaction (Rule 9). */
  audit: { userId: string; ipAddress?: string };
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
   * Create a new tag
   */
  async createTag(input: CreateTagInput) {
    // Validate color format if provided (CODE-006)
    if (input.color && !/^#[0-9A-Fa-f]{6}$/.test(input.color)) {
      throw new ValidationError("Invalid color format. Use hex format like #FF5733");
    }
    // The checked and stored name is trimmed and NFC-normalised (N5)
    const data = { ...input, name: normalizeTagName(input.name) };

    // Case-insensitive duplicate check and insert in one locked transaction (NEW-36)
    const tag = await withTransaction(async (tx) => {
      await lockTagNames(tx, data.householdId);
      await assertNameFree(data.householdId, data.name, tx);
      return tagRepository.create(data, tx);
    }).catch(rethrowTagNameClash);
    logger.info("Created tag", { householdId: data.householdId, tagId: tag.id });
    return tag;
  }

  /**
   * Update an existing tag
   */
  async updateTag(id: string, householdId: string, input: UpdateTagInput) {
    // A rename is checked and stored trimmed and NFC-normalised, like create (N5)
    const data = input.name === undefined ? input : { ...input, name: normalizeTagName(input.name) };

    // Verify tag exists
    const existingTag = await tagRepository.findById(id, householdId);
    if (!existingTag) {
      throw new NotFoundError("Tag not found");
    }

    // Validate color format if provided (CODE-006)
    if (data.color && !/^#[0-9A-Fa-f]{6}$/.test(data.color)) {
      throw new ValidationError("Invalid color format. Use hex format like #FF5733");
    }

    // A rename checks the name case-insensitively, ignoring this tag, under the same lock
    // as create; the update runs in that transaction (NEW-36).
    const updatedTag = await withTransaction(async (tx) => {
      const name = data.name;
      if (name !== undefined && name !== existingTag.name) {
        await lockTagNames(tx, householdId);
        await assertNameFree(householdId, name, tx, id);
      }
      return tagRepository.update(id, householdId, data, tx);
    }).catch(rethrowTagNameClash);
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

  /** Actor and audit share the locked writer transaction. */
  addTransactionTags(transactionId: string, tagIds: string[], actor: HouseholdContext, ipAddress?: string) {
    return tagWriteRepository.write(actor, { operation: "add", transactionId, tagIds }, ipAddress);
  }

  removeTransactionTag(transactionId: string, tagId: string, actor: HouseholdContext, ipAddress?: string) {
    return tagWriteRepository.write(actor, { operation: "remove", transactionId, tagIds: [tagId] }, ipAddress);
  }

  setTransactionTags(transactionId: string, tagIds: string[], actor: HouseholdContext, ipAddress?: string) {
    return tagWriteRepository.write(actor, { operation: "set", transactionId, tagIds }, ipAddress);
  }

  /**
   * Merge multiple tags into a single tag (FUNC-001)
   * Moves all transaction associations from source tags to target tag
   */
  async mergeTags(input: MergeTagsInput) {
    const { sourceTagIds, targetTagId, householdId, audit } = input;

    // Validate input
    if (sourceTagIds.length === 0) {
      throw new ValidationError("At least one source tag is required");
    }

    // Filter out targetTagId from sourceTagIds if present (user may have selected it)
    const filteredSourceIds = Array.from(new Set(sourceTagIds.filter(id => id !== targetTagId)));
    if (filteredSourceIds.length === 0) {
      throw new ValidationError("No source tags to merge - select tags other than the target");
    }

    // Perform merge in transaction
    const mergedTagNames = await withTransaction(async (tx) => {
      // NEW-19: lock the target and every source (household-scoped, id order)
      // before checking them, so a concurrent merge, rename or delete of the
      // same tags waits instead of racing this one.
      const locked = await tx.select().from(tags)
        .where(and(eq(tags.householdId, householdId), inArray(tags.id, [targetTagId, ...filteredSourceIds])))
        .orderBy(asc(tags.id))
        .for("update");
      const lockedById = new Map(locked.map((tag) => [tag.id, tag]));
      if (!lockedById.has(targetTagId)) {
        throw new NotFoundError("Target tag not found");
      }
      const sourceTags: Tag[] = filteredSourceIds.map((sourceTagId) => {
        const tag = lockedById.get(sourceTagId);
        if (!tag) throw new NotFoundError(`Source tag not found: ${sourceTagId}`);
        return tag;
      });

      // For each source tag, move its transaction associations to target
      for (const sourceTagId of filteredSourceIds) {
        // Update transaction_tags: replace source tag with target tag
        // Use raw SQL to handle conflicts (some transactions may already have target tag)
        await tx.execute(sql`
          INSERT INTO transaction_tags (transaction_id, tag_id)
          SELECT DISTINCT transaction_id, ${targetTagId}::uuid
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

      // Rule 9: the audit row commits or rolls back with the merge.
      const names = sourceTags.map((tag) => tag.name);
      await businessAuditService.log({
        tx,
        householdId,
        userId: audit.userId,
        action: "UPDATE",
        entityType: "tag",
        entityId: targetTagId,
        details: { operation: "merge_tags", sourceTagIds: filteredSourceIds, mergedTagNames: names },
        ipAddress: audit.ipAddress,
      });
      return names;
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
      mergedTagNames,
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
   * Create default tags for a household (P3)
   * Skips a name the household already has in any case, archived or not, checked under the
   * tag-name lock like create (NEW-36, NEW-39)
   */
  async createDefaultTags(
    householdId: string
  ): Promise<{ created: number; skipped: number; tags: Tag[] }> {
    const createdTags = await withTransaction(async (tx) => {
      await lockTagNames(tx, householdId);
      const written: Tag[] = [];
      for (const defaultTag of DEFAULT_TAGS) {
        if (await tagRepository.findByName(householdId, defaultTag.name, { executor: tx })) continue;
        written.push(await tagRepository.create({ householdId, name: defaultTag.name, color: defaultTag.color }, tx));
      }
      return written;
    });
    const created = createdTags.length;
    const skipped = DEFAULT_TAGS.length - created;

    logger.info("Created default tags", {
      householdId,
      created,
      skipped,
    });

    return { created, skipped, tags: createdTags };
  }
}

export const tagService = new TagService();
