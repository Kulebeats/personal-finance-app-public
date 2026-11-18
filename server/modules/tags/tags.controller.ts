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
import { createTagSchema, updateTagSchema } from "./tags.validation";
import { tagService } from "./tags.service";

// Schema for adding tags to transaction (not in validation file since it's transaction-specific)
import { z } from "zod";
const addTagsSchema = z.object({
  tagIds: z.array(z.string().uuid()),
});

const setTagsSchema = z.object({
  tagIds: z.array(z.string().uuid()),
});

const getTagTransactionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// P3: Backend tag search filtering
const listTagsQuerySchema = z.object({
  search: z.string().max(100).optional(),
  limit: z.coerce.number().min(1).max(500).optional(),
});

export const tagsController = {
  // =========================================================================
  // Tag CRUD
  // =========================================================================

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;

      // P3: Backend tag search filtering
      const parseResult = listTagsQuerySchema.safeParse(req.query);
      const options = parseResult.success ? parseResult.data : {};

      const tags = await tagService.listTags(householdId, options);
      success(res, tags);
    } catch (error) {
      next(error);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;
      const tag = await tagService.getTagById(id, householdId);
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

      created(res, tag);
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
        newValue: parseResult.data,
        ipAddress: businessAuditService.getIpAddress(req),
      });

      success(res, newValue);
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
      const { householdId, userId } = req.householdContext!;
      const { transactionId } = req.params;

      const tags = await tagService.getTransactionTags(
        transactionId,
        householdId,
        userId
      );
      success(res, tags);
    } catch (error) {
      next(error);
    }
  },

  async addTransactionTags(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
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

      const tags = await tagService.addTransactionTags(
        transactionId,
        parseResult.data.tagIds,
        householdId,
        userId
      );

      // Audit logging
      await businessAuditService.log({
        householdId,
        userId,
        action: "LINK",
        entityType: "transaction",
        entityId: transactionId,
        details: { tagIds: parseResult.data.tagIds, operation: "add_tags" },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      success(res, tags);
    } catch (error) {
      next(error);
    }
  },

  async removeTransactionTag(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const { transactionId, tagId } = req.params;

      const tags = await tagService.removeTransactionTag(
        transactionId,
        tagId,
        householdId,
        userId
      );

      // Audit logging
      await businessAuditService.log({
        householdId,
        userId,
        action: "UNLINK",
        entityType: "transaction",
        entityId: transactionId,
        details: { tagId, operation: "remove_tag" },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      success(res, tags);
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
      const { householdId, userId } = req.householdContext!;
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

      const updatedTags = await tagService.setTransactionTags(
        transactionId,
        parseResult.data.tagIds,
        householdId,
        userId
      );

      // Audit logging
      await businessAuditService.log({
        householdId,
        userId,
        action: "UPDATE",
        entityType: "transaction",
        entityId: transactionId,
        details: { tagIds: parseResult.data.tagIds, operation: "set_tags" },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      success(res, updatedTags);
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
      const { householdId, userId } = req.householdContext!;
      const { id } = req.params;

      const parseResult = getTagTransactionsQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid query parameters",
          parseResult.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          }))
        );
      }

      const result = await tagService.getTagTransactions(
        id,
        householdId,
        userId,
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
      const { sourceTagIds, targetTagId } = req.body;

      if (!sourceTagIds || !Array.isArray(sourceTagIds)) {
        throw new ValidationError("sourceTagIds must be an array");
      }
      if (!targetTagId) {
        throw new ValidationError("targetTagId is required");
      }

      const result = await tagService.mergeTags({
        sourceTagIds,
        targetTagId,
        householdId,
      });

      // Audit logging
      await businessAuditService.log({
        householdId,
        userId,
        action: "UPDATE",
        entityType: "tag",
        entityId: targetTagId,
        details: {
          operation: "merge_tags",
          sourceTagIds,
          mergedTagNames: result.mergedTagNames,
        },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      logger.info("Merged tags", {
        householdId,
        sourceTagIds,
        targetTagId,
      });

      success(res, result);
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

      success(res, { message: "Tag archived successfully", tag: result });
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
      const { householdId } = req.householdContext!;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;

      const analytics = await tagService.getTagAnalytics(householdId, limit);
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
      const { householdId } = req.householdContext!;
      const { transactionName, merchantName, limit } = req.query;

      const suggestions = await tagService.suggestTags(householdId, {
        transactionName: transactionName as string | undefined,
        merchantName: merchantName as string | undefined,
        limit: limit ? parseInt(limit as string) : 5,
      });

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

      success(res, result);
    } catch (error) {
      next(error);
    }
  },
};
