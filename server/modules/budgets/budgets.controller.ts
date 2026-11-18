/**
 * Budgets Module - Controller
 *
 * HTTP handlers for budget management.
 * Delegates to budgetService for business logic.
 *
 * @module modules/budgets/controller
 */

import { Request, Response, NextFunction } from "express";
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
  clearBudgetsSchema,
  moveBudgetSchema,
} from "./budgets.validation";
import { businessAuditService } from "../../services/BusinessAuditService";
import { success, created } from "../../core/http";
import { ValidationError } from "../../core/errors";
import { mapBudgetMoney, mapBudgetWithPeriods } from "./budgets.helpers";

// Type for budget settings updates (avoids Record<string, any>)
interface BudgetSettingsUpdate {
  budgetSystem?: string;
  defaultBudgetScope?: "all_future" | "current_month";
  defaultMonthOnlyChanges?: boolean;
}

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
      const currency = await getHouseholdCurrency(householdId);
      const queryResult = budgetProgressQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        throw new ValidationError(
          "Invalid request data",
          queryResult.error.errors
        );
      }
      const { year, month } = queryResult.data;
      const progress = await budgetService.getBudgetProgress(
        householdId,
        year,
        month
      );
      return success(
        res,
        progress.map((item) => mapBudgetMoney(item, currency))
      );
    } catch (error) {
      next(error);
    }
  },

  async getAlerts(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const currency = await getHouseholdCurrency(householdId);
      const queryResult = budgetProgressQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        throw new ValidationError(
          "Invalid request data",
          queryResult.error.errors
        );
      }
      const { year, month } = queryResult.data;
      const alerts = await budgetService.getBudgetAlerts(
        householdId,
        year,
        month
      );
      return success(
        res,
        alerts.map((alert) => ({
          ...alert,
          budget: mapBudgetMoney(alert.budget, currency),
          spent: toMoneyDto(alert.spent, currency),
        }))
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
      const budget = await budgetService.createBudget(
        parseResult.data,
        householdId
      );

      await businessAuditService.logCreate({
        userId: req.householdContext!.userId,
        householdId,
        entityId: budget.id,
        entityType: "budget",
        newValue: {
          name: budget.name,
          amount: budget.amount,
          period: budget.period,
        },
        ipAddress: businessAuditService.getIpAddress(req),
      });

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

      // Fetch before state for audit
      const beforeBudget = await budgetService.getBudgetById(id, householdId);

      const budget = await budgetService.updateBudget(
        id,
        parseResult.data,
        householdId
      );

      await businessAuditService.logUpdate({
        userId: req.householdContext!.userId,
        householdId,
        entityId: id,
        entityType: "budget",
        oldValue: {
          name: beforeBudget.name,
          amount: beforeBudget.amount,
          period: beforeBudget.period,
          categoryId: beforeBudget.categoryId,
          isActive: beforeBudget.isActive,
        },
        newValue: {
          name: budget.name,
          amount: budget.amount,
          period: budget.period,
          categoryId: budget.categoryId,
          isActive: budget.isActive,
        },
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

      // Capture entity snapshot before deletion for audit
      const deletedBudget = await budgetService.getBudgetById(id, householdId);

      await budgetService.deleteBudget(id, householdId);

      await businessAuditService.logDelete({
        userId: req.householdContext!.userId,
        householdId,
        entityId: id,
        entityType: "budget",
        oldValue: {
          name: deletedBudget.name,
          amount: deletedBudget.amount,
          period: deletedBudget.period,
          categoryId: deletedBudget.categoryId,
        },
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
      const defaultApplyScope =
        preferences.defaultBudgetScope === "all_future"
          ? "all_future"
          : "this_month";
      return success(res, {
        budgetSystem: preferences.budgetSystem || "flex",
        defaultApplyScope,
      });
    } catch (error) {
      next(error);
    }
  },

  async updateSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const parseResult = budgetSettingsSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors
        );
      }

      let preferences = await householdRepository.findPreferences(householdId);
      if (!preferences) {
        preferences = await householdRepository.createPreferences({
          householdId,
        });
      }

      const updates: BudgetSettingsUpdate = {};
      if (parseResult.data.budgetSystem) {
        updates.budgetSystem = parseResult.data.budgetSystem;
      }
      if (parseResult.data.defaultApplyScope) {
        updates.defaultBudgetScope =
          parseResult.data.defaultApplyScope === "all_future"
            ? "all_future"
            : "current_month";
        updates.defaultMonthOnlyChanges =
          parseResult.data.defaultApplyScope !== "all_future";
      }

      const updated = await householdRepository.updatePreferences(
        householdId,
        updates
      );

      if (parseResult.data.budgetSystem === "flex") {
        await budgetService.ensureFlexBudget(householdId);
      }

      return success(res, {
        budgetSystem: updated.budgetSystem || "flex",
        defaultApplyScope:
          updated.defaultBudgetScope === "all_future"
            ? "all_future"
            : "this_month",
      });
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
      const result = await budgetService.updateBudgetForecast(
        householdId,
        id,
        parseResult.data
      );
      await businessAuditService.logUpdate({
        userId,
        householdId,
        entityId: id,
        entityType: "budget",
        newValue: {
          amount: parseResult.data.amount,
          year: parseResult.data.year,
          month: parseResult.data.month,
          applyScope: result.scope,
          months: result.months,
        },
        ipAddress: businessAuditService.getIpAddress(req),
        metadata: { operation: "forecastUpdate" },
      });
      return success(res, result);
    } catch (error) {
      next(error);
    }
  },

  async recalculate(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const parseResult = recalcBudgetsSchema.safeParse(req.body || {});
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors
        );
      }
      const months = parseResult.data.months || 3;
      const result = await budgetService.recalculateBudgets(
        householdId,
        months
      );
      await businessAuditService.logUpdate({
        userId,
        householdId,
        entityId: `bulk:${householdId}`,
        entityType: "budget",
        newValue: {
          months,
          updated: result.updated,
          created: result.created,
          cleared: result.cleared,
        },
        ipAddress: businessAuditService.getIpAddress(req),
        metadata: { operation: "recalculate" },
      });
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
      const cleared = await budgetService.clearBudgets(householdId);
      await businessAuditService.logDelete({
        userId,
        householdId,
        entityId: `bulk:${householdId}`,
        entityType: "budget",
        oldValue: { cleared },
        ipAddress: businessAuditService.getIpAddress(req),
        metadata: { operation: "clear" },
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
      const result = await budgetService.moveBudgetAmount(
        householdId,
        parseResult.data
      );

      await businessAuditService.log({
        householdId,
        userId: req.householdContext!.userId,
        action: "TRANSFER",
        entityType: "budget",
        entityId: parseResult.data.fromBudgetId,
        details: {
          toBudgetId: parseResult.data.toBudgetId,
          amount: parseResult.data.amount,
        },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return success(res, result);
    } catch (error) {
      next(error);
    }
  },
};
