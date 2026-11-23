/**
 * Per-channel delivery ledger (R16.2). One `notification_deliveries` row per
 * (recipient, event, channel) records what actually happened:
 *
 *   pending     claimed, transport not yet answered (a crash leaves it here: never resent)
 *   sent        the channel accepted it: never resent
 *   failed      the channel definitely did not accept it: the only status that is retried
 *   unknown     the outcome cannot be known (timeout, thrown transport): never retried
 *   suppressed  deliberately not sent (quiet hours, push not configured, no subscription)
 *
 * Calling again for the same event is the retry: finished channels are skipped, `failed`
 * ones are tried again, new channels are sent.
 */
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { notificationDeliveries } from "@shared/schema";
import { db } from "../../db";
import { logger } from "../../utils/logger";
import type { TransactionType } from "../../utils/withTransaction";

export type DeliveryChannel = "email" | "push";
export type DeliveryStatus = "pending" | "sent" | "failed" | "unknown" | "suppressed";

/** What a transport reports for one attempt. */
export interface ChannelResult {
  status: Exclude<DeliveryStatus, "pending">;
  /** Short machine reason, never message content. */
  reason?: string;
}

export interface DeliveryOutcome {
  status: DeliveryStatus;
  /** True only when this call invoked the transport. */
  attempted: boolean;
}

export interface DeliverOptions {
  /** Suppression reasons that are not a decision about this event and may be taken again (REC a1). */
  retrySuppressed?: readonly string[];
}

// Older email senders used the same reason for definite failures and lost acknowledgements.
const OPAQUE_EMAIL_FAILURE = "transport_rejected";
export const SCHEDULED_DISPATCH_READY = "scheduled_dispatch_ready";
export const PRE_DISPATCH_FAILURE: ChannelResult = { status: "failed", reason: "pre_dispatch_failed" };

export function hasRetryableChannelFailure(channels: Partial<Record<DeliveryChannel, DeliveryStatus>>): boolean {
  return channels.email === "failed" || channels.push === "failed";
}

/** Written with a newly published inbox row. A retry can distinguish it from a legacy inbox with no receipt. */
export async function reserveScheduledDelivery(
  tx: TransactionType, userId: string, eventKey: string, channels: readonly DeliveryChannel[],
): Promise<void> {
  if (channels.length === 0) return;
  await tx.insert(notificationDeliveries).values(channels.map(channel => ({
    userId, eventKey, channel, status: "suppressed", attempts: 0, reason: SCHEDULED_DISPATCH_READY,
  }))).onConflictDoNothing();
}

export async function deliverOnce(
  userId: string,
  eventKey: string,
  channel: DeliveryChannel,
  send: () => Promise<ChannelResult>,
  options: DeliverOptions = {},
): Promise<DeliveryOutcome> {
  const key = and(
    eq(notificationDeliveries.userId, userId), eq(notificationDeliveries.eventKey, eventKey),
    eq(notificationDeliveries.channel, channel),
  );
  const inserted = await db.insert(notificationDeliveries)
    .values({ userId, eventKey, channel, status: "pending" })
    .onConflictDoNothing().returning({ id: notificationDeliveries.id });
  let rowId = inserted[0]?.id;

  if (!rowId) {
    // Only a failed row (or a named, reconsiderable suppression) is retried, and only by
    // whoever flips it back to pending first.
    const retrySuppressed = options.retrySuppressed ?? [];
    const failed = eq(notificationDeliveries.status, "failed");
    const retryableFailure = channel === "email"
      ? and(failed, sql`${notificationDeliveries.reason} is distinct from ${OPAQUE_EMAIL_FAILURE}`)
      : failed;
    const retryable = retrySuppressed.length > 0
      ? or(retryableFailure,
        and(eq(notificationDeliveries.status, "suppressed"), inArray(notificationDeliveries.reason, [...retrySuppressed])))
      : retryableFailure;
    const claimed = await db.update(notificationDeliveries)
      .set({ status: "pending", attempts: sql`${notificationDeliveries.attempts} + 1`, updatedAt: new Date() })
      .where(and(key, retryable))
      .returning({ id: notificationDeliveries.id });
    rowId = claimed[0]?.id;
    if (!rowId) {
      const [existing] = await db.select({ status: notificationDeliveries.status, reason: notificationDeliveries.reason })
        .from(notificationDeliveries).where(key);
      if (channel === "email" && existing?.status === "failed" && existing.reason === OPAQUE_EMAIL_FAILURE) {
        return { status: "unknown", attempted: false };
      }
      return { status: (existing?.status ?? "unknown") as DeliveryStatus, attempted: false };
    }
  }

  let result: ChannelResult;
  try {
    result = await send();
  } catch (error) {
    // A transport that throws gives no proof either way: unknown, never failed.
    logger.warn("Notification transport threw", { channel, message: error instanceof Error ? error.name : "error" });
    result = { status: "unknown", reason: "transport_threw" };
  }
  await db.update(notificationDeliveries)
    .set({ status: result.status, reason: result.reason ?? null, updatedAt: new Date() })
    .where(eq(notificationDeliveries.id, rowId));
  return { status: result.status, attempted: true };
}

/** True when any channel row exists for the event: it has been through the ledger before. */
export async function hasDeliveryRecord(userId: string, eventKey: string): Promise<boolean> {
  const [row] = await db.select({ id: notificationDeliveries.id }).from(notificationDeliveries)
    .where(and(eq(notificationDeliveries.userId, userId), eq(notificationDeliveries.eventKey, eventKey))).limit(1);
  return !!row;
}

/** Continue a recorded delivery under its prior key when a producer changes key formats. */
export async function resolveDeliveryEventKey(userId: string, dedupeKey?: string, legacyKey?: string): Promise<string> {
  if (legacyKey && await hasDeliveryRecord(userId, legacyKey)) return legacyKey;
  return dedupeKey ?? `event:${randomUUID()}`;
}
