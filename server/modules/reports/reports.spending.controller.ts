import { Request, Response, NextFunction } from "express";
import { reportsService } from "./reports.service";
import {
  reportsSpendingBreakdownQuerySchema,
  reportsSpendingTrendQuerySchema,
  reportsExpenseClassificationQuerySchema,
  reportsSubcategoryBreakdownQuerySchema,
} from "./reports.validation";
import {
  resolveReportQuery,
  handleReportError,
  reportSuccess,
} from "./reports.utils";

export const reportsSpendingController = {
  async getSpendingBreakdown(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const query = reportsSpendingBreakdownQuerySchema.parse(req.query);
      const resolvedQuery = await resolveReportQuery(req, res, query);
      if (!resolvedQuery) return res;

      const result = await reportsService.getSpendingBreakdown(
        householdId,
        userId,
        resolvedQuery,
      );
      return reportSuccess(res, result);
    } catch (error) {
      return handleReportError(res, error, "GET /reports/spending/breakdown");
    }
  },

  async getSpendingTrend(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const query = reportsSpendingTrendQuerySchema.parse(req.query);
      const resolvedQuery = await resolveReportQuery(req, res, query);
      if (!resolvedQuery) return res;

      const result = await reportsService.getSpendingTrend(
        householdId,
        userId,
        resolvedQuery,
      );
      return reportSuccess(res, result);
    } catch (error) {
      return handleReportError(res, error, "GET /reports/spending/trend");
    }
  },

  async getExpenseClassification(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { householdId, userId } = req.householdContext!;
      const query = reportsExpenseClassificationQuerySchema.parse(req.query);
      const resolvedQuery = await resolveReportQuery(req, res, query);
      if (!resolvedQuery) return res;

      const result = await reportsService.getExpenseClassification(
        householdId,
        userId,
        resolvedQuery,
      );
      return reportSuccess(res, result);
    } catch (error) {
      return handleReportError(
        res,
        error,
        "GET /reports/expenses/classification",
      );
    }
  },

  async getSubcategoryBreakdown(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { householdId, userId } = req.householdContext!;
      const query = reportsSubcategoryBreakdownQuerySchema.parse(req.query);
      const resolvedQuery = await resolveReportQuery(req, res, query);
      if (!resolvedQuery) return res;

      const result = await reportsService.getSubcategoryBreakdown(
        householdId,
        userId,
        resolvedQuery,
      );
      return reportSuccess(res, result);
    } catch (error) {
      return handleReportError(res, error, "GET /reports/spending/subcategory");
    }
  },
};
