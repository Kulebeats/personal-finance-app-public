/**
 * A-21: a member who turns on a bill reminder gets it from the in-process
 * scheduler alone, with no external call to /api/cron/*. Starting the
 * scheduler registers the reminder job and a same-period recovery tick.
 * A definite transport rejection leaves the period open. The recovery tick
 * sends the owner e-mail once and does not repeat the committed in-app row.
 * Real Postgres and real notification code; only
 * node-cron's clock, SMTP, the web-push wire and the outbox processor loop are
 * stubbed.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  accounts, householdMembers, households, jobs, notificationDeliveries, notifications, recurringTransactions,
  userNotificationPreferences, users,
} from "@shared/schema";
import { db } from "../../../db";
import { sendEmail } from "../../../services/emailService";
import { notificationService } from "../../../services/NotificationService";
import { recurringNoticeDedupeKey } from "../../../services/notification/recurring-notice";
import { SCHEDULED_RUN_PREFIX, SCHEDULER_START_MARKER } from "../jobJournal";
import { SCHEDULED_JOBS } from "../jobRegistry";
import { periodIdentity } from "../schedulePeriod";

const ticks = vi.hoisted(() => new Map<string, () => Promise<void>>());
vi.mock("node-cron", async (original) => {
  const actual = await original<typeof import("node-cron")>();
  return { default: { validate: actual.validate, schedule: (_cron: string, tick: () => Promise<void>, options: { name: string }) => {
    ticks.set(options.name, tick);
    return { stop: async () => {} };
  } } };
});
vi.mock("../../events/processor", () => ({ startProcessor: vi.fn(), stopProcessor: vi.fn() }));
vi.mock("../../../services/emailService", () => ({ sendEmail: vi.fn(async () => true), isEmailServiceConfigured: vi.fn(() => true) }));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }));

import { initScheduler, stopScheduler } from "../../../scheduler";

const smtp = vi.mocked(sendEmail);
const DAY_MS = 86_400_000;
const REMINDER_JOB = "recurring.remind";
const RETRY_TICK = "scheduler.retry-incomplete";
const householdId = randomUUID();
const ownerId = randomUUID();
const accountId = randomUUID();
const ruleId = randomUUID();
const legacyRuleId = randomUUID();
const ownerEmail = `scheduler-bill-${ownerId}@example.invalid`;
const slot = new Date();
slot.setUTCHours(6, 0, 0, 0);
const utcDate = (days: number) => new Date(slot.getTime() + days * DAY_MS).toISOString().slice(0, 10);

const remindersEmailed = () => smtp.mock.calls.filter(([message]) => message.to === ownerEmail).length;
async function remindersInApp(): Promise<number> {
  const rows = await db.select({ id: notifications.id }).from(notifications)
    .where(and(eq(notifications.userId, ownerId), eq(notifications.dedupeKey, reminderKey(ruleId))));
  return rows.length;
}
const reminderKey = (id: string) => recurringNoticeDedupeKey({ householdId, recurringId: id, dueDate: utcDate(3) }, ownerId);
const deliveries = (id: string) => db.select({ status: notificationDeliveries.status, reason: notificationDeliveries.reason,
  attempts: notificationDeliveries.attempts }).from(notificationDeliveries).where(and(
    eq(notificationDeliveries.userId, ownerId), eq(notificationDeliveries.eventKey, reminderKey(id)),
  ));
let hadStartMarker = false;
let ownsPeriod = false;
const startMarkers = () => db.select({ id: jobs.id }).from(jobs).where(eq(jobs.name, SCHEDULER_START_MARKER));
const runScope = and(eq(jobs.name, `${SCHEDULED_RUN_PREFIX}${REMINDER_JOB}`), eq(jobs.idempotencyKey, periodIdentity(REMINDER_JOB, slot)));
const journal = () => db.select({ status: jobs.status, result: jobs.result }).from(jobs).where(runScope).orderBy(jobs.startedAt);

beforeAll(async () => {
  // Other suites may leave rules and journal rows behind: this period starts
  // clean, and rules of other households are skipped (see the test's spy).
  await db.delete(jobs).where(runScope);
  ownsPeriod = true;
  hadStartMarker = (await startMarkers()).length > 0;
  await db.insert(households).values({ id: householdId, name: "Synthetic scheduled bill reminder", currency: "ZMW" });
  await db.insert(users).values({ id: ownerId, email: ownerEmail, username: `scheduler-bill-${ownerId}`,
    passwordHash: "!synthetic-not-a-login!", emailVerified: true });
  await db.insert(householdMembers).values({ householdId, userId: ownerId, role: "owner" });
  await db.insert(userNotificationPreferences).values({ userId: ownerId, notificationType: "recurring_due",
    inAppEnabled: true, emailEnabled: true, pushEnabled: false });
  await db.insert(accounts).values({ id: accountId, householdId, name: "Synthetic current", type: "checking", currency: "ZMW",
    initialBalance: "0.00", balance: "0.00", isPrivate: false, ownerUserId: ownerId });
  // This upcoming due date reaches its initial reminder day at the canonical tick.
  await db.insert(recurringTransactions).values([ruleId, legacyRuleId].map(id => ({
    id, householdId, accountId, name: "Synthetic water bill", amount: "250.00", type: "expense" as const, frequency: "monthly" as const,
    startDate: utcDate(3), nextDueDate: utcDate(3), reminderDays: 3, detectionMethod: "manual", isActive: true, isPaused: false,
  })));
  await db.insert(notifications).values({
    userId: ownerId, householdId, type: "recurring_due", title: "Synthetic pre-ledger reminder", body: "Already published",
    dedupeKey: reminderKey(legacyRuleId), metadata: { recurringId: legacyRuleId },
  });
}, 30_000);

afterAll(async () => {
  await stopScheduler();
  // The start marker this run recorded is removed; one that predates it stays.
  if (ownsPeriod && !hadStartMarker && ticks.size > 0) {
    await vi.waitFor(async () => expect(await startMarkers()).toHaveLength(1), { timeout: 5_000, interval: 100 });
    await db.delete(jobs).where(eq(jobs.name, SCHEDULER_START_MARKER));
  }
  if (ownsPeriod) await db.delete(jobs).where(runScope);
  await db.delete(notificationDeliveries).where(inArray(notificationDeliveries.userId, [ownerId]));
  await db.delete(notifications).where(eq(notifications.userId, ownerId));
  await db.delete(recurringTransactions).where(inArray(recurringTransactions.id, [ruleId, legacyRuleId]));
  await db.delete(accounts).where(eq(accounts.id, accountId));
  await db.delete(userNotificationPreferences).where(eq(userNotificationPreferences.userId, ownerId));
  await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
  await db.delete(households).where(eq(households.id, householdId));
  await db.delete(users).where(eq(users.id, ownerId));
});

describe("A-15 the registered scheduler recovers a definite bill reminder failure", () => {
  it("recovers after inbox publication and definite rejection, then closes the same period once", async () => {
    smtp.mockResolvedValueOnce(false);
    let failPendingClaim = false;
    const insert = db.insert.bind(db);
    const insertWithFault: typeof db.insert = table => {
      if (failPendingClaim && Object.is(table, notificationDeliveries)) throw new Error("Synthetic claim connection failure");
      return insert(table);
    };
    const fault = vi.spyOn(db, "insert").mockImplementation(insertWithFault);
    // Only this fixture's household is reminded; another suite's leftover rule
    // counts as checked and not delivered, so it can't fail or close the period.
    const trigger = notificationService.triggerRecurringDue.bind(notificationService);
    const scoped = vi.spyOn(notificationService, "triggerRecurringDue").mockImplementation(
      async (...args: Parameters<typeof trigger>) => args[0].householdId === householdId ? trigger(...args) : 0,
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(slot.getTime() - 8 * 60_000));
      expect(initScheduler({ NODE_ENV: "production" }, SCHEDULED_JOBS.filter(job => job.name === REMINDER_JOB))).toBe(true);
      const tick = ticks.get(REMINDER_JOB);
      const recover = ticks.get(RETRY_TICK);
      expect(tick, "no registered canonical bill reminder tick").toBeDefined();
      expect(recover, "no registered recovery tick").toBeDefined();
      await recover!();
      expect(await remindersInApp()).toBe(0);

      vi.setSystemTime(slot);
      failPendingClaim = true;
      await tick!();
      failPendingClaim = false;
      expect({ emailed: remindersEmailed(), inApp: await remindersInApp() }).toEqual({ emailed: 0, inApp: 1 });
      expect(await deliveries(ruleId)).toMatchObject([{ status: "suppressed", attempts: 0, reason: "scheduled_dispatch_ready" }]);
      expect(await journal()).toMatchObject([{ status: "failed", result: { failed: 1 } }]);

      vi.setSystemTime(new Date(slot.getTime() + 7 * 60_000));
      await recover!();
      expect(await deliveries(ruleId)).toMatchObject([{ status: "failed", reason: "transport_not_accepted" }]);
      expect({ emailed: remindersEmailed(), inApp: await remindersInApp() }).toEqual({ emailed: 1, inApp: 1 });
      expect(await journal()).toMatchObject([
        { status: "failed", result: { failed: 1 } }, { status: "failed", result: { failed: 1 } },
      ]);

      vi.setSystemTime(new Date(slot.getTime() + 22 * 60_000));
      await recover!();
      expect(await journal()).toMatchObject([
        { status: "failed", result: { failed: 1 } },
        { status: "failed", result: { failed: 1 } },
        { status: "completed", result: { failed: 0 } },
      ]);
      expect({ emailed: remindersEmailed(), inApp: await remindersInApp() }).toEqual({ emailed: 2, inApp: 1 });
      expect(await deliveries(ruleId)).toMatchObject([{ status: "sent" }]);
      expect(await deliveries(legacyRuleId)).toEqual([]);

      vi.setSystemTime(new Date(slot.getTime() + 37 * 60_000));
      await recover!();
      expect(await journal()).toHaveLength(3);
      expect({ emailed: remindersEmailed(), inApp: await remindersInApp() }).toEqual({ emailed: 2, inApp: 1 });
    } finally {
      fault.mockRestore();
      scoped.mockRestore();
      vi.useRealTimers();
    }
  }, 30_000);
});
