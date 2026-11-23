import { Request, Response, NextFunction } from "express";
import { reportsService } from "./reports.service";
import {
  reportsTransactionsQuerySchema,
  reportsGoalsProgressQuerySchema,
  reportsCustomQuerySchema,
  reportsCustomBodySchema,
} from "./reports.validation";
import {
  resolveReportQuery,
  handleReportError,
  reportSuccess,
} from "./reports.utils";

export const reportsCustomController = {
  async getTransactions(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const query = reportsTransactionsQuerySchema.parse(req.query);
      const resolvedQuery = await resolveReportQuery(req, res, query);
      if (!resolvedQuery) return res;

      const result = await reportsService.getTransactions(
        householdId,
        userId,
        resolvedQuery,
      );
      return reportSuccess(res, result);
    } catch (error) {
      return handleReportError(res, error, "GET /reports/transactions");
    }
  },

  async getGoalsProgress(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const query = reportsGoalsProgressQuerySchema.parse(req.query);
      const resolvedQuery = await resolveReportQuery(req, res, query);
      if (!resolvedQuery) return res;

      const result = await reportsService.getGoalsProgress(
        householdId,
        userId,
        resolvedQuery,
      );
      return reportSuccess(res, result);
    } catch (error) {
      return handleReportError(res, error, "GET /reports/goals/progress");
    }
  },

  async getCustomChart(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const query = reportsCustomQuerySchema.parse(req.query);
      const resolvedQuery = await resolveReportQuery(req, res, query);
      if (!resolvedQuery) return res;

      const result = await reportsService.executeCustomChart(
        householdId,
        userId,
        {
          config: {
            name: resolvedQuery.name ?? "",
            chartType: resolvedQuery.chartType,
            primaryMetric: resolvedQuery.primaryMetric,
            secondaryMetric: resolvedQuery.secondaryMetric,
            groupBy: resolvedQuery.groupBy,
            period: resolvedQuery.period,
            aggregation: resolvedQuery.aggregation,
          },
          from: resolvedQuery.from,
          to: resolvedQuery.to,
          scope: resolvedQuery.scope,
        },
      );
      return reportSuccess(res, result);
    } catch (error) {
      return handleReportError(res, error, "GET /reports/custom");
    }
  },

  async executeCustomChart(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const body = reportsCustomBodySchema.parse(req.body);
      const resolvedBody = await resolveReportQuery(req, res, body);
      if (!resolvedBody) return res;

      const result = await reportsService.executeCustomChart(
        householdId,
        userId,
        {
          config: {
            name: resolvedBody.name ?? "",
            chartType: resolvedBody.chartType,
            primaryMetric: resolvedBody.primaryMetric,
            secondaryMetric: resolvedBody.secondaryMetric,
            groupBy: resolvedBody.groupBy,
            period: resolvedBody.period,
            aggregation: resolvedBody.aggregation,
          },
          from: resolvedBody.from,
          to: resolvedBody.to,
          scope: resolvedBody.scope,
        },
      );
      return reportSuccess(res, result);
    } catch (error) {
      return handleReportError(res, error, "POST /reports/custom");
    }
  },
};
