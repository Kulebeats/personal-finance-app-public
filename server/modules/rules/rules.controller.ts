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
import { validateRuleTagReferences, validateRuleTagReferenceSets } from "../../services/rule/tag-references";
import { validateRuleCategoryReferences, validateRuleCategoryReferenceSets } from "../../services/rule/category-references";
import { validateRuleEntityReferences, validateRuleEntityReferenceSets } from "../../services/rule/entity-references";
import { validateRuleSplitActions } from "../../services/rule/split-allocation";
import { withTransaction } from "../../utils/withTransaction";
import type { Rule, RuleCondition, MerchantCache } from "../../services/rule/types";
import { CONDITION_TYPES, ALL_OPERATORS } from "@shared/ruleConditions";

// Schemas
import { createRuleSchema, updateRuleSchema, bulkEnableDisableSchema, reorderRulesSchema } from "./rules.validation";

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
      const newRule = await withTransaction(async (tx) => {
        await ruleRepository.lockAuthorContext(householdId, userId, tx);
        validateRuleSplitActions(body.actions);
        await validateRuleCategoryReferences(body.actions, householdId, tx);
        await validateRuleTagReferences(body.actions, householdId, tx);
        await validateRuleEntityReferences(body.actions, req.householdContext!, tx);
        const saved = await ruleRepository.create(ruleData as InsertRule, tx);
        await businessAuditService.logCreate({
          tx,
          householdId,
          userId,
          entityType: "rule",
          entityId: saved.id,
          newValue: { name: saved.name, priority: saved.priority },
          ipAddress: businessAuditService.getIpAddress(req),
        });
        return saved;
      });

      // A-32: the saved rule and what applying it to past rows did are
      // reported apart, so a partial apply is never shown as a full success.
      const applied = body.applyToPast ? await ruleService.applyToPast(householdId, userId) : undefined;

      logger.info("Created rule", { householdId, ruleId: newRule.id });
      return created(res, { rule: newRule, applied });
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
      const updated = await withTransaction(async (tx) => {
        await ruleRepository.lockAuthorContext(householdId, userId, tx);
        const previous = await ruleRepository.findByIdAndHouseholdForUpdate(
          id,
          householdId,
          tx,
        );
        if (!previous) throw new NotFoundError("Rule not found");
        // The UI's pure disable toggle must remain available to quarantine a
        // bad persisted rule; all other edits check the merged action set.
        const pureDisable = body.enabled === false && Object.keys(body).length === 1;
        if (!pureDisable) {
          validateRuleSplitActions(body.actions ?? previous.actions);
          await validateRuleCategoryReferences(body.actions ?? previous.actions, householdId, tx);
          await validateRuleTagReferences(body.actions ?? previous.actions, householdId, tx);
          await validateRuleEntityReferences(body.actions ?? previous.actions, req.householdContext!, tx);
        }
        const next = await ruleRepository.updateByHousehold(id, householdId, body, tx);
        if (!next) throw new NotFoundError("Rule not found");
        await businessAuditService.logUpdate({
          tx,
          householdId,
          userId,
          entityType: "rule",
          entityId: next.id,
          newValue: body,
          ipAddress: businessAuditService.getIpAddress(req),
        });
        return next;
      });

      // A-32: same as create() above.
      const applied = body.applyToPast ? await ruleService.applyToPast(householdId, userId) : undefined;

      return success(res, { rule: updated, applied });
    } catch (error) {
      next(error);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const { id } = req.params;
      const deleted = await withTransaction(async (tx) => {
        await ruleRepository.lockAuthorContext(householdId, userId, tx);
        const previous = await ruleRepository.findByIdAndHouseholdForUpdate(id, householdId, tx);
        if (!previous) throw new NotFoundError("Rule not found");
        const saved = await ruleRepository.deleteByHousehold(id, householdId, tx);
        if (!saved) throw new NotFoundError("Rule not found");
        await businessAuditService.logDelete({
          tx, householdId, userId, entityType: "rule", entityId: saved.id,
          metadata: { name: saved.name }, ipAddress: businessAuditService.getIpAddress(req),
        });
        return saved;
      });

      return success(res, { rule: deleted }, 200, { message: "Rule deleted" });
    } catch (error) {
      next(error);
    }
  },

  async reorder(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const parsed = reorderRulesSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError("Invalid reorder request", parsed.error.errors);
      }

      // Sort by priority and extract IDs for repository method
      const orderedIds = [...parsed.data.rules]
        .sort((a, b) => a.priority - b.priority)
        .map((r) => r.id);

      await withTransaction(async (tx) => {
        await ruleRepository.reorder(householdId, orderedIds, userId, tx);
        await businessAuditService.logUpdate({
          tx, householdId, userId, entityType: "rule_order", entityId: householdId,
          newValue: { orderedIds }, ipAddress: businessAuditService.getIpAddress(req),
        });
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
      // PostgreSQL returns canonical lowercase UUIDs. Preserve the first
      // requested order while treating alternate spellings as one rule.
      const canonicalIds = Array.from(new Set(ruleIds.map((id) => id.toLowerCase())));
      // Lock in stable order. One invalid stored rule rejects the whole batch.
      const updatedRules = await withTransaction(async (tx) => {
        await ruleRepository.lockAuthorContext(householdId, userId, tx);
        const byId = new Map<string, Rule>();
        const locked: Rule[] = [];
        for (const ruleId of [...canonicalIds].sort()) {
          const previous = await ruleRepository.findByIdAndHouseholdForUpdate(
            ruleId,
            householdId,
            tx,
          );
          if (!previous) continue;
          locked.push(previous);
        }
        const actionSets = locked.map((rule) => rule.actions);
        for (const actions of actionSets) validateRuleSplitActions(actions);
        await validateRuleCategoryReferenceSets(actionSets, householdId, tx);
        await validateRuleTagReferenceSets(actionSets, householdId, tx);
        await validateRuleEntityReferenceSets(actionSets, req.householdContext!, tx);
        for (const previous of locked) {
          const next = await ruleRepository.updateByHousehold(
            previous.id,
            householdId,
            { enabled: true },
            tx,
          );
          if (next) {
            await businessAuditService.logUpdate({
              tx, householdId, userId, entityType: "rule", entityId: next.id,
              newValue: { enabled: true }, ipAddress: businessAuditService.getIpAddress(req),
              metadata: { operation: "bulkEnable", batchSize: canonicalIds.length },
            });
            byId.set(previous.id, next);
          }
        }
        return canonicalIds.flatMap((id) => {
          const rule = byId.get(id);
          return rule ? [rule] : [];
        });
      });

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
      const canonicalIds = Array.from(new Set(ruleIds.map(id => id.toLowerCase())));
      const updatedRules = await withTransaction(async (tx) => {
        await ruleRepository.lockAuthorContext(householdId, userId, tx);
        const byId = new Map<string, Rule>();
        for (const id of [...canonicalIds].sort()) {
          const previous = await ruleRepository.findByIdAndHouseholdForUpdate(id, householdId, tx);
          if (!previous) continue;
          const next = await ruleRepository.updateByHousehold(id, householdId, { enabled: false }, tx);
          if (!next) continue;
          await businessAuditService.logUpdate({
            tx, householdId, userId, entityType: "rule", entityId: next.id,
            newValue: { enabled: false }, ipAddress: businessAuditService.getIpAddress(req),
            metadata: { operation: "bulkDisable", batchSize: canonicalIds.length },
          });
          byId.set(id, next);
        }
        return canonicalIds.flatMap(id => {
          const rule = byId.get(id);
          return rule ? [rule] : [];
        });
      });

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
