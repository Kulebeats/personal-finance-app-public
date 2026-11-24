/**
 * AH-11 slice 2: a member without MFA is e-mailed when 7 days and when 1 day of
 * the grace are left. Real Postgres and the real delivery ledger; only SMTP is
 * stubbed. A re-run sends nothing twice, a definite rejection is retried, and a
 * lost acknowledgement is not.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { notificationDeliveries, securityAuditLogs, users } from "@shared/schema";
import { db } from "../../../db";
import { sendEmail } from "../../../services/emailService";

vi.mock("../../../services/emailService", () => ({ sendEmail: vi.fn(async () => true), isEmailServiceConfigured: vi.fn(() => true) }));

import { sendMfaGraceReminders } from "../auth.mfa-reminders";

const smtp = vi.mocked(sendEmail);
const REMINDER_AUDIT = "MFA_GRACE_REMINDER_SENT";
const created: string[] = [];

interface Member { id: string; email: string }
async function member(
  graceIn: string, { mfaEnabled = false as boolean | null, emailVerified = true } = {},
): Promise<Member> {
  const id = randomUUID();
  const email = `ah11-reminder-${id}@example.invalid`;
  await db.insert(users).values({
    id, email, username: `ah11-reminder-${id}`, passwordHash: "!synthetic-not-a-login!", emailVerified, mfaEnabled,
    mfaGraceEndsAt: sql`now() + ${graceIn}::interval`,
  });
  created.push(id);
  return { id, email };
}
const subjectsTo = (m: Member) => smtp.mock.calls.filter(([message]) => message.to === m.email).map(([message]) => message.subject);
const ledger = (m: Member) => db.select({ status: notificationDeliveries.status, eventKey: notificationDeliveries.eventKey })
  .from(notificationDeliveries).where(eq(notificationDeliveries.userId, m.id)).orderBy(notificationDeliveries.eventKey);
async function audits(m: Member): Promise<number> {
  const rows = await db.select({ id: securityAuditLogs.id }).from(securityAuditLogs)
    .where(and(eq(securityAuditLogs.userId, m.id), eq(securityAuditLogs.eventType, REMINDER_AUDIT)));
  return rows.length;
}

beforeEach(() => {
  smtp.mockReset();
  smtp.mockImplementation(async () => true);
});

afterAll(async () => {
  if (created.length === 0) return;
  await db.delete(securityAuditLogs).where(inArray(securityAuditLogs.userId, created));
  await db.delete(notificationDeliveries).where(inArray(notificationDeliveries.userId, created));
  await db.delete(users).where(inArray(users.id, created));
});

describe("AH-11 MFA grace reminders", () => {
  it("sends the 7-day reminder once, then the 1-day one, only to members who still need MFA", async () => {
    const weekLeft = await member("6 days 12 hours");
    const dayLeft = await member("20 hours");
    const early = await member("8 days");
    const enrolled = await member("6 days", { mfaEnabled: true });
    const expired = await member("-1 hour");
    const unverified = await member("6 days", { emailVerified: false });

    await sendMfaGraceReminders();

    expect(subjectsTo(weekLeft)).toEqual([expect.stringMatching(/7 days left/)]);
    // A member who never got the 7-day reminder gets only the 1-day one.
    expect(subjectsTo(dayLeft)).toEqual([expect.stringMatching(/1 day left/)]);
    for (const quiet of [early, enrolled, expired, unverified]) expect(subjectsTo(quiet)).toEqual([]);
    expect(await ledger(weekLeft)).toEqual([{ status: "sent", eventKey: expect.stringMatching(/^mfa_grace_reminder:7d:/) }]);
    expect(await audits(weekLeft)).toBe(1);
    expect(await audits(dayLeft)).toBe(1);

    // A re-run (recovery tick, second instance) sends nothing again.
    await sendMfaGraceReminders();
    expect(subjectsTo(weekLeft)).toHaveLength(1);
    expect(subjectsTo(dayLeft)).toHaveLength(1);
    expect(await audits(weekLeft)).toBe(1);

    // The last day: the 7-day member now gets the 1-day reminder as well.
    await db.update(users).set({ mfaGraceEndsAt: sql`now() + interval '20 hours'` }).where(eq(users.id, weekLeft.id));
    await sendMfaGraceReminders();
    expect(subjectsTo(weekLeft)).toEqual([expect.stringMatching(/7 days left/), expect.stringMatching(/1 day left/)]);
    expect(await audits(weekLeft)).toBe(2);
  });

  it("reminds a member whose MFA flag is NULL, whom the grace gate treats as not enrolled", async () => {
    const unset = await member("6 days", { mfaEnabled: null });

    await sendMfaGraceReminders();

    expect(subjectsTo(unset)).toEqual([expect.stringMatching(/6 days left/)]);
    expect(await audits(unset)).toBe(1);
  });

  it("re-reads each member before sending: one who enrolled mid-run is not e-mailed, a new address is used", async () => {
    // Members are taken earliest deadline first, so `first` is sent before the other two.
    const first = await member("1 minute");
    const enrolsMidRun = await member("6 days 23 hours");
    const movesMidRun = await member("6 days 22 hours");
    const newAddress = `ah11-reminder-moved-${movesMidRun.id}@example.invalid`;
    smtp.mockImplementation(async (message) => {
      if (message.to === first.email) {
        await db.update(users).set({ mfaEnabled: true }).where(eq(users.id, enrolsMidRun.id));
        await db.update(users).set({ email: newAddress }).where(eq(users.id, movesMidRun.id));
      }
      return true;
    });

    await sendMfaGraceReminders();

    expect(subjectsTo(first)).toHaveLength(1);
    expect(subjectsTo(enrolsMidRun)).toEqual([]);
    expect(await ledger(enrolsMidRun)).toEqual([expect.objectContaining({ status: "suppressed" })]);
    expect(await audits(enrolsMidRun)).toBe(0);
    expect(subjectsTo(movesMidRun)).toEqual([]);
    expect(smtp.mock.calls.filter(([message]) => message.to === newAddress)).toHaveLength(1);
  });

  it("retries a definite rejection on the next run, but never resends a lost acknowledgement", async () => {
    const rejected = await member("6 days");
    const lost = await member("5 days");
    smtp.mockImplementation(async (message) => {
      if (message.to === rejected.email) return false;
      if (message.to === lost.email) throw new Error("synthetic lost acknowledgement");
      return true;
    });

    const first = await sendMfaGraceReminders();

    expect(first.failed).toBeGreaterThanOrEqual(1);
    expect(await ledger(rejected)).toEqual([expect.objectContaining({ status: "failed" })]);
    expect(await ledger(lost)).toEqual([expect.objectContaining({ status: "unknown" })]);
    expect(await audits(rejected)).toBe(0);
    // It may have been delivered, so it is recorded.
    expect(await audits(lost)).toBe(1);

    smtp.mockImplementation(async () => true);
    await sendMfaGraceReminders();

    expect(subjectsTo(rejected)).toHaveLength(2);
    expect(await ledger(rejected)).toEqual([expect.objectContaining({ status: "sent" })]);
    expect(await audits(rejected)).toBe(1);
    expect(subjectsTo(lost)).toHaveLength(1);
  });
});
