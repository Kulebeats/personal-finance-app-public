/**
 * Weekly Recap Module - Controller
 *
 * HTTP handlers for weekly recap dashboard.
 * Delegates to WeeklyRecapService for data aggregation.
 *
 * @module modules/weekly-recap/controller
 */

import { Request, Response, NextFunction } from "express";
import { weeklyRecapService } from "./weekly-recap.service";
import { logger } from "../../utils/logger";
import { z } from "zod";
import { businessAuditService } from "../../services/BusinessAuditService";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { NOTIFICATION_TYPES } from "@shared/notificationTypes";
import {
  weeklyRecapQuerySchema,
  generateRecapSchema,
} from "./weekly-recap.validation";
import { db } from "../../db";
import { and, eq } from "drizzle-orm";
import { userDisplaySettings, userNotificationPreferences } from "@shared/schema";

function success<T>(
  res: Response,
  data: T,
  message?: string,
  status = 200
): Response {
  return res.status(status).json({ success: true, data, message });
}

/**
 * Map day name to day number (0 = Sunday)
 */
const DAY_MAP: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

type WeeklyRecapStoredSettings = {
  dayOfWeek?: number;
  includeGoals?: boolean;
  includeRecurring?: boolean;
};

function getStoredWeeklyRecapSettings(
  dashboardWidgets: unknown
): WeeklyRecapStoredSettings {
  if (!dashboardWidgets || typeof dashboardWidgets !== "object") {
    return {};
  }

  const weeklyRecap = (dashboardWidgets as Record<string, unknown>)
    .weeklyRecap;
  if (!weeklyRecap || typeof weeklyRecap !== "object") {
    return {};
  }

  return weeklyRecap as WeeklyRecapStoredSettings;
}

/**
 * Helper to get week dates, respecting user's first day of week setting
 */
async function getWeekDates(
  userId: string,
  weekStart?: string,
  weekEnd?: string
): Promise<{ start: Date; end: Date }> {
  if (weekStart && weekEnd) {
    return { start: new Date(weekStart), end: new Date(weekEnd) };
  }

  // Get user's first day of week setting
  const settings = await db.query.userDisplaySettings.findFirst({
    where: (settings, { eq }) => eq(settings.userId, userId),
  });

  const firstDayOfWeek = settings?.firstDayOfWeek || "Sunday";
  const userFirstDay = DAY_MAP[firstDayOfWeek] ?? 0;

  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.

  // Calculate offset to get to the start of the week
  let offset = dayOfWeek - userFirstDay;
  if (offset < 0) offset += 7;

  const start = new Date(now);
  start.setDate(now.getDate() - offset);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

// CONTRACT-006: Accept both "wrap-up" (client) and "overall" (legacy) values
const feedbackSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  step: z.enum(["net-worth", "spending", "recurring", "goals", "wrap-up", "overall"]),
  feedback: z.enum(["positive", "negative"]),
});

const updateSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  dayOfWeek: z.number().min(0).max(6).optional(),
  includeGoals: z.boolean().optional(),
  includeRecurring: z.boolean().optional(),
});

export const weeklyRecapController = {
  /**
   * Get weekly recap with real analytics data
   */
  async getRecap(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const userId = req.session.userId!;
      const { weekStart, weekEnd } = req.query;

      const { start, end } = await getWeekDates(
        userId,
        weekStart as string,
        weekEnd as string
      );
      const from = formatDate(start);
      const to = formatDate(end);

      // Get real recap data from service
      const weeklyRecap = await weeklyRecapService.getRecap(
        householdId,
        userId,
        from,
        to
      );

      return success(res, weeklyRecap);
    } catch (error) {
      logger.error("GET /api/weekly-recap error", {}, error as Error);
      next(error);
    }
  },

  /**
   * Submit feedback on weekly recap
   */
  async submitFeedback(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.session.userId!;
      const parseResult = feedbackSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid feedback data" },
        });
      }

      // Log feedback (could store in DB for analytics later)
      logger.info("Weekly recap feedback", {
        userId: userId.substring(0, 8) + "...",
        ...parseResult.data,
      });

      // Audit logging (non-blocking)
      try {
        const household = await householdRepository.findByUserId(userId);
        if (household) {
          await businessAuditService.log({
            householdId: household.id,
            userId,
            action: "CREATE",
            entityType: "user",
            entityId: userId,
            details: {
              action: "weekly_recap_feedback",
              step: parseResult.data.step,
              feedback: parseResult.data.feedback,
              weekStart: parseResult.data.weekStart,
              weekEnd: parseResult.data.weekEnd,
            },
            ipAddress: businessAuditService.getIpAddress(req),
          });
        }
      } catch {
        // Non-blocking - audit failure shouldn't affect user flow
      }

      return success(res, { recorded: true }, "Feedback recorded");
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get user's weekly recap settings
   * GET /api/weekly-recap/settings
   */
  async getSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.session.userId!;

      const [prefs] = await db
        .select({
          inAppEnabled: userNotificationPreferences.inAppEnabled,
          emailEnabled: userNotificationPreferences.emailEnabled,
        })
        .from(userNotificationPreferences)
        .where(
          and(
            eq(userNotificationPreferences.userId, userId),
            eq(
              userNotificationPreferences.notificationType,
              NOTIFICATION_TYPES.WEEKLY_RECAP
            )
          )
        )
        .limit(1);

      const displaySettings = await db.query.userDisplaySettings.findFirst({
        where: (settings, { eq }) => eq(settings.userId, userId),
      });
      const stored = getStoredWeeklyRecapSettings(
        displaySettings?.dashboardWidgets
      );

      const settings = {
        enabled: prefs?.inAppEnabled ?? true,
        emailEnabled: prefs?.emailEnabled ?? false,
        dayOfWeek:
          stored.dayOfWeek ??
          DAY_MAP[displaySettings?.firstDayOfWeek ?? "Sunday"] ??
          0,
        includeGoals: stored.includeGoals ?? true,
        includeRecurring: stored.includeRecurring ?? true,
      };

      return success(res, settings);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Update user's weekly recap settings
   * PATCH /api/weekly-recap/settings
   */
  async updateSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.session.userId!;
      const parseResult = updateSettingsSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid settings data" },
        });
      }

      const data = parseResult.data;
      const [existingPrefs] = await db
        .select()
        .from(userNotificationPreferences)
        .where(
          and(
            eq(userNotificationPreferences.userId, userId),
            eq(
              userNotificationPreferences.notificationType,
              NOTIFICATION_TYPES.WEEKLY_RECAP
            )
          )
        )
        .limit(1);

      const currentDisplaySettings = await db.query.userDisplaySettings.findFirst({
        where: (settings, { eq }) => eq(settings.userId, userId),
      });
      const currentStored = getStoredWeeklyRecapSettings(
        currentDisplaySettings?.dashboardWidgets
      );

      const nextSettings = {
        enabled: data.enabled ?? existingPrefs?.inAppEnabled ?? true,
        emailEnabled: data.emailEnabled ?? existingPrefs?.emailEnabled ?? false,
        dayOfWeek:
          data.dayOfWeek ??
          currentStored.dayOfWeek ??
          DAY_MAP[currentDisplaySettings?.firstDayOfWeek ?? "Sunday"] ??
          0,
        includeGoals: data.includeGoals ?? currentStored.includeGoals ?? true,
        includeRecurring:
          data.includeRecurring ?? currentStored.includeRecurring ?? true,
      };

      if (existingPrefs) {
        await db
          .update(userNotificationPreferences)
          .set({
            inAppEnabled: nextSettings.enabled,
            emailEnabled: nextSettings.emailEnabled,
            updatedAt: new Date(),
          })
          .where(eq(userNotificationPreferences.id, existingPrefs.id));
      } else {
        await db.insert(userNotificationPreferences).values({
          userId,
          notificationType: NOTIFICATION_TYPES.WEEKLY_RECAP,
          inAppEnabled: nextSettings.enabled,
          emailEnabled: nextSettings.emailEnabled,
          pushEnabled: false,
        });
      }

      const existingDashboardWidgets =
        currentDisplaySettings?.dashboardWidgets &&
        typeof currentDisplaySettings.dashboardWidgets === "object"
          ? (currentDisplaySettings.dashboardWidgets as Record<
              string,
              unknown
            >)
          : {};
      const mergedDashboardWidgets = {
        ...existingDashboardWidgets,
        weeklyRecap: {
          dayOfWeek: nextSettings.dayOfWeek,
          includeGoals: nextSettings.includeGoals,
          includeRecurring: nextSettings.includeRecurring,
        },
      };

      const firstDayOfWeek = DAY_NAMES[nextSettings.dayOfWeek] ?? "Sunday";

      if (currentDisplaySettings) {
        await db
          .update(userDisplaySettings)
          .set({
            firstDayOfWeek,
            dashboardWidgets: mergedDashboardWidgets,
            updatedAt: new Date(),
          })
          .where(eq(userDisplaySettings.userId, userId));
      } else {
        await db.insert(userDisplaySettings).values({
          userId,
          firstDayOfWeek,
          dashboardWidgets: mergedDashboardWidgets,
        });
      }

      // Log the settings update
      logger.info("Weekly recap settings updated", {
        userId: userId.substring(0, 8) + "...",
        settings: data,
      });

      // Audit logging (non-blocking)
      try {
        const household = await householdRepository.findByUserId(userId);
        if (household) {
          await businessAuditService.log({
            householdId: household.id,
            userId,
            action: "UPDATE",
            entityType: "user",
            entityId: userId,
            details: {
              action: "weekly_recap_settings_update",
              settings: data,
            },
            ipAddress: businessAuditService.getIpAddress(req),
          });
        }
      } catch {
        // Non-blocking - audit failure shouldn't affect user flow
      }

      return success(res, nextSettings);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get historical weekly recaps
   * GET /api/weekly-recap/history
   */
  async getHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const userId = req.session.userId!;
      const parseResult = weeklyRecapQuerySchema.safeParse(req.query);

      if (!parseResult.success) {
        return res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid query parameters" },
        });
      }

      // Get past 8 weeks of recaps
      const history: Array<{
        weekStart: string;
        weekEnd: string;
        summary: {
          netWorth: Awaited<
            ReturnType<typeof weeklyRecapService.getRecap>
          >["netWorth"];
          spending: number;
        };
      }> = [];
      const now = new Date();

      for (let i = 0; i < 8; i++) {
        const weekEnd = new Date(now);
        weekEnd.setDate(now.getDate() - (i * 7));
        weekEnd.setHours(23, 59, 59, 999);

        const weekStart = new Date(weekEnd);
        weekStart.setDate(weekEnd.getDate() - 6);
        weekStart.setHours(0, 0, 0, 0);

        const from = formatDate(weekStart);
        const to = formatDate(weekEnd);

        try {
          const recap = await weeklyRecapService.getRecap(
            householdId,
            userId,
            from,
            to
          );
          history.push({
            weekStart: from,
            weekEnd: to,
            summary: {
              netWorth: recap.netWorth,
              spending: recap.spending?.total || 0,
            },
          });
        } catch (error) {
          logger.warn("Failed to fetch historical recap", { from, to, error });
        }
      }

      return success(res, { history });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Generate a weekly recap for a specific week
   * POST /api/weekly-recap/generate
   */
  async generateRecap(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const userId = req.session.userId!;
      const parseResult = generateRecapSchema.safeParse(req.body);

      if (!parseResult.success) {
        return res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid request data" },
        });
      }

      const { weekOf } = parseResult.data;

      // Calculate week range from weekOf date, respecting user settings
      const settings = await db.query.userDisplaySettings.findFirst({
        where: (settings, { eq }) => eq(settings.userId, userId),
      });

      const firstDayOfWeek = settings?.firstDayOfWeek || "Sunday";
      const userFirstDay = DAY_MAP[firstDayOfWeek] ?? 0;

      const date = new Date(weekOf);
      const dayOfWeek = date.getDay();

      // Calculate offset to get to the start of the week
      let offset = dayOfWeek - userFirstDay;
      if (offset < 0) offset += 7;

      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - offset);
      weekStart.setHours(0, 0, 0, 0);

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      const from = formatDate(weekStart);
      const to = formatDate(weekEnd);

      // Generate recap
      const recap = await weeklyRecapService.getRecap(
        householdId,
        userId,
        from,
        to
      );

      // Audit logging
      try {
        await businessAuditService.log({
          householdId,
          userId,
          action: "CREATE",
          entityType: "user",
          entityId: userId,
          details: {
            action: "weekly_recap_generated",
            weekStart: from,
            weekEnd: to,
          },
          ipAddress: businessAuditService.getIpAddress(req),
        });
      } catch {
        // Non-blocking
      }

      return success(res, recap);
    } catch (error) {
      next(error);
    }
  },
};
