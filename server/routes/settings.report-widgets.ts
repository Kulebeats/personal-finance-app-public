import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { CUSTOM_CHART_PERIODS } from "@shared/reports";
import { userRepository } from "../repositories/UserRepository";
import { logger } from "../utils/logger";
import { InternalError, ValidationError } from "../core/errors";
import { businessAuditService } from "../services/BusinessAuditService";
import { patchReportWidgetPreferences, resetReportWidgetPreferences } from "../repositories/UserDisplayPreferences";
import { reportWidgetPreferences } from "../repositories/ReportWidgetPreferences";

const router = Router();

// Apply rate limiting to all routes in this file

// ============================================================================
// REPORT WIDGET PREFERENCES
// ============================================================================

/**
 * GET /api/settings/report-widgets
 * Get user report widget preferences
 */
router.get(
  "/report-widgets",
  async (req: Request, res: Response, next: NextFunction) => {
  try {
    const displaySettings = await userRepository.getDisplaySettings(
      req.session.userId!
    );

    const preferences = reportWidgetPreferences(displaySettings?.reportWidgetPreferences);

    res.json({
      success: true,
      data: { preferences },
    });
  } catch (error) {
    logger.error(
      "Get report widget preferences error",
      {
        requestId: req.requestId,
        userId: req.session.userId?.substring(0, 8) + "...",
      },
      error as Error
    );
    return next(new InternalError("Failed to get report widget preferences"));
  }
});

/**
 * PATCH /api/settings/report-widgets
 * Update user report widget preferences
 */
const widgetPatchesSchema = z.record(z.object({
  id: z.string().optional(),
  enabled: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
  chartType: z.string().optional(),
  expanded: z.boolean().optional(),
})).superRefine((widgets, context) => {
  for (const [key, widget] of Object.entries(widgets)) {
    if (widget.id !== undefined && widget.id !== key) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [key, "id"], message: "Widget id must match its map key" });
    }
  }
});

const reportWidgetPreferencesSchema = z.object({
  coreWidgets: widgetPatchesSchema.optional(),
  optionalWidgets: widgetPatchesSchema.optional(),
  customCharts: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        chartType: z.string(),
        primaryMetric: z.string(),
        secondaryMetric: z.string().optional(),
        groupBy: z.string().optional(),
        period: z.enum(CUSTOM_CHART_PERIODS).optional(),
        aggregation: z.string().optional(),
        showAverage: z.boolean().optional(),
        showComparison: z.boolean().optional(),
        createdAt: z.string().optional(),
        order: z.number().int().min(0),
      })
    )
    .max(10)
    .optional(),
  hasCompletedWidgetSetup: z.boolean().optional(),
});

router.patch(
  "/report-widgets",
  async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = reportWidgetPreferencesSchema.safeParse(req.body);
    if (!parseResult.success) {
      return next(
        new ValidationError("Invalid input", parseResult.error.errors)
      );
    }
    const body = parseResult.data;

    const updatedPreferences = await patchReportWidgetPreferences(req.session.userId!, body);

    // Log the preference update (non-financial, using standard logger)
    logger.info("Report widget preferences updated", {
      userId: req.session.userId?.substring(0, 8) + "...",
      requestId: req.requestId,
      changedFields: Object.keys(body),
    });

    // Audit log for compliance
    await businessAuditService.logUpdate({
      householdId: null,
      userId: req.session.userId!,
      entityType: "display_settings",
      entityId: req.session.userId!,
      newValue: body,
      ipAddress: businessAuditService.getIpAddress(req),
    });

    res.json({
      success: true,
      data: { preferences: updatedPreferences },
      message: "Report widget preferences updated successfully",
    });
  } catch (error) {
    // Re-throw HttpErrors (ValidationError, etc.) to be handled by error middleware
    if (error instanceof ValidationError) {
      return next(error);
    }

    logger.error(
      "Update report widget preferences error",
      {
        requestId: req.requestId,
        userId: req.session.userId?.substring(0, 8) + "...",
      },
      error as Error
    );
    return next(new InternalError("Failed to update report widget preferences"));
  }
});

const resetReportWidgetPreferencesSchema = z.object({}).strict();

/** Restore the existing report layout defaults while keeping saved charts. */
router.post("/report-widgets/reset", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = resetReportWidgetPreferencesSchema.safeParse(req.body === undefined ? {} : req.body);
    if (!parseResult.success) {
      return next(new ValidationError("Invalid input", parseResult.error.errors));
    }

    const updatedPreferences = await resetReportWidgetPreferences(req.session.userId!);
    await businessAuditService.logUpdate({
      householdId: null,
      userId: req.session.userId!,
      entityType: "display_settings",
      entityId: req.session.userId!,
      newValue: { coreWidgets: updatedPreferences.coreWidgets, optionalWidgets: updatedPreferences.optionalWidgets },
      ipAddress: businessAuditService.getIpAddress(req),
    });
    logger.info("Report widget layout reset", {
      userId: req.session.userId?.substring(0, 8) + "...",
      requestId: req.requestId,
    });
    res.json({
      success: true,
      data: { preferences: updatedPreferences },
      message: "Report widget layout reset successfully",
    });
  } catch (error) {
    if (error instanceof ValidationError) return next(error);
    logger.error("Reset report widget layout error", {
      requestId: req.requestId,
      userId: req.session.userId?.substring(0, 8) + "...",
    }, error as Error);
    return next(new InternalError("Failed to reset report widget layout"));
  }
});

export default router;
