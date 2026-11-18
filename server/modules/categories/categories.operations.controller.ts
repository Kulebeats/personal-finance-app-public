/**
 * Categories Operations Controller
 *
 * HTTP handlers for category seed and reorder operations.
 * Split from main controller to maintain <500 LOC limit.
 *
 * @module modules/categories/categories.operations.controller
 */

import { Request, Response, NextFunction } from "express";
import { categoryGroupRepository } from "../../repositories/CategoryGroupRepository";
import { categoryRepository } from "../../repositories/CategoryRepository";
import { logger } from "../../utils/logger";
import { z } from "zod";
import { success, created, noContent } from "../../core/http";
import { ValidationError, ConflictError } from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import { seedDefaultCategories } from "../../seed";

// Reorder schemas
const reorderCategoriesSchema = z.object({
  categoryIds: z.array(z.string().uuid()).min(1),
});

const reorderGroupsSchema = z.object({
  groupIds: z.array(z.string().uuid()).min(1),
});

export const categoriesOperationsController = {
  /**
   * Seed default categories for a new household
   * POST /api/categories/seed
   */
  async seedDefaults(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const userId = req.user!.id;

      // Check if categories already exist
      const existingCategories =
        await categoryRepository.findByHousehold(householdId);
      if (existingCategories.length > 0) {
        throw new ConflictError("Categories already exist for this household");
      }

      // Use the existing seed function
      await seedDefaultCategories(householdId);

      // Fetch the created categories
      const [createdCategories, createdGroups] = await Promise.all([
        categoryRepository.findByHousehold(householdId),
        categoryGroupRepository.findByHousehold(householdId),
      ]);

      // Audit logging
      await businessAuditService.log({
        householdId,
        userId,
        action: "CREATE",
        entityType: "category",
        entityId: "seed",
        details: {
          action: "seed_defaults",
          categoryCount: createdCategories.length,
          groupCount: createdGroups.length,
        },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      logger.info("Seeded default categories", {
        householdId,
        categoryCount: createdCategories.length,
        groupCount: createdGroups.length,
      });

      return created(res, {
        categories: createdCategories,
        groups: createdGroups,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Reorder categories
   * PUT /api/categories/reorder
   */
  async reorderCategories(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const userId = req.user!.id;

      const parseResult = reorderCategoriesSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      const { categoryIds } = parseResult.data;

      // Use the repository's reorder method
      await categoryRepository.reorder(householdId, categoryIds);

      // Audit logging
      await businessAuditService.log({
        householdId,
        userId,
        action: "UPDATE",
        entityType: "category",
        entityId: "reorder",
        details: { action: "reorder_categories", categoryIds },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return noContent(res);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Reorder category groups
   * PUT /api/categories/groups/reorder
   */
  async reorderGroups(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const userId = req.user!.id;

      const parseResult = reorderGroupsSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      const { groupIds } = parseResult.data;

      // SCP-335: atomic, household-scoped reorder. The repository wraps every
      // ownership re-check and displayOrder write in one transaction so a
      // mid-loop failure cannot leave a partially reordered set, and a caller
      // cannot reorder another household's groups.
      await categoryGroupRepository.reorder(householdId, groupIds);

      // Audit logging
      await businessAuditService.log({
        householdId,
        userId,
        action: "UPDATE",
        entityType: "category_group",
        entityId: "reorder",
        details: { action: "reorder_groups", groupIds },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return noContent(res);
    } catch (error) {
      next(error);
    }
  },
};
