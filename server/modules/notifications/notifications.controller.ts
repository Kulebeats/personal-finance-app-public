/**
 * Notifications Module - Controller
 *
 * HTTP handlers for user notifications.
 * Uses existing notificationService from services/NotificationService.
 *
 * @module modules/notifications/controller
 */

import { Request, Response, NextFunction } from "express";
import { notificationService } from "../../services/NotificationService";
import { notificationRepository } from "../../repositories/NotificationRepository";
import { createHash } from "crypto";
import { z } from "zod";
import { success } from "../../core/http";
import { ValidationError, NotFoundError } from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import { resolveRequestHousehold } from "../../core/authz/session-preconditions";
import { pushNotificationService } from "../../services/notification/push";
import { pushSubscribeBodySchema, pushUnsubscribeBodySchema } from "./notifications.validation";

const listQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  offset: z.coerce.number().min(0).optional().default(0),
  unreadOnly: z
    .preprocess((v) => v === "true" || v === "1" || v === true, z.boolean())
    .optional()
    .default(false),
  includeArchived: z
    .preprocess((v) => v === "true" || v === "1" || v === true, z.boolean())
    .optional()
    .default(false),
});

const markReadSchema = z.object({
  notificationIds: z.array(z.string().uuid()),
});

const batchReadSchema = z.object({
  notificationIds: z.array(z.string().uuid()).min(1).max(100),
});

const batchArchiveSchema = z.object({
  notificationIds: z.array(z.string().uuid()).min(1).max(100),
});

function hashPushEndpoint(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 16);
}

export const notificationsController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.session.userId!;
      const parseResult = listQuerySchema.safeParse(req.query);

      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid query parameters",
          parseResult.error.errors,
        );
      }

      const notifications = await notificationService.getNotifications(userId, {
        limit: parseResult.data.limit,
        offset: parseResult.data.offset,
        unreadOnly: parseResult.data.unreadOnly,
        includeArchived: parseResult.data.includeArchived,
      });

      success(res, notifications);
    } catch (error) {
      next(error);
    }
  },

  async getUnreadCount(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.session.userId!;
      const count = await notificationService.getUnreadCount(userId);
      success(res, { count });
    } catch (error) {
      next(error);
    }
  },

  async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.session.userId!;
      const { id } = req.params;

      if (!id || !z.string().uuid().safeParse(id).success) {
        throw new ValidationError("Invalid notification ID");
      }

      const notification = await notificationService.markAsRead(id, userId);
      if (!notification) {
        throw new NotFoundError("Notification");
      }

      // Audit logging (non-blocking)
      try {
        const household = await resolveRequestHousehold(req, userId);
        if (household) {
          await businessAuditService.logUpdate({
            householdId: household.id,
            userId,
            entityType: "user",
            entityId: id,
            newValue: { isRead: notification.isRead },
            ipAddress: businessAuditService.getIpAddress(req),
            metadata: { action: "notification_read" },
          });
        }
      } catch {
        // Non-blocking - audit failure shouldn't affect user flow
      }

      success(res, notification);
    } catch (error) {
      next(error);
    }
  },

  async markAllAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.session.userId!;
      const count = await notificationService.markAllAsRead(userId);

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
            details: { action: "mark_all_notifications_read", count },
            ipAddress: businessAuditService.getIpAddress(req),
          });
        }
      } catch {
        // Non-blocking - audit failure shouldn't affect user flow
      }

      success(res, { count }, 200, {
        message: `Marked ${count} notifications as read`,
      });
    } catch (error) {
      next(error);
    }
  },

  async archive(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.session.userId!;
      const { id } = req.params;

      if (!id || !z.string().uuid().safeParse(id).success) {
        throw new ValidationError("Invalid notification ID");
      }

      const notification = await notificationService.archive(id, userId);
      if (!notification) {
        throw new NotFoundError("Notification");
      }

      // Audit logging (non-blocking)
      try {
        const household = await resolveRequestHousehold(req, userId);
        if (household) {
          await businessAuditService.logDelete({
            householdId: household.id,
            userId,
            entityType: "user",
            entityId: id,
            ipAddress: businessAuditService.getIpAddress(req),
            metadata: { action: "notification_archived" },
          });
        }
      } catch {
        // Non-blocking - audit failure shouldn't affect user flow
      }

      success(res, notification, 200, { message: "Notification archived" });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get single notification by ID
   * GET /api/notifications/:id
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.session.userId!;
      const { id } = req.params;

      if (!id || !z.string().uuid().safeParse(id).success) {
        throw new ValidationError("Invalid notification ID");
      }

      const notification = await notificationRepository.findById(id, userId);
      if (!notification) {
        throw new NotFoundError("Notification");
      }

      success(res, notification);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Batch mark multiple notifications as read
   * PUT /api/notifications/batch-read
   */
  async batchMarkAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.session.userId!;
      const parseResult = batchReadSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      const { notificationIds } = parseResult.data;
      let count = 0;

      // Mark each notification as read
      for (const notificationId of notificationIds) {
        const notification = await notificationService.markAsRead(
          notificationId,
          userId
        );
        if (notification) {
          count++;
        }
      }

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
            details: { action: "batch_mark_read", notificationIds, count },
            ipAddress: businessAuditService.getIpAddress(req),
          });
        }
      } catch {
        // Non-blocking - audit failure shouldn't affect user flow
      }

      success(res, { count });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Batch archive multiple notifications
   * DELETE /api/notifications/batch-archive
   */
  async batchArchive(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.session.userId!;
      const parseResult = batchArchiveSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      const { notificationIds } = parseResult.data;
      let count = 0;

      // Archive each notification
      for (const notificationId of notificationIds) {
        const notification = await notificationService.archive(
          notificationId,
          userId
        );
        if (notification) {
          count++;
        }
      }

      // Audit logging (non-blocking)
      try {
        const household = await resolveRequestHousehold(req, userId);
        if (household) {
          await businessAuditService.log({
            householdId: household.id,
            userId,
            action: "DELETE",
            entityType: "user",
            entityId: userId,
            details: { action: "batch_archive", notificationIds, count },
            ipAddress: businessAuditService.getIpAddress(req),
          });
        }
      } catch {
        // Non-blocking - audit failure shouldn't affect user flow
      }

      success(res, { count });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Subscribe to push notifications
   * POST /api/notifications/push/subscribe
   */
  async subscribePush(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.session.userId!;
      // OPS-008: https, default port, no credentials, no IP literal, known push service.
      const parsed = pushSubscribeBodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError("Invalid push subscription", parsed.error.errors);
      }
      const { subscription } = parsed.data;

      await pushNotificationService.saveSubscription(userId, req.sessionID, subscription);

      // Audit logging (non-blocking). Store a hash, not the raw browser push endpoint.
      try {
        const household = await resolveRequestHousehold(req, userId);
        if (household) {
          const endpointHash = hashPushEndpoint(subscription.endpoint);
          await businessAuditService.logCreate({
            householdId: household.id,
            userId,
            entityType: "push_subscription",
            entityId: endpointHash,
            newValue: { endpointHash },
            ipAddress: businessAuditService.getIpAddress(req),
            metadata: { action: "push_subscription_saved" },
          });
        }
      } catch {
        // Non-blocking - audit failure shouldn't affect user flow
      }

      success(res, { message: "Push subscription saved" });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Unsubscribe from push notifications
   * DELETE /api/notifications/push/unsubscribe
   * FIX AUTH-NOTIF-PUSH-001: Verify ownership before deleting
   */
  async unsubscribePush(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = pushUnsubscribeBodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError("Endpoint is required", parsed.error.errors);
      }
      const { endpoint } = parsed.data;
      const userId = req.session.userId!;

      // FIX AUTH-NOTIF-PUSH-001: Pass userId to verify ownership
      await pushNotificationService.removeSubscription(endpoint, userId);

      // Audit logging (non-blocking). Store a hash, not the raw browser push endpoint.
      try {
        const household = await resolveRequestHousehold(req, userId);
        if (household) {
          const endpointHash = hashPushEndpoint(endpoint);
          await businessAuditService.logDelete({
            householdId: household.id,
            userId,
            entityType: "push_subscription",
            entityId: endpointHash,
            oldValue: { endpointHash },
            ipAddress: businessAuditService.getIpAddress(req),
            metadata: { action: "push_subscription_removed" },
          });
        }
      } catch {
        // Non-blocking - audit failure shouldn't affect user flow
      }

      success(res, { message: "Push subscription removed" });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get VAPID public key for push notifications
   * GET /api/notifications/push/vapid-key
   */
  async getVapidKey(req: Request, res: Response, next: NextFunction) {
    try {
      const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;

      // Feature off, not an error: push is simply not configured on this server.
      if (!vapidPublicKey) {
        success(res, { configured: false, publicKey: null });
        return;
      }

      success(res, { configured: true, publicKey: vapidPublicKey });
    } catch (error) {
      next(error);
    }
  },
};
