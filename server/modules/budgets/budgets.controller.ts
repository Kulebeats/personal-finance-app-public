/**
 * Budgets Module - Controller
 *
 * HTTP handlers for budget management.
 * Delegates to budgetService for business logic.
 *
 * @module modules/budgets/controller
 */

import { Request, Response, NextFunction } from "express";
import { isIP } from "node:net";
import { budgetService } from "../../services/BudgetService";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { logger } from "../../utils/logger";
import { toMoneyDto } from "../../core/money";
import {
  createBudgetSchema,
  updateBudgetSchema,
  budgetProgressQuerySchema,
  listBudgetsQuerySchema,
  budgetSettingsSchema,
  forecastQuerySchema,
  forecastUpdateSchema,
  recalcBudgetsSchema,
  budgetPreviewQuerySchema,
  clearBudgetsSchema,
  ensureFlexBudgetSchema,
  moveBudgetSchema,
} from "./budgets.validation";
import { businessAuditService } from "../../services/BusinessAuditService";
import { toBudgetSettingsView, updateBudgetSettings } from "../../services/budget/BudgetSettingsService";
import { success, created } from "../../core/http";
import { ValidationError } from "../../core/errors";
import { mapBudgetMoney, mapBudgetWithPeriods, mapUnbudgetedSpend } from "./budgets.helpers";

// Helper to get household currency
async function getHouseholdCurrency(householdId: string): Promise<string> {
  const household = await householdRepository.findById(householdId);
  return household?.currency || "ZMW";
}

export const budgetsController = {
  // =========================================================================
  // List & Query
  // =========================================================================

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const currency = await getHouseholdCurrency(householdId);
      const queryResult = listBudgetsQuerySchema.safeParse(req.query);
      const options = queryResult.success ? queryResult.data : {};
      const budgets = await budgetService.getBudgets(householdId, options);
      logger.request(req, "Listed budgets", { count: budgets.length });
      return success(res, budgets.map((b) => mapBudgetMoney(b, currency)));
    } catch (error) {
      next(error);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const currency = await getHouseholdCurrency(householdId);
      const { id } = req.params;
      const budget = await budgetService.getBudgetById(id, householdId);
      return success(res, mapBudgetMoney(budget, currency));
    } catch (error) {
      next(error);
    }
  },

  async getProgress(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const queryResult = budgetProgressQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        throw new ValidationError(
          "Invalid request data",
          queryResult.error.errors
        );
      }
      const { year, month } = queryResult.data;
      const { progress, unavailable, unbudgeted } = await budgetService.getBudgetProgressReport(
        householdId,
        year,
        month,
        { kind: "actor", actor: req.householdContext! },
      );
      return success(
        res,
        progress.map((item) => mapBudgetMoney(item, item.currency)),
        200,
        { unavailableBudgets: unavailable, unbudgetedSpent: mapUnbudgetedSpend(unbudgeted) },
      );
    } catch (error) {
      next(error);
    }
  },

  async getAlerts(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const queryResult = budgetProgressQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        throw new ValidationError(
          "Invalid request data",
          queryResult.error.errors
        );
      }
      const { year, month } = queryResult.data;
      const { alerts, unavailable } = await budgetService.getBudgetAlertsReport(
        householdId,
        year,
        month,
        { kind: "actor", actor: req.householdContext! },
      );
      return success(
        res,
        alerts.map((alert) => ({
          ...alert,
          budget: mapBudgetMoney(alert.budget, alert.budget.currency),
          spent: toMoneyDto(alert.spent),
        })),
        200,
        { unavailableBudgets: unavailable },
      );
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
      const currency = await getHouseholdCurrency(householdId);
      const parseResult = createBudgetSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors
        );
      }
      // The service writes the budget and its audit row in one transaction.
      const { onlyFor, ...data } = parseResult.data;
      const budget = await budgetService.createBudget(data, householdId, {
        userId: req.householdContext!.userId,
        ipAddress: businessAuditService.getIpAddress(req),
      }, onlyFor);

      logger.request(req, "Created budget");
      return success(res, mapBudgetMoney(budget, currency), 201);
    } catch (error) {
      next(error);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const currency = await getHouseholdCurrency(householdId);
      const { id } = req.params;
      const parseResult = updateBudgetSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors
        );
      }

      // NEW-32: the update and its one audit row commit in one transaction.
      const budget = await budgetService.updateBudget(id, parseResult.data, householdId, {
        userId: req.householdContext!.userId,
        ipAddress: businessAuditService.getIpAddress(req),
      });

      logger.request(req, "Updated budget");
      return success(res, mapBudgetMoney(budget, currency));
    } catch (error) {
      next(error);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;

      // NEW-32: the delete and its one audit row commit in one transaction.
      await budgetService.deleteBudget(id, householdId, {
        userId: req.householdContext!.userId,
        ipAddress: businessAuditService.getIpAddress(req),
      });

      logger.request(req, "Deleted budget");
      return success(res, { message: "Budget deleted successfully" });
    } catch (error) {
      next(error);
    }
  },

  // =========================================================================
  // Settings
  // =========================================================================

  async getSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      let preferences = await householdRepository.findPreferences(householdId);
      if (!preferences) {
        preferences = await householdRepository.createPreferences({
          householdId,
        });
      }
      return success(res, toBudgetSettingsView(preferences));
    } catch (error) {
      next(error);
    }
  },

  async updateSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const parseResult = budgetSettingsSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors
        );
      }
      // NEW-32: preferences, any flex budget and their audit rows commit together.
      const settings = await updateBudgetSettings(
        { householdId, userId, ipAddress: businessAuditService.getIpAddress(req) },
        parseResult.data,
      );
      return success(res, settings);
    } catch (error) {
      next(error);
    }
  },

  /**
   * The household's flex budget, created and audited if it has none yet
   * (N8 b2: a new household is on the flex system before any bucket exists).
   * Idempotent under the preferences lock; the amount is set through update.
   */
  async ensureFlex(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const parseResult = ensureFlexBudgetSchema.safeParse(req.body ?? {});
      if (!parseResult.success) {
        throw new ValidationError("Invalid request data", parseResult.error.errors);
      }
      const currency = await getHouseholdCurrency(householdId);
      const budget = await budgetService.ensureFlexBudget({
        householdId, userId, ipAddress: businessAuditService.getIpAddress(req),
      });
      logger.request(req, "Ensured flex budget");
      return success(res, mapBudgetMoney(budget, currency));
    } catch (error) {
      next(error);
    }
  },

  // =========================================================================
  // Forecast & Operations
  // =========================================================================

  async getForecast(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const currency = await getHouseholdCurrency(householdId);
      const queryResult = forecastQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        throw new ValidationError(
          "Invalid request data",
          queryResult.error.errors
        );
      }
      const { year, month, months } = queryResult.data;
      const forecast = await budgetService.getBudgetForecast(
        householdId,
        year,
        month,
        months
      );
      return success(res, {
        ...forecast,
        budgets: forecast.budgets.map((b) => mapBudgetWithPeriods(b, currency)),
      });
    } catch (error) {
      next(error);
    }
  },

  async updateForecast(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const { id } = req.params;
      const parseResult = forecastUpdateSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors
        );
      }
      // NEW-32: the override and its one audit row commit in one transaction.
      const result = await budgetService.updateBudgetForecast(householdId, id, parseResult.data, {
        userId, ipAddress: businessAuditService.getIpAddress(req),
      });
      return success(res, result);
    } catch (error) {
      next(error);
    }
  },

  async recalculate(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const parseResult = req.method === "GET" ? budgetPreviewQuerySchema.safeParse(req.query)
        : recalcBudgetsSchema.safeParse(req.body || {});
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors
        );
      }
      const months = parseResult.data.months || 3;
      const result = await budgetService.previewRecalculation(
        householdId,
        userId,
        months
      );
      res.set("Cache-Control", "no-store");
      return success(res, result);
    } catch (error) {
      next(error);
    }
  },

  async clear(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const parseResult = clearBudgetsSchema.safeParse(req.body || {});
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors
        );
      }
      const requestIp = req.ip?.split("%")[0];
      const cleared = await budgetService.clearBudgets({
        householdId,
        userId,
        ipAddress: requestIp && isIP(requestIp) ? requestIp : undefined,
      });
      return success(res, { cleared });
    } catch (error) {
      next(error);
    }
  },

  async move(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const parseResult = moveBudgetSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors
        );
      }
      // NEW-32: the move and its one TRANSFER audit row commit in one transaction.
      const result = await budgetService.moveBudgetAmount(householdId, parseResult.data, {
        userId: req.householdContext!.userId,
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return success(res, result);
    } catch (error) {
      next(error);
    }
  },
};
