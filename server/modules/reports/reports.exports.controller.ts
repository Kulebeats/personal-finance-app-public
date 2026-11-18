import { Request, Response, NextFunction } from "express";
import { reportsExportService } from "./reports.export.service";
import {
  reportsExportsQuerySchema,
  exportReportSchema,
  reportsExportParamsSchema,
  type ExportReportInput,
} from "./reports.validation";
import type { ReportScope } from "./reports.types";
import {
  resolveReportScope,
  resolveReportQuery,
  handleReportError,
  reportSuccess,
} from "./reports.utils";
import { businessAuditService } from "../../services/BusinessAuditService";

export const reportsExportsController = {
  async listExports(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId, role } = req.householdContext!;
      const query = reportsExportsQuerySchema.parse(req.query);
      const includeHousehold = role === "owner" || role === "admin";

      const result = await reportsExportService.listExports({
        householdId,
        userId,
        includeHousehold,
        status: query.status,
        limit: query.limit,
      });
      return reportSuccess(res, result);
    } catch (error) {
      return handleReportError(res, error, "GET /reports/exports");
    }
  },

  async createExport(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const body = exportReportSchema.parse(req.body);
      if (body.format !== "csv") {
        return res.status(400).json({
          success: false,
          error: { code: "UNSUPPORTED_FORMAT", message: "CSV only for now" },
        });
      }
      const resolvedBody = await resolveReportQuery(req, res, body);
      if (!resolvedBody) return res;

      const { scope, ...input } = resolvedBody;

      const result = await reportsExportService.createExport(
        householdId,
        userId,
        scope,
        input,
        businessAuditService.getIpAddress(req),
      );
      return reportSuccess(res, result);
    } catch (error) {
      return handleReportError(res, error, "POST /reports/exports");
    }
  },

  async getExport(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId, role } = req.householdContext!;
      const params = reportsExportParamsSchema.parse(req.params);
      const exportItem = await reportsExportService.getExportById(
        params.id,
        householdId,
      );

      if (!exportItem) {
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Export not found" },
        });
      }

      const isHouseholdAdmin = role === "owner" || role === "admin";
      if (!isHouseholdAdmin && exportItem.userId !== userId) {
        return res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: "Forbidden" },
        });
      }

      if (req.query.download === "true") {
        return reportsExportsController.downloadExport(req, res, next);
      }

      return reportSuccess(res, exportItem);
    } catch (error) {
      return handleReportError(res, error, "GET /reports/exports/:id");
    }
  },

  async downloadExport(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId, userId } = req.householdContext!;
      const params = reportsExportParamsSchema.parse(req.params);
      const exportItem = await reportsExportService.getExportById(
        params.id,
        householdId,
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

      // FIX REPORTS-EXPORT-002: Use stored parameters for reproducible downloads
      let scope: ReportScope;
      let exportInput: ExportReportInput;

      if (exportItem.parameters) {
        // Use stored parameters for reproducibility. createExport always stores
        // the resolved scope alongside the validated input, so it is present.
        const storedParams = exportItem.parameters as ExportReportInput & {
          scope: ReportScope;
        };
        scope = storedParams.scope;
        exportInput = {
          reportType: storedParams.reportType || exportItem.exportType,
          format: storedParams.format || exportItem.fileFormat,
          startDate: storedParams.startDate || exportItem.dateRangeStart,
          endDate: storedParams.endDate || exportItem.dateRangeEnd,
          includeCharts: storedParams.includeCharts || false,
          includeForecast: storedParams.includeForecast || false,
          forecastMonths: storedParams.forecastMonths || 3,
          // Restore original filters and preferences
          ...(storedParams.groupBy && { groupBy: storedParams.groupBy }),
          ...(storedParams.limit && { limit: storedParams.limit }),
          ...(storedParams.includePending !== undefined && { includePending: storedParams.includePending }),
          ...(storedParams.includeTransfers !== undefined && { includeTransfers: storedParams.includeTransfers }),
        } as ExportReportInput;
      } else {
        // Fallback for legacy exports without stored parameters
        const resolvedScope = resolveReportScope(req, res, {});
        if (!resolvedScope) return res;
        scope = resolvedScope.scope;

        exportInput = {
          reportType: exportItem.exportType,
          format: exportItem.fileFormat,
          startDate: exportItem.dateRangeStart!,
          endDate: exportItem.dateRangeEnd!,
          includeCharts: false,
          includeForecast: false,
          forecastMonths: 3,
        } as ExportReportInput;
      }

      const { content, fileName } =
        await reportsExportService.generateExportFile(
          householdId,
          userId,
          scope,
          exportInput,
        );

      // DPA audit (SCP-336): financial + PII data egress. Log the export event
      // (metadata only — never the exported rows) for data-export traceability.
      await businessAuditService.log({
        userId,
        householdId,
        action: "PROCESS",
        entityType: "data_export",
        entityId: exportItem.id,
        details: {
          exportType: exportItem.exportType,
          fileFormat: exportItem.fileFormat,
          recordCount: exportItem.recordCount,
          dateRangeStart: exportItem.dateRangeStart,
          dateRangeEnd: exportItem.dateRangeEnd,
          fileName,
        },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`,
      );
      return res.send(content);
    } catch (error) {
      return handleReportError(
        res,
        error,
        "GET /reports/exports/:id?download=true",
      );
    }
  },
};
