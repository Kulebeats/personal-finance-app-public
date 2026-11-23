import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import request from "supertest";
import {
  accounts, householdMembers, households, userNotificationPreferences, recurringTransactionHistory,
  recurringTransactionLinks, recurringTransactions, transactions,
} from "@shared/schema";
import { db } from "../../../db";
import { sendEmail } from "../../../services/emailService";
import { householdRepository } from "../../../repositories/HouseholdRepository";
import { recurringService } from "../../../services/RecurringService";
import { weeklyRecapService } from "../weekly-recap.service";
import { sendWeeklyRecapEmail } from "../weekly-recap.email.service";
import { a, actors, app, b, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

// Actual signed routes, recap assembly, recurring SQL and audit; only SMTP is replaced.
vi.mock("../../../services/emailService", () => ({ sendEmail: vi.fn() }));
const smtp = vi.mocked(sendEmail);
const ruleIds = {
  shared: randomUUID(), hidden: randomUUID(), ownerPrivate: randomUUID(), ownerSource: randomUUID(),
  memberPrivate: randomUUID(), memberSource: randomUUID(), historicalOwner: randomUUID(),
  foreignSource: randomUUID(), retainedPaymentRule: randomUUID(), foreign: randomUUID(),
};
const extra = {
  hiddenAccount: randomUUID(), memberAccount: randomUUID(), memberSource: randomUUID(), deletedSharedPayment: randomUUID(),
};
const allRules = Object.values(ruleIds);
type Viewer = Role | "outsider";
function day(offset: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}
function rule(id: string, accountId: string, name: string, amount: string, offset: number) {
  return { id, householdId: a, accountId, name, amount, type: "expense" as const,
    frequency: "monthly" as const, startDate: day(-30), nextDueDate: day(offset) };
}
function getRecap(viewer: Viewer) {
  return request(app).get(`/api/weekly-recap?weekStart=${day(-3)}&weekEnd=${day(3)}`)
    .set("Cookie", actors.get(viewer)!.cookie);
}
const expectedRetainedBill = () => ({
  id: ruleIds.retainedPaymentRule,
  name: "VISIBLE_BILL_AFTER_PAYMENT_DELETION",
  amount: 12.34,
  dueDate: day(3),
  frequency: "monthly",
});
const expectedIds = {
  owner: [ruleIds.ownerSource, ruleIds.ownerPrivate, ruleIds.shared, ruleIds.hidden, ruleIds.historicalOwner],
  member: [ruleIds.memberSource, ruleIds.shared, ruleIds.hidden, ruleIds.memberPrivate],
};
async function clearOwnRows() {
  await db.delete(recurringTransactions).where(inArray(recurringTransactions.id, allRules));
  await db.delete(transactions).where(inArray(transactions.id, [extra.memberSource, extra.deletedSharedPayment]));
  await db.delete(accounts).where(inArray(accounts.id, [extra.hiddenAccount, extra.memberAccount]));
}
async function recipientEmail(viewer: Viewer) {
  const user = await db.query.users.findFirst({ where: (row, { eq }) => eq(row.id, actors.get(viewer)!.id) });
  return user!.email;
}

describe("R04 weekly recap recurring projection follows the signed viewer and digest recipient", () => {
  beforeAll(async () => {
    await start();
    await db.insert(userNotificationPreferences).values(Array.from(actors.values(), actor => ({
      userId: actor.id, notificationType: "weekly_recap", emailEnabled: true,
    })));
  }, 20_000);
  beforeEach(async () => {
    await clearOwnRows();
    await reset();
    smtp.mockReset();
    smtp.mockResolvedValue(true);
    await db.update(households).set({ aiConsentGiven: true }).where(inArray(households.id, [a, b]));
    await db.insert(accounts).values([
      { id: extra.hiddenAccount, householdId: a, name: "DISPLAY_HIDDEN", type: "checking", currency: "ZMW", isHidden: true },
      { id: extra.memberAccount, householdId: a, name: "MEMBER_PRIVATE_ACCOUNT", type: "checking", currency: "ZMW", isPrivate: true, ownerUserId: actors.get("member")!.id },
    ]);
    await db.insert(transactions).values([
      { id: extra.memberSource, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("member")!.id,
        date: day(-5), name: "MEMBER_PRIVATE_SOURCE", amount: "66.66", type: "expense", isPrivate: true },
      { id: extra.deletedSharedPayment, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id,
        date: day(-5), name: "DELETED_SHARED_PAYMENT", amount: "902.34", type: "expense", deletedAt: new Date() },
    ]);
    await db.insert(recurringTransactions).values([
      rule(ruleIds.shared, ids.sharedAccount, "VISIBLE_SHARED_BILL", "11.11", 0),
      rule(ruleIds.hidden, extra.hiddenAccount, "VISIBLE_DISPLAY_HIDDEN_BILL", "22.22", 1),
      rule(ruleIds.ownerPrivate, ids.privateAccount, "OWNER_PRIVATE_BILL", "777.77", -1),
      rule(ruleIds.ownerSource, ids.sharedAccount, "OWNER_PRIVATE_ACCOUNT_SOURCE", "333.33", -2),
      rule(ruleIds.memberPrivate, extra.memberAccount, "MEMBER_PRIVATE_BILL", "55.55", 2),
      rule(ruleIds.memberSource, ids.sharedAccount, "MEMBER_PRIVATE_TRANSACTION_SOURCE", "66.66", -3),
      rule(ruleIds.historicalOwner, ids.sharedAccount, "OWNER_PRIVATE_HISTORY", "44.44", 3),
      rule(ruleIds.foreignSource, ids.sharedAccount, "FOREIGN_SOURCE_MARKER", "901.23", 0),
      rule(ruleIds.retainedPaymentRule, ids.sharedAccount, "VISIBLE_BILL_AFTER_PAYMENT_DELETION", "12.34", 3),
      { ...rule(ruleIds.foreign, ids.foreignAccount, "VISIBLE_FOREIGN_HOUSEHOLD_BILL", "201.00", 0), householdId: b },
    ]);
    await db.insert(recurringTransactionLinks).values([
      { recurringTransactionId: ruleIds.shared, transactionId: ids.sharedTx },
      { recurringTransactionId: ruleIds.ownerSource, transactionId: ids.privateTx },
      { recurringTransactionId: ruleIds.memberSource, transactionId: extra.memberSource },
      { recurringTransactionId: ruleIds.foreignSource, transactionId: ids.foreignTx },
      { recurringTransactionId: ruleIds.retainedPaymentRule, transactionId: extra.deletedSharedPayment },
    ]);
    await db.insert(recurringTransactionHistory).values({
      recurringTransactionId: ruleIds.historicalOwner, action: "updated",
      previousState: { accountId: ids.privateAccount }, newState: { accountId: ids.sharedAccount },
    });
  });
  afterEach(async () => { vi.restoreAllMocks(); await clearOwnRows(); });
  afterAll(async () => { await clearOwnRows(); await stop(); });

  it.each(["admin", "view_only", "professional"] as const)("%s signed recap contains only visible recurring names, IDs, count and total", async viewer => {
    const response = await getRecap(viewer).expect(200);
    expect(response.body.data.recurring).toEqual({
      upcoming: [
        { id: ruleIds.shared, name: "VISIBLE_SHARED_BILL", amount: 11.11, dueDate: day(0), frequency: "monthly" },
        { id: ruleIds.hidden, name: "VISIBLE_DISPLAY_HIDDEN_BILL", amount: 22.22, dueDate: day(1), frequency: "monthly" },
        expectedRetainedBill(),
      ], count: 3, totalAmount: 45.67,
    });
    const body = JSON.stringify(response.body.data.recurring);
    for (const secret of [ruleIds.ownerPrivate, ruleIds.ownerSource, ruleIds.memberPrivate, ruleIds.memberSource,
      ruleIds.historicalOwner, ruleIds.foreignSource, extra.deletedSharedPayment, "DELETED_SHARED_PAYMENT", "777.77", "333.33", "55.55", "66.66", "44.44", "901.23", "902.34"])
      expect(body).not.toContain(secret);
  });

  it.each(["owner", "member"] as const)("%s receives their own private data while another person's private sources stay excluded", async viewer => {
    const response = await getRecap(viewer).expect(200);
    const recurring = response.body.data.recurring;
    const billIds = recurring.upcoming.map((bill: { id: string }) => bill.id);
    expect(billIds.filter((id: string) => id !== ruleIds.retainedPaymentRule)).toEqual(expectedIds[viewer]);
    expect(recurring.upcoming.filter((bill: { id: string }) => bill.id === ruleIds.retainedPaymentRule))
      .toEqual([expectedRetainedBill()]);
    expect(recurring.count).toBe(viewer === "owner" ? 6 : 5);
    expect(recurring.totalAmount).toBe(viewer === "owner" ? 1201.21 : 167.88);
    expect(JSON.stringify(recurring)).not.toContain("902.34");
    expect(JSON.stringify(recurring)).not.toContain(viewer === "owner" ? "MEMBER_PRIVATE" : "OWNER_PRIVATE");
  });

  it("isolates an outsider's signed recap and retains a legitimate foreign-household bill", async () => {
    const response = await getRecap("outsider").expect(200);
    expect(response.body.data.recurring).toMatchObject({ upcoming: [{ id: ruleIds.foreign, amount: 201 }], count: 1, totalAmount: 201 });
    expect(JSON.stringify(response.body.data.recurring)).not.toContain(ruleIds.shared);
    expect(JSON.stringify(response.body.data.recurring)).not.toContain(ruleIds.retainedPaymentRule);
  });

  it.each(["owner", "member", "view_only", "professional"] as const)("%s email digest uses its recipient's projection and never falls back to a household snapshot", async viewer => {
    const email = await recipientEmail(viewer);
    expect(await sendWeeklyRecapEmail(actors.get(viewer)!.id, a, email, day(-3), day(3))).toBe("sent");
    expect(smtp).toHaveBeenCalledTimes(1);
    const message = smtp.mock.calls[0][0];
    expect(message.to).toBe(email);
    const count = viewer === "owner" ? 6 : viewer === "member" ? 5 : 3;
    const total = viewer === "owner" ? "1,201.21" : viewer === "member" ? "167.88" : "45.67";
    expect(message.html).toContain(`Upcoming Bills (${count})`);
    expect(message.html).not.toContain(total);
    expect(message.html).toContain("Total unavailable because bill currency was not recorded");
    expect(message.html).toContain(`11.11 (currency unrecorded) • Due ${day(0)}`);
    expect(message.html).toContain("VISIBLE_SHARED_BILL");
    if (viewer === "view_only" || viewer === "professional") {
      expect(message.html).toContain(expectedRetainedBill().name);
      expect(message.html).toContain(`12.34 (currency unrecorded) • Due ${day(3)}`);
    }
    for (const secret of ["FOREIGN_SOURCE_MARKER", "DELETED_SHARED_PAYMENT", "901.23", "902.34"])
      expect(message.html).not.toContain(secret);
    if (viewer !== "owner") for (const secret of ["OWNER_PRIVATE", "777.77", "333.33", "44.44"])
      expect(message.html).not.toContain(secret);
    if (viewer !== "member") for (const secret of ["MEMBER_PRIVATE", "55.55", "66.66"])
      expect(message.html).not.toContain(secret);
  });

  it("keeps a private linked bill visible only to its owner after the payment is deleted", async () => {
    await db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, extra.memberSource));

    const memberRecap = (await getRecap("member").expect(200)).body.data.recurring;
    expect(memberRecap.upcoming).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ruleIds.memberSource, name: "MEMBER_PRIVATE_TRANSACTION_SOURCE" }),
    ]));
    const ownerRecap = (await getRecap("owner").expect(200)).body.data.recurring;
    expect(JSON.stringify(ownerRecap)).not.toContain(ruleIds.memberSource);

    for (const viewer of ["member", "owner"] as const) {
      const email = await recipientEmail(viewer);
      expect(await sendWeeklyRecapEmail(actors.get(viewer)!.id, a, email, day(-3), day(3))).toBe("sent");
      const message = smtp.mock.calls.find(([sent]) => sent.to === email)?.[0];
      expect(message).toBeDefined();
      if (viewer === "member") expect(message?.html).toContain("MEMBER_PRIVATE_TRANSACTION_SOURCE");
      else {
        expect(message?.html).not.toContain("MEMBER_PRIVATE_TRANSACTION_SOURCE");
        expect(message?.html).not.toContain("66.66");
      }
    }
  });

  it("returns an empty recurring section when the viewer has no visible bills", async () => {
    const visibleIds = [...expectedIds.member, ruleIds.retainedPaymentRule];
    await db.update(recurringTransactions).set({ isActive: false }).where(inArray(recurringTransactions.id, visibleIds));
    expect((await getRecap("member").expect(200)).body.data.recurring).toEqual({ upcoming: [], count: 0, totalAmount: 0 });
  });

  it("rejects a removed or cross-household recipient before generating a financial digest", async () => {
    await db.delete(householdMembers).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id)));
    for (const recipient of [actors.get("member")!.id, actors.get("outsider")!.id]) {
      await expect(weeklyRecapService.getRecap(a, recipient, day(-3), day(3))).rejects.toMatchObject({ statusCode: 403 });
      expect(await sendWeeklyRecapEmail(recipient, a, "synthetic@example.invalid", day(-3), day(3))).toBe("failed");
    }
    expect(smtp).not.toHaveBeenCalled();
  });

  it("rejects an unknown recipient role at the repository seam", async () => {
    const original = householdRepository.findMember.bind(householdRepository);
    vi.spyOn(householdRepository, "findMember").mockImplementation(async (...args) =>
      ({ ...await original(...args), role: "operator" }) as never);
    await expect(weeklyRecapService.getRecap(a, actors.get("member")!.id, day(-3), day(3)))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(await sendWeeklyRecapEmail(actors.get("member")!.id, a, "synthetic@example.invalid", day(-3), day(3))).toBe("failed");
    expect(smtp).not.toHaveBeenCalled();
  });

  it("keeps the internal household-only recurring API available without using it for recipients", async () => {
    const rules = await recurringService.getUpcomingBills(a, 7);
    expect(rules.map(bill => bill.id)).toEqual(expect.arrayContaining([ruleIds.ownerPrivate, ruleIds.memberPrivate]));
    expect(rules.map(bill => bill.id)).not.toContain(ruleIds.foreign);
  });
});
