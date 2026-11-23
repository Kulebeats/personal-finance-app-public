/**
 * #184 follow-up (Astra item 5): a recurring-due notice is bound to one
 * authorization. The rule's content and each recipient's right to see it are
 * read together when the notice is written, and visibility is checked again at
 * the moment an e-mail or push is dispatched.
 *
 * Real HTTP cron request, real Postgres, real notification and delivery ledger
 * code. Only SMTP and the web-push wire are stubbed; a test places a change in
 * the window the finding describes, or holds a real lock open across it.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  accounts, householdMembers, households, notificationDeliveries, notifications, recurringTransactions,
  userNotificationPreferences, userPushSubscriptions, users,
} from "@shared/schema";
import { db, pool } from "../db";
import { hashPassword } from "../auth";
import { notificationService } from "../services/notification";
import { recurringNoticeDedupeKey } from "../services/notification/recurring-notice";
import { sendEmail } from "../services/emailService";
import { postCronDoor } from "./cron-door-fixture";
import { getTestApp } from "./fixtures";
import { deleteSeededSessions, seedLivePushSubscription } from "./push-fixtures";

vi.mock("../services/emailService", () => ({ sendEmail: vi.fn() }));
const pushWire = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: pushWire.send } }));
const smtp = vi.mocked(sendEmail);
// The quiet-hours check runs inside the channel transport, just before a send.
// A test can place a change there; the real check still decides.
const beforeSend = vi.hoisted(() => ({ hook: null as null | ((userId: string) => Promise<void>) }));
vi.mock("../services/notification/quiet-hours", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/notification/quiet-hours")>();
  return { ...actual, isInQuietHours: async (userId: string, at?: Date) => {
    await beforeSend.hook?.(userId);
    return actual.isInQuietHours(userId, at);
  } };
});

const CRON_SECRET = "synthetic-notice-binding-cron";
const DAY_MS = 86_400_000;
const PRIVATE_NAME = "ALICE_PRIVATE_RENT_SENTINEL";
const PRIVATE_AMOUNT = "987.65";
const SHARED_NAME = "Household rent";
const SHARED_AMOUNT = "500.00";
const MOVED_NAME = "Rent on the new joint account";
const MOVED_AMOUNT = "321.00";
const LOCK_WAIT_MS = 5_000;

const householdId = randomUUID();
const ids = {
  alice: randomUUID(), bob: randomUUID(), shared: randomUUID(), sharedB: randomUUID(), private: randomUUID(), rule: randomUUID(),
};
const email = (id: string) => `notice-binding-${id}@example.invalid`;
let app: Awaited<ReturnType<typeof getTestApp>>;

const utcDate = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);

/** The door answers 500 when a send in the run failed (the period stays open for a retry). */
async function runReminderCron(expectedStatus = 200) {
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  try {
    expect((await postCronDoor(app, "recurring-reminders", CRON_SECRET)).status).toBe(expectedStatus);
  } finally {
    vi.unstubAllEnvs();
  }
}

async function noticesFor(userId: string) {
  return db.select().from(notifications).where(eq(notifications.userId, userId));
}
const emailsTo = (userId: string) => smtp.mock.calls.map(([message]) => message).filter(message => message.to === email(userId));

beforeAll(async () => {
  app = await getTestApp();
  await db.insert(households).values({ id: householdId, name: "Synthetic notice binding", currency: "ZMW" });
  const passwordHash = await hashPassword("SyntheticNoticeBinding123!");
  for (const [id, role] of [[ids.alice, "owner"], [ids.bob, "member"]] as const) {
    await db.insert(users).values({ id, email: email(id), username: `notice-binding-${id}`, passwordHash, emailVerified: true });
    await db.insert(householdMembers).values({ householdId, userId: id, role });
    await db.insert(userNotificationPreferences).values({ userId: id, notificationType: "recurring_due",
      inAppEnabled: true, emailEnabled: true, pushEnabled: false });
  }
  await db.insert(accounts).values([
    { id: ids.shared, householdId, name: "Shared current", type: "checking", currency: "ZMW",
      initialBalance: "0.00", balance: "0.00", isPrivate: false, ownerUserId: null },
    { id: ids.sharedB, householdId, name: "Joint savings", type: "checking", currency: "ZMW",
      initialBalance: "0.00", balance: "0.00", isPrivate: false, ownerUserId: null },
    { id: ids.private, householdId, name: "Alice private", type: "checking", currency: "ZMW",
      initialBalance: "0.00", balance: "0.00", isPrivate: true, ownerUserId: ids.alice },
  ]);
}, 30_000);

beforeEach(async () => {
  smtp.mockReset();
  smtp.mockResolvedValue(true);
  pushWire.send.mockReset();
  pushWire.send.mockResolvedValue({ statusCode: 201 });
  await db.delete(userPushSubscriptions).where(inArray(userPushSubscriptions.userId, [ids.alice, ids.bob]));
  await db.update(userNotificationPreferences).set({ inAppEnabled: true, emailEnabled: true, pushEnabled: false })
    .where(inArray(userNotificationPreferences.userId, [ids.alice, ids.bob]));
  await db.delete(notificationDeliveries).where(inArray(notificationDeliveries.userId, [ids.alice, ids.bob]));
  await db.delete(notifications).where(inArray(notifications.userId, [ids.alice, ids.bob]));
  await db.delete(recurringTransactions).where(eq(recurringTransactions.id, ids.rule));
  await db.update(accounts).set({ isPrivate: false, ownerUserId: null }).where(inArray(accounts.id, [ids.shared, ids.sharedB]));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); beforeSend.hook = null; });

afterAll(async () => {
  const userIds = [ids.alice, ids.bob];
  await db.delete(notificationDeliveries).where(inArray(notificationDeliveries.userId, userIds));
  await db.delete(notifications).where(inArray(notifications.userId, userIds));
  await db.delete(userPushSubscriptions).where(inArray(userPushSubscriptions.userId, userIds));
  await deleteSeededSessions(userIds);
  await db.delete(recurringTransactions).where(eq(recurringTransactions.householdId, householdId));
  await db.delete(accounts).where(eq(accounts.householdId, householdId));
  await db.delete(userNotificationPreferences).where(inArray(userNotificationPreferences.userId, userIds));
  await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
  await db.delete(households).where(eq(households.id, householdId));
  for (const id of userIds) {
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [id]);
    await db.delete(users).where(eq(users.id, id));
  }
});

// A bill reminder e-mail goes to the rule's account owner only (REC a1); tests that
// follow Bob's e-mail make him the shared account's owner.
const makeBobSharedOwner = () => db.update(accounts).set({ ownerUserId: ids.bob }).where(eq(accounts.id, ids.shared));

async function insertRule(accountId: string, name: string, amount: string) {
  await db.insert(recurringTransactions).values({
    id: ids.rule, householdId, accountId, name, amount, type: "expense", frequency: "monthly",
    startDate: utcDate(3), nextDueDate: utcDate(3), reminderDays: 3, detectionMethod: "manual", isActive: true, isPaused: false,
  });
}

describe("a recurring-due notice is bound to one authorization (#184 Astra 5)", () => {
  it("never sends the rule's old private content to a member who can only see its new shared version", async () => {
    await makeBobSharedOwner();
    await insertRule(ids.private, PRIVATE_NAME, PRIVATE_AMOUNT);
    // The cron has already read the rule when it hands the notice over; the rule
    // becomes a sanitized shared one in that window.
    const original = notificationService.triggerRecurringDue.bind(notificationService);
    vi.spyOn(notificationService, "triggerRecurringDue").mockImplementation(async notice => {
      await db.update(recurringTransactions).set({ accountId: ids.shared, name: SHARED_NAME, amount: SHARED_AMOUNT })
        .where(eq(recurringTransactions.id, ids.rule));
      return original(notice);
    });

    await runReminderCron();

    const bobNotices = await noticesFor(ids.bob);
    const bobEmails = emailsTo(ids.bob);
    for (const sent of [JSON.stringify(bobNotices), JSON.stringify(bobEmails)]) {
      expect(sent).not.toContain(PRIVATE_NAME);
      expect(sent).not.toContain("987.65");
    }
    expect(bobNotices.map(notice => notice.title)).toEqual([`Upcoming: ${SHARED_NAME}`]);
    expect(bobEmails.map(message => message.subject)).toEqual([`Upcoming: ${SHARED_NAME}`]);
  });

  it("does not dispatch to a member who lost sight of the rule after the notice was written, and records why", async () => {
    await makeBobSharedOwner();
    await insertRule(ids.shared, SHARED_NAME, SHARED_AMOUNT);
    // Just before Bob's send, the account turns private to Alice.
    beforeSend.hook = async (userId) => {
      if (userId === ids.bob) {
        await db.update(accounts).set({ isPrivate: true, ownerUserId: ids.alice }).where(eq(accounts.id, ids.shared));
      }
    };

    await runReminderCron();

    expect(emailsTo(ids.bob)).toEqual([]);
    const [ledger] = await db.select({ status: notificationDeliveries.status, reason: notificationDeliveries.reason })
      .from(notificationDeliveries)
      .where(and(eq(notificationDeliveries.userId, ids.bob), eq(notificationDeliveries.channel, "email")));
    // The account is now Alice's: the e-mail belongs to her (REC a1), decided in the same
    // locked read that says Bob can no longer see the rule.
    expect(ledger).toEqual({ status: "suppressed", reason: "not_email_owner" });
    expect((await noticesFor(ids.alice)).map(notice => notice.title)).toEqual([`Upcoming: ${SHARED_NAME}`]);
    expect(emailsTo(ids.alice).map(message => message.subject)).toEqual([`Upcoming: ${SHARED_NAME}`]);
  });
});

const noticeRef = () => ({ householdId, recurringId: ids.rule, dueDate: utcDate(3) });
const makeSharedAccountAlicePrivate = () =>
  db.update(accounts).set({ isPrivate: true, ownerUserId: ids.alice }).where(eq(accounts.id, ids.shared));
const ledgerRow = async (userId: string, channel: "email" | "push") => {
  const [row] = await db.select({ status: notificationDeliveries.status, reason: notificationDeliveries.reason })
    .from(notificationDeliveries)
    .where(and(eq(notificationDeliveries.userId, userId), eq(notificationDeliveries.channel, channel)));
  return row;
};

/** Resolves true once another backend waits on a lock, false if `settled` finishes first. */
async function lockWaiterAppears(settled: Promise<unknown>): Promise<boolean> {
  let done = false;
  void settled.finally(() => { done = true; });
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (!done && Date.now() < deadline) {
    const { rows } = await pool.query<{ waiting: number }>(
      "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()");
    if (rows[0].waiting > 0) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return false;
}

describe("a recurring-due notice never sends content other than what was authorized (#226 fix-forward)", () => {
  it("does not send the bound content on a retried dispatch after the rule moved to a newly visible account", async () => {
    await makeBobSharedOwner();
    await insertRule(ids.shared, SHARED_NAME, SHARED_AMOUNT);
    smtp.mockImplementation(async message => message.to !== email(ids.bob));
    await runReminderCron(500);
    expect(await ledgerRow(ids.bob, "email")).toMatchObject({ status: "failed" });

    // On the retry, after the content is bound and just before Bob's send: the
    // shared account turns Alice-private and the rule moves to another shared
    // account with a new name and amount. Bob may see the rule again, but not
    // the content that was bound.
    smtp.mockReset();
    smtp.mockResolvedValue(true);
    let moved = false;
    beforeSend.hook = async (userId) => {
      if (userId !== ids.bob || moved) return;
      moved = true;
      await makeSharedAccountAlicePrivate();
      // Bob owns the account the rule moves to, so he stays its e-mail owner (REC a1).
      await db.update(accounts).set({ ownerUserId: ids.bob }).where(eq(accounts.id, ids.sharedB));
      await db.update(recurringTransactions).set({ accountId: ids.sharedB, name: MOVED_NAME, amount: MOVED_AMOUNT })
        .where(eq(recurringTransactions.id, ids.rule));
    };

    await runReminderCron();

    expect(moved).toBe(true);
    expect(emailsTo(ids.bob)).toEqual([]);
    expect(await ledgerRow(ids.bob, "email")).toEqual({ status: "suppressed", reason: "content_changed" });
  });

  it("does not notify about a due date the rule no longer has", async () => {
    await insertRule(ids.shared, SHARED_NAME, SHARED_AMOUNT);
    const original = notificationService.triggerRecurringDue.bind(notificationService);
    vi.spyOn(notificationService, "triggerRecurringDue").mockImplementation(async notice => {
      await db.update(recurringTransactions).set({ nextDueDate: utcDate(10) }).where(eq(recurringTransactions.id, ids.rule));
      return original(notice);
    });

    await runReminderCron();

    expect([...(await noticesFor(ids.alice)), ...(await noticesFor(ids.bob))]).toEqual([]);
    expect(smtp).not.toHaveBeenCalled();
  });

  it("does not write the in-app notice while a privacy change is in flight, and honours it once committed", async () => {
    await insertRule(ids.shared, SHARED_NAME, SHARED_AMOUNT);
    const holder = await pool.connect();
    let waited = false;
    try {
      await holder.query("BEGIN");
      await holder.query("UPDATE accounts SET is_private = true, owner_user_id = $1 WHERE id = $2", [ids.alice, ids.shared]);
      const trigger = notificationService.triggerRecurringDue(noticeRef());
      waited = await lockWaiterAppears(trigger);
      await holder.query("COMMIT");
      await trigger;
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
    }

    expect(waited).toBe(true);
    expect(await noticesFor(ids.bob)).toEqual([]);
    expect(emailsTo(ids.bob)).toEqual([]);
    expect((await noticesFor(ids.alice)).map(notice => notice.title)).toEqual([`Upcoming: ${SHARED_NAME}`]);
  });

  it("treats a concurrent run's notice as already written instead of failing the other recipients", async () => {
    await insertRule(ids.shared, SHARED_NAME, SHARED_AMOUNT);
    const holder = await pool.connect();
    let waited = false;
    let outcome: unknown;
    try {
      await holder.query("BEGIN");
      await holder.query(
        "INSERT INTO notifications (user_id, household_id, type, title, body, dedupe_key) VALUES ($1, $2, 'recurring_due', $3, $4, $5)",
        [ids.bob, householdId, `Upcoming: ${SHARED_NAME}`, "Already written by a concurrent run", recurringNoticeDedupeKey(noticeRef(), ids.bob)]);
      const trigger = notificationService.triggerRecurringDue(noticeRef()).then(count => ({ count }), error => ({ error }));
      waited = await lockWaiterAppears(trigger);
      await holder.query("COMMIT");
      outcome = await trigger;
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
    }

    expect(waited).toBe(true);
    expect(outcome).not.toHaveProperty("error");
    expect(await noticesFor(ids.bob)).toHaveLength(1);
    expect((await noticesFor(ids.alice)).map(notice => notice.title)).toEqual([`Upcoming: ${SHARED_NAME}`]);
  });

  it("re-checks visibility for every push device, not once before the loop", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "synthetic-public");
    vi.stubEnv("VAPID_PRIVATE_KEY", "synthetic-private");
    await insertRule(ids.shared, SHARED_NAME, SHARED_AMOUNT);
    await db.update(userNotificationPreferences).set({ inAppEnabled: false, emailEnabled: false, pushEnabled: true })
      .where(eq(userNotificationPreferences.userId, ids.bob));
    await db.update(userNotificationPreferences).set({ inAppEnabled: false, emailEnabled: false, pushEnabled: false })
      .where(eq(userNotificationPreferences.userId, ids.alice));
    // Two devices, each registered from its own live session, as production does.
    for (const n of [1, 2]) {
      await seedLivePushSubscription(ids.bob, {
        endpoint: `https://fcm.googleapis.com/fcm/send/notice-binding-${n}-${randomUUID()}`,
        keys: { p256dh: "synthetic", auth: "synthetic" },
      });
    }
    // The first device is reached; the account turns private before the second.
    pushWire.send.mockImplementationOnce(async () => { await makeSharedAccountAlicePrivate(); return { statusCode: 201 }; });

    await notificationService.triggerRecurringDue(noticeRef());

    expect(pushWire.send).toHaveBeenCalledTimes(1);
  });
});
