import { Request, Response, NextFunction } from "express";
import { reportsService } from "./reports.service";
import {
  reportsCashflowQuerySchema,
  reportsBudgetComparisonQuerySchema,
  reportsIncomeQuerySchema,
  reportsSavingsRateQuerySchema,
} from "./reports.validation";
import {
  resolveReportScope,
  resolveReportQuery,
  handleReportError,
  reportSuccess,
} from "./reports.utils";

export const reportsCashflowController = {
  async getCashflow(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const query = reportsCashflowQuerySchema.parse(req.query);
      const resolvedQuery = await resolveReportQuery(req, res, query);
      if (!resolvedQuery) return res;

      const result = await reportsService.getCashflow(
        householdId,
        userId,
        resolvedQuery,
      );
      return reportSuccess(res, result);
    } catch (error) {
      return handleReportError(res, error, "GET /reports/cashflow");
    }
  },

  async getIncome(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const query = reportsIncomeQuerySchema.parse(req.query);
      const resolvedQuery = await resolveReportQuery(req, res, query);
      if (!resolvedQuery) return res;

      const result = await reportsService.getIncome(
        householdId,
        userId,
        resolvedQuery,
      );
      return reportSuccess(res, result);
    } catch (error) {
      return handleReportError(res, error, "GET /reports/income");
    }
  },

  async getSavingsRate(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const query = reportsSavingsRateQuerySchema.parse(req.query);
      const resolvedQuery = await resolveReportQuery(req, res, query);
      if (!resolvedQuery) return res;

      const result = await reportsService.getSavingsRate(
        householdId,
        userId,
        resolvedQuery,
      );
      return reportSuccess(res, result);
    } catch (error) {
      return handleReportError(res, error, "GET /reports/savings-rate");
    }
  },

  async getBudgetComparison(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const query = reportsBudgetComparisonQuerySchema.parse(req.query);
      const resolvedQuery = await resolveReportQuery(req, res, query);
      if (!resolvedQuery) return res;

      const result = await reportsService.getBudgetComparison(
        householdId,
        userId,
        resolvedQuery,
      );
      return reportSuccess(res, result);
    } catch (error) {
      return handleReportError(res, error, "GET /reports/cashflow/budget");
    }
  },
};
