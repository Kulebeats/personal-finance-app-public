/**
 * Rules Module - Controller
 *
 * HTTP handlers for auto-categorization rules.
 * Uses repositories and services for data access.
 *
 * @module modules/rules/controller
 */

import { Request, Response, NextFunction } from "express";
import {
  ruleRepository,
  type InsertRule,
} from "../../repositories/RuleRepository";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { ruleService } from "../../services/RuleService";
import { logger } from "../../utils/logger";
import { z } from "zod";
import { businessAuditService } from "../../services/BusinessAuditService";
import { success, created } from "../../core/http";
import { ValidationError, NotFoundError } from "../../core/errors";
import { matchesRule } from "../../services/rule/matching";
import type { Rule, RuleCondition, MerchantCache } from "../../services/rule/types";
import { CONDITION_TYPES, ALL_OPERATORS } from "@shared/ruleConditions";

// Schemas
import { createRuleSchema, updateRuleSchema, bulkEnableDisableSchema } from "./rules.validation";

// Preview condition schema that maps to RuleCondition type expected by service
const previewConditionSchema = z.object({
  type: z.enum(CONDITION_TYPES),
  operator: z.enum(ALL_OPERATORS),
  value: z.union([z.string(), z.number(), z.array(z.string())]),
  value2: z.union([z.string(), z.number()]).optional(),
  enabled: z.boolean().optional().default(true),
});

// Preview schema for testing rule conditions
const previewSchema = z.object({
  conditions: z.array(previewConditionSchema).min(1),
  conditionLogic: z.enum(["all", "any"]).default("all"),
  limit: z.number().min(1).max(100).optional().default(20),
});

export const rulesController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const rulesList = await ruleRepository.findByHousehold(householdId);
      return success(res, { rules: rulesList });
    } catch (error) {
      next(error);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;
      const rule = await ruleRepository.findByIdAndHousehold(id, householdId);
      if (!rule) {
        throw new NotFoundError("Rule not found");
      }
      return success(res, { rule });
    } catch (error) {
      next(error);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const parseResult = createRuleSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      const body = parseResult.data;
      // Use satisfies for type checking while allowing JSONB type flexibility
      const ruleData = {
        householdId,
        name: body.name,
        conditions: body.conditions,
        conditionLogic: body.conditionLogic,
        actions: body.actions,
        enabled: body.enabled,
        priority: body.priority ?? 0,
        applyToPast: body.applyToPast,
      } satisfies Omit<InsertRule, "id" | "createdAt" | "updatedAt" | "splitConfig">;
      const newRule = await ruleRepository.create(ruleData as InsertRule);

      if (body.applyToPast) {
        // Rule 11: apply-to-past may only read/mutate transactions VISIBLE to
        // the requester — another member's private transactions stay untouched
        // (mirrors dryRunRule / SCP-334). includePending: false preserves the
        // previous findByHousehold default of excluding pending transactions.
        const visibleTransactions =
          await transactionRepository.findByHouseholdWithVisibility(
            householdId,
            userId,
            { includePending: false },
          );
        await ruleService.applyRulesToTransactions(
          visibleTransactions,
          householdId,
          { userId },
        );
      }

      await businessAuditService.logCreate({
        householdId,
        userId,
        entityType: "rule",
        entityId: newRule.id,
        newValue: { name: newRule.name, priority: newRule.priority },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      logger.info("Created rule", { householdId, ruleId: newRule.id });
      return created(res, { rule: newRule });
    } catch (error) {
      next(error);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const { id } = req.params;
      const parseResult = updateRuleSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      const body = parseResult.data;
      const updated = await ruleRepository.updateByHousehold(
        id,
        householdId,
        body,
      );

      if (!updated) {
        throw new NotFoundError("Rule not found");
      }

      if (body.applyToPast) {
        // Rule 11: same visibility contract as create() above.
        const visibleTransactions =
          await transactionRepository.findByHouseholdWithVisibility(
            householdId,
            userId,
            { includePending: false },
          );
        await ruleService.applyRulesToTransactions(
          visibleTransactions,
          householdId,
          { userId },
        );
      }

      await businessAuditService.logUpdate({
        householdId,
        userId,
        entityType: "rule",
        entityId: updated.id,
        newValue: body,
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return success(res, { rule: updated });
    } catch (error) {
      next(error);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const { id } = req.params;
      const deleted = await ruleRepository.deleteByHousehold(id, householdId);

      if (!deleted) {
        throw new NotFoundError("Rule not found");
      }

      await businessAuditService.logDelete({
        householdId,
        userId,
        entityType: "rule",
        entityId: deleted.id,
        metadata: { name: deleted.name },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return success(res, { rule: deleted }, 200, { message: "Rule deleted" });
    } catch (error) {
      next(error);
    }
  },

  async reorder(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const { rules: ruleOrder } = req.body;

      if (!Array.isArray(ruleOrder)) {
        throw new ValidationError("rules must be an array");
      }

      // Sort by priority and extract IDs for repository method
      const sortedRules = [...ruleOrder].sort(
        (a: { priority: number }, b: { priority: number }) =>
          a.priority - b.priority,
      );
      const orderedIds = sortedRules.map((r: { id: string }) => r.id);

      await ruleRepository.reorder(householdId, orderedIds);

      await businessAuditService.logUpdate({
        householdId,
        userId,
        entityType: "rule_order",
        entityId: householdId, // Using householdId as the container for order
        newValue: { orderedIds },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return success(res, { message: "Rules reordered" });
    } catch (error) {
      next(error);
    }
  },

  async preview(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;

      const parseResult = previewSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid preview data",
          parseResult.error.errors,
        );
      }

      const { conditions, conditionLogic, limit } = parseResult.data;

      // Fetch transactions to test against — visibility-filtered (Rule 11):
      // preview must not leak another member's private transactions.
      const transactions =
        await transactionRepository.findByHouseholdWithVisibility(
          householdId,
          userId,
          { limit: 200, includePending: false }, // Check against more transactions to find matches
        );

      // Create a synthetic rule for testing
      const testRule: Partial<Rule> = {
        conditions: conditions as RuleCondition[],
        conditionLogic,
      };

      // Test each transaction against the conditions
      const matchingTransactions: typeof transactions = [];
      const merchantCache: MerchantCache = new Map();

      for (const transaction of transactions) {
        if (matchingTransactions.length >= limit) break;

        const matches = await matchesRule(
          testRule as Rule,
          transaction,
          householdId,
          merchantCache
        );

        if (matches) {
          matchingTransactions.push(transaction);
        }
      }

      logger.info("Rule preview executed", {
        householdId,
        conditionCount: conditions.length,
        matchCount: matchingTransactions.length,
      });

      return success(res, {
        matchingTransactions: matchingTransactions.map((t) => ({
          id: t.id,
          date: t.date,
          name: t.name,
          amount: t.amount,
          type: t.type,
          categoryId: t.categoryId,
        })),
        count: matchingTransactions.length,
        totalChecked: transactions.length,
      });
    } catch (error) {
      next(error);
    }
  },

  async bulkEnable(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const parseResult = bulkEnableDisableSchema.safeParse(req.body);

      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      const { ruleIds } = parseResult.data;
      const updatedRules = [];

      for (const ruleId of ruleIds) {
        const rule = await ruleRepository.updateByHousehold(
          ruleId,
          householdId,
          { enabled: true }
        );

        if (rule) {
          updatedRules.push(rule);
          await businessAuditService.logUpdate({
            householdId,
            userId,
            entityType: "rule",
            entityId: rule.id,
            newValue: { enabled: true },
            ipAddress: businessAuditService.getIpAddress(req),
          });
        }
      }

      logger.info("Bulk enabled rules", {
        householdId,
        count: updatedRules.length
      });

      return success(res, {
        rules: updatedRules,
        count: updatedRules.length
      });
    } catch (error) {
      next(error);
    }
  },

  async bulkDisable(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const parseResult = bulkEnableDisableSchema.safeParse(req.body);

      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      const { ruleIds } = parseResult.data;
      const updatedRules = [];

      for (const ruleId of ruleIds) {
        const rule = await ruleRepository.updateByHousehold(
          ruleId,
          householdId,
          { enabled: false }
        );

        if (rule) {
          updatedRules.push(rule);
          await businessAuditService.logUpdate({
            householdId,
            userId,
            entityType: "rule",
            entityId: rule.id,
            newValue: { enabled: false },
            ipAddress: businessAuditService.getIpAddress(req),
          });
        }
      }

      logger.info("Bulk disabled rules", {
        householdId,
        count: updatedRules.length
      });

      return success(res, {
        rules: updatedRules,
        count: updatedRules.length
      });
    } catch (error) {
      next(error);
    }
  },

  async dryRun(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const { id: ruleId } = req.params;
      const { transactionId } = req.body;

      if (!transactionId) {
        throw new ValidationError("transactionId is required");
      }

      const result = await ruleService.dryRunRule(
        ruleId,
        transactionId,
        householdId,
        userId
      );

      logger.info("Dry-run executed", {
        householdId,
        ruleId,
        transactionId,
        matches: result.matches,
      });

      return success(res, result);
    } catch (error) {
      next(error);
    }
  },
};
