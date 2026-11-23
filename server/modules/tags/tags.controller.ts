/**
 * Tags Module - Controller
 *
 * HTTP handlers for tags and transaction tagging.
 * ARCH-001: Now uses service layer for business logic.
 *
 * @module modules/tags/controller
 */

import { Request, Response, NextFunction } from "express";
import { logger } from "../../utils/logger";
import { ValidationError } from "../../core/errors";
import { success, created, noContent } from "../../core/http/responses";
import { businessAuditService } from "../../services/BusinessAuditService";
import { createTagSchema, updateTagSchema, listTagsQuerySchema, tagTransactionsQuerySchema, analyticsQuerySchema, suggestQuerySchema, mergeTagsSchema } from "./tags.validation";
import { tagService } from "./tags.service";
import { tagReadService } from "./tags.read.service";
import { normalizeTagName } from "./tags.name-guard";

// Schema for adding tags to transaction (not in validation file since it's transaction-specific)
import { z } from "zod";
const addTagsSchema = z.object({
  tagIds: z.array(z.string().uuid()),
}).strict();

const setTagsSchema = z.object({
  tagIds: z.array(z.string().uuid()),
}).strict();

export const tagsController = {
  // =========================================================================
  // Tag CRUD
  // =========================================================================

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const parseResult = listTagsQuerySchema.safeParse(req.query);
      if (!parseResult.success) throw new ValidationError("Invalid query parameters", parseResult.error.errors);

      const tags = await tagReadService.listTags(req.householdContext!, parseResult.data);
      success(res, tags);
    } catch (error) {
      next(error);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const tag = await tagReadService.getTagById(id, req.householdContext!);
      success(res, tag);
    } catch (error) {
      next(error);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const parseResult = createTagSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid tag data",
          parseResult.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          }))
        );
      }

      const tag = await tagService.createTag({
        householdId,
        ...parseResult.data,
      });

      // Audit logging
      await businessAuditService.logCreate({
        householdId,
        userId,
        entityType: "tag",
        entityId: tag.id,
        newValue: { name: tag.name, color: tag.color },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      created(res, await tagReadService.projectMutationTag(req.householdContext!, tag));
    } catch (error) {
      next(error);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const { id } = req.params;
      const parseResult = updateTagSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid tag data",
          parseResult.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          }))
        );
      }

      const { oldValue, newValue } = await tagService.updateTag(
        id,
        householdId,
        parseResult.data
      );

      // Audit logging
      await businessAuditService.logUpdate({
        householdId,
        userId,
        entityType: "tag",
        entityId: id,
        oldValue: { name: oldValue.name, color: oldValue.color },
        // A rename records the name as stored: trimmed and NFC-normalised (N5)
        newValue: parseResult.data.name === undefined ? parseResult.data
          : { ...parseResult.data, name: normalizeTagName(parseResult.data.name) },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      success(res, await tagReadService.projectMutationTag(req.householdContext!, newValue));
    } catch (error) {
      next(error);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const { id } = req.params;

      const existingTag = await tagService.deleteTag(id, householdId);

      // Audit logging
      await businessAuditService.logDelete({
        householdId,
        userId,
        entityType: "tag",
        entityId: id,
        oldValue: { name: existingTag.name, color: existingTag.color },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      noContent(res);
    } catch (error) {
      next(error);
    }
  },

  // =========================================================================
  // Transaction Tags
  // =========================================================================

  async getTransactionTags(req: Request, res: Response, next: NextFunction) {
    try {
      const { transactionId } = req.params;

      const tags = await tagReadService.getTransactionTags(
        transactionId,
        req.householdContext!,
      );
      success(res, tags);
    } catch (error) {
      next(error);
    }
  },

  async addTransactionTags(req: Request, res: Response, next: NextFunction) {
    try {
      const { transactionId } = req.params;
      const parseResult = addTagsSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid tag data",
          parseResult.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          }))
        );
      }

      await tagService.addTransactionTags(
        transactionId,
        parseResult.data.tagIds,
        req.householdContext!,
        businessAuditService.getIpAddress(req)
      );

      success(res, await tagReadService.projectMutationTransactionTags(req.householdContext!, transactionId));
    } catch (error) {
      next(error);
    }
  },

  async removeTransactionTag(req: Request, res: Response, next: NextFunction) {
    try {
      const { transactionId, tagId } = req.params;

      await tagService.removeTransactionTag(
        transactionId,
        tagId,
        req.householdContext!,
        businessAuditService.getIpAddress(req)
      );

      success(res, await tagReadService.projectMutationTransactionTags(req.householdContext!, transactionId));
    } catch (error) {
      next(error);
    }
  },

  /**
   * Set all tags on a transaction (replace existing)
   * PUT /api/tags/transaction/:transactionId
   * API-002: Set all tags at once endpoint
   */
  async setTransactionTags(req: Request, res: Response, next: NextFunction) {
    try {
      const { transactionId } = req.params;

      const parseResult = setTagsSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid tag data",
          parseResult.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          }))
        );
      }

      await tagService.setTransactionTags(
        transactionId,
        parseResult.data.tagIds,
        req.householdContext!,
        businessAuditService.getIpAddress(req)
      );

      success(res, await tagReadService.projectMutationTransactionTags(req.householdContext!, transactionId));
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get all transactions with a specific tag
   * GET /api/tags/:id/transactions
   * API-001: Get transactions by tag endpoint
   */
  async getTagTransactions(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      const parseResult = tagTransactionsQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid query parameters",
          parseResult.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          }))
        );
      }

      const result = await tagReadService.getTagTransactions(
        id,
        req.householdContext!,
        parseResult.data.limit,
        parseResult.data.offset
      );

      success(res, result);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Merge multiple tags into one
   * POST /api/tags/merge
   * FUNC-001: Tag merge functionality
   */
  async mergeTags(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const parsed = mergeTagsSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message ?? "Invalid merge request", parsed.error.errors);
      }
      const { sourceTagIds, targetTagId } = parsed.data;

      // The audit row is written inside the merge transaction (Rule 9, NEW-19).
      const result = await tagService.mergeTags({
        sourceTagIds,
        targetTagId,
        householdId,
        audit: { userId, ipAddress: businessAuditService.getIpAddress(req) },
      });

      logger.info("Merged tags", {
        householdId,
        sourceTagIds,
        targetTagId,
      });

      success(res, { ...result, targetTag: await tagReadService.projectMutationTag(req.householdContext!, result.targetTag) });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Archive a tag
   * POST /api/tags/:id/archive
   * FUNC-002: Tag archive functionality
   */
  async archiveTag(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const { id } = req.params;

      const result = await tagService.archiveTag({
        tagId: id,
        householdId,
      });

      // Audit logging (result is guaranteed by service validation)
      if (result) {
        await businessAuditService.logDelete({
          householdId,
          userId,
          entityType: "tag",
          entityId: id,
          oldValue: { name: result.name, archived: true },
          ipAddress: businessAuditService.getIpAddress(req),
        });
      }

      success(res, { message: "Tag archived successfully", tag: await tagReadService.projectMutationTag(req.householdContext!, result) });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get tag analytics
   * GET /api/tags/analytics
   * CODE-005: Tag reports/analytics
   */
  async getAnalytics(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = analyticsQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new ValidationError("Invalid query parameters", parsed.error.errors);
      const analytics = await tagReadService.getTagAnalytics(req.householdContext!, parsed.data.limit);
      success(res, analytics);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Suggest tags for a transaction
   * GET /api/tags/suggest
   * P3: Tag suggestions feature
   */
  async suggestTags(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = suggestQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new ValidationError("Invalid query parameters", parsed.error.errors);
      const suggestions = await tagReadService.suggestTags(req.householdContext!, parsed.data);

      success(res, suggestions);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Create default tags for a household
   * POST /api/tags/defaults
   * P3: Default tags creation feature
   */
  async createDefaults(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;

      const result = await tagService.createDefaultTags(householdId);

      // Audit logging for created tags
      if (result.created > 0) {
        await businessAuditService.log({
          householdId,
          userId,
          action: "CREATE",
          entityType: "tag",
          entityId: "default-tags",
          details: {
            operation: "create_default_tags",
            created: result.created,
            skipped: result.skipped,
            tagNames: result.tags.map((t) => t.name),
          },
          ipAddress: businessAuditService.getIpAddress(req),
        });
      }

      logger.info("Created default tags", {
        householdId,
        created: result.created,
        skipped: result.skipped,
      });

      success(res, { ...result, tags: await tagReadService.projectMutationTags(req.householdContext!, result.tags) });
    } catch (error) {
      next(error);
    }
  },
};
