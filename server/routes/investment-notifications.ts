import { Router } from "express";
import { db } from "../db";
import {
  userNotificationPreferences,
  investmentNotificationTypeEnum,
} from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { logger } from "../utils/logger";
import { generalLimiter } from "../middleware/rateLimit";
import { businessAuditService } from "../services/BusinessAuditService";
import { householdRepository } from "../repositories/HouseholdRepository";
import { requireAuth } from "../auth";

const router = Router();

// SEC-AUTH-001: Apply authentication and rate limiting to all routes
router.use(requireAuth);
router.use(generalLimiter);

const INVESTMENT_NOTIFICATION_TYPES = [
  "maturity_reminder",
  "coupon_payment",
  "price_alert",
  "stale_price",
  "auction_results",
];

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
        thresholdAmount: existing?.thresholdAmount || null,
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
  notificationType: z.enum(
    INVESTMENT_NOTIFICATION_TYPES as [string, ...string[]]
  ),
  inAppEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  thresholdAmount: z.number().optional().nullable(),
});

// PUT /api/investments/notifications/preferences
router.put("/preferences", async (req, res) => {
  // Auth already enforced by requireAuth middleware

  try {
    const data = updatePreferenceSchema.parse(req.body);

    const existing = await db
      .select()
      .from(userNotificationPreferences)
      .where(
        and(
          eq(userNotificationPreferences.userId, req.user!.id),
          eq(
            userNotificationPreferences.notificationType,
            data.notificationType
          )
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Update
      const [updated] = await db
        .update(userNotificationPreferences)
        .set({
          inAppEnabled: data.inAppEnabled,
          emailEnabled: data.emailEnabled,
          pushEnabled: data.pushEnabled,
          thresholdAmount: data.thresholdAmount
            ? String(data.thresholdAmount)
            : null,
          updatedAt: new Date(),
        })
        .where(eq(userNotificationPreferences.id, existing[0].id))
        .returning();

      // Audit logging (non-blocking)
      try {
        const household = await householdRepository.findByUserId(req.user!.id);
        if (household) {
          await businessAuditService.logUpdate({
            householdId: household.id,
            userId: req.user!.id,
            entityType: "user",
            entityId: existing[0].id,
            oldValue: {
              inAppEnabled: existing[0].inAppEnabled,
              emailEnabled: existing[0].emailEnabled,
              pushEnabled: existing[0].pushEnabled,
            },
            newValue: {
              inAppEnabled: data.inAppEnabled,
              emailEnabled: data.emailEnabled,
              pushEnabled: data.pushEnabled,
            },
            ipAddress: businessAuditService.getIpAddress(req),
            metadata: { action: "investment_notification_preference_update" },
          });
        }
      } catch {
        // Non-blocking - audit failure shouldn't affect user flow
      }

      res.json(updated);
    } else {
      // Insert
      const [inserted] = await db
        .insert(userNotificationPreferences)
        .values({
          userId: req.user!.id,
          notificationType: data.notificationType,
          inAppEnabled: data.inAppEnabled ?? true,
          emailEnabled: data.emailEnabled ?? true,
          pushEnabled: data.pushEnabled ?? false,
          thresholdAmount: data.thresholdAmount
            ? String(data.thresholdAmount)
            : null,
        })
        .returning();

      // Audit logging (non-blocking)
      try {
        const household = await householdRepository.findByUserId(req.user!.id);
        if (household) {
          await businessAuditService.logCreate({
            householdId: household.id,
            userId: req.user!.id,
            entityType: "user",
            entityId: inserted.id,
            newValue: {
              notificationType: data.notificationType,
              inAppEnabled: data.inAppEnabled ?? true,
              emailEnabled: data.emailEnabled ?? true,
              pushEnabled: data.pushEnabled ?? false,
            },
            ipAddress: businessAuditService.getIpAddress(req),
            metadata: { action: "investment_notification_preference_create" },
          });
        }
      } catch {
        // Non-blocking - audit failure shouldn't affect user flow
      }

      res.json(inserted);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    logger.error(
      "Error updating notification preference",
      { requestId: req.requestId },
      error as Error
    );
    res.status(500).json({ error: "Failed to update preference" });
  }
});

export default router;
