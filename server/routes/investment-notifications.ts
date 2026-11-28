import { Router } from "express";
import { db } from "../db";
import {
  userNotificationPreferences,
} from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { logger } from "../utils/logger";
import { businessAuditService } from "../services/BusinessAuditService";
import { resolveRequestHousehold } from "../core/authz/session-preconditions";
import { requireAuth } from "../auth";
import { INVESTMENT_NOTIFICATION_PREFERENCE_TYPES } from "@shared/notificationTypes";
import { saveInvestmentNotificationPreference } from "../modules/settings/settings.investment-preferences.service";
import { notificationThresholdSchema } from "../modules/settings/settings.validation";
import { HttpError } from "../core/errors";

const router = Router();

// SEC-AUTH-001: Apply authentication and rate limiting to all routes
router.use(requireAuth);

const INVESTMENT_NOTIFICATION_TYPES = [...INVESTMENT_NOTIFICATION_PREFERENCE_TYPES];

// GET /api/investments/notifications/preferences
router.get("/preferences", async (req, res) => {
  // Auth already enforced by requireAuth middleware

  try {
    const preferences = await db
      .select()
      .from(userNotificationPreferences)
      .where(
        and(
          eq(userNotificationPreferences.userId, req.user!.id),
          inArray(
            userNotificationPreferences.notificationType,
            INVESTMENT_NOTIFICATION_TYPES
          )
        )
      );

    // If no preferences found, return defaults/empty list or create default map?
    // Client can handle empty list by assuming defaults.
    // Or we can construct a response that ensures all types are present with defaults.

    const response = INVESTMENT_NOTIFICATION_TYPES.map((type) => {
      const existing = preferences.find((p) => p.notificationType === type);
      return {
        notificationType: type,
        inAppEnabled: existing?.inAppEnabled ?? true,
        emailEnabled: existing?.emailEnabled ?? true,
        pushEnabled: existing?.pushEnabled ?? false,
        thresholdAmount: existing?.thresholdAmount ?? null,
      };
    });

    res.json(response);
  } catch (error) {
    logger.error(
      "Error fetching notification preferences",
      { requestId: req.requestId },
      error as Error
    );
    res.status(500).json({ error: "Failed to fetch preferences" });
  }
});

const updatePreferenceSchema = z.object({
  notificationType: z.enum(INVESTMENT_NOTIFICATION_PREFERENCE_TYPES),
  inAppEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  // NEW-26: the same exact decimal(15,2) rule as the general notification writer; never a float.
  thresholdAmount: notificationThresholdSchema.optional().nullable(),
});

// PUT /api/investments/notifications/preferences
router.put("/preferences", async (req, res, next) => {
  // Auth already enforced by requireAuth middleware

  try {
    const data = updatePreferenceSchema.parse(req.body);
    const household = await resolveRequestHousehold(req, req.user!.id);
    // NEW-26: the write and its audit row commit in one transaction; an audit failure rolls back and 500s.
    const { updated } = await saveInvestmentNotificationPreference({
      userId: req.user!.id,
      householdId: household?.id ?? null,
      ipAddress: businessAuditService.getIpAddress(req),
    }, data);

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    // A deliberate refusal (409 session context changed, 400 bad context header, 404) keeps its status.
    if (error instanceof HttpError) return next(error);
    logger.error(
      "Error updating notification preference",
      { requestId: req.requestId },
      error as Error
    );
    res.status(500).json({ error: "Failed to update preference" });
  }
});

export default router;
