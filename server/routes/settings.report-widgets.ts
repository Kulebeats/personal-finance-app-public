import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { userRepository } from "../repositories/UserRepository";
import { logger } from "../utils/logger";
import { generalLimiter } from "../middleware/rateLimit";
import { InternalError, ValidationError } from "../core/errors";
import { businessAuditService } from "../services/BusinessAuditService";
import type {
  ReportWidgetPreferences,
  DisplaySettingsWithPreferences,
} from "@shared/schema";

const router = Router();

// Apply rate limiting to all routes in this file
router.use(generalLimiter);

// ============================================================================
// REPORT WIDGET PREFERENCES
// ============================================================================

/**
 * Default preferences for report widgets
 */
const DEFAULT_REPORT_WIDGET_PREFERENCES: ReportWidgetPreferences = {
  coreWidgets: {
    summaryCards: { enabled: true, order: 0, chartType: "cards" },
    goalProgress: { enabled: true, order: 1, chartType: "progressBars" },
    fixedVariableExpenses: { enabled: true, order: 2, chartType: "donut" },
  },
  optionalWidgets: {
    monthlyTrends: { enabled: true, order: 0, chartType: "bar" },
    netWorthTimeline: { enabled: true, order: 1, chartType: "area" },
    savingsRate: { enabled: true, order: 2, chartType: "line" },
    incomeBreakdown: { enabled: false, order: 3, chartType: "bar" },
    topMerchants: { enabled: false, order: 4, chartType: "bar" },
    categoryTrends: { enabled: false, order: 5, chartType: "line" },
    debtPaydown: { enabled: false, order: 6, chartType: "area" },
    sankeyFlow: { enabled: false, order: 7, chartType: "sankey" },
  },
  customCharts: [],
  hasCompletedWidgetSetup: false,
};

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

    // Cast to typed interface for safe access
    const typedSettings = displaySettings as DisplaySettingsWithPreferences | undefined;
    const preferences = typedSettings?.reportWidgetPreferences ?? DEFAULT_REPORT_WIDGET_PREFERENCES;

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
const reportWidgetPreferencesSchema = z.object({
  coreWidgets: z
    .record(
      z.object({
        enabled: z.boolean(),
        order: z.number().int().min(0),
        chartType: z.string(),
      })
    )
    .optional(),
  optionalWidgets: z
    .record(
      z.object({
        enabled: z.boolean(),
        order: z.number().int().min(0),
        chartType: z.string(),
      })
    )
    .optional(),
  customCharts: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        chartType: z.string(),
        primaryMetric: z.string(),
        secondaryMetric: z.string().optional(),
        groupBy: z.string().optional(),
        aggregation: z.string().optional(),
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

    // Get current settings
    let displaySettings = await userRepository.getDisplaySettings(
      req.session.userId!
    );

    if (!displaySettings) {
      // Create default settings first
      displaySettings = await userRepository.createDisplaySettings({
        userId: req.session.userId!,
        theme: "system",
        currency: "ZMW",
        numberFormat: "US",
        dateFormat: "MM/DD/YYYY",
        firstDayOfWeek: "Sunday",
        viewMode: "comfortable",
      });
    }

    // Cast to typed interface for safe access
    const typedSettings = displaySettings as DisplaySettingsWithPreferences;
    const currentPreferences = typedSettings.reportWidgetPreferences ?? DEFAULT_REPORT_WIDGET_PREFERENCES;

    // Merge with existing preferences
    const updatedPreferences: ReportWidgetPreferences = {
      ...currentPreferences,
      ...body,
      coreWidgets: body.coreWidgets
        ? { ...currentPreferences.coreWidgets, ...body.coreWidgets }
        : currentPreferences.coreWidgets,
      optionalWidgets: body.optionalWidgets
        ? { ...currentPreferences.optionalWidgets, ...body.optionalWidgets }
        : currentPreferences.optionalWidgets,
      customCharts: body.customCharts ?? currentPreferences.customCharts,
      hasCompletedWidgetSetup: body.hasCompletedWidgetSetup ?? currentPreferences.hasCompletedWidgetSetup,
    };

    // Update display settings with new widget preferences
    await userRepository.updateDisplaySettings(req.session.userId!, {
      reportWidgetPreferences: updatedPreferences,
    });

    // Log the preference update (non-financial, using standard logger)
    logger.info("Report widget preferences updated", {
      userId: req.session.userId?.substring(0, 8) + "...",
      requestId: req.requestId,
      changedFields: Object.keys(body),
    });

    // Audit log for compliance
    await businessAuditService.logUpdate({
      householdId: "user-settings",
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

export default router;
