/**
 * Weekly Recap Module - Controller
 *
 * HTTP handlers for weekly recap dashboard.
 * Delegates to WeeklyRecapService for data aggregation.
 *
 * @module modules/weekly-recap/controller
 */

import { Request, Response, NextFunction } from "express";
import { requireRecapRecipient, weeklyRecapService } from "./weekly-recap.service";
import { logger } from "../../utils/logger";
import { z } from "zod";
import { businessAuditService } from "../../services/BusinessAuditService";
import { resolveRequestHousehold } from "../../core/authz/session-preconditions";
import { ValidationError } from "../../core/errors";
import { getWeeklyRecapSettings, patchWeeklyRecapSettings } from "../../repositories/UserDisplayPreferences";
import {
  weeklyRecapQuerySchema,
  generateRecapSchema,
} from "./weekly-recap.validation";
import { readRecipientWorth, readRecipientWorthBatch } from "./recap-worth.reader";
import { parseRecapWeek, readRecapCalendar, recentWeeks, weekContaining, type RecapWeek } from "./recap-week";
import { feedbackSchema, recordRecapFeedback } from "./weekly-recap.feedback";

const HISTORY_WEEKS = 8;

function success<T>(
  res: Response,
  data: T,
  message?: string,
  status = 200
): Response {
  return res.status(status).json({ success: true, data, message });
}

/**
 * NEW-31 / R16.3: an explicit window must be exactly seven real dates; with
 * none, the current week of the household's calendar starts on the user's
 * first day of the week.
 */
async function requestedWeek(query: Request["query"], householdId: string, userId: string): Promise<RecapWeek> {
  const { weekStart, weekEnd } = query;
  if (weekStart === undefined && weekEnd === undefined) {
    const calendar = await readRecapCalendar(householdId, userId);
    return weekContaining(calendar.today, calendar.firstDay);
  }
  const week = parseRecapWeek(weekStart, weekEnd);
  if (!week) {
    throw new ValidationError("Invalid recap week", [{
      field: "weekEnd", message: "A recap week is seven consecutive dates (YYYY-MM-DD)",
    }]);
  }
  return week;
}

const updateSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
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
      const { from, to } = await requestedWeek(req.query, householdId, userId);

      // Get real recap data from service
      const weeklyRecap = await weeklyRecapService.getRecap(
        householdId,
        userId,
        from,
        to
      );

      await requireRecapRecipient(householdId, userId);
      weeklyRecap.netWorth = await readRecipientWorth(householdId, userId, from, to);
      return success(res, weeklyRecap);
    } catch (error) {
      logger.error("GET /api/weekly-recap error", {}, error as Error);
      next(error);
    }
  },

  /**
   * Submit feedback on weekly recap (NEW-31: stored as a structured row)
   */
  async submitFeedback(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const userId = req.session.userId!;
      const parseResult = feedbackSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid feedback data" },
        });
      }

      const { id } = await recordRecapFeedback(householdId, userId, parseResult.data,
        businessAuditService.getIpAddress(req));
      return success(res, { recorded: true, id }, "Feedback recorded");
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
      const settings = await getWeeklyRecapSettings(req.session.userId!);
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
      const nextSettings = await patchWeeklyRecapSettings(userId, data);

      // Log the settings update
      logger.info("Weekly recap settings updated", {
        userId: userId.substring(0, 8) + "...",
        settings: data,
      });

      // Audit logging (non-blocking)
      try {
        const household = await resolveRequestHousehold(req, userId);
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
   * Get historical weekly recaps: the current week of the household calendar
   * and the seven before it, each exactly seven dates.
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
      const weeks = recentWeeks(await readRecapCalendar(householdId, userId), HISTORY_WEEKS);

      for (const { from, to } of weeks) {
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
      }

      await requireRecapRecipient(householdId, userId);
      const worth = await readRecipientWorthBatch(householdId, userId, history.map(item => ({ from: item.weekStart, to: item.weekEnd })));
      history.forEach((item, index) => { item.summary.netWorth = worth[index]; });
      return success(res, { history });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Generate a weekly recap for the week that contains a date
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
      const { firstDay } = await readRecapCalendar(householdId, userId);
      const { from, to } = weekContaining(weekOf, firstDay);

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

      await requireRecapRecipient(householdId, userId);
      recap.netWorth = await readRecipientWorth(householdId, userId, from, to);
      return success(res, recap);
    } catch (error) {
      next(error);
    }
  },
};
