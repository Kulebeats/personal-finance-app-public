import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { households, notificationDeliveries, recurringTransactions, userNotificationPreferences, users } from "@shared/schema";
import { db } from "../../../db";
import { sendEmail } from "../../../services/emailService";
import { processWeeklyRecapEmails } from "../weekly-recap.email.service";
import { a, actors, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

/**
 * Astra A-26: the scheduled Monday e-mail lists the bills due in the next
 * seven household days from the send date, not the bills of the spending week
 * that just ended (which the daily recurring job has already moved forward).
 * The entry the scheduler calls runs at a fixed household day; the digest
 * reads and visibility are real Postgres, and only SMTP is a stub.
 */
vi.mock("../../../services/emailService", () => ({ sendEmail: vi.fn() }));
const smtp = vi.mocked(sendEmail);

const LUSAKA = "Africa/Lusaka"; // UTC+2, no daylight saving.
const SEND_INSTANT = new Date("2026-12-07T08:00:00Z"); // Monday 7 Dec, 10:00 in Lusaka.

const SHARED_BILL = "A26_SHARED_BILL_WED";
const PRIVATE_BILL = "A26_PRIVATE_BILL_THU";
const LATE_BILL = "A26_SHARED_BILL_NEXT_MONDAY";
const billIds = [randomUUID(), randomUUID(), randomUUID()];
const recipients: readonly Role[] = ["owner", "member"];

async function emailOf(role: Role): Promise<string> {
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, actors.get(role)!.id));
  return row.email;
}

/** The one digest sent to this member by the run, as HTML. */
async function digestFor(role: Role): Promise<{ subject: string; html: string }> {
  const to = await emailOf(role);
  const sent = smtp.mock.calls.map(([message]) => message).filter((message) => message.to === to);
  expect(sent).toHaveLength(1);
  return { subject: sent[0].subject, html: sent[0].html };
}

describe("Astra A-26: the scheduled recap's upcoming bills are the next seven household days", () => {
  beforeAll(async () => {
    await start();
    await db.insert(userNotificationPreferences).values(recipients.map((role) => ({
      userId: actors.get(role)!.id, notificationType: "weekly_recap", emailEnabled: true,
    })));
  }, 20_000);
  beforeEach(async () => {
    // The bills reference fixture accounts, so they go before the accounts do.
    await db.delete(recurringTransactions).where(inArray(recurringTransactions.id, billIds));
    await reset();
    // OPS-007: one recap per user and week; each case starts with none sent.
    await db.delete(notificationDeliveries).where(inArray(notificationDeliveries.userId, recipients.map((role) => actors.get(role)!.id)));
    smtp.mockReset();
    smtp.mockResolvedValue(true);
    await db.update(households).set({ aiConsentGiven: true, timeZone: LUSAKA }).where(eq(households.id, a));
    const bill = { householdId: a, amount: "42.00", type: "expense" as const, frequency: "monthly" as const, startDate: "2026-11-01" };
    await db.insert(recurringTransactions).values([
      { ...bill, id: billIds[0], accountId: ids.sharedAccount, name: SHARED_BILL, nextDueDate: "2026-12-09" },
      // On the owner's private account (A5 PRIVATE): the owner's alone.
      { ...bill, id: billIds[1], accountId: ids.privateAccount, name: PRIVATE_BILL, nextDueDate: "2026-12-10" },
      // Seven days after the send date: outside the next seven days.
      { ...bill, id: billIds[2], accountId: ids.sharedAccount, name: LATE_BILL, nextDueDate: "2026-12-14" },
    ]);
    vi.useFakeTimers({ toFake: ["Date"], now: SEND_INSTANT });
  });
  afterEach(() => { vi.useRealTimers(); });
  afterAll(async () => {
    await db.delete(recurringTransactions).where(inArray(recurringTransactions.id, billIds));
    await db.delete(userNotificationPreferences).where(inArray(userNotificationPreferences.userId, recipients.map((role) => actors.get(role)!.id)));
    await db.delete(notificationDeliveries).where(inArray(notificationDeliveries.userId, recipients.map((role) => actors.get(role)!.id)));
    await stop();
  });

  it("lists a bill due this week in the Monday e-mail, while the spending week stays the week that ended", async () => {
    await processWeeklyRecapEmails();

    const owner = await digestFor("owner");
    expect(owner.subject).toContain("(2026-11-30 to 2026-12-06)");
    expect(owner.html).toContain(SHARED_BILL);
    expect(owner.html).toContain(PRIVATE_BILL);
    expect(owner.html).not.toContain(LATE_BILL);
  });

  it("applies each recipient's own visibility to the upcoming bills", async () => {
    await processWeeklyRecapEmails();

    const member = await digestFor("member");
    expect(member.html).toContain(SHARED_BILL);
    expect(member.html).not.toContain(PRIVATE_BILL);
    expect(member.html).not.toContain(LATE_BILL);
  });
});
