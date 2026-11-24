/**
 * Recurring Module - Controller
 *
 * HTTP handlers for recurring transaction rules.
 * These methods match the legacy routes/recurring.ts exactly.
 *
 * @module modules/recurring/controller
 */

import { Request, Response, NextFunction } from "express";
import { isIP } from "node:net";
import { z } from "zod";
import { recurringService } from "../../services/RecurringService";
import { db } from "../../db";
import { householdToday } from "../../services/householdCalendarToday";
import { listRecurringCalendar } from "../../services/recurring/RecurringCalendarQuery";
import { logger } from "../../utils/logger";
import { success } from "../../core/http";
import { ValidationError } from "../../core/errors";
import { toMoneyDto } from "../../core/money";
import { positiveMoneyDtoSchema } from "../../core/validation/money";
import {
  createRecurringSchema,
  updateRecurringSchema,
  listRecurringQuerySchema,
  recurringCalendarQuerySchema,
  upcomingQuerySchema,
  createRecurringFromTransactionSchema,
  createRecurringFromExistingTransactionSchema,
  linkTransactionSchema,
  historyQuerySchema,
  processRecurringSchema,
} from "./recurring.validation";
import { businessAuditService } from "../../services/BusinessAuditService";
import { recordRecurringBatchSummary } from "../../services/recurring/RecurringBatchAudit";
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
      const actor = req.householdContext!;
      const queryResult = listRecurringQuerySchema.safeParse(req.query);
      const options = queryResult.success ? queryResult.data : {};
      const rules = await recurringService.getVisibleRecurringRules(
        actor,
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
      const actor = req.householdContext!;
      const { id } = req.params;
      const rule = await recurringService.getVisibleRecurringById(id, actor);
      return success(res, mapRecurringRuleMoney(rule));
    } catch (error) {
      next(error);
    }
  },

  async getCalendar(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = recurringCalendarQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new ValidationError("Invalid request data", parsed.error.issues);
      const occurrences = await listRecurringCalendar(req.householdContext!, parsed.data);
      return success(res, occurrences.map(({ rule, ...occurrence }) => ({
        ...occurrence, rule: mapRecurringRuleMoney(rule),
      })));
    } catch (error) {
      next(error);
    }
  },

  async getUpcoming(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = req.householdContext!;
      const queryResult = upcomingQuerySchema.safeParse(req.query);
      const days = queryResult.success ? queryResult.data.days : 30;
      const upcoming = await recurringService.getUpcomingBills(
        actor,
        days,
      );
      return success(res, upcoming.map(mapRecurringRuleMoney));
    } catch (error) {
      next(error);
    }
  },

  async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const summary = await recurringService.getSummaryData(req.householdContext!);
      return success(res, {
        ...summary,
        totalMonthlyIncome: toMoneyDto(summary.totalMonthlyIncome, summary.currency),
        totalMonthlyExpenses: toMoneyDto(summary.totalMonthlyExpenses, summary.currency),
      });
    } catch (error) {
      next(error);
    }
  },

  async getHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = req.householdContext!;
      const { id } = req.params;
      const { limit } = historyQuerySchema.parse(req.query);
      const history = await recurringService.getHistory(id, actor, limit);
      return success(res, history);
    } catch (error) {
      next(error);
    }
  },

  async getLinkedTransactions(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = req.householdContext!;
      const { id } = req.params;
      const links = await recurringService.getLinkedTransactions(
        id,
        actor,
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
      // The CREATE audit row is written inside the rule's transaction (FIN-13).
      const rule = await recurringService.createRecurring(
        parseResult.data,
        householdId,
        req.user!.id,
        {
          actor: req.householdContext!, currency: positiveMoneyDtoSchema.parse(req.body.amount).currency,
          audit: { ipAddress: businessAuditService.getIpAddress(req) },
        },
      );

      logger.request(req, "Created recurring rule");
      return success(res, mapRecurringRuleMoney(rule), 201);
    } catch (error) {
      next(error);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = req.householdContext!;
      const { id } = req.params;
      const parseResult = updateRecurringSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      const { confirmDenomination, expectedDefinition, ...updates } = parseResult.data;
      const denomination = req.body.amount === undefined && confirmDenomination === undefined ? undefined : {
        confirmDenomination,
        currency: req.body.amount === undefined ? undefined : positiveMoneyDtoSchema.parse(req.body.amount).currency,
        ...(expectedDefinition === undefined ? {} : { expectedDefinition }),
      };
      // The UPDATE audit row is written inside the update's transaction (FIN-13).
      const audit = { ipAddress: businessAuditService.getIpAddress(req) };
      const { rule } = await recurringService.updateRecurring(id, updates, actor, denomination, audit);

      logger.request(req, "Updated recurring rule");
      return success(res, mapRecurringRuleMoney(rule));
    } catch (error) {
      next(error);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      // The DELETE audit row is written inside the deletion's transaction (FIN-13).
      await recurringService.deleteRecurring(id, req.householdContext!, { ipAddress: businessAuditService.getIpAddress(req) });
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
      const actor = req.householdContext!;
      const { id } = req.params;
      const parseResult = linkTransactionSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }
      // The LINK audit row is written inside the link's transaction (FIN-13).
      const link = await recurringService.linkVisibleTransaction(
        id,
        parseResult.data.transactionId,
        actor,
        { ipAddress: businessAuditService.getIpAddress(req) },
      );
      logger.request(req, "Linked transaction to recurring");
      return success(res, mapRecurringLinkMoney(link));
    } catch (error) {
      next(error);
    }
  },

  async unlinkTransaction(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = req.householdContext!;
      const { id, linkId } = req.params;
      const ids = z.object({ id: z.string().uuid(), linkId: z.string().uuid() }).safeParse({ id, linkId });
      if (!ids.success) throw new ValidationError("Invalid recurring link ID", ids.error.errors);
      // The UNLINK audit row is written inside the unlink's transaction (FIN-13).
      await recurringService.unlinkTransaction(id, linkId, actor, { ipAddress: businessAuditService.getIpAddress(req) });
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
      const today = await householdToday(db, householdId);
      if (asOfDate !== undefined && asOfDate > today) {
        throw new ValidationError("Processing date cannot be in the future", [
          { field: "asOfDate", message: "Choose today or an earlier date." },
        ]);
      }
      const cutoff = asOfDate ?? today;
      const result = await recurringService.processRecurring(
        householdId,
        cutoff,
        dryRun,
        req.householdContext!,
      );

      // A run that processed something reports whether its summary row was written (FIN-13).
      const auditRecorded = !dryRun && result.processed > 0
        ? await recordRecurringBatchSummary({ householdId, userId }, {
          processed: result.processed, created: result.created, errors: result.errors.length, asOfDate: cutoff,
        }, businessAuditService.getIpAddress(req))
        : undefined;

      logger.request(req, "Processed recurring transactions", {
        processed: result.processed,
        created: result.created,
        dryRun,
      });
      return success(res, { ...result, dryRun, ...(auditRecorded === undefined ? {} : { auditRecorded }) });
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
      const requestIp = req.ip?.split("%")[0];
      const result = await recurringService.createRecurringFromTransaction(
        transactionData,
        recurring,
        householdId,
        userId,
        requestIp && isIP(requestIp) ? requestIp : undefined,
      );

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
          // A new rule's CREATE audit row is written inside its transaction
          // (FIN-13); a duplicate writes nothing and so is not audited.
          { ipAddress: businessAuditService.getIpAddress(req) },
        );
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
