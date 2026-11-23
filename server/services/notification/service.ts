/**
 * Notification Service
 *
 * Core notification operations: notify, notifyHousehold, triggers, list/read.
 *
 * @module services/notification/service
 */

import { notificationRepository } from "../../repositories/NotificationRepository";
import { db } from "../../db";
import { runAfterCommit, withTransaction, type TransactionType } from "../../utils/withTransaction";
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
import { eq, and } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { pushNotificationService } from "./push";
import { budgetReviewMessage, canDispatchBudgetReview, publishBudgetReview } from "../budget/BudgetAlertPublication";
import { sendNotificationEmail } from "./email-channel";
import { isInQuietHours } from "./quiet-hours";
import {
  deliverOnce, hasDeliveryRecord, PRE_DISPATCH_FAILURE, reserveScheduledDelivery, resolveDeliveryEventKey, SCHEDULED_DISPATCH_READY,
  type ChannelResult, type DeliveryChannel, type DeliveryOutcome, type DeliveryStatus,
} from "./delivery";
import { HOUSEHOLD_NOTIFICATION_EXCLUDED_ROLES, goalProgressAudience } from "./audience";
import {
  EMAIL_OWNER_ONLY, publishRecurringNotice, recurringDispatchHold, type RecurringNoticeRef,
} from "./recurring-notice";
import { deliverRecurringDue } from "./recurring-delivery";

/** Identifiers only: the rule's content is read under each recipient's authorization. */
export type RecurringDueNotice = RecurringNoticeRef;

export interface NotifyData {
  title: string;
  body: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
  /** Prior ledger key for this recipient and event, if older deliveries can exist. */
  legacyDeliveryEventKey?: string;
  budgetReview?: { year: number; month: number };
  /** Title, body and metadata come from the bound read, not from the caller. */
  recurringNotice?: RecurringNoticeRef;
  /** No e-mail for this recipient; in-app and push are unaffected (REC a1). */
  emailSuppressed?: boolean;
  /** Only recurring and scheduled goal notices have automatic channel recovery. */
  scheduledRecovery?: boolean;
  assertScheduledWindow?: () => void;
  /**
   * The caller's last check, run before each channel and push device: a result
   * holds that send back, and says why. For the in-app row it runs with `tx`,
   * the transaction that writes the row, so it can lock what it reads.
   */
  dispatchHold?: (tx?: TransactionType) => Promise<ChannelResult | null>;
}

/** What one notify call actually did. */
export interface NotifyOutcome {
  /** The in-app row created by this call (legacy return of notify). */
  notification: Notification | null;
  /**
   * True only when this call produced a real outcome: an in-app row, or a channel that
   * accepted the message. A deduplicated repeat that sends nothing is false.
   */
  delivered: boolean;
  channels: Partial<Record<DeliveryChannel, DeliveryStatus>>;
}

/** Per-device check passed to the push transport. */
type PushGate = NonNullable<Parameters<typeof pushNotificationService.sendPushDetailed>[5]>;

const NOT_DELIVERED: NotifyOutcome = { notification: null, delivered: false, channels: {} };

/**
 * NotificationService
 *
 * Business logic for creating and managing notifications.
 * Handles preferences lookup, email delivery, and triggers.
 */
export class NotificationService {
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
    return (await this.notifyDetailed(userId, householdId, type, data)).notification;
  }

  /**
   * notify, reporting what actually happened. Each external channel is recorded in the
   * delivery ledger (event identity = dedupeKey, else a fresh id): sent, unknown and suppressed
   * channels are never resent, failed ones are retried when the same event is notified again.
   */
  async notifyDetailed(
    userId: string,
    householdId: string | null,
    type: NotificationType,
    data: NotifyData
  ): Promise<NotifyOutcome> {
    if (data.budgetReview && householdId) data = { ...budgetReviewMessage(userId, householdId, data.budgetReview.year, data.budgetReview.month), budgetReview: data.budgetReview };
    const review = data.budgetReview && householdId
      ? await publishBudgetReview(userId, householdId, data.budgetReview.year, data.budgetReview.month) : undefined;
    if (review && !review.admitted) return NOT_DELIVERED;
    const prefs = review?.preferences ?? await this.getUserPreferences(userId, type);

    if (!prefs?.inAppEnabled && !prefs?.emailEnabled && !prefs?.pushEnabled) {
      logger.debug(`Notification ${type} skipped - all channels disabled for user`, {
        userId,
      });
      return NOT_DELIVERED;
    }

    let deduplicated = !review && !!data.dedupeKey
      && await notificationRepository.existsByDedupeKey(userId, data.dedupeKey);
    const eventKey = await resolveDeliveryEventKey(userId, data.dedupeKey, data.legacyDeliveryEventKey);
    const reserve = !review && data.scheduledRecovery ? (tx: TransactionType) => {
      const channels: DeliveryChannel[] = [];
      if (prefs?.emailEnabled || data.emailSuppressed) channels.push("email");
      if (prefs?.pushEnabled) channels.push("push");
      return reserveScheduledDelivery(tx, userId, eventKey, channels);
    } : undefined;

    let notification: Notification | null = review?.notification ?? null;
    let created = false;
    const reviewScope = data.budgetReview && householdId ? { ...data.budgetReview, householdId } : undefined;
    const recurring = data.recurringNotice;
    let recurringHold: (() => Promise<ChannelResult | null>) | undefined;

    if (recurring) {
      // Content and this recipient's right to see it are one locked read; the in-app row is written in its transaction.
      const published = await publishRecurringNotice(
        userId, recurring, !!prefs?.inAppEnabled && !deduplicated, reserve, data.assertScheduledWindow);
      if (!published) return NOT_DELIVERED;
      data = { ...data, ...published.message };
      // Every later send re-reads the rule and goes out only with exactly this content.
      recurringHold = () => recurringDispatchHold(userId, recurring, published.content, data.assertScheduledWindow);
      notification = published.notification;
      created = notification !== null;
      if (!notification && prefs?.inAppEnabled) deduplicated = true;
    } else if (!review && prefs?.inAppEnabled && !deduplicated) {
      const row = { userId, householdId, type, title: data.title, body: data.body,
        actionUrl: data.actionUrl, metadata: data.metadata, dedupeKey: data.dedupeKey };
      const finalHold = data.dispatchHold;
      if (finalHold || reserve) {
        // The last check and the row commit together: a write to what it locked waits (#245 r4 P1).
        const written = await withTransaction(async (tx) => {
          if (await finalHold?.(tx)) return undefined;
          const createdRow = await notificationRepository.createInTransaction(tx, row);
          if (createdRow) await reserve?.(tx);
          return { row: createdRow };
        });
        if (!written) return NOT_DELIVERED;
        notification = written.row;
      } else {
        notification = await notificationRepository.create(row);
      }
      created = notification !== null;
      if (!notification && data.dedupeKey) deduplicated = true;
    }

    // A repeat of an event that predates the ledger has no rows: it was already delivered
    // by the old path, so it is not sent again.
    if (deduplicated && !(await hasDeliveryRecord(userId, eventKey))) {
      logger.debug(`Notification ${type} deduplicated`, { userId, dedupeKey: data.dedupeKey });
      return NOT_DELIVERED;
    }

    const dispatch = async (channel: DeliveryChannel, transport: () => Promise<ChannelResult>): Promise<DeliveryOutcome> => {
      if (review) {
        const result = await transport();
        return { status: result.status, attempted: true };
      }
      return deliverOnce(userId, eventKey, channel, transport, reserve ? { retrySuppressed: [SCHEDULED_DISPATCH_READY] } : undefined);
    };
    const quietHours: ChannelResult = { status: "suppressed", reason: "quiet_hours" };
    // Last check before a send: a recipient who lost sight of the rule, or whose bound
    // content no longer matches the rule, is skipped, and the ledger says why.
    const hold = recurringHold ?? data.dispatchHold;
    const held = async (): Promise<ChannelResult | null> => {
      try {
        return (await this.isInQuietHours(userId)) ? quietHours : (await hold?.()) ?? null;
      } catch (error) {
        if (!reserve) throw error;
        logger.warn("Scheduled notification gate failed before dispatch", { userId, error });
        return PRE_DISPATCH_FAILURE;
      }
    };
    // Checked again for every device: a send can take seconds per subscription.
    const pushGate: PushGate | undefined = reviewScope
      ? subscription => canDispatchBudgetReview(userId, reviewScope.householdId, reviewScope.year, reviewScope.month, { channel: "push", ...subscription })
      : hold && (async () => (await hold()) === null);

    // REC a1: a recurring notice always leaves its e-mail ledger row, whatever the member's
    // channel preferences, so the owner e-mail can tell it from a pre-ledger delivery.
    const recovery = reserve ? { retryBeforeDispatch: true, onDispatch: data.assertScheduledWindow } : undefined;
    const email = prefs?.emailEnabled || data.emailSuppressed
      ? await dispatch("email", async () => data.emailSuppressed ? EMAIL_OWNER_ONLY : (await held())
        ?? sendNotificationEmail(userId, type, data.title, data.body, data.actionUrl, reviewScope, recovery))
      : undefined;
    const push = prefs?.pushEnabled
      ? await dispatch("push", async () => (await held())
        ?? pushNotificationService.sendPushDetailed(
          userId, type, data.title, data.body, data.actionUrl, pushGate, recovery))
      : undefined;

    const externalSent = [email, push].some(outcome => outcome?.attempted && outcome.status === "sent");
    const result = review && !prefs.inAppEnabled && !externalSent ? null : notification;
    return {
      notification: result,
      delivered: review ? result !== null : created || externalSent,
      channels: { ...(email && { email: email.status }), ...(push && { push: push.status }) },
    };
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

        const outcome = await this.notifyDetailed(
          member.userId,
          householdId,
          type,
          { ...data, dedupeKey: memberDedupeKey }
        );
        if (outcome.delivered) count++;
      }
    }
    return count;
  }

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
    _budgetId: string,
    _budgetName: string,
    _percentUsed: number,
    _alertLevel: "warning" | "alert" | "exceeded",
    year: number,
    month: number,
    userId: string,
  ): Promise<boolean> {
    const [member] = await db.select({ role: householdMembers.role }).from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)));
    if (!member || HOUSEHOLD_NOTIFICATION_EXCLUDED_ROLES.has(member.role)) return false;
    // Budget alerts always take the review path, where "a notification came back" is the real
    // outcome, so this keeps calling notify (callers and tests wrap it).
    return (await this.notify(userId, householdId, NOTIFICATION_TYPES.BUDGET_WARNING, {
      ...budgetReviewMessage(userId, householdId, year, month),
      budgetReview: { year, month },
    })) !== null;
  }

  /**
   * Decides who hears of a goal milestone, then sends it without waiting.
   * A writer passes its own transaction: the audience is judged on the state
   * the write produces (#235 R2-1), and the send waits until that transaction
   * commits, so a rollback sends nothing (R3-1). A caller after commit passes
   * nothing and the send starts at once. An audience error fails the write.
   */
  async triggerGoalMilestone(
    householdId: string,
    goalId: string,
    goalName: string,
    percentBefore: number,
    percentAfter: number,
    tx?: TransactionType,
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
    const recipients = await goalProgressAudience(householdId, goalId, tx ?? db);
    if (recipients.length === 0) return;

    const [type, notice]: [NotificationType, NotifyData] = milestone === 100
      ? [NOTIFICATION_TYPES.GOAL_ACHIEVED, {
        title: "Goal achieved!",
        body: `You completed "${goalName}"`,
        actionUrl: `/goals/${goalId}`,
        metadata: { goalId, percentComplete: percentAfter },
        dedupeKey: `goal:${goalId}:milestone:100`,
      }]
      : [NOTIFICATION_TYPES.GOAL_PROGRESS, {
        title: `Goal progress: ${goalName}`,
        body: `You reached ${milestone}% of your goal`,
        actionUrl: `/goals/${goalId}`,
        metadata: { goalId, percentComplete: percentAfter, milestone },
        dedupeKey: `goal:${goalId}:milestone:${milestone}`,
      }];
    const send = () => {
      this.dispatchGoalMilestone(recipients, householdId, type, notice).catch((error: unknown) => {
        logger.error("Goal milestone notice failed", { householdId, goalId }, error instanceof Error ? error : undefined);
      });
    };
    if (tx) runAfterCommit(tx, send);
    else send();
  }

  /** Sends a milestone to an audience already decided (#235 M6, R2-1). */
  async dispatchGoalMilestone(
    recipients: readonly string[], householdId: string, type: NotificationType, data: NotifyData,
  ): Promise<number> {
    return this.notifyMembers(recipients, householdId, type, data);
  }

  /** Sends one notice to each of these members, with a dedupe key per member. */
  async notifyMembers(
    recipients: readonly string[], householdId: string, type: NotificationType, data: NotifyData,
  ): Promise<number> {
    let count = 0;
    for (const userId of recipients) {
      const dedupeKey = data.dedupeKey ? `${data.dedupeKey}:user:${userId}` : undefined;
      const outcome = await this.notifyDetailed(userId, householdId, type, { ...data, dedupeKey });
      if (outcome.delivered) count++;
    }
    return count;
  }

  /** Only members who can see the rule are told about it (FIN-01 / OPS-005). */
  async triggerRecurringDue(notice: RecurringDueNotice, assertWindow?: () => void): Promise<number> {
    const type = NOTIFICATION_TYPES.RECURRING_DUE;
    return deliverRecurringDue(notice, (id, data) => this.notifyDetailed(id, notice.householdId, type, data), {
      emailEnabled: async (id) => !!(await this.getUserPreferences(id, type))?.emailEnabled,
      inQuietHours: (id) => this.isInQuietHours(id),
      assertWindow,
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
    return isInQuietHours(userId);
  }
}

export const notificationService = new NotificationService();
