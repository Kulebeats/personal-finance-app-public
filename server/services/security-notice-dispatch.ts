import { randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { outboxEvents, users, userQuietHours, type OutboxEvent, type User } from "@shared/schema";
import { db } from "../db";
import { withTransaction, type TransactionType } from "../utils/withTransaction";
import { EventTypes } from "../core/events/eventTypes";
import { isEmailServiceConfigured, sendEmail } from "./emailService";
import { noticeText, securityNoticePayloadSchema, securityNoticePreferences, type SecurityNoticePayload } from "./security-notice";
import { quietHoursRetryAt } from "./security-notice-policy";

export interface SecurityNoticeClaim { eventId: string; token: string; generation: number }
const leaseMs = 60_000;
async function databaseNow(tx: TransactionType): Promise<Date> {
  const result = await tx.execute(sql`SELECT clock_timestamp() AS now`);
  return new Date(result.rows[0].now as string);
}
async function preflight(tx: TransactionType, event: OutboxEvent, user: User | undefined, payload: SecurityNoticePayload, now: Date) {
  let reason: string | null = null, suppressed = false, nextRetryAt: Date | null = null;
  if (!user || user.erasedAt || user.passwordHash.startsWith("!erased!")) { reason = "subject_erased"; suppressed = true; }
  else if (!(await securityNoticePreferences(tx, user.id, payload.kind)).email) { reason = "email_preference_disabled"; suppressed = true; }
  else {
    const [quiet] = await tx.select().from(userQuietHours).where(eq(userQuietHours.userId, user.id));
    try { nextRetryAt = quietHoursRetryAt(quiet, user.timezone, now); }
    catch { reason = "email_delivery_policy_invalid"; }
    if (nextRetryAt) reason = "quiet_hours_deferred";
    else if (!reason && !isEmailServiceConfigured()) reason = "email_transport_unavailable";
  }
  if (!reason) return true;
  const retryCount = reason === "quiet_hours_deferred" || suppressed ? event.retryCount : event.retryCount + 1;
  await tx.update(outboxEvents).set({
    status: suppressed ? "suppressed" : nextRetryAt ? "pending" : retryCount >= event.maxRetries ? "dead_letter" : "failed",
    lastError: reason, retryCount, nextRetryAt: nextRetryAt ?? (suppressed || retryCount >= event.maxRetries ? null : new Date(now.getTime() + Math.min(300_000, 1000 * 2 ** retryCount))),
    processedAt: suppressed ? now : null, dispatchClaimToken: null, dispatchLeaseUntil: null, updatedAt: now,
  }).where(eq(outboxEvents.id, event.id));
  return false;
}
/** All security paths lock subject before event, matching identity mutation order. */
async function withLockedNotice<T>(id: string, operation: (tx: TransactionType, event: OutboxEvent, user: User | undefined, payload: SecurityNoticePayload) => Promise<T>): Promise<T | null> {
  const [snapshot] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, id));
  if (!snapshot || snapshot.eventType !== EventTypes.SECURITY_NOTICE_REQUESTED) return null;
  const parsed = securityNoticePayloadSchema.safeParse(snapshot.payload);
  if (!parsed.success) {
    await db.update(outboxEvents).set({ status: "dead_letter", lastError: "invalid_security_notice_payload", updatedAt: new Date() })
      .where(and(eq(outboxEvents.id, id), sql`${outboxEvents.status} IN ('pending', 'failed')`));
    return null;
  }
  return withTransaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, parsed.data.userId)).for("update");
    const [event] = await tx.select().from(outboxEvents).where(eq(outboxEvents.id, id)).for("update");
    if (!event || event.eventType !== EventTypes.SECURITY_NOTICE_REQUESTED) return null;
    const payload = securityNoticePayloadSchema.safeParse(event.payload);
    if (!payload.success || payload.data.userId !== parsed.data.userId) return null;
    return operation(tx, event, user, payload.data);
  });
}
export async function claimSecurityNotice(eventId: string): Promise<SecurityNoticeClaim | null> {
  return withLockedNotice(eventId, async (tx, event, user, payload) => {
    const now = await databaseNow(tx);
    const available = (event.status === "pending" || event.status === "failed") && (!event.nextRetryAt || event.nextRetryAt <= now);
    const expiredBeforeDispatch = event.status === "processing" && event.dispatchStartedAt === null && event.dispatchLeaseUntil !== null && event.dispatchLeaseUntil <= now;
    if ((!available && !expiredBeforeDispatch) || event.dispatchStartedAt !== null) return null;
    if (!await preflight(tx, event, user, payload, now)) return null;
    const token = randomUUID(), generation = event.dispatchGeneration + 1;
    await tx.update(outboxEvents).set({ status: "processing", dispatchClaimToken: token, dispatchGeneration: generation,
      dispatchLeaseUntil: new Date(now.getTime() + leaseMs), nextRetryAt: null, lastError: null, updatedAt: now }).where(eq(outboxEvents.id, eventId));
    return { eventId, token, generation };
  });
}
function owns(event: OutboxEvent, claim: SecurityNoticeClaim) {
  return event.dispatchClaimToken === claim.token && event.dispatchGeneration === claim.generation;
}
/** Durable intent BEFORE transport. Returning the persisted payload prevents a
 * caller's stale/mutated claim from choosing a recipient or bypassing preflight. */
export async function beginSecurityNoticeDispatch(claim: SecurityNoticeClaim): Promise<SecurityNoticePayload | null> {
  return withLockedNotice(claim.eventId, async (tx, event, user, payload) => {
    const now = await databaseNow(tx);
    if (event.status !== "processing" || !owns(event, claim) || !event.dispatchLeaseUntil || event.dispatchLeaseUntil <= now || event.dispatchStartedAt) return null;
    if (!await preflight(tx, event, user, payload, now)) return null;
    await tx.update(outboxEvents).set({ status: "unknown", dispatchStartedAt: now, lastError: "dispatch_outcome_unknown", updatedAt: now })
      .where(eq(outboxEvents.id, event.id));
    return payload;
  });
}
export async function completeSecurityNoticeDispatch(claim: SecurityNoticeClaim): Promise<boolean> {
  const result = await db.update(outboxEvents).set({ status: "completed", processedAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(and(eq(outboxEvents.id, claim.eventId), eq(outboxEvents.eventType, EventTypes.SECURITY_NOTICE_REQUESTED),
      eq(outboxEvents.status, "unknown"), eq(outboxEvents.dispatchClaimToken, claim.token), eq(outboxEvents.dispatchGeneration, claim.generation),
      gt(outboxEvents.dispatchStartedAt, new Date(0)))).returning({ id: outboxEvents.id });
  return result.length === 1;
}
/** No timer is enabled here. False/throw/failed post-send persistence remain
 * unknown: the existing boolean transport cannot prove non-dispatch. */
export async function dispatchSecurityNotice(eventId: string): Promise<boolean> {
  const claim = await claimSecurityNotice(eventId);
  if (!claim) return false;
  const payload = await beginSecurityNoticeDispatch(claim);
  if (!payload) return false;
  const content = noticeText[payload.kind];
  try {
    const accepted = await sendEmail({ to: payload.recipient, subject: content.title,
      html: `<p>${content.body}</p>`, text: content.body });
    return accepted ? await completeSecurityNoticeDispatch(claim) : false;
  } catch {
    // Intent is already committed. Never turn an uncertain outcome into retry.
    return false;
  }
}
