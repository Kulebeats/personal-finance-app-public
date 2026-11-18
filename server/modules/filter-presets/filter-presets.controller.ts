/**
 * Filter Presets Module - Controller
 *
 * HTTP request handlers for filter preset endpoints.
 *
 * @module modules/filter-presets/filter-presets.controller
 */

import { Request, Response, NextFunction } from "express";
import { filterPresetsService } from "./filter-presets.service";
import {
  CreateFilterPresetSchema,
  UpdateFilterPresetSchema,
  ListFilterPresetsQuerySchema,
} from "./filter-presets.validation";
import { success, created, noContent } from "../../core/http/responses";
import { businessAuditService } from "../../services/BusinessAuditService";
import type { FilterPreset } from "@shared/schema";

function getFilterPresetAuditValue(preset: FilterPreset) {
  return {
    name: preset.name,
    context: preset.context,
    isDefault: preset.isDefault,
    isShared: preset.isShared,
    filterKeyCount:
      preset.filters && typeof preset.filters === "object"
        ? Object.keys(preset.filters).length
        : 0,
  };
}

export const filterPresetsController = {
  /**
   * GET /api/filter-presets
   * List all filter presets for the authenticated user
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;

      const query = ListFilterPresetsQuerySchema.parse(req.query);
      const presets = await filterPresetsService.listPresets(
        householdId,
        userId,
        query.context,
      );

      return success(res, presets);
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/filter-presets/:id
   * Get a specific filter preset by ID
   */
  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const { id } = req.params;

      const preset = await filterPresetsService.getPresetById(
        id,
        householdId,
        userId,
      );

      return success(res, preset);
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/filter-presets
   * Create a new filter preset
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;

      const data = CreateFilterPresetSchema.parse(req.body);
      const preset = await filterPresetsService.createPreset({
        householdId,
        userId,
        ...data,
      });

      await businessAuditService.logCreate({
        householdId,
        userId,
        entityType: "filter_preset",
        entityId: preset.id,
        newValue: getFilterPresetAuditValue(preset),
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return created(res, preset);
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/filter-presets/:id
   * Update an existing filter preset
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const { id } = req.params;

      const data = UpdateFilterPresetSchema.parse(req.body);
      const existing = await filterPresetsService.getPresetById(
        id,
        householdId,
        userId,
      );
      const preset = await filterPresetsService.updatePreset(
        id,
        householdId,
        userId,
        data,
      );

      await businessAuditService.logUpdate({
        householdId,
        userId,
        entityType: "filter_preset",
        entityId: preset.id,
        oldValue: getFilterPresetAuditValue(existing),
        newValue: getFilterPresetAuditValue(preset),
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return success(res, preset);
    } catch (error) {
      next(error);
    }
  },

  /**
   * DELETE /api/filter-presets/:id
   * Delete a filter preset
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const { id } = req.params;

      const existing = await filterPresetsService.getPresetById(
        id,
        householdId,
        userId,
      );
      await filterPresetsService.deletePreset(id, householdId, userId);

      await businessAuditService.logDelete({
        householdId,
        userId,
        entityType: "filter_preset",
        entityId: existing.id,
        oldValue: getFilterPresetAuditValue(existing),
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return noContent(res);
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/filter-presets/default/:context
   * Get the default preset for a specific context
   */
  async getDefault(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const { context } = req.params;

      const preset = await filterPresetsService.getDefaultPreset(
        householdId,
        userId,
        context,
      );

      return success(res, preset);
    } catch (error) {
      next(error);
    }
  },
};
