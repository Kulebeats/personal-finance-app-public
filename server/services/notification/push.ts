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
import { ValidationError } from "../../core/errors";
import { checkPushEndpoint, describePushEndpoint, pushAgent, PUSH_SEND_TIMEOUT_MS } from "./push-endpoint";
import { PRE_DISPATCH_FAILURE, type ChannelResult } from "./delivery";
import { isDispatchableSubscription, saveSessionSubscription } from "./push-subscriptions";

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
   * Save this browser's push subscription for the session that sends it. An
   * endpoint another user registered is removed from them, never handed over.
   */
  async saveSubscription(
    userId: string,
    sessionId: string,
    subscription: PushSubscriptionJSON
  ): Promise<void> {
    if (!subscription.endpoint || !subscription.keys) {
      throw new ValidationError("Invalid push subscription");
    }
    // OPS-008: the controller validates too; this keeps every caller of the service safe.
    const check = checkPushEndpoint(subscription.endpoint);
    if (!check.ok) throw new ValidationError(`Invalid push subscription: ${check.reason}`);

    try {
      await saveSessionSubscription(userId, sessionId, subscription);
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
        logger.warn("Push subscription not found for user", { endpointOrigin: describePushEndpoint(endpoint), userId });
      } else {
        logger.info("Push subscription removed", { endpointOrigin: describePushEndpoint(endpoint), userId });
      }
    } catch (error) {
      logger.error("Failed to remove push subscription", { endpointOrigin: describePushEndpoint(endpoint), userId, error });
      throw error;
    }
  }

  /**
   * Get all subscriptions for a user
   */
  async getUserSubscriptions(userId: string, throwOnFailure = false): Promise<PushSubscriptionJSON[]> {
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
      if (throwOnFailure) throw error;
      return [];
    }
  }

  /** True when at least one subscription accepted the push. */
  async sendPushNotification(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    actionUrl?: string,
    canDispatch?: (subscription: PushSubscriptionJSON) => Promise<boolean>
  ): Promise<boolean> {
    return (await this.sendPushDetailed(userId, type, title, body, actionUrl, canDispatch)).status === "sent";
  }

  /**
   * Send a push notification to all of a user's subscriptions and report one channel outcome:
   * sent (any subscription accepted it), else unknown (a connection error or timeout: the push
   * may have arrived), else failed (every attempt was rejected with an HTTP status), else
   * suppressed (not configured, no subscription, or nothing was dispatchable).
   */
  async sendPushDetailed(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    actionUrl?: string,
    canDispatch?: (subscription: PushSubscriptionJSON) => Promise<boolean>,
    recovery?: { retryBeforeDispatch: boolean },
  ): Promise<ChannelResult> {
    if (!isPushServiceConfigured()) {
      logger.debug("Push notification skipped - service not configured");
      return { status: "suppressed", reason: "push_not_configured" };
    }

    const retryBeforeDispatch = recovery?.retryBeforeDispatch ?? false;
    let handoffStarted = false;
    let successCount = 0;
    let rejectedCount = 0;
    let unreachableCount = 0;
    try {
      const subscriptions = await this.getUserSubscriptions(userId, retryBeforeDispatch);

      if (subscriptions.length === 0) {
        logger.debug("No push subscriptions for user", { userId });
        return { status: "suppressed", reason: "no_subscription" };
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

      const failedEndpoints: string[] = [];
      // The row may have been removed (sign-out, revoke, another user registered
      // the endpoint) or its session ended since the list was read.
      const isGateOpen = async (subscription: (typeof subscriptions)[number]): Promise<boolean> =>
        await isDispatchableSubscription(userId, subscription) && (!canDispatch || await canDispatch(subscription));

      // Send to all user's subscriptions
      for (const subscription of subscriptions) {
        // OPS-008: re-check the stored endpoint before any connection. A row that
        // fails (saved before the guard, or the allow-list narrowed) is skipped,
        // logged by origin only, and disabled by removing it.
        const check = checkPushEndpoint(subscription.endpoint);
        if (!check.ok) {
          logger.warn("Push subscription skipped and disabled: endpoint failed validation", {
            userId,
            endpointOrigin: describePushEndpoint(subscription.endpoint),
            reason: check.reason,
          });
          failedEndpoints.push(subscription.endpoint);
          continue;
        }
        // Scheduled notifications distinguish a gate fault from a transport fault:
        // their gates run outside the send's try, so a gate that throws is a
        // pre-dispatch failure the period can retry.
        if (retryBeforeDispatch && !await isGateOpen(subscription)) continue;
        try {
          if (!retryBeforeDispatch && !await isGateOpen(subscription)) continue;
          // pushAgent refuses non-public resolved addresses; web-push never follows redirects.
          handoffStarted = true;
          await webpush.sendNotification(subscription, payload, { agent: pushAgent, timeout: PUSH_SEND_TIMEOUT_MS });
          successCount++;
        } catch (error) {
          logger.warn("Failed to send push to subscription", {
            userId,
            endpointOrigin: describePushEndpoint(subscription.endpoint),
            // WebPushError carries the full endpoint; log only its status and message.
            statusCode: error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : undefined,
            message: error instanceof Error ? error.message : String(error),
          });

          const hasStatus = !!error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number";
          if (hasStatus) rejectedCount++;
          else unreachableCount++;

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
        return { status: "sent" };
      }
      if (unreachableCount > 0) return { status: "unknown", reason: "push_unreachable" };
      if (rejectedCount > 0) return { status: "failed", reason: "push_rejected" };
      return { status: "suppressed", reason: "nothing_dispatchable" };
    } catch (error) {
      logger.error("Failed to send push notification", { userId, type, error });
      if (retryBeforeDispatch && successCount > 0) return { status: "sent" };
      if (retryBeforeDispatch && !handoffStarted) return PRE_DISPATCH_FAILURE;
      if (retryBeforeDispatch && unreachableCount === 0 && rejectedCount > 0) return { status: "failed", reason: "push_rejected" };
      return { status: "unknown", reason: "push_service_error" };
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
