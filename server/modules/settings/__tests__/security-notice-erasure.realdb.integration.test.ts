import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, expect, it, vi } from "vitest";
import { auditLogs, householdMembers, households, outboxEvents, securityAuditLogs, userNotificationPreferences, users } from "@shared/schema";
import { hashPassword } from "../../../auth";
import { db, pool } from "../../../db";
import { getTestApp } from "../../../__tests__/fixtures";
import { EventTypes } from "../../../core/events/eventTypes";
import { dispatchSecurityNotice } from "../../../services/security-notice-dispatch";
import { sendEmail } from "../../../services/emailService";

const verificationTokens = vi.hoisted(() => new Map<string, string>());
vi.mock("../../../services/emailService", async (original) => ({
  ...await original<typeof import("../../../services/emailService")>(),
  isEmailServiceConfigured: vi.fn(() => true),
  sendEmail: vi.fn(async () => true),
  sendVerificationEmail: vi.fn(async (email: string, token: string) => {
    verificationTokens.set(email, token);
    return true;
  }),
}));

const password = "SyntheticNoticeErasure123!";
const householdId = randomUUID();
const erasedId = randomUUID();
const retainedId = randomUUID();
const ordinaryEventId = randomUUID();
const actorIds = [erasedId, retainedId];
const reusedEmail = `notice-reused-${erasedId}@example.invalid`;
const erasedNewEmail = `notice-current-${erasedId}@example.invalid`;
const retainedFirstEmail = `notice-owner-${retainedId}@example.invalid`;
const noticeType = EventTypes.SECURITY_NOTICE_REQUESTED;
const noticeSubject = (userId: string) => and(eq(outboxEvents.eventType, noticeType),
  sql`${outboxEvents.payload}->>'userId' = ${userId}`);
const readNotices = (userId: string) => db.select().from(outboxEvents).where(noticeSubject(userId)).orderBy(outboxEvents.id);

afterAll(async () => {
  for (const id of actorIds) {
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [id]);
    await db.delete(outboxEvents).where(noticeSubject(id));
  }
  await db.delete(outboxEvents).where(eq(outboxEvents.id, ordinaryEventId));
  await db.delete(securityAuditLogs).where(inArray(securityAuditLogs.userId, actorIds));
  await db.delete(auditLogs).where(inArray(auditLogs.userId, actorIds));
  await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
  await db.delete(households).where(eq(households.id, householdId));
  await db.delete(users).where(inArray(users.id, actorIds));
});

it("erases the former owner's notices without altering another subject's pending delivery to a reused address", async () => {
  const app = await getTestApp();
  const passwordHash = await hashPassword(password);
  await db.insert(households).values({ id: householdId, name: "Synthetic security notice erasure", currency: "ZMW" });
  await db.insert(users).values([
    { id: erasedId, email: reusedEmail, username: `notice-erased-${erasedId}`, passwordHash, emailVerified: true },
    { id: retainedId, email: retainedFirstEmail, username: `notice-retained-${retainedId}`, passwordHash, emailVerified: true },
  ]);
  await db.insert(householdMembers).values([
    { userId: erasedId, householdId, role: "member" },
    { userId: retainedId, householdId, role: "owner" },
  ]);
  await db.insert(userNotificationPreferences).values(actorIds.map(userId => ({
    userId, notificationType: "email_changed", inAppEnabled: true, emailEnabled: true,
  })));
  await db.insert(outboxEvents).values({ id: ordinaryEventId, eventType: "test.erasure_trace", aggregateType: "test",
    aggregateId: randomUUID(), status: "completed", payload: { recordedAddress: reusedEmail } });

  async function login(email: string) {
    const result = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    return (result.headers["set-cookie"] as unknown as string[]).join("; ");
  }
  async function changeEmail(currentEmail: string, newEmail: string) {
    await request(app).post("/api/settings/security/email/change").set("Cookie", await login(currentEmail))
      .send({ newEmail, password }).expect(200);
    const token = verificationTokens.get(newEmail);
    expect(token).toEqual(expect.any(String));
    await request(app).post("/api/settings/security/email/verify").set("User-Agent", "synthetic-notice-verifier")
      .send({ token }).expect(200);
  }

  await changeEmail(reusedEmail, erasedNewEmail);
  const formerOwnerNotices = await readNotices(erasedId);
  expect(formerOwnerNotices).toHaveLength(2);
  expect(formerOwnerNotices).toEqual(expect.arrayContaining([expect.objectContaining({ status: "pending",
    payload: expect.objectContaining({ userId: erasedId, recipient: reusedEmail }) })]));

  await changeEmail(retainedFirstEmail, reusedEmail);
  const retainedNotices = await readNotices(retainedId);
  expect(retainedNotices).toHaveLength(2);
  const reusedNotice = retainedNotices.find(row => (row.payload as { recipient: string }).recipient === reusedEmail)!;
  expect(reusedNotice).toMatchObject({ status: "pending", aggregateType: "security_audit",
    payload: { userId: retainedId, recipient: reusedEmail, kind: "email_changed" } });
  const [retainedAudit] = await db.select().from(securityAuditLogs).where(eq(securityAuditLogs.id, reusedNotice.aggregateId));
  expect(retainedAudit).toMatchObject({ userId: retainedId, eventType: "EMAIL_CHANGED", userAgent: "synthetic-notice-verifier",
    details: { action: "email_change" } });

  const cookie = await login(erasedNewEmail);
  await request(app).post("/api/settings/security/step-up").set("Cookie", cookie).send({ password }).expect(200);
  await request(app).post("/api/settings/account/delete").set("Cookie", cookie).send({ password }).expect(200);

  const [tombstone] = await db.select().from(users).where(eq(users.id, erasedId));
  expect(tombstone.email).toMatch(/@deleted\.invalid$/);
  expect(tombstone.erasedAt).toBeInstanceOf(Date);
  expect(await readNotices(erasedId)).toEqual([]);
  for (const notice of formerOwnerNotices) expect(await dispatchSecurityNotice(notice.id)).toBe(false);
  expect(sendEmail).not.toHaveBeenCalled();
  const [ordinaryEvent] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, ordinaryEventId));
  expect(ordinaryEvent.payload).toEqual({ recordedAddress: tombstone.email });
  expect(await readNotices(retainedId)).toEqual(retainedNotices);
  expect(await db.select().from(securityAuditLogs).where(eq(securityAuditLogs.id, retainedAudit.id))).toEqual([retainedAudit]);

  expect(await dispatchSecurityNotice(reusedNotice.id)).toBe(true);
  expect(sendEmail).toHaveBeenCalledTimes(1);
  expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: reusedEmail, subject: "Email address changed" }));
  const [dispatched] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, reusedNotice.id));
  expect(dispatched).toMatchObject({ status: "completed", payload: reusedNotice.payload });
}, 60_000);
