import { Request, Response, NextFunction } from "express";
import { reportsExportService } from "./reports.export.service";
import {
  reportsExportsQuerySchema,
  exportReportSchema,
  reportsExportParamsSchema,
} from "./reports.validation";
import {
  resolveReportQuery,
  handleReportError,
  reportSuccess,
} from "./reports.utils";
import { businessAuditService } from "../../services/BusinessAuditService";
import { generateAuthorizedReportCsv } from "./reportCsvPublication";
import { NotFoundError, UnauthorizedError } from "../../core/errors";
import { createAuthorizedReportExport } from "./reportExportCreation";
import { listAuthorizedExportMetadata, readAuthorizedExportMetadata } from "./reportExportMetadata";

const exportSession = (req: Request) => {
  if (!req.user || req.session?.userId !== req.user.id) throw new UnauthorizedError("Authentication required");
  return { snapshot: structuredClone(req.user), sessionId: req.sessionID, generation: req.session.securityGeneration };
};
const exportError = (res: Response, error: unknown, context: string) => {
  if (error instanceof UnauthorizedError || error instanceof NotFoundError) return res.status(error.statusCode).json(error.toJSON());
  return handleReportError(res, error, context);
};

/** Every export type (list, create, metadata, download) runs under the
 * member's current `financial.export` grant via withReportExportAuthority.
 */
export const reportsExportsController = {
  async listExports(req: Request, res: Response, next: NextFunction) {
    try {
      const session = exportSession(req);
      const query = reportsExportsQuerySchema.parse(req.query);
      const result = await listAuthorizedExportMetadata(req.householdContext!, session, query);
      return reportSuccess(res, result);
    } catch (error) {
      return exportError(res, error, "GET /reports/exports");
    }
  },

  async createExport(req: Request, res: Response, next: NextFunction) {
    try {
      const body = exportReportSchema.parse(req.body);
      const session = exportSession(req);
      if (body.format !== "csv") {
        return res.status(400).json({
          success: false,
          error: { code: "UNSUPPORTED_FORMAT", message: "CSV only for now" },
        });
      }
      const resolvedBody = await resolveReportQuery(req, res, body);
      if (!resolvedBody) return res;

      const { scope, ...input } = resolvedBody;
      const result = await createAuthorizedReportExport(req.householdContext!, session, scope, input, businessAuditService.getIpAddress(req));
      return reportSuccess(res, result);
    } catch (error) {
      return exportError(res, error, "POST /reports/exports");
    }
  },

  async getExport(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const session = exportSession(req);
      const params = reportsExportParamsSchema.parse(req.params);
      const exportItem = await reportsExportService.getExportById(
        params.id,
        householdId,
        userId,
      );

      if (!exportItem) {
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Export not found" },
        });
      }

      if (req.query.download === "true") {
        return reportsExportsController.downloadExport(req, res, next);
      }
      const result = await readAuthorizedExportMetadata(req.householdContext!, session, params.id);
      return reportSuccess(res, result);
    } catch (error) {
      return exportError(res, error, "GET /reports/exports/:id");
    }
  },

  async downloadExport(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const session = exportSession(req);
      const params = reportsExportParamsSchema.parse(req.params);
      const exportItem = await reportsExportService.getExportById(
        params.id,
        householdId,
        userId,
      );

      if (!exportItem) {
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Export not found" },
        });
      }

      if (!exportItem.dateRangeStart || !exportItem.dateRangeEnd) {
        return res.status(400).json({
          success: false,
          error: { code: "INVALID_EXPORT", message: "Missing date range" },
        });
      }

      if (exportItem.fileFormat !== "csv") {
        return res.status(400).json({
          success: false,
          error: { code: "UNSUPPORTED_FORMAT", message: "CSV only for now" },
        });
      }

      // Authority, regeneration from stored parameters (FIX REPORTS-EXPORT-002)
      // and the DPA PROCESS audit (SCP-336) commit together before any bytes.
      const result = await generateAuthorizedReportCsv(req.householdContext!, exportItem.id, session, businessAuditService.getIpAddress(req));
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
      return res.send(result.content);
    } catch (error) {
      return exportError(
        res,
        error,
        "GET /reports/exports/:id?download=true",
      );
    }
  },
};
