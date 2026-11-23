/**
 * Recurring Pattern Controller
 *
 * Handles pattern detection and confirmation logic.
 *
 * @module modules/recurring/recurring.pattern.controller
 */

import { Request, Response, NextFunction } from "express";
import { recurringService } from "../../services/RecurringService";
import { logger } from "../../utils/logger";
import { success } from "../../core/http";
import { ValidationError } from "../../core/errors";
import { toMoneyDto } from "../../core/money";
import { mapRecurringRuleMoney } from "./recurring.helpers";
import {
  detectPatternsSchema,
  confirmPatternSchema,
} from "./recurring.validation";
import { businessAuditService } from "../../services/BusinessAuditService";


export const recurringPatternController = {
  async detectPatterns(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = req.householdContext!;
      const { householdId } = actor;
      const parseResult = detectPatternsSchema.safeParse(req.body);
      if (!parseResult.success) throw new ValidationError("Invalid detection options", parseResult.error.errors);
      const options = parseResult.data;
      const patterns = await recurringService.detectAndSuggest(
        householdId,
        options,
        actor,
      );
      logger.request(req, "Detected recurring patterns", {
        count: patterns.length,
      });
      return success(
        res,
        patterns.map((pattern) => ({
          ...pattern,
          estimatedAmount: toMoneyDto(pattern.estimatedAmount, pattern.currency ?? ""),
        })),
      );
    } catch (error) {
      next(error);
    }
  },

  async confirmPattern(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = req.householdContext!;
      const { householdId } = actor;
      const parseResult = confirmPatternSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }
      const rule = await recurringService.confirmPattern(
        householdId,
        parseResult.data.pattern,
        req.user!.id,
        parseResult.data.accountId,
        actor,
        businessAuditService.getIpAddress(req),
      );

      logger.request(req, "Confirmed recurring pattern");
      return success(res, mapRecurringRuleMoney(rule), 201);
    } catch (error) {
      next(error);
    }
  },
};
