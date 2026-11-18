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
import {
  detectPatternsSchema,
  confirmPatternSchema,
} from "./recurring.validation";
import { businessAuditService } from "../../services/BusinessAuditService";

const mapRecurringRuleMoney = <T extends { amount?: string | number }>(
  rule: T,
): T => ({
  ...rule,
  amount: rule.amount !== undefined ? toMoneyDto(rule.amount) : rule.amount,
});

export const recurringPatternController = {
  async detectPatterns(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const parseResult = detectPatternsSchema.safeParse(req.body);
      const options = parseResult.success ? parseResult.data : undefined;
      const patterns = await recurringService.detectAndSuggest(
        householdId,
        options,
      );
      logger.request(req, "Detected recurring patterns", {
        count: patterns.length,
      });
      return success(
        res,
        patterns.map((pattern) => ({
          ...pattern,
          estimatedAmount: toMoneyDto(pattern.estimatedAmount),
        })),
      );
    } catch (error) {
      next(error);
    }
  },

  async confirmPattern(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
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
      );

      await businessAuditService.logCreate({
        userId: req.user!.id,
        householdId,
        entityId: rule.id,
        entityType: "recurring_rule",
        newValue: { pattern: true, name: rule.name },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      logger.request(req, "Confirmed recurring pattern");
      return success(res, mapRecurringRuleMoney(rule), 201);
    } catch (error) {
      next(error);
    }
  },
};
