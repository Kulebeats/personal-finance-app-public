import { db } from "../db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  notifications,
  type InsertNotification,
  type Notification,
} from "@shared/schema";
import { isPostgresError } from "../utils/postgresError";

/**
 * NotificationRepository
 *
 * Data access layer for notifications table.
 * Handles CRUD operations and deduplication.
 */
class NotificationRepository {
  /**
   * Create a notification with dedupe check
   * Returns null if dedupe key already exists (duplicate)
   */
  async create(data: InsertNotification): Promise<Notification | null> {
    try {
      const [notification] = await db
        .insert(notifications)
        .values(data)
        .returning();
      return notification;
    } catch (error: unknown) {
      // Handle unique constraint violation for dedupe_key
      if (isPostgresError(error, "23505", "dedupe")) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Find notifications for a user with pagination
   */
  async findByUser(
    userId: string,
    options?: {
      limit?: number;
      offset?: number;
      unreadOnly?: boolean;
      includeArchived?: boolean;
    }
  ): Promise<Notification[]> {
    const limit = options?.limit ?? 20;
    const offset = options?.offset ?? 0;

    const conditions = [eq(notifications.userId, userId)];

    if (options?.unreadOnly) {
      conditions.push(eq(notifications.isRead, false));
    }

    if (!options?.includeArchived) {
      conditions.push(eq(notifications.isArchived, false));
    }

    return await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Get unread count for a user
   */
  async getUnreadCount(userId: string): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.isRead, false),
          eq(notifications.isArchived, false)
        )
      );
    return result?.count ?? 0;
  }

  /**
   * Mark a single notification as read
   */
  async markAsRead(id: string, userId: string): Promise<Notification | null> {
    const [notification] = await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning();
    return notification || null;
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string): Promise<number> {
    const result = await db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.isRead, false),
          eq(notifications.isArchived, false)
        )
      );
    return result.rowCount ?? 0;
  }

  /**
   * Archive a notification (soft delete)
   */
  async archive(id: string, userId: string): Promise<Notification | null> {
    const [notification] = await db
      .update(notifications)
      .set({ isArchived: true })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning();
    return notification || null;
  }

  /**
   * Check if a dedupe key exists for a user
   */
  async existsByDedupeKey(userId: string, dedupeKey: string): Promise<boolean> {
    const [result] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.dedupeKey, dedupeKey)
        )
      )
      .limit(1);
    return !!result;
  }

  /**
   * Find a notification by ID
   */
  async findById(id: string, userId: string): Promise<Notification | null> {
    const [notification] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .limit(1);
    return notification || null;
  }

  /**
   * Delete old archived notifications (retention policy)
   * Returns number of deleted records
   */
  async purgeArchived(olderThanDays: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await db
      .delete(notifications)
      .where(
        and(
          eq(notifications.isArchived, true),
          sql`${notifications.createdAt} < ${cutoffDate.toISOString()}`
        )
      );
    return result.rowCount ?? 0;
  }

  /**
   * Auto-archive old read notifications (data minimization)
   * Archives read notifications older than the specified days
   * Returns number of archived records
   */
  async autoArchiveOldRead(olderThanDays: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await db
      .update(notifications)
      .set({ isArchived: true })
      .where(
        and(
          eq(notifications.isArchived, false),
          eq(notifications.isRead, true),
          sql`${notifications.createdAt} < ${cutoffDate.toISOString()}`
        )
      );
    return result.rowCount ?? 0;
  }
}

export const notificationRepository = new NotificationRepository();
