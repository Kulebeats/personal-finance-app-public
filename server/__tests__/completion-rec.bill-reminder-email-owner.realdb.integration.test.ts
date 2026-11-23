/**
 * REC (owner decision a1): a bill reminder e-mail goes to the rule's owner only.
 *
 * A recurring rule has no owner column; its owner is its account's
 * `ownerUserId`. The e-mail goes to that member when they can still see the
 * rule and are notifiable; otherwise to the household owner under the same
 * visibility check; otherwise to nobody. In-app notices keep today's audience
 * (every notifiable member who can see the rule).
 *
 * Real HTTP cron request, real Postgres, real notification and delivery ledger
 * code. Only SMTP and the web-push wire are stubbed.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  accounts, householdMembers, households, notificationDeliveries, notifications, recurringTransactions,
  userNotificationPreferences, users,
} from "@shared/schema";
import { db, pool } from "../db";
import { sendEmail } from "../services/emailService";
import { notificationService } from "../services/notification";
import { emailDecisionProbe } from "../services/notification/recurring-notice";
import { postCronDoor } from "./cron-door-fixture";
import { getTestApp } from "./fixtures";

vi.mock("../services/emailService", () => ({ sendEmail: vi.fn() }));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }));
const smtp = vi.mocked(sendEmail);

const CRON_SECRET = "synthetic-bill-reminder-owner-cron";
const DAY_MS = 86_400_000;
const householdId = randomUUID();
const ids = {
  alice: randomUUID(), bob: randomUUID(), carol: randomUUID(),
  bobShared: randomUUID(), aliceShared: randomUUID(), carolShared: randomUUID(), unowned: randomUUID(), bobPrivate: randomUUID(), rule: randomUUID(),
};
const members = [ids.alice, ids.bob, ids.carol];
const email = (id: string) => `bill-owner-${id}@example.invalid`;
let app: Awaited<ReturnType<typeof getTestApp>>;

const utcDate = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);

async function runReminderCron() {
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  try {
    expect((await postCronDoor(app, "recurring-reminders", CRON_SECRET)).status).toBe(200);
  } finally {
    vi.unstubAllEnvs();
  }
}

// The cron reminds exactly `reminderDays` before the due date.
async function insertRule(accountId: string) {
  await db.insert(recurringTransactions).values({
    id: ids.rule, householdId, accountId, name: "Water bill", amount: "250.00", type: "expense", frequency: "monthly",
    startDate: utcDate(3), nextDueDate: utcDate(3), reminderDays: 3, detectionMethod: "manual", isActive: true, isPaused: false,
  });
}

const realPreferences = notificationService.getUserPreferences.bind(notificationService);
const emailedMembers = () => members.filter((id) => smtp.mock.calls.some(([message]) => message.to === email(id)));
async function inAppMembers(): Promise<string[]> {
  const rows = await db.select({ userId: notifications.userId }).from(notifications)
    .where(and(inArray(notifications.userId, members), eq(notifications.type, "recurring_due")));
  return members.filter((id) => rows.some((row) => row.userId === id));
}

beforeAll(async () => {
  app = await getTestApp();
  await db.insert(households).values({ id: householdId, name: "Synthetic bill owners", currency: "ZMW" });
  for (const [id, role] of [[ids.alice, "owner"], [ids.bob, "member"], [ids.carol, "member"]] as const) {
    await db.insert(users).values({ id, email: email(id), username: `bill-owner-${id}`, passwordHash: "synthetic-unused", emailVerified: true });
    await db.insert(householdMembers).values({ householdId, userId: id, role });
    await db.insert(userNotificationPreferences).values({ userId: id, notificationType: "recurring_due",
      inAppEnabled: true, emailEnabled: true, pushEnabled: false });
  }
  await db.insert(accounts).values([
    { id: ids.bobShared, householdId, name: "Bob's shared current", type: "checking", currency: "ZMW",
      initialBalance: "0.00", balance: "0.00", isPrivate: false, ownerUserId: ids.bob },
    { id: ids.aliceShared, householdId, name: "Alice's shared current", type: "checking", currency: "ZMW",
      initialBalance: "0.00", balance: "0.00", isPrivate: false, ownerUserId: ids.alice },
    { id: ids.carolShared, householdId, name: "Carol shared current", type: "checking", currency: "ZMW",
      initialBalance: "0.00", balance: "0.00", isPrivate: false, ownerUserId: ids.carol },
    { id: ids.unowned, householdId, name: "Joint current", type: "checking", currency: "ZMW",
      initialBalance: "0.00", balance: "0.00", isPrivate: false, ownerUserId: null },
    { id: ids.bobPrivate, householdId, name: "Bob private", type: "checking", currency: "ZMW",
      initialBalance: "0.00", balance: "0.00", isPrivate: true, ownerUserId: ids.bob },
  ]);
}, 30_000);

/** Puts Carol back as a member if a test removed her. */
async function ensureCarolMember() {
  const [row] = await db.select({ id: householdMembers.id }).from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, ids.carol)));
  if (!row) await db.insert(householdMembers).values({ householdId, userId: ids.carol, role: "member" });
}

beforeEach(async () => {
  smtp.mockReset();
  smtp.mockResolvedValue(true);
  await ensureCarolMember();
  await db.update(householdMembers).set({ role: "member" })
    .where(and(eq(householdMembers.householdId, householdId), inArray(householdMembers.userId, [ids.bob, ids.carol])));
  await db.update(userNotificationPreferences).set({ inAppEnabled: true, emailEnabled: true, pushEnabled: false })
    .where(inArray(userNotificationPreferences.userId, members));
  await db.update(accounts).set({ ownerUserId: ids.bob }).where(eq(accounts.id, ids.bobPrivate));
  await db.delete(notificationDeliveries).where(inArray(notificationDeliveries.userId, members));
  await db.delete(notifications).where(inArray(notifications.userId, members));
  await db.delete(recurringTransactions).where(eq(recurringTransactions.id, ids.rule));
  await db.update(accounts).set({ ownerUserId: ids.alice, isPrivate: false }).where(eq(accounts.id, ids.aliceShared));
  await db.update(accounts).set({ ownerUserId: ids.carol }).where(eq(accounts.id, ids.carolShared));
});

/**
 * Hands Alice's shared account to Bob on the `onCall`-th call of `step` (first by
 * default), then lets it carry on. `makePrivate` also hides it from everyone else.
 */
function handAccountToBobAt(
  step: "getUserPreferences" | "isInQuietHours", { onCall = 1, makePrivate = false } = {},
) {
  const target = notificationService as unknown as Record<typeof step, (...args: unknown[]) => Promise<unknown>>;
  const original = target[step].bind(notificationService);
  let calls = 0;
  vi.spyOn(target, step).mockImplementation(async (...args: unknown[]) => {
    calls += 1;
    if (calls === onCall) {
      await db.update(accounts).set({ ownerUserId: ids.bob, ...(makePrivate && { isPrivate: true }) })
        .where(eq(accounts.id, ids.aliceShared));
    }
    return original(...args);
  });
}

async function emailRow(userId: string) {
  const [row] = await db.select({ status: notificationDeliveries.status, reason: notificationDeliveries.reason })
    .from(notificationDeliveries)
    .where(and(eq(notificationDeliveries.userId, userId), eq(notificationDeliveries.channel, "email")));
  return row;
}
const sentTo = (id: string) => smtp.mock.calls.filter(([message]) => message.to === email(id)).length;
const quietHoursOf = () => vi.spyOn(
  notificationService as unknown as { isInQuietHours: (userId: string) => Promise<boolean> }, "isInQuietHours");
const pause = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); emailDecisionProbe.betweenReads = undefined; });

afterAll(async () => {
  await db.delete(notificationDeliveries).where(inArray(notificationDeliveries.userId, members));
  await db.delete(notifications).where(inArray(notifications.userId, members));
  await db.delete(recurringTransactions).where(eq(recurringTransactions.householdId, householdId));
  await db.delete(accounts).where(eq(accounts.householdId, householdId));
  await db.delete(userNotificationPreferences).where(inArray(userNotificationPreferences.userId, members));
  await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
  await db.delete(households).where(eq(households.id, householdId));
  for (const id of members) {
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [id]);
    await db.delete(users).where(eq(users.id, id));
  }
});

describe("REC bill reminder e-mail goes to the rule's owner only", () => {
  it("a rule on a member's shared account e-mails only that member; in-app reaches everyone who can see it", async () => {
    await insertRule(ids.bobShared);
    await runReminderCron();
    expect(emailedMembers()).toEqual([ids.bob]);
    expect(await inAppMembers()).toEqual([ids.alice, ids.bob, ids.carol]);
  });

  it("a rule on an account with no owner e-mails the household owner", async () => {
    await insertRule(ids.unowned);
    await runReminderCron();
    expect(emailedMembers()).toEqual([ids.alice]);
    expect(await inAppMembers()).toEqual([ids.alice, ids.bob, ids.carol]);
  });

  it("a private rule e-mails its owner and no one who cannot see it", async () => {
    await insertRule(ids.bobPrivate);
    await runReminderCron();
    expect(emailedMembers()).toEqual([ids.bob]);
    expect(await inAppMembers()).toEqual([ids.bob]);
  });

  it("when the owner of a private rule is not notifiable, the household owner who cannot see it gets nothing", async () => {
    await db.update(householdMembers).set({ role: "view_only" })
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, ids.bob)));
    await insertRule(ids.bobPrivate);
    await runReminderCron();
    expect(emailedMembers()).toEqual([]);
    expect(await inAppMembers()).toEqual([]);
  });
});

describe("REC e-mail owner is decided at the send, from the owner then", () => {
  it("a new owner whose notice was already processed still gets the e-mail", async () => {
    await insertRule(ids.carolShared);
    // Alice (first) is processed while Carol owns the account; it moves to Alice on Carol's turn.
    vi.spyOn(notificationService, "getUserPreferences").mockImplementation(async function (this: unknown, ...args) {
      if (args[0] === ids.carol) await db.update(accounts).set({ ownerUserId: ids.alice }).where(eq(accounts.id, ids.carolShared));
      return realPreferences(...args);
    });
    await runReminderCron();
    expect(emailedMembers()).toEqual([ids.alice]);
    expect(await inAppMembers()).toEqual([ids.alice, ids.bob, ids.carol]);
  });

  it("an owner change between two runs for the same due date e-mails the new owner once", async () => {
    await insertRule(ids.aliceShared);
    await runReminderCron();
    expect(emailedMembers()).toEqual([ids.alice]);

    await db.update(accounts).set({ ownerUserId: ids.bob }).where(eq(accounts.id, ids.aliceShared));
    await runReminderCron();
    expect(emailedMembers()).toEqual([ids.alice, ids.bob]);
    expect(smtp.mock.calls.filter(([message]) => message.to === email(ids.alice))).toHaveLength(1);
    expect(smtp.mock.calls.filter(([message]) => message.to === email(ids.bob))).toHaveLength(1);
  });

  it("a second run with no owner change sends nothing again", async () => {
    await insertRule(ids.aliceShared);
    await runReminderCron();
    await runReminderCron();
    expect(smtp.mock.calls).toHaveLength(1);
  });
});

describe("REC e-mail owner is decided with the notice, and re-checked at the send", () => {
  it("an owner change after the audience is read but before publication e-mails the new owner", async () => {
    await insertRule(ids.aliceShared);
    // Alice is first in membership order: the account moves to Bob as her notice starts.
    handAccountToBobAt("getUserPreferences");
    await runReminderCron();
    expect(emailedMembers()).toEqual([ids.bob]);
    expect(await inAppMembers()).toEqual([ids.alice, ids.bob, ids.carol]);
  });

  it("an owner change after publication but before the send suppresses the old owner's e-mail", async () => {
    await insertRule(ids.aliceShared);
    // The first quiet-hours check is Alice's e-mail send, after her notice was published.
    handAccountToBobAt("isInQuietHours");
    await runReminderCron();
    expect(emailedMembers()).toEqual([ids.bob]);
    expect(await emailRow(ids.alice)).toMatchObject({ status: "suppressed", reason: "not_email_owner" });
  });

  it("an ownership transfer between the final check's owner read and visibility read waits for the send", async () => {
    await insertRule(ids.aliceShared);
    // The second decision is the one inside Alice's send; the transfer is started between its two reads.
    let decisions = 0;
    let transfer: Promise<void> | undefined;
    let transferLandedInside: boolean | undefined;
    emailDecisionProbe.betweenReads = async () => {
      decisions += 1;
      if (decisions !== 2) return;
      transfer = db.update(accounts).set({ ownerUserId: ids.bob }).where(eq(accounts.id, ids.aliceShared))
        .then(() => undefined);
      transferLandedInside = await Promise.race([transfer.then(() => true), pause(300).then(() => false)]);
    };
    await runReminderCron();
    await transfer;
    // One state decided the e-mail: Alice owned the account when it went out, and the transfer waited for it.
    expect(transferLandedInside).toBe(false);
    expect(emailedMembers()).toEqual([ids.alice]);
    const [account] = await db.select({ ownerUserId: accounts.ownerUserId }).from(accounts).where(eq(accounts.id, ids.aliceShared));
    expect(account.ownerUserId).toBe(ids.bob);
  });
});

describe("REC an owner who changes hands is reconsidered, never dropped", () => {
  it("a private-account transfer after the owner is chosen, before the send starts, e-mails the new owner", async () => {
    await insertRule(ids.aliceShared);
    // Calls 1-3 are the in-app notices; the 4th is the e-mail gate for Alice, the owner chosen first.
    handAccountToBobAt("getUserPreferences", { onCall: 4, makePrivate: true });
    await runReminderCron();
    expect(emailedMembers()).toEqual([ids.bob]);
  });

  it("a private-account transfer inside the send e-mails the new owner", async () => {
    await insertRule(ids.aliceShared);
    handAccountToBobAt("isInQuietHours", { makePrivate: true });
    await runReminderCron();
    expect(emailedMembers()).toEqual([ids.bob]);
    expect(await emailRow(ids.alice)).toMatchObject({ status: "suppressed", reason: "not_email_owner" });
  });

  it("Alice to Bob and back to Alice: Alice's e-mail is sent once she owns the account again", async () => {
    await insertRule(ids.aliceShared);
    handAccountToBobAt("isInQuietHours");
    await runReminderCron();
    expect(emailedMembers()).toEqual([ids.bob]);
    vi.restoreAllMocks();

    await db.update(accounts).set({ ownerUserId: ids.alice }).where(eq(accounts.id, ids.aliceShared));
    await runReminderCron();
    expect(sentTo(ids.alice)).toBe(1);
    expect(sentTo(ids.bob)).toBe(1);
    expect(await emailRow(ids.alice)).toMatchObject({ status: "sent" });

    await runReminderCron();
    expect(smtp.mock.calls).toHaveLength(2);
  });
});

describe("REC the owner e-mail does not resend what the pre-ledger sender delivered", () => {
  it("an owner whose in-app notice predates the delivery ledger is not e-mailed again", async () => {
    await insertRule(ids.aliceShared);
    // The old sender wrote the in-app row and sent its e-mail without a ledger row.
    await db.insert(notifications).values({
      userId: ids.alice, householdId, type: "recurring_due", title: "Upcoming: Water bill", body: "legacy",
      actionUrl: "/recurring", dedupeKey: `recurring:${ids.rule}:${utcDate(3)}:user:${ids.alice}`,
    });
    await runReminderCron();
    expect(emailedMembers()).toEqual([]);
    expect(await inAppMembers()).toEqual([ids.alice, ids.bob, ids.carol]);
  });
});

describe("REC the e-mail decision holds against a rejoin, a lost view and quiet hours", () => {
  it("a rejoin started inside the decision waits for the send, and the e-mail goes to who is eligible then", async () => {
    await insertRule(ids.carolShared);
    // Carol owns the account but has left, so the household owner Alice is the e-mail owner.
    await db.delete(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, ids.carol)));
    let decisions = 0;
    let rejoin: Promise<void> | undefined;
    let rejoinLandedInside: boolean | undefined;
    emailDecisionProbe.betweenReads = async () => {
      decisions += 1;
      if (decisions !== 2) return;
      // As acceptInvite joins: the household row FOR UPDATE, then the membership row.
      rejoin = db.transaction(async (tx) => {
        await tx.select({ id: households.id }).from(households).where(eq(households.id, householdId)).for("update");
        await tx.insert(householdMembers).values({ householdId, userId: ids.carol, role: "member" });
      });
      rejoinLandedInside = await Promise.race([rejoin.then(() => true), pause(300).then(() => false)]);
    };
    await runReminderCron();
    await rejoin;
    expect(rejoinLandedInside).toBe(false);
    expect(emailedMembers()).toEqual([ids.alice]);
  });

  it("an owner who loses sight of the rule mid-send is e-mailed once it is theirs again", async () => {
    await insertRule(ids.bobPrivate);
    // Inside Bob's send his private account passes to Carol, who is view-only; Alice cannot see it.
    let moved = false;
    quietHoursOf().mockImplementation(async () => {
      if (!moved) {
        moved = true;
        await db.update(accounts).set({ ownerUserId: ids.carol }).where(eq(accounts.id, ids.bobPrivate));
        await db.update(householdMembers).set({ role: "view_only" })
          .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, ids.carol)));
      }
      return false;
    });
    await runReminderCron();
    expect(emailedMembers()).toEqual([]);
    expect(await emailRow(ids.bob)).toMatchObject({ status: "suppressed", reason: "not_visible" });
    vi.restoreAllMocks();

    await db.update(accounts).set({ ownerUserId: ids.bob }).where(eq(accounts.id, ids.bobPrivate));
    await runReminderCron();
    expect(sentTo(ids.bob)).toBe(1);
    expect(await emailRow(ids.bob)).toMatchObject({ status: "sent" });
  });

  it("a member told in-app only who becomes the owner and turns e-mail on is e-mailed for the same due date", async () => {
    await insertRule(ids.aliceShared);
    await db.update(userNotificationPreferences).set({ emailEnabled: false }).where(eq(userNotificationPreferences.userId, ids.carol));
    await runReminderCron();
    expect(emailedMembers()).toEqual([ids.alice]);

    await db.update(accounts).set({ ownerUserId: ids.carol }).where(eq(accounts.id, ids.aliceShared));
    await db.update(userNotificationPreferences).set({ emailEnabled: true }).where(eq(userNotificationPreferences.userId, ids.carol));
    await runReminderCron();
    expect(emailedMembers()).toEqual([ids.alice, ids.carol]);
  });

  it("a former owner's quiet hours do not hold back the new owner's e-mail", async () => {
    await insertRule(ids.aliceShared);
    // Alice is in quiet hours; as her send checks them, her account goes privately to Bob.
    quietHoursOf().mockImplementation(async (userId: string) => {
      if (userId !== ids.alice) return false;
      await db.update(accounts).set({ ownerUserId: ids.bob, isPrivate: true }).where(eq(accounts.id, ids.aliceShared));
      return true;
    });
    await runReminderCron();
    expect(emailedMembers()).toEqual([ids.bob]);
    expect(await emailRow(ids.alice)).toMatchObject({ status: "suppressed", reason: "not_email_owner" });
  });
});
