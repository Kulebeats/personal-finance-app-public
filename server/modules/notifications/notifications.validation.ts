/**
 * Notifications Module Validation Schemas
 *
 * Zod schemas for validating notification-related requests.
 *
 * @module modules/notifications/notifications.validation
 */

import { z } from "zod";

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
  unreadOnly: z.coerce.boolean().default(false),
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
