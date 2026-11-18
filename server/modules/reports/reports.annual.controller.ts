import { Request, Response, NextFunction } from "express";
import { reportsService } from "./reports.service";
import { reportsAnnualQuerySchema } from "./reports.validation";
import {
  resolveReportQuery,
  handleReportError,
  reportSuccess,
} from "./reports.utils";

export const reportsAnnualController = {
  async getAnnual(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const query = reportsAnnualQuerySchema.parse(req.query);
      const resolvedQuery = await resolveReportQuery(req, res, query);
      if (!resolvedQuery) return res;

      const result = await reportsService.getAnnual(
        householdId,
        userId,
        resolvedQuery,
      );
      return reportSuccess(res, result);
    } catch (error) {
      return handleReportError(res, error, "GET /reports/annual");
    }
  },
};
