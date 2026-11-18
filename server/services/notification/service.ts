/**
 * Notification Service
 *
 * Core notification operations: notify, notifyHousehold, triggers, list/read.
 *
 * @module services/notification/service
 */

import { notificationRepository } from "../../repositories/NotificationRepository";
import { db } from "../../db";
import { Money } from "../../core/money";
import {
  userNotificationPreferences,
  userQuietHours,
  householdMembers,
  type Notification,
} from "@shared/schema";
import {
  NOTIFICATION_TYPES,
  type NotificationType,
} from "@shared/notificationTypes";
import { sendEmail } from "../emailService";
import { eq, and } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { buildEmailHtml } from "./email";
import { pushNotificationService } from "./push";

const HOUSEHOLD_NOTIFICATION_EXCLUDED_ROLES = new Set([
  "view_only",
  "professional",
]);

export interface NotifyData {
  title: string;
  body: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
}

/**
 * NotificationService
 *
 * Business logic for creating and managing notifications.
 * Handles preferences lookup, email delivery, and triggers.
 */
export class NotificationService {
  // ============================================================================
  // Core Methods
  // ============================================================================

  /**
   * Send a notification to a user
   * Respects user preferences and quiet hours
   */
  async notify(
    userId: string,
    householdId: string | null,
    type: NotificationType,
    data: NotifyData
  ): Promise<Notification | null> {
    const prefs = await this.getUserPreferences(userId, type);

    if (!prefs?.inAppEnabled && !prefs?.emailEnabled && !prefs?.pushEnabled) {
      logger.debug(`Notification ${type} skipped - all channels disabled for user`, {
        userId,
      });
      return null;
    }

    if (data.dedupeKey) {
      const alreadyExists = await notificationRepository.existsByDedupeKey(
        userId,
        data.dedupeKey
      );
      if (alreadyExists) {
        logger.debug(`Notification ${type} deduplicated`, {
          userId,
          dedupeKey: data.dedupeKey,
        });
        return null;
      }
    }

    let notification: Notification | null = null;

    if (prefs?.inAppEnabled) {
      notification = await notificationRepository.create({
        userId,
        householdId,
        type,
        title: data.title,
        body: data.body,
        actionUrl: data.actionUrl,
        metadata: data.metadata,
        dedupeKey: data.dedupeKey,
      });

      if (!notification && data.dedupeKey) {
        logger.debug(`Notification ${type} deduplicated`, {
          userId,
          dedupeKey: data.dedupeKey,
        });
        return null;
      }
    }

    if (prefs?.emailEnabled) {
      const inQuietHours = await this.isInQuietHours(userId);
      if (inQuietHours) {
        logger.debug(`Email suppressed - user in quiet hours`, {
          userId,
          type,
        });
      } else {
        await this.sendNotificationEmail(
          userId,
          type,
          data.title,
          data.body,
          data.actionUrl
        );
      }
    }

    if (prefs?.pushEnabled) {
      const inQuietHours = await this.isInQuietHours(userId);
      if (inQuietHours) {
        logger.debug(`Push notification suppressed - user in quiet hours`, {
          userId,
          type,
        });
      } else {
        await pushNotificationService.sendPushNotification(
          userId,
          type,
          data.title,
          data.body,
          data.actionUrl
        );
      }
    }

    return notification;
  }

  /**
   * Fan-out notification to all household members
   */
  async notifyHousehold(
    householdId: string,
    type: NotificationType,
    data: NotifyData
  ): Promise<number> {
    const members = await db
      .select({ userId: householdMembers.userId, role: householdMembers.role })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, householdId));

    let count = 0;
    for (const member of members) {
      if (
        member.userId &&
        !HOUSEHOLD_NOTIFICATION_EXCLUDED_ROLES.has(member.role)
      ) {
        const memberDedupeKey = data.dedupeKey
          ? `${data.dedupeKey}:user:${member.userId}`
          : undefined;

        const notification = await this.notify(
          member.userId,
          householdId,
          type,
          { ...data, dedupeKey: memberDedupeKey }
        );
        if (notification) count++;
      }
    }
    return count;
  }

  // ============================================================================
  // Trigger Methods
  // ============================================================================

  async triggerLargeTransaction(
    userId: string,
    householdId: string,
    transactionId: string,
    amount: number,
    merchantName: string
  ): Promise<void> {
    const prefs = await this.getUserPreferences(
      userId,
      NOTIFICATION_TYPES.LARGE_TRANSACTION
    );

    // Use Money class for comparison to avoid floating point issues
    const amountMoney = new Money(String(amount));
    const thresholdMoney = prefs?.thresholdAmount
      ? new Money(prefs.thresholdAmount)
      : new Money("500");

    if (amountMoney.lt(thresholdMoney)) return;

    const formattedAmount = new Intl.NumberFormat("en-ZM", {
      style: "currency",
      currency: "ZMW",
    }).format(amount);

    await this.notify(userId, householdId, NOTIFICATION_TYPES.LARGE_TRANSACTION, {
      title: "Large expense recorded",
      body: `${formattedAmount} at ${merchantName}`,
      actionUrl: "/transactions",
      metadata: { transactionId, amount, merchantName },
      dedupeKey: `large_transaction:${transactionId}`,
    });
  }

  async triggerBudgetAlert(
    householdId: string,
    budgetId: string,
    budgetName: string,
    percentUsed: number,
    alertLevel: "warning" | "alert" | "exceeded",
    year: number,
    month: number
  ): Promise<void> {
    const type =
      alertLevel === "warning"
        ? NOTIFICATION_TYPES.BUDGET_WARNING
        : NOTIFICATION_TYPES.BUDGET_EXCEEDED;

    const title =
      alertLevel === "warning"
        ? `Budget warning: ${budgetName}`
        : `Budget alert: ${budgetName}`;

    const body =
      percentUsed >= 100
        ? `You are at ${Math.round(percentUsed)}% of your budget`
        : `You have used ${Math.round(percentUsed)}% of your budget`;

    await this.notifyHousehold(householdId, type, {
      title,
      body,
      actionUrl: "/budget",
      metadata: { budgetId, percentUsed, alertLevel },
      dedupeKey: `budget:${budgetId}:${year}-${month}:${alertLevel}`,
    });
  }

  async triggerGoalMilestone(
    householdId: string,
    goalId: string,
    goalName: string,
    percentBefore: number,
    percentAfter: number
  ): Promise<void> {
    const normalizedBefore = Math.min(percentBefore, 100);
    const normalizedAfter = Math.min(percentAfter, 100);

    if (normalizedAfter <= normalizedBefore) return;

    const milestones = [25, 50, 75, 100];
    const crossed = milestones.filter(
      (m) => normalizedBefore < m && normalizedAfter >= m
    );

    if (crossed.length === 0) return;

    const milestone = Math.max(...crossed);

    if (milestone === 100) {
      await this.notifyHousehold(householdId, NOTIFICATION_TYPES.GOAL_ACHIEVED, {
        title: "Goal achieved!",
        body: `You completed "${goalName}"`,
        actionUrl: `/goals/${goalId}`,
        metadata: { goalId, percentComplete: percentAfter },
        dedupeKey: `goal:${goalId}:milestone:100`,
      });
      return;
    }

    await this.notifyHousehold(householdId, NOTIFICATION_TYPES.GOAL_PROGRESS, {
      title: `Goal progress: ${goalName}`,
      body: `You reached ${milestone}% of your goal`,
      actionUrl: `/goals/${goalId}`,
      metadata: { goalId, percentComplete: percentAfter, milestone },
      dedupeKey: `goal:${goalId}:milestone:${milestone}`,
    });
  }

  async triggerRecurringDue(
    householdId: string,
    recurringId: string,
    name: string,
    amount: number,
    dueDate: string
  ): Promise<void> {
    const formattedAmount = new Intl.NumberFormat("en-ZM", {
      style: "currency",
      currency: "ZMW",
    }).format(amount);

    const formattedDate = new Date(dueDate).toLocaleDateString("en-ZM", {
      month: "short",
      day: "numeric",
    });

    await this.notifyHousehold(householdId, NOTIFICATION_TYPES.RECURRING_DUE, {
      title: `Upcoming: ${name}`,
      body: `${name} for ${formattedAmount} is due on ${formattedDate}`,
      actionUrl: "/recurring",
      metadata: { recurringId, amount, dueDate },
      dedupeKey: `recurring:${recurringId}:${dueDate}`,
    });
  }

  async triggerNewLogin(
    userId: string,
    sessionId: string
  ): Promise<void> {
    await this.notify(userId, null, NOTIFICATION_TYPES.NEW_LOGIN, {
      title: "New login detected",
      body: "A new device signed in to your account. Review your active sessions for details.",
      actionUrl: "/settings/security/sessions",
      metadata: { sessionId },
      dedupeKey: `login:${sessionId}`,
    });
  }

  async triggerPasswordChanged(userId: string): Promise<void> {
    const timestamp = Date.now();
    await this.notify(userId, null, NOTIFICATION_TYPES.PASSWORD_CHANGED, {
      title: "Password changed",
      body: "Your password was updated successfully",
      actionUrl: "/settings/security",
      dedupeKey: `password_changed:${timestamp}`,
    });
  }

  // ============================================================================
  // List/Read Operations
  // ============================================================================

  async getNotifications(
    userId: string,
    options?: {
      limit?: number;
      offset?: number;
      unreadOnly?: boolean;
      includeArchived?: boolean;
    }
  ): Promise<Notification[]> {
    return await notificationRepository.findByUser(userId, options);
  }

  async getUnreadCount(userId: string): Promise<number> {
    return await notificationRepository.getUnreadCount(userId);
  }

  async markAsRead(id: string, userId: string): Promise<Notification | null> {
    return await notificationRepository.markAsRead(id, userId);
  }

  async markAllAsRead(userId: string): Promise<number> {
    return await notificationRepository.markAllAsRead(userId);
  }

  async archive(id: string, userId: string): Promise<Notification | null> {
    return await notificationRepository.archive(id, userId);
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  async getUserPreferences(
    userId: string,
    type: NotificationType
  ): Promise<{
    inAppEnabled: boolean;
    emailEnabled: boolean;
    pushEnabled: boolean;
    thresholdAmount?: string | null;
  } | null> {
    const [prefs] = await db
      .select()
      .from(userNotificationPreferences)
      .where(
        and(
          eq(userNotificationPreferences.userId, userId),
          eq(userNotificationPreferences.notificationType, type)
        )
      )
      .limit(1);

    if (!prefs) {
      return { inAppEnabled: true, emailEnabled: false, pushEnabled: false };
    }

    return {
      inAppEnabled: prefs.inAppEnabled ?? true,
      emailEnabled: prefs.emailEnabled ?? false,
      pushEnabled: prefs.pushEnabled ?? false,
      thresholdAmount: prefs.thresholdAmount,
    };
  }

  private async isInQuietHours(userId: string): Promise<boolean> {
    const [quietHours] = await db
      .select()
      .from(userQuietHours)
      .where(eq(userQuietHours.userId, userId))
      .limit(1);

    if (!quietHours?.enabled) return false;

    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now
      .getMinutes()
      .toString()
      .padStart(2, "0")}:00`;

    const start = quietHours.startTime;
    const end = quietHours.endTime;

    if (start > end) {
      return currentTime >= start || currentTime <= end;
    }
    return currentTime >= start && currentTime <= end;
  }

  private async sendNotificationEmail(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    actionUrl?: string
  ): Promise<void> {
    const { users } = await import("@shared/schema");
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user?.email) {
      logger.warn("Cannot send notification email - user email not found", {
        userId,
      });
      return;
    }

    const baseUrl = process.env.APP_URL || "http://localhost:5000";
    const fullActionUrl = actionUrl ? `${baseUrl}${actionUrl}` : null;
    const html = buildEmailHtml(title, body, fullActionUrl);

    try {
      await sendEmail({
        to: user.email,
        subject: title,
        html,
        text: `${title}\n\n${body}${
          fullActionUrl ? `\n\nView: ${fullActionUrl}` : ""
        }`,
      });
      logger.info(`Notification email sent`, { userId, type });
    } catch (error) {
      logger.error("Failed to send notification email", { userId, type, error });
    }
  }
}

export const notificationService = new NotificationService();
