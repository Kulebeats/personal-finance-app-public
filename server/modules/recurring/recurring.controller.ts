/**
 * Recurring Module - Controller
 *
 * HTTP handlers for recurring transaction rules.
 * These methods match the legacy routes/recurring.ts exactly.
 *
 * @module modules/recurring/controller
 */

import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { recurringService } from "../../services/RecurringService";
import { logger } from "../../utils/logger";
import { success } from "../../core/http";
import { ValidationError } from "../../core/errors";
import { toMoneyDto } from "../../core/money";
import {
  createRecurringSchema,
  updateRecurringSchema,
  listRecurringQuerySchema,
  upcomingQuerySchema,
  createRecurringFromTransactionSchema,
  createRecurringFromExistingTransactionSchema,
  linkTransactionSchema,
  historyQuerySchema,
  processRecurringSchema,
} from "./recurring.validation";
import { businessAuditService } from "../../services/BusinessAuditService";
import { recurringLifecycleController } from "./recurring.lifecycle.controller";
import { recurringPatternController } from "./recurring.pattern.controller";
import {
  mapRecurringRuleMoney,
  mapTransactionMoney,
  mapRecurringLinkMoney,
} from "./recurring.helpers";

export const recurringController = {
  // =========================================================================
  // List & Query
  // =========================================================================

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const queryResult = listRecurringQuerySchema.safeParse(req.query);
      const options = queryResult.success ? queryResult.data : {};
      const rules = await recurringService.getRecurringRules(
        householdId,
        options,
      );
      logger.request(req, "Listed recurring rules", { count: rules.length });
      return success(res, rules.map(mapRecurringRuleMoney));
    } catch (error) {
      next(error);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;
      const rule = await recurringService.getRecurringById(id, householdId);
      return success(res, mapRecurringRuleMoney(rule));
    } catch (error) {
      next(error);
    }
  },

  async getUpcoming(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const queryResult = upcomingQuerySchema.safeParse(req.query);
      const days = queryResult.success ? queryResult.data.days : 30;
      const upcoming = await recurringService.getUpcomingBills(
        householdId,
        days,
      );
      return success(res, upcoming.map(mapRecurringRuleMoney));
    } catch (error) {
      next(error);
    }
  },

  async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const summary = await recurringService.getSummaryData(householdId);
      return success(res, {
        ...summary,
        totalMonthlyIncome: toMoneyDto(summary.totalMonthlyIncome),
        totalMonthlyExpenses: toMoneyDto(summary.totalMonthlyExpenses),
      });
    } catch (error) {
      next(error);
    }
  },

  async getHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;
      const { limit } = historyQuerySchema.parse(req.query);
      const history = await recurringService.getHistory(id, householdId, limit);
      return success(res, history);
    } catch (error) {
      next(error);
    }
  },

  async getLinkedTransactions(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;
      const links = await recurringService.getLinkedTransactions(
        id,
        householdId,
      );
      return success(res, links.map(mapRecurringLinkMoney));
    } catch (error) {
      next(error);
    }
  },

  // =========================================================================
  // CRUD Operations
  // =========================================================================

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const parseResult = createRecurringSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }
      const rule = await recurringService.createRecurring(
        parseResult.data,
        householdId,
        req.user!.id,
      );

      await businessAuditService.logCreate({
        userId: req.user!.id,
        householdId,
        entityId: rule.id,
        entityType: "recurring_rule",
        newValue: { name: rule.name, amount: rule.amount },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      logger.request(req, "Created recurring rule");
      return success(res, mapRecurringRuleMoney(rule), 201);
    } catch (error) {
      next(error);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;
      const parseResult = updateRecurringSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      // Fetch before state for audit
      const beforeRule = await recurringService.getRecurringById(
        id,
        householdId,
      );

      const rule = await recurringService.updateRecurring(
        id,
        parseResult.data,
        householdId,
        req.user!.id,
      );

      await businessAuditService.logUpdate({
        userId: req.user!.id,
        householdId,
        entityId: id,
        entityType: "recurring_rule",
        oldValue: {
          name: beforeRule.name,
          amount: beforeRule.amount,
          frequency: beforeRule.frequency,
          isActive: beforeRule.isActive,
        },
        newValue: {
          name: rule.name,
          amount: rule.amount,
          frequency: rule.frequency,
          isActive: rule.isActive,
        },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      logger.request(req, "Updated recurring rule");
      return success(res, mapRecurringRuleMoney(rule));
    } catch (error) {
      next(error);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const { id } = req.params;

      // Capture entity snapshot before deletion for audit
      const deletedRule = await recurringService.getRecurringById(
        id,
        householdId,
      );

      await recurringService.deleteRecurring(id, householdId);

      await businessAuditService.logDelete({
        userId,
        householdId,
        entityId: id,
        entityType: "recurring_rule",
        oldValue: {
          name: deletedRule.name,
          amount: deletedRule.amount,
          frequency: deletedRule.frequency,
          accountId: deletedRule.accountId,
        },
        ipAddress: businessAuditService.getIpAddress(req),
      });
      logger.request(req, "Deleted recurring rule");
      return success(res, { message: "Recurring rule deleted successfully" });
    } catch (error) {
      next(error);
    }
  },

  // Pattern detection and confirmation
  ...recurringPatternController,

  // Lifecycle actions (skip, pause, resume, end) are in recurring.lifecycle.controller.ts
  ...recurringLifecycleController,

  // =========================================================================
  // Transaction Linking
  // =========================================================================

  async linkTransaction(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;
      const userId = req.user!.id;
      const parseResult = linkTransactionSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }
      const link = await recurringService.linkTransaction(
        id,
        parseResult.data.transactionId,
        householdId,
        userId,
        "manual",
      );
      await businessAuditService.log({
        userId,
        householdId,
        action: "LINK",
        entityType: "recurring_rule",
        entityId: id,
        details: {
          transactionId: parseResult.data.transactionId,
          linkId: link.id,
          matchMethod: "manual",
        },
        ipAddress: businessAuditService.getIpAddress(req),
      });
      logger.request(req, "Linked transaction to recurring");
      return success(res, mapRecurringLinkMoney(link));
    } catch (error) {
      next(error);
    }
  },

  async unlinkTransaction(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { linkId } = req.params;
      const userId = req.user!.id;
      const deletedLink = await recurringService.unlinkTransaction(
        linkId,
        householdId,
        userId,
      );
      await businessAuditService.log({
        userId,
        householdId,
        action: "UNLINK",
        entityType: "recurring_rule",
        entityId: deletedLink.recurringTransactionId,
        details: {
          transactionId: deletedLink.transactionId,
          linkId: deletedLink.id,
        },
        ipAddress: businessAuditService.getIpAddress(req),
      });
      logger.request(req, "Unlinked transaction");
      return success(res, { message: "Unlinked successfully" });
    } catch (error) {
      next(error);
    }
  },

  // =========================================================================
  // Batch Processing
  // =========================================================================

  async processRecurring(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const parseResult = processRecurringSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      const { dryRun, asOfDate } = parseResult.data;
      const result = await recurringService.processRecurring(
        householdId,
        asOfDate,
        dryRun,
      );

      if (!dryRun) {
        await businessAuditService.log({
          userId,
          householdId,
          action: "PROCESS",
          entityType: "recurring_batch",
          entityId: randomUUID(),
          details: {
            processed: result.processed,
            created: result.created,
            errors: result.errors.length,
            asOfDate: asOfDate || new Date().toISOString().split("T")[0],
          },
          ipAddress: businessAuditService.getIpAddress(req),
        });
      }

      logger.request(req, "Processed recurring transactions", {
        processed: result.processed,
        created: result.created,
        dryRun,
      });
      return success(res, { ...result, dryRun });
    } catch (error) {
      next(error);
    }
  },

  // =========================================================================
  // Create from Transaction
  // =========================================================================

  async createWithTransaction(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const userId = req.user!.id;
      const parseResult = createRecurringFromTransactionSchema.safeParse(
        req.body,
      );
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      const { recurring, ...transactionData } = parseResult.data;
      const result = await recurringService.createRecurringFromTransaction(
        transactionData,
        recurring,
        householdId,
        userId,
      );

      if (!result.isDuplicate) {
        await businessAuditService.logCreate({
          userId,
          householdId,
          entityId: result.recurringRule.id,
          entityType: "recurring_rule",
          newValue: {
            name: result.recurringRule.name,
            amount: result.recurringRule.amount,
            source: "transaction",
            transactionId: result.transaction.id,
          },
          ipAddress: businessAuditService.getIpAddress(req),
          metadata: { operation: "createFromTransaction" },
        });
      }

      logger.request(req, "Created recurring from transaction");
      return success(
        res,
        {
          transaction: mapTransactionMoney(result.transaction),
          recurringRule: mapRecurringRuleMoney(result.recurringRule),
          isDuplicate: result.isDuplicate,
        },
        201,
      );
    } catch (error) {
      next(error);
    }
  },

  async createFromTransaction(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const { transactionId } = req.params;
      const parseResult =
        createRecurringFromExistingTransactionSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }
      const result =
        await recurringService.createRecurringFromExistingTransaction(
          transactionId,
          parseResult.data,
          householdId,
          userId,
        );
      if (!result.isDuplicate) {
        await businessAuditService.logCreate({
          userId,
          householdId,
          entityId: result.recurringRule.id,
          entityType: "recurring_rule",
          newValue: {
            name: result.recurringRule.name,
            amount: result.recurringRule.amount,
            source: "transaction",
            transactionId,
          },
          ipAddress: businessAuditService.getIpAddress(req),
          metadata: { operation: "createFromTransaction" },
        });
      }
      logger.request(req, "Created recurring from transaction");
      return success(res, {
        transaction: mapTransactionMoney(result.transaction),
        recurringRule: mapRecurringRuleMoney(result.recurringRule),
        isDuplicate: result.isDuplicate,
      });
    } catch (error) {
      next(error);
    }
  },
};
