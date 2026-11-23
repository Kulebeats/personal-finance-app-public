/**
 * Notifications Module Validation Schemas
 *
 * Zod schemas for validating notification-related requests.
 *
 * @module modules/notifications/notifications.validation
 */

import { strictBooleanSchema } from "../../core/validation/query-boolean";
import { z } from "zod";
import { isValidTimeZone } from "../../services/notification/quiet-hours-window";

// Push subscription bodies (OPS-008). The endpoint rules live beside the send
// path so save-time and send-time checks share one definition.
export { pushSubscribeBodySchema, pushUnsubscribeBodySchema } from "../../services/notification/push-endpoint";

// ============================================================================
// Notification Type Enum
// ============================================================================

export const notificationTypeSchema = z.enum([
  "budget_alert",
  "goal_progress",
  "bill_reminder",
  "transaction_alert",
  "security_alert",
  "system",
  "weekly_recap",
]);

export const notificationPrioritySchema = z.enum([
  "low",
  "medium",
  "high",
  "urgent",
]);

// ============================================================================
// Create Notification Schema (Internal)
// ============================================================================

export const createNotificationSchema = z.object({
  userId: z.string().uuid(),
  type: notificationTypeSchema,
  title: z.string().min(1).max(200),
  body: z.string().max(1000),
  priority: notificationPrioritySchema.default("medium"),
  data: z.record(z.unknown()).optional(),
  actionUrl: z.string().max(500).optional(),
  expiresAt: z.coerce.date().optional(),
});

// ============================================================================
// Update Notification Schema
// ============================================================================

export const markAsReadSchema = z.object({
  notificationIds: z.array(z.string().uuid()).min(1).max(100),
});

export const dismissNotificationSchema = z.object({
  notificationId: z.string().uuid(),
});

// ============================================================================
// Query Schemas
// ============================================================================

export const notificationQuerySchema = z.object({
  type: notificationTypeSchema.optional(),
  unreadOnly: strictBooleanSchema.default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ============================================================================
// Type Exports
// ============================================================================

export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;
export type MarkAsReadInput = z.infer<typeof markAsReadSchema>;
export type DismissNotificationInput = z.infer<
  typeof dismissNotificationSchema
>;
export type NotificationQuery = z.infer<typeof notificationQuerySchema>;

// ============================================================================
// Quiet hours (R16.2): the user's own window, read in their IANA time zone
// ============================================================================

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM");

/** start > end is a window through midnight; start === end would be empty and is refused. */
export const quietHoursBodySchema = z
  .object({
    enabled: z.boolean(),
    startTime: timeOfDay,
    endTime: timeOfDay,
    timezone: z.string().min(1).max(64).refine(isValidTimeZone, "Unknown IANA time zone"),
  })
  .strict()
  .refine((body) => body.startTime !== body.endTime, { message: "Start and end must differ", path: ["endTime"] });
