/**
 * Categories Module - Groups Controller
 *
 * HTTP handlers for category groups.
 * Split from main controller to comply with 500 LOC limit (CLAUDE.md Rule 2).
 *
 * @module modules/categories/groups-controller
 */

import { Request, Response, NextFunction } from "express";
import { categoryGroupRepository } from "../../repositories/CategoryGroupRepository";
import { logger } from "../../utils/logger";
import { success, created } from "../../core/http";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import {
  createCategoryGroupSchema,
  updateCategoryGroupSchema,
} from "./categories.validation";

/**
 * Check for duplicate category group name (case-insensitive)
 * Throws ConflictError if duplicate found
 */
async function checkDuplicateGroupName(
  householdId: string,
  name: string,
  excludeId?: string
): Promise<void> {
  const existing = await categoryGroupRepository.findByHousehold(householdId);
  const duplicate = existing.find(
    (g) =>
      g.name.toLowerCase() === name.toLowerCase() &&
      g.id !== excludeId &&
      !g.isArchived
  );
  if (duplicate) {
    throw new ConflictError(
      `Category group "${name}" already exists in this household`
    );
  }
}

export const categoryGroupsController = {
  /**
   * List all category groups for a household
   * GET /api/categories/groups
   */
  async listGroups(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const groups = await categoryGroupRepository.findByHousehold(householdId);
      return success(res, { groups });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Create a new category group
   * POST /api/categories/groups
   */
  async createGroup(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const parseResult = createCategoryGroupSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      // Check for duplicate name
      await checkDuplicateGroupName(householdId, parseResult.data.name);

      const existingGroups =
        await categoryGroupRepository.findByHousehold(householdId);
      const maxOrder = Math.max(
        ...existingGroups.map((g) => g.displayOrder || 0),
        0,
      );

      const group = await categoryGroupRepository.create({
        householdId,
        ...parseResult.data,
        displayOrder: maxOrder + 1,
      });

      // Audit logging
      await businessAuditService.logCreate({
        householdId,
        userId: req.user!.id,
        entityType: "category_group",
        entityId: group.id,
        newValue: { name: group.name, type: group.type },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      logger.info("Created category group", { householdId, groupId: group.id });
      return created(res, { group });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Update an existing category group
   * PUT /api/categories/groups/:id
   */
  async updateGroup(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;
      const parseResult = updateCategoryGroupSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      // SEC-CRITICAL-003: Verify household ownership before updating
      const existingGroup = await categoryGroupRepository.findByIdAndHousehold(
        id,
        householdId
      );
      if (!existingGroup) {
        throw new NotFoundError("Category group not found");
      }

      // Check for duplicate name if name is being changed
      if (
        parseResult.data.name &&
        parseResult.data.name.toLowerCase() !== existingGroup.name.toLowerCase()
      ) {
        await checkDuplicateGroupName(householdId, parseResult.data.name, id);
      }

      const group = await categoryGroupRepository.update(id, parseResult.data);

      // Audit logging
      await businessAuditService.logUpdate({
        householdId,
        userId: req.user!.id,
        entityType: "category_group",
        entityId: group!.id,
        oldValue: { name: existingGroup.name, type: existingGroup.type },
        newValue: parseResult.data,
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return success(res, { group });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Delete (archive) a category group
   * DELETE /api/categories/groups/:id
   */
  async deleteGroup(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;

      // SEC-CRITICAL-003: Verify household ownership before deleting
      const existingGroup = await categoryGroupRepository.findByIdAndHousehold(
        id,
        householdId
      );
      if (!existingGroup) {
        throw new NotFoundError("Category group not found");
      }

      const group = await categoryGroupRepository.update(id, {
        isArchived: true,
      });

      // Audit logging
      await businessAuditService.logDelete({
        householdId,
        userId: req.user!.id,
        entityType: "category_group",
        entityId: group!.id,
        metadata: { name: group!.name },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return success(res, { group });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Restore an archived category group
   * PUT /api/categories/groups/:id/restore
   */
  async restoreGroup(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;

      // SEC-CRITICAL-003: Verify household ownership before restoring
      const existingGroup = await categoryGroupRepository.findByIdAndHousehold(
        id,
        householdId
      );
      if (!existingGroup) {
        throw new NotFoundError("Category group not found");
      }

      const group = await categoryGroupRepository.update(id, {
        isArchived: false,
      });

      // Audit logging
      await businessAuditService.log({
        householdId,
        userId: req.user!.id,
        action: "RESTORE",
        entityType: "category_group",
        entityId: group!.id,
        details: { name: group!.name },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return success(res, { group });
    } catch (error) {
      next(error);
    }
  },
};
