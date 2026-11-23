/**
 * Outbox Event Service
 *
 * Implements the Outbox Pattern for reliable event publishing.
 * Events are stored in the database and processed asynchronously.
 *
 * @module core/events/outbox
 */

import { db } from "../../db";
import {
  outboxEvents,
  type InsertOutboxEvent,
  type OutboxEvent,
} from "../../../shared/schema";
import { eq, and, lte, or, sql } from "drizzle-orm";
import { logger } from "../../utils/logger";
import type { TransactionType } from "../../utils/withTransaction";
import { EventTypes } from "./eventTypes";

// Re-export EventTypes from centralized location for backwards compatibility
export { EventTypes } from "./eventTypes";

/**
 * ARCHITECTURE: Outbox Pattern
 *
 * The Outbox Pattern ensures reliable event delivery by:
 * 1. Storing events in the same database transaction as the business data
 * 2. Processing events asynchronously via a background worker
 * 3. Retrying failed events with exponential backoff
 * 4. Moving permanently failed events to a dead letter queue for review
 *
 * Generic handlers use at-least-once delivery. Security notices use a separate
 * fenced dispatcher: a possibly dispatched outcome is unknown, never blindly
 * retried by these generic state helpers.
 */

/**
 * BUSINESS RULE: Exponential Backoff Retry
 *
 * Retry delays grow exponentially to avoid overwhelming failing services:
 * - Retry 1: 2 seconds
 * - Retry 2: 4 seconds
 * - Retry 3: 8 seconds
 * - Retry 4: 16 seconds
 * - Retry 5: 32 seconds (capped at 5 minutes)
 *
 * After 5 failed attempts, events move to dead_letter for manual intervention.
 */
function calculateNextRetry(retryCount: number): Date {
  const baseDelayMs = 1000; // 1 second
  const maxDelayMs = 300000; // 5 minutes max to prevent very long waits
  const delay = Math.min(baseDelayMs * Math.pow(2, retryCount), maxDelayMs);
  return new Date(Date.now() + delay);
}

/**
 * Outbox Event Service
 */
class OutboxEventService {
  /**
   * Publish an event to the outbox.
   *
   * ATOMICITY (CLAUDE.md Rule 10 / Rule 14): pass the caller's `tx` whenever the
   * business write that the event describes is itself transactional. The outbox
   * row is then inserted on the SAME connection, inside the SAME transaction, so
   * the write and its event commit or roll back as one unit — which is the entire
   * point of the outbox pattern. The relay (getPendingEvents → markProcessing →
   * markCompleted) ships it afterwards.
   *
   * Without `tx` the insert runs on its own pooled connection and commits
   * independently of the caller's transaction. That reintroduces the two failure
   * modes the pattern exists to prevent:
   *   - LOST EVENT: the business row commits, the process dies before/while
   *     publishing, and no event is ever emitted.
   *   - ORPHAN EVENT: the event commits but the business transaction then rolls
   *     back, emitting an event for a row that does not exist.
   *
   * `tx` is therefore the correct call for any publish inside withTransaction.
   * Omitting it remains supported for callers that legitimately have no
   * surrounding transaction (their write already committed separately).
   *
   * @param event - The event to publish.
   * @param tx - Optional caller transaction to enlist in. Strongly preferred when
   *   the business write is transactional.
   */
  async publish(
    event: {
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      householdId?: string;
      payload: Record<string, unknown>;
    },
    tx?: TransactionType,
  ): Promise<OutboxEvent> {
    // Enlist in the caller's transaction when given one; otherwise fall back to
    // the pool (independent commit — see the atomicity note above).
    const executor = tx ?? db;

    const [created] = await executor
      .insert(outboxEvents)
      .values({
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        householdId: event.householdId,
        payload: event.payload,
        status: "pending",
        retryCount: 0,
        maxRetries: 5,
      })
      .returning();

    logger.debug("Event published to outbox", {
      eventId: created.id,
      eventType: event.eventType,
    });

    return created;
  }

  /**
   * Get pending events ready for processing
   */
  async getPendingEvents(limit = 10): Promise<OutboxEvent[]> {
    const now = new Date();
    return db
      .select()
      .from(outboxEvents)
      .where(
        and(
          or(
            and(sql`${outboxEvents.eventType} <> ${EventTypes.SECURITY_NOTICE_REQUESTED}`, eq(outboxEvents.status, "pending")),
            and(
              eq(outboxEvents.status, "failed"),
              sql`${outboxEvents.eventType} <> ${EventTypes.SECURITY_NOTICE_REQUESTED}`, lte(outboxEvents.nextRetryAt, now)
            ),
            and(eq(outboxEvents.eventType, EventTypes.SECURITY_NOTICE_REQUESTED), sql`${outboxEvents.dispatchStartedAt} IS NULL`,
              or(and(sql`${outboxEvents.status} IN ('pending', 'failed')`, sql`(${outboxEvents.nextRetryAt} IS NULL OR ${outboxEvents.nextRetryAt} <= now())`),
                and(eq(outboxEvents.status, "processing"), sql`${outboxEvents.dispatchLeaseUntil} <= now()`)))
          )
        )
      )
      .orderBy(outboxEvents.createdAt)
      .limit(limit);
  }

  /**
   * Atomically mark event as processing (claim it)
   *
   * Returns true if successfully claimed, false if already claimed.
   * Uses WHERE status = 'pending' to prevent race conditions.
   */
  async markProcessing(eventId: string): Promise<boolean> {
    const result = await db
      .update(outboxEvents)
      .set({
        status: "processing",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(outboxEvents.id, eventId),
          sql`${outboxEvents.eventType} <> ${EventTypes.SECURITY_NOTICE_REQUESTED}`,
          or(
            eq(outboxEvents.status, "pending"),
            eq(outboxEvents.status, "failed")
          )
        )
      )
      .returning();

    return result.length > 0;
  }

  /**
   * Mark event as completed
   */
  async markCompleted(eventId: string): Promise<void> {
    await db
      .update(outboxEvents)
      .set({
        status: "completed",
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(outboxEvents.id, eventId), sql`${outboxEvents.eventType} <> ${EventTypes.SECURITY_NOTICE_REQUESTED}`));
  }

  /**
   * Mark event as failed with retry logic
   */
  async markFailed(eventId: string, error: string): Promise<void> {
    const [event] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId));

    if (!event || event.eventType === EventTypes.SECURITY_NOTICE_REQUESTED) return;

    const newRetryCount = event.retryCount + 1;
    const isDead = newRetryCount >= event.maxRetries;

    await db
      .update(outboxEvents)
      .set({
        status: isDead ? "dead_letter" : "failed",
        retryCount: newRetryCount,
        lastError: error,
        nextRetryAt: isDead ? null : calculateNextRetry(newRetryCount),
        updatedAt: new Date(),
      })
      .where(and(eq(outboxEvents.id, eventId), sql`${outboxEvents.eventType} <> ${EventTypes.SECURITY_NOTICE_REQUESTED}`));

    /**
     * BUSINESS RULE: Dead Letter Queue
     *
     * Events that fail after maxRetries (default 5) are moved to dead_letter.
     * Dead letter events require manual intervention because:
     * - The handler code may have a bug
     * - External dependencies may be permanently unavailable
     * - The event payload may be malformed
     *
     * Admins can use retryDeadLetter() to requeue after fixing the issue.
     */
    if (isDead) {
      logger.error("Event moved to dead letter queue", {
        eventId,
        eventType: event.eventType,
        retryCount: newRetryCount,
        lastError: error,
      });
    }
  }

  /**
   * Get dead letter events for manual review
   */
  async getDeadLetterEvents(limit = 50): Promise<OutboxEvent[]> {
    return db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.status, "dead_letter"))
      .orderBy(outboxEvents.createdAt)
      .limit(limit);
  }

  /**
   * Retry a dead letter event
   */
  async retryDeadLetter(eventId: string): Promise<void> {
    await db
      .update(outboxEvents)
      .set({
        status: "pending",
        retryCount: 0,
        lastError: null,
        nextRetryAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(outboxEvents.id, eventId),
          eq(outboxEvents.status, "dead_letter"),
          sql`(${outboxEvents.eventType} <> ${EventTypes.SECURITY_NOTICE_REQUESTED} OR ${outboxEvents.dispatchStartedAt} IS NULL)`
        )
      );
  }

  /**
   * Get event processing stats
   */
  async getStats(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    deadLetter: number;
    unknown: number;
    suppressed: number;
  }> {
    const result = await db
      .select({
        status: outboxEvents.status,
        count: sql<number>`count(*)::int`,
      })
      .from(outboxEvents)
      .groupBy(outboxEvents.status);

    const stats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      deadLetter: 0,
      unknown: 0,
      suppressed: 0,
    };

    for (const row of result) {
      switch (row.status) {
        case "pending":
          stats.pending = row.count;
          break;
        case "processing":
          stats.processing = row.count;
          break;
        case "completed":
          stats.completed = row.count;
          break;
        case "failed":
          stats.failed = row.count;
          break;
        case "dead_letter":
          stats.deadLetter = row.count;
          break;
        case "unknown": stats.unknown = row.count; break;
        case "suppressed": stats.suppressed = row.count; break;
      }
    }

    return stats;
  }
}

export const outboxEventService = new OutboxEventService();
