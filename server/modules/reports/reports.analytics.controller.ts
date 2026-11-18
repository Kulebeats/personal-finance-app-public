import { Request, Response, NextFunction } from "express";
import { reportsService } from "./reports.service";
import {
  reportsSankeyQuerySchema,
  reportsFinancialRatiosQuerySchema,
  reportsDebtQuerySchema,
  reportsForecastQuerySchema,
} from "./reports.validation";
import {
  resolveReportQuery,
  handleReportError,
  reportSuccess,
} from "./reports.utils";

export const reportsAnalyticsController = {
  async getSankey(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const query = reportsSankeyQuerySchema.parse(req.query);
      const resolvedQuery = await resolveReportQuery(req, res, query);
      if (!resolvedQuery) return res;

      const result = await reportsService.getSankey(
        householdId,
        userId,
        resolvedQuery,
      );
      return reportSuccess(res, result);
    } catch (error) {
      return handleReportError(res, error, "GET /reports/sankey");
    }
  },

  async getFinancialRatios(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const query = reportsFinancialRatiosQuerySchema.parse(req.query);
      const resolvedQuery = await resolveReportQuery(req, res, query);
      if (!resolvedQuery) return res;

      const result = await reportsService.getFinancialRatios(
        householdId,
        userId,
        resolvedQuery,
      );
      return reportSuccess(res, result);
    } catch (error) {
      return handleReportError(res, error, "GET /reports/ratios");
    }
  },

  async getDebtAnalysis(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const query = reportsDebtQuerySchema.parse(req.query);
      const resolvedQuery = await resolveReportQuery(req, res, query);
      if (!resolvedQuery) return res;

      const result = await reportsService.getDebtAnalysis(
        householdId,
        userId,
        resolvedQuery,
      );
      return reportSuccess(res, result);
    } catch (error) {
      return handleReportError(res, error, "GET /reports/debt");
    }
  },

  async getForecast(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const query = reportsForecastQuerySchema.parse(req.query);
      const resolvedQuery = await resolveReportQuery(req, res, query);
      if (!resolvedQuery) return res;

      const result = await reportsService.getForecast(
        householdId,
        userId,
        resolvedQuery,
      );
      return reportSuccess(res, result);
    } catch (error) {
      return handleReportError(res, error, "GET /reports/forecast");
    }
  },
};
