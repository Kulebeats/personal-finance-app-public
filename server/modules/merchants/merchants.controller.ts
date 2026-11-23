/**
 * Merchants Module - Controller
 *
 * HTTP handlers for merchant management.
 * Delegates to MerchantService for business logic.
 *
 * @module modules/merchants/controller
 */

import { Request, Response, NextFunction } from "express";
import { merchantService } from "./MerchantService";
import { logger } from "../../utils/logger";
import { success, created } from "../../core/http";
import { ValidationError } from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import { merchantLifecycleService } from "./merchants.lifecycle.service";
import { actorOf } from "./merchants.assets.controller";

// Schemas
import {
  createMerchantSchema,
  deleteMerchantQuerySchema,
  mergeBySourceSchema,
  undoMergeParamsSchema,
  updateMerchantSchema,
  mergeSchema,
} from "./merchants.validation";

export const merchantsController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { search, includeHidden } = req.query;

      const merchantList = await merchantService.list(req.householdContext!, {
        search: typeof search === "string" ? search : undefined,
        includeHidden: includeHidden === "true",
      });

      return success(res, { merchants: merchantList });
    } catch (error) {
      next(error);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      const details = await merchantService.getDetails(id, req.householdContext!);
      return success(res, details);
    } catch (error) {
      next(error);
    }
  },

  async duplicates(req: Request, res: Response, next: NextFunction) {
    try {
      const groups = await merchantService.findDuplicates(req.householdContext!);
      return success(res, { groups });
    } catch (error) {
      next(error);
    }
  },

  async autocomplete(req: Request, res: Response, next: NextFunction) {
    try {
      const query = typeof req.query.q === "string" ? req.query.q : "";
      const parsedLimit = Number(req.query.limit);
      const limit = Number.isFinite(parsedLimit)
        ? Math.min(Math.max(parsedLimit, 1), 50)
        : 25;

      if (!query.trim()) {
        return success(res, { merchants: [] });
      }

      const merchantList = await merchantService.autocomplete(
        req.householdContext!,
        query,
        limit,
      );
      return success(res, { merchants: merchantList });
    } catch (error) {
      next(error);
    }
  },

  async mergeHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const history = await merchantService.getMergeHistory(householdId);
      return success(res, { history });
    } catch (error) {
      next(error);
    }
  },

  async seedDefaults(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const result = await merchantService.seedDefaults(householdId);
      return success(res, result);
    } catch (error) {
      next(error);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const parseResult = createMerchantSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      const merchant = await merchantService.create(
        householdId,
        parseResult.data,
      );

      await businessAuditService.logCreate({
        householdId,
        userId: req.user!.id,
        entityType: "merchant",
        entityId: merchant.id,
        newValue: { name: merchant.name },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      logger.info("Created merchant", {
        householdId,
        merchantId: merchant.id,
      });
      return created(res, { merchant });
    } catch (error) {
      next(error);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;
      const parseResult = updateMerchantSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      const merchant = await merchantService.update(
        id,
        householdId,
        parseResult.data,
      );

      await businessAuditService.logUpdate({
        householdId,
        userId: req.user!.id,
        entityType: "merchant",
        entityId: merchant.id,
        newValue: parseResult.data,
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return success(res, { merchant });
    } catch (error) {
      next(error);
    }
  },

  /** Archive (the only delete the server performs; see merchants.lifecycle.service). */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const query = deleteMerchantQuerySchema.safeParse(req.query);
      if (!query.success) {
        throw new ValidationError(
          "Merchants can only be archived here: permanent delete is not available, and merge uses POST /merchants/:id/merge",
          query.error.errors,
        );
      }
      const result = await merchantLifecycleService.archive(req.params.id, actorOf(req), req.householdContext!);
      return success(res, result);
    } catch (error) {
      next(error);
    }
  },

  async merge(req: Request, res: Response, next: NextFunction) {
    try {
      const parseResult = mergeSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "sourceId and targetId are required",
          parseResult.error.errors,
        );
      }

      const { sourceId, targetId } = parseResult.data;
      const result = await merchantLifecycleService.merge(sourceId, targetId, actorOf(req), req.householdContext!);
      logger.info("Merged merchants", { householdId: req.householdContext!.householdId, sourceId, targetId });
      return success(res, result);
    } catch (error) {
      next(error);
    }
  },

  async mergeBySource(req: Request, res: Response, next: NextFunction) {
    try {
      const { sourceId } = req.params;
      const parseResult = mergeBySourceSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "targetMerchantId is required",
          parseResult.error.errors,
        );
      }

      const result = await merchantLifecycleService.merge(
        sourceId,
        parseResult.data.targetMerchantId,
        actorOf(req),
        req.householdContext!,
      );
      logger.info("Merged merchants", {
        householdId: req.householdContext!.householdId,
        sourceId,
        targetId: result.targetId,
      });
      return success(res, {
        merged: true,
        targetMerchantId: result.targetId,
        mergeHistoryId: result.mergeHistoryId,
      });
    } catch (error) {
      next(error);
    }
  },

  async undoMerge(req: Request, res: Response, next: NextFunction) {
    try {
      const parseResult = undoMergeParamsSchema.safeParse(req.params);
      if (!parseResult.success) {
        throw new ValidationError(
          "historyId is required",
          parseResult.error.errors,
        );
      }

      const result = await merchantLifecycleService.undoMerge(
        parseResult.data.historyId,
        actorOf(req),
        req.householdContext!,
      );
      logger.info("Undid merchant merge", {
        householdId: req.householdContext!.householdId,
        historyId: parseResult.data.historyId,
        restoredMerchantId: result.restoredMerchant.id,
        targetId: result.target.id,
        restoredTransactionCount: result.restoredTransactionCount,
        skippedTransactionCount: result.skippedTransactionCount,
      });
      return success(res, result);
    } catch (error) {
      next(error);
    }
  },
};
