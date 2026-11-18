import { Request, Response, NextFunction } from "express";
import { reportsService } from "./reports.service";
import {
  reportsNetWorthQuerySchema,
  reportsNetWorthChangesQuerySchema,
} from "./reports.validation";
import {
  resolveReportQuery,
  handleReportError,
  reportSuccess,
} from "./reports.utils";

export const reportsNetWorthController = {
  async getNetWorth(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const query = reportsNetWorthQuerySchema.parse(req.query);
      const resolvedQuery = await resolveReportQuery(req, res, query);
      if (!resolvedQuery) return res;

      const result = await reportsService.getNetWorth(
        householdId,
        userId,
        resolvedQuery,
      );
      return reportSuccess(res, result);
    } catch (error) {
      return handleReportError(res, error, "GET /reports/net-worth");
    }
  },

  async getNetWorthChanges(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const query = reportsNetWorthChangesQuerySchema.parse(req.query);
      const resolvedQuery = await resolveReportQuery(req, res, query);
      if (!resolvedQuery) return res;

      const result = await reportsService.getNetWorthChanges(
        householdId,
        userId,
        resolvedQuery,
      );
      return reportSuccess(res, result);
    } catch (error) {
      return handleReportError(res, error, "GET /reports/net-worth/changes");
    }
  },
};
