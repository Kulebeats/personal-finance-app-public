/**
 * Push Notification Service
 *
 * Handles Web Push notifications using the Web Push protocol.
 * Supports subscription management and push message delivery.
 *
 * @module services/notification/push
 */

// @ts-expect-error - web-push doesn't have type definitions
import webpush from "web-push";
import { db } from "../../db";
import { and, eq } from "drizzle-orm";
import { logger } from "../../utils/logger";
import type { NotificationType } from "@shared/notificationTypes";

// Web Push subscription schema (stored in DB)
export interface PushSubscription {
  id: string;
  userId: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

// Configure Web Push with VAPID keys
const configureWebPush = () => {
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

  if (!vapidPublicKey || !vapidPrivateKey) {
    logger.warn("Web Push not configured - missing VAPID keys");
    return false;
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  return true;
};

// Check if push service is configured
export function isPushServiceConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

// Log configuration status on module load
const isConfigured = configureWebPush();
logger.info("Web Push configured", {
  configured: isConfigured ? "YES" : "NO",
});

/**
 * PushNotificationService
 *
 * Manages push notification subscriptions and delivery.
 */
export class PushNotificationService {
  /**
   * Save a push subscription for a user
   */
  async saveSubscription(
    userId: string,
    subscription: PushSubscriptionJSON
  ): Promise<void> {
    if (!subscription.endpoint || !subscription.keys) {
      throw new Error("Invalid push subscription");
    }

    try {
      const { userPushSubscriptions } = await import("@shared/schema");

      // Check if subscription already exists
      const [existing] = await db
        .select()
        .from(userPushSubscriptions)
        .where(eq(userPushSubscriptions.endpoint, subscription.endpoint))
        .limit(1);

      if (existing) {
        // Update existing subscription
        await db
          .update(userPushSubscriptions)
          .set({
            userId,
            keys: subscription.keys,
            updatedAt: new Date(),
          })
          .where(eq(userPushSubscriptions.endpoint, subscription.endpoint));
      } else {
        // Create new subscription
        await db.insert(userPushSubscriptions).values({
          userId,
          endpoint: subscription.endpoint,
          keys: subscription.keys,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      logger.info("Push subscription saved", { userId });
    } catch (error) {
      logger.error("Failed to save push subscription", { userId, error });
      throw error;
    }
  }

  /**
   * Remove a push subscription
   * FIX AUTH-NOTIF-PUSH-001: Verify ownership before deleting
   */
  async removeSubscription(endpoint: string, userId: string): Promise<void> {
    try {
      const { userPushSubscriptions } = await import("@shared/schema");

      // FIX AUTH-NOTIF-PUSH-001: Delete by both endpoint AND userId to prevent unauthorized unsubscribe
      const result = await db
        .delete(userPushSubscriptions)
        .where(
          and(
            eq(userPushSubscriptions.endpoint, endpoint),
            eq(userPushSubscriptions.userId, userId)
          )
        )
        .returning();

      if (result.length === 0) {
        logger.warn("Push subscription not found for user", { endpoint, userId });
      } else {
        logger.info("Push subscription removed", { endpoint, userId });
      }
    } catch (error) {
      logger.error("Failed to remove push subscription", { endpoint, userId, error });
      throw error;
    }
  }

  /**
   * Get all subscriptions for a user
   */
  async getUserSubscriptions(userId: string): Promise<PushSubscriptionJSON[]> {
    try {
      const { userPushSubscriptions } = await import("@shared/schema");

      const subscriptions = await db
        .select()
        .from(userPushSubscriptions)
        .where(eq(userPushSubscriptions.userId, userId));

      return subscriptions.map((sub) => ({
        endpoint: sub.endpoint,
        keys: sub.keys as { p256dh: string; auth: string },
      }));
    } catch (error) {
      logger.error("Failed to get user subscriptions", { userId, error });
      return [];
    }
  }

  /**
   * Send a push notification to a user
   */
  async sendPushNotification(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    actionUrl?: string
  ): Promise<boolean> {
    if (!isPushServiceConfigured()) {
      logger.debug("Push notification skipped - service not configured");
      return false;
    }

    try {
      const subscriptions = await this.getUserSubscriptions(userId);

      if (subscriptions.length === 0) {
        logger.debug("No push subscriptions for user", { userId });
        return false;
      }

      const payload = JSON.stringify({
        title,
        body,
        icon: "/icon-192x192.png",
        badge: "/badge-72x72.png",
        tag: type,
        data: {
          url: actionUrl,
          type,
        },
      });

      let successCount = 0;
      const failedEndpoints: string[] = [];

      // Send to all user's subscriptions
      for (const subscription of subscriptions) {
        try {
          await webpush.sendNotification(subscription, payload);
          successCount++;
        } catch (error) {
          logger.warn("Failed to send push to subscription", {
            userId,
            endpoint: subscription.endpoint,
            error,
          });

          // If subscription is no longer valid (410 Gone), remove it
          if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 410) {
            failedEndpoints.push(subscription.endpoint);
          }
        }
      }

      // Clean up invalid subscriptions
      for (const endpoint of failedEndpoints) {
        await this.removeSubscription(endpoint, userId);
      }

      if (successCount > 0) {
        logger.info("Push notifications sent", {
          userId,
          type,
          successCount,
          totalSubscriptions: subscriptions.length,
        });
        return true;
      }

      return false;
    } catch (error) {
      logger.error("Failed to send push notification", { userId, type, error });
      return false;
    }
  }
}

export const pushNotificationService = new PushNotificationService();

// Type for push subscription JSON
interface PushSubscriptionJSON {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}
