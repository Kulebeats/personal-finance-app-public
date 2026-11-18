/**
 * Categories Module - Controller
 *
 * HTTP handlers for categories.
 * Category groups are handled in categories.groups.controller.ts.
 *
 * @module modules/categories/controller
 */

import { Request, Response, NextFunction } from "express";
import { categoryGroupRepository } from "../../repositories/CategoryGroupRepository";
import { categoryRepository } from "../../repositories/CategoryRepository";
import { logger } from "../../utils/logger";
import { success, created } from "../../core/http";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import {
  createCategorySchema,
  updateCategorySchema,
  categoryQuerySchema,
  type CategoryQuery,
} from "./categories.validation";
// Re-export operations controller for routes
export { categoriesOperationsController } from "./categories.operations.controller";
// Re-export groups controller for routes
export { categoryGroupsController } from "./categories.groups.controller";

/**
 * Check for duplicate category name (case-insensitive)
 * Throws ConflictError if duplicate found
 */
async function checkDuplicateCategoryName(
  householdId: string,
  name: string,
  excludeId?: string
): Promise<void> {
  const existing = await categoryRepository.findByHousehold(householdId);
  const duplicate = existing.find(
    (c) =>
      c.name.toLowerCase() === name.toLowerCase() &&
      c.id !== excludeId &&
      !c.isArchived
  );
  if (duplicate) {
    throw new ConflictError(
      `Category "${name}" already exists in this household`
    );
  }
}

export const categoriesController = {
  /**
   * List all categories and groups for a household
   * GET /api/categories
   *
   * Supports query parameters:
   * - includeArchived: boolean - Include archived categories (default: false)
   * - groupType: string - Filter by group type (income|expense|transfers|other)
   */
  async listCategories(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;

      // Parse and validate query parameters
      const parseResult = categoryQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid query parameters",
          parseResult.error.errors,
        );
      }
      const { includeArchived, groupType } = parseResult.data;

      const [allCategories, allGroups] = await Promise.all([
        categoryRepository.findByHousehold(householdId),
        categoryGroupRepository.findByHousehold(householdId),
      ]);

      // Filter based on query parameters
      const categories = includeArchived
        ? allCategories
        : allCategories.filter((c) => !c.isArchived);

      let groups = includeArchived
        ? allGroups
        : allGroups.filter((g) => !g.isArchived);

      // Filter by group type if specified
      if (groupType) {
        groups = groups.filter((g) => g.type === groupType);
      }

      return success(res, { categories, groups });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get a single category by ID
   * GET /api/categories/:id
   */
  async getCategoryById(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;
      const category = await categoryRepository.findByIdAndHousehold(
        id,
        householdId,
      );
      if (!category) {
        throw new NotFoundError("Category not found");
      }
      return success(res, { category });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Create a new category
   * POST /api/categories
   */
  async createCategory(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const parseResult = createCategorySchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      // Check for duplicate name
      await checkDuplicateCategoryName(householdId, parseResult.data.name);

      // FIX DATA-CATS-001: Validate groupId belongs to household
      if (parseResult.data.groupId) {
        const group = await categoryGroupRepository.findByIdAndHousehold(
          parseResult.data.groupId,
          householdId
        );
        if (!group) {
          throw new NotFoundError("Category group not found");
        }
      }

      // Get max display order for new category
      const existing = await categoryRepository.findByHousehold(householdId);
      const maxOrder = Math.max(...existing.map((c) => c.displayOrder || 0), 0);

      const category = await categoryRepository.create({
        householdId,
        name: parseResult.data.name,
        groupId: parseResult.data.groupId,
        icon: parseResult.data.icon,
        color: parseResult.data.color,
        displayOrder: maxOrder + 1,
        // SCP-335: persist budget-config fields supplied by the client.
        includeInBudget: parseResult.data.includeInBudget,
        rolloverEnabled: parseResult.data.rolloverEnabled,
        rolloverStartBalance: parseResult.data.rolloverStartBalance,
      });

      // Audit logging
      await businessAuditService.logCreate({
        householdId,
        userId: req.user!.id,
        entityType: "category",
        entityId: category.id,
        newValue: { name: category.name, groupId: category.groupId },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      logger.info("Created category", { householdId, categoryId: category.id });
      return created(res, { category });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Update an existing category
   * PUT /api/categories/:id
   */
  async updateCategory(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;
      const parseResult = updateCategorySchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      // SEC-CRITICAL-003: Verify household ownership before updating
      const existingCategory = await categoryRepository.findByIdAndHousehold(
        id,
        householdId
      );
      if (!existingCategory) {
        throw new NotFoundError("Category not found");
      }

      // Check for duplicate name if name is being changed
      if (
        parseResult.data.name &&
        parseResult.data.name.toLowerCase() !== existingCategory.name.toLowerCase()
      ) {
        await checkDuplicateCategoryName(householdId, parseResult.data.name, id);
      }

      // FIX DATA-CATS-001: Validate groupId belongs to household if being changed
      if (parseResult.data.groupId !== undefined && parseResult.data.groupId !== null) {
        const group = await categoryGroupRepository.findByIdAndHousehold(
          parseResult.data.groupId,
          householdId
        );
        if (!group) {
          throw new NotFoundError("Category group not found");
        }
      }

      // SCP-335: map only real category columns (the validation schema also
      // carries sortOrder, which is not a column) and include the budget-config
      // fields so they are reachable via the API. Each field is only set when
      // the client actually supplied it.
      const { name, groupId, icon, color } = parseResult.data;
      const updates: Partial<typeof existingCategory> = {};
      if (name !== undefined) updates.name = name;
      if (groupId !== undefined) updates.groupId = groupId;
      if (icon !== undefined) updates.icon = icon;
      if (color !== undefined) updates.color = color;
      if (parseResult.data.includeInBudget !== undefined) {
        updates.includeInBudget = parseResult.data.includeInBudget;
      }
      if (parseResult.data.rolloverEnabled !== undefined) {
        updates.rolloverEnabled = parseResult.data.rolloverEnabled;
      }
      if (parseResult.data.rolloverStartBalance !== undefined) {
        updates.rolloverStartBalance = parseResult.data.rolloverStartBalance;
      }
      if (parseResult.data.isArchived !== undefined) {
        updates.isArchived = parseResult.data.isArchived;
      }

      const category = await categoryRepository.update(id, householdId, updates);

      // Audit logging
      await businessAuditService.logUpdate({
        householdId,
        userId: req.user!.id,
        entityType: "category",
        entityId: category!.id,
        oldValue: { name: existingCategory.name, groupId: existingCategory.groupId },
        newValue: parseResult.data,
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return success(res, { category });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Delete (archive) a category
   * DELETE /api/categories/:id
   */
  async deleteCategory(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;

      // SEC-CRITICAL-003: Verify household ownership before deleting
      const existingCategory = await categoryRepository.findByIdAndHousehold(
        id,
        householdId
      );
      if (!existingCategory) {
        throw new NotFoundError("Category not found");
      }

      const category = await categoryRepository.update(id, householdId, {
        isArchived: true,
      });

      // Audit logging
      await businessAuditService.logDelete({
        householdId,
        userId: req.user!.id,
        entityType: "category",
        entityId: category!.id,
        metadata: { name: category!.name },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return success(res, { category });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Archive a category (alternative to DELETE)
   * PATCH /api/categories/:id/archive
   */
  async archiveCategory(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;

      // Verify household ownership before archiving
      const existingCategory = await categoryRepository.findByIdAndHousehold(
        id,
        householdId
      );
      if (!existingCategory) {
        throw new NotFoundError("Category not found");
      }

      if (existingCategory.isArchived) {
        throw new ConflictError("Category is already archived");
      }

      const category = await categoryRepository.update(id, householdId, {
        isArchived: true,
      });

      // Audit logging
      await businessAuditService.log({
        householdId,
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "category",
        entityId: category!.id,
        details: { name: category!.name },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return success(res, { category });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Restore an archived category
   * PUT /api/categories/:id/restore
   */
  async restoreCategory(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;

      // SEC-CRITICAL-003: Verify household ownership before restoring
      const existingCategory = await categoryRepository.findByIdAndHousehold(
        id,
        householdId
      );
      if (!existingCategory) {
        throw new NotFoundError("Category not found");
      }

      const category = await categoryRepository.update(id, householdId, {
        isArchived: false,
      });

      // Audit logging
      await businessAuditService.log({
        householdId,
        userId: req.user!.id,
        action: "RESTORE",
        entityType: "category",
        entityId: category!.id,
        details: { name: category!.name },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return success(res, { category });
    } catch (error) {
      next(error);
    }
  },
};
