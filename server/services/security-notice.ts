import type { Request } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { notifications, outboxEvents, securityAuditLogs, userNotificationPreferences, type User } from "@shared/schema";
import { type TransactionType } from "../utils/withTransaction";
import { EventTypes } from "../core/events/eventTypes";

export const securityNoticePayloadSchema = z.object({
  version: z.literal(1),
  userId: z.string().uuid(),
  kind: z.enum(["password_changed", "email_changed"]),
  channel: z.literal("email"),
  recipient: z.string().email().max(255),
  occurredAt: z.string().datetime(),
}).strict();
export type SecurityNoticePayload = z.infer<typeof securityNoticePayloadSchema>;
export const noticeText = {
  password_changed: { title: "Password changed", body: "Your account password was changed. Review your security settings if you did not make this change." },
  email_changed: { title: "Email address changed", body: "Your account email address was changed. Review your security settings if you did not make this change." },
} as const;

/** Missing preferences retain the application's opt-in email/default in-app policy.
 * Conflicting legacy rows are conservative: an explicit channel opt-out wins. */
export async function securityNoticePreferences(tx: TransactionType, userId: string, kind: SecurityNoticePayload["kind"]) {
  const rows = await tx.select().from(userNotificationPreferences)
    .where(and(eq(userNotificationPreferences.userId, userId), eq(userNotificationPreferences.notificationType, kind)));
  return { inApp: rows.length === 0 || rows.every((row) => row.inAppEnabled === true),
    email: rows.length > 0 && rows.every((row) => row.emailEnabled === true) };
}

/** The caller holds the user lock. No transport, secrets or full user payloads. */
export async function enqueueSecurityNotice(tx: TransactionType, subject: User, req: Request, options: {
  eventType: "PASSWORD_CHANGE" | "PASSWORD_RESET_COMPLETE" | "EMAIL_CHANGED";
  kind: SecurityNoticePayload["kind"];
  recipients: string[];
  action: "password_change" | "password_reset" | "email_change";
  sessionsRevoked?: boolean;
}): Promise<string> {
  const occurredAt = new Date();
  const [audit] = await tx.insert(securityAuditLogs).values({
    eventType: options.eventType, userId: subject.id,
    ipAddress: req.ip || req.socket?.remoteAddress || null,
    userAgent: req.headers["user-agent"] || null,
    details: { action: options.action, ...(options.sessionsRevoked === undefined ? {} : { sessionsRevoked: options.sessionsRevoked }) },
    createdAt: occurredAt,
  }).returning({ id: securityAuditLogs.id });
  const prefs = await securityNoticePreferences(tx, subject.id, options.kind);
  if (prefs.inApp) await tx.insert(notifications).values({
    userId: subject.id, type: options.kind, ...noticeText[options.kind], actionUrl: "/settings?section=security",
    metadata: { securityEventId: audit.id }, dedupeKey: `security:${audit.id}:in_app`,
  });
  for (const recipient of new Set(options.recipients.map((email) => email.trim().toLowerCase()))) {
    const payload = securityNoticePayloadSchema.parse({ version: 1, userId: subject.id, kind: options.kind,
      channel: "email", recipient, occurredAt: occurredAt.toISOString() });
    await tx.insert(outboxEvents).values({ eventType: EventTypes.SECURITY_NOTICE_REQUESTED, aggregateType: "security_audit",
      aggregateId: audit.id, payload, status: prefs.email ? "pending" : "suppressed",
      lastError: prefs.email ? null : "email_preference_disabled", processedAt: prefs.email ? null : occurredAt });
  }
  return audit.id;
}
