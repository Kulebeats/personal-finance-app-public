/**
 * Recurring Lifecycle Controller
 *
 * Handles lifecycle actions for recurring transactions:
 * skip, pause, resume, end operations.
 *
 * @module modules/recurring/recurring.lifecycle.controller
 */

import { Request, Response, NextFunction } from "express";
import { recurringService } from "../../services/RecurringService";
import { logger } from "../../utils/logger";
import { success } from "../../core/http";
import { ValidationError } from "../../core/errors";
import { toMoneyDto } from "../../core/money";
import { endRecurringSchema } from "./recurring.validation";
import { businessAuditService } from "../../services/BusinessAuditService";

const mapRecurringRuleMoney = <T extends { amount?: string | number }>(
  rule: T
): T => ({
  ...rule,
  amount: rule.amount !== undefined ? toMoneyDto(rule.amount) : rule.amount,
});

export const recurringLifecycleController = {
  async skip(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;
      const userId = req.user!.id;
      const beforeRule = await recurringService.getRecurringById(
        id,
        householdId
      );
      const rule = await recurringService.skipNextOccurrence(
        id,
        householdId,
        userId
      );
      await businessAuditService.logUpdate({
        userId,
        householdId,
        entityId: id,
        entityType: "recurring_rule",
        oldValue: {
          nextDueDate: beforeRule.nextDueDate,
          lastOccurredDate: beforeRule.lastOccurredDate,
          totalOccurrences: beforeRule.totalOccurrences,
        },
        newValue: {
          nextDueDate: rule.nextDueDate,
          lastOccurredDate: rule.lastOccurredDate,
          totalOccurrences: rule.totalOccurrences,
        },
        ipAddress: businessAuditService.getIpAddress(req),
        metadata: { operation: "skip" },
      });
      logger.request(req, "Skipped recurring occurrence");
      return success(res, mapRecurringRuleMoney(rule));
    } catch (error) {
      next(error);
    }
  },

  async pause(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;
      const userId = req.user!.id;
      const beforeRule = await recurringService.getRecurringById(
        id,
        householdId
      );
      const rule = await recurringService.pauseRecurring(
        id,
        householdId,
        userId
      );
      await businessAuditService.logUpdate({
        userId,
        householdId,
        entityId: id,
        entityType: "recurring_rule",
        oldValue: {
          isPaused: beforeRule.isPaused,
          isActive: beforeRule.isActive,
        },
        newValue: {
          isPaused: rule.isPaused,
          isActive: rule.isActive,
        },
        ipAddress: businessAuditService.getIpAddress(req),
        metadata: { operation: "pause" },
      });
      logger.request(req, "Paused recurring rule");
      return success(res, mapRecurringRuleMoney(rule));
    } catch (error) {
      next(error);
    }
  },

  async resume(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;
      const userId = req.user!.id;
      const beforeRule = await recurringService.getRecurringById(
        id,
        householdId
      );
      const rule = await recurringService.resumeRecurring(
        id,
        householdId,
        userId
      );
      await businessAuditService.logUpdate({
        userId,
        householdId,
        entityId: id,
        entityType: "recurring_rule",
        oldValue: {
          isPaused: beforeRule.isPaused,
          isActive: beforeRule.isActive,
        },
        newValue: {
          isPaused: rule.isPaused,
          isActive: rule.isActive,
        },
        ipAddress: businessAuditService.getIpAddress(req),
        metadata: { operation: "resume" },
      });
      logger.request(req, "Resumed recurring rule");
      return success(res, mapRecurringRuleMoney(rule));
    } catch (error) {
      next(error);
    }
  },

  async end(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;
      const parseResult = endRecurringSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors
        );
      }
      const userId = req.user!.id;
      const beforeRule = await recurringService.getRecurringById(
        id,
        householdId
      );
      const rule = await recurringService.endRecurring(
        id,
        householdId,
        parseResult.data.endDate
      );
      await businessAuditService.logUpdate({
        userId,
        householdId,
        entityId: id,
        entityType: "recurring_rule",
        oldValue: {
          endDate: beforeRule.endDate,
          isActive: beforeRule.isActive,
          isPaused: beforeRule.isPaused,
        },
        newValue: {
          endDate: rule.endDate,
          isActive: rule.isActive,
          isPaused: rule.isPaused,
        },
        ipAddress: businessAuditService.getIpAddress(req),
        metadata: { operation: "end" },
      });
      logger.request(req, "Ended recurring rule");
      return success(res, mapRecurringRuleMoney(rule));
    } catch (error) {
      next(error);
    }
  },
};
