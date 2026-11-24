import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { accounts, households, recurringTransactionHistory, recurringTransactionLinks, recurringTransactions, transactions } from "@shared/schema";
import { shiftCalendarDate } from "@shared/household-calendar";
import { db } from "../../../db";
import { recurringRepository } from "../../../repositories/RecurringRepository";
import { recurringService } from "../../../services/RecurringService";
import { calendarClock } from "../../../services/householdCalendarToday";
import { a, actors, app, ids, resetAccountsAndMembership, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

function signedHeaders(viewer: "owner" | "member") {
  const actor = actors.get(viewer)!;
  return { Cookie: actor.cookie, "X-Capital-Subject": actor.id, "X-Capital-Household": a };
}

function readCalendar(viewer: "owner" | "member", from = "2026-11-01", to = "2026-11-30") {
  return request(app).get("/api/recurring/calendar").query({ from, to })
    .set(signedHeaders(viewer));
}

describe("A-52 signed recurring calendar", () => {
  beforeAll(start, 20_000);
  beforeEach(resetAccountsAndMembership);
  afterAll(stop);
  afterEach(() => vi.restoreAllMocks());

  it("uses household today, the named skip and the current posting state of visible linked payments", async () => {
    vi.spyOn(calendarClock, "now").mockReturnValue(new Date("2026-11-21T22:15:00Z"));
    await db.update(households).set({ timeZone: "Africa/Lusaka" }).where(eq(households.id, a));

    const rule = (name: string, nextDueDate: string, isActive = true) => ({
      id: randomUUID(), householdId: a, accountId: ids.sharedAccount,
      name, nextDueDate, startDate: "2026-11-01", isActive, autoLinkEnabled: false,
      frequency: "monthly" as const, type: "expense" as const, amount: "24.00",
    });
    const rent = rule("Overdue rent", "2026-11-21");
    const internet = rule("Due today", "2026-11-22");
    const phone = rule("Upcoming phone", "2026-11-30");
    const insurance = rule("Completed insurance", "2026-12-13", false);
    const gym = rule("Skipped gym", "2026-11-15");
    const privateRule = rule("Private payment", "2026-12-18");
    const privateAccountRule = rule("Private account payment", "2026-12-19");
    await db.insert(recurringTransactions).values([rent, internet, phone, insurance, gym, privateRule, privateAccountRule]);

    const payment = (date: string, extra: Partial<typeof transactions.$inferInsert> = {}) => ({
      id: randomUUID(), householdId: a, accountId: ids.sharedAccount, name: "Calendar payment",
      type: "expense" as const, date, amount: "26.51", currency: "ZMW", ...extra,
    });
    const posted = payment("2026-11-14");
    const pending = payment("2026-11-19", { status: "pending" });
    await db.insert(transactions).values([posted, pending]);

    // Signed deletion needs a posting receipt. Book these expenses on the
    // funded fixture accounts through the public writer before linking them.
    async function createPayment(accountId: string, date: string, value: string, isPrivate: boolean) {
      const amount = { amount: value, currency: "ZMW" };
      const ownerUserId = isPrivate ? actors.get("owner")!.id : null;
      const response = await request(app).post("/api/transactions").set(signedHeaders("owner")).send({
        accountId, date, name: `A52 privacy witness ${date}`, type: "expense", amount, isPrivate, ownerUserId,
      }).expect(201);
      const id: string = response.body.data.id;
      const [persisted] = await db.select().from(transactions).where(eq(transactions.id, id));
      expect(persisted).toMatchObject({ id, accountId, isPrivate, ownerUserId, deletedAt: null,
        amount: value, currency: "ZMW", postingMode: "posted", postedBalanceDelta: `-${value}` });
      return { id, amount };
    }

    const privatePayment = await createPayment(ids.sharedAccount, "2026-11-18", "731.09", true);
    const privateAccountPayment = await createPayment(ids.privateAccount, "2026-11-19", "26.52", false);
    await db.insert(recurringTransactionLinks).values([
      { recurringTransactionId: insurance.id, transactionId: posted.id, expectedDate: "2026-11-13" },
      { recurringTransactionId: insurance.id, transactionId: pending.id, expectedDate: "2026-11-19" },
      { recurringTransactionId: privateRule.id, transactionId: privatePayment.id, expectedDate: "2026-11-18" },
      { recurringTransactionId: privateAccountRule.id, transactionId: privateAccountPayment.id, expectedDate: "2026-11-19" },
    ]);

    await request(app).post(`/api/recurring/${gym.id}/skip`)
      .set("Cookie", actors.get("owner")!.cookie).send({ occurrenceDate: gym.nextDueDate }).expect(200);

    const member = (await readCalendar("member").expect(200)).body.data;
    expect(member).toEqual([
      expect.objectContaining({ date: "2026-11-13", status: "paid", rule: expect.objectContaining({ id: insurance.id }),
        amount: { amount: "26.51", currency: "ZMW" } }),
      expect.objectContaining({ date: "2026-11-15", status: "skipped", rule: expect.objectContaining({ id: gym.id }) }),
      expect.objectContaining({ date: "2026-11-19", status: "pending", rule: expect.objectContaining({ id: insurance.id }) }),
      expect.objectContaining({ date: "2026-11-21", status: "overdue", rule: expect.objectContaining({ id: rent.id }) }),
      expect.objectContaining({ date: "2026-11-22", status: "due", rule: expect.objectContaining({ id: internet.id }) }),
      expect.objectContaining({ date: "2026-11-30", status: "upcoming", rule: expect.objectContaining({ id: phone.id }) }),
    ]);
    const ownerCalendar = (await readCalendar("owner").expect(200)).body.data;
    expect(ownerCalendar).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: "2026-11-18", status: "paid", amount: privatePayment.amount,
        rule: expect.objectContaining({ id: privateRule.id }) }),
      expect.objectContaining({ date: "2026-11-19", status: "paid", amount: privateAccountPayment.amount,
        rule: expect.objectContaining({ id: privateAccountRule.id }) }),
    ]));

    await db.update(transactions).set({ isPending: true }).where(eq(transactions.id, posted.id));
    expect((await readCalendar("member").expect(200)).body.data[0]).toMatchObject({ status: "pending" });
    await readCalendar("member", "2026-11-01", "2026-12-31").expect(400);

    for (const [rule, source] of [[privateRule, privatePayment], [privateAccountRule, privateAccountPayment]] as const) {
      await request(app).delete(`/api/transactions/${source.id}`).set(signedHeaders("owner")).expect(200);
      const [deleted] = await db.select({ deletedAt: transactions.deletedAt }).from(transactions).where(eq(transactions.id, source.id));
      expect(deleted.deletedAt).toBeInstanceOf(Date);
      await request(app).get(`/api/recurring/${rule.id}`).set(signedHeaders("member")).expect(404);
      const ownerDetail = await request(app).get(`/api/recurring/${rule.id}`).set(signedHeaders("owner"));
      expect.soft(ownerDetail.status).toBe(200);
      expect.soft(ownerDetail.body.data).toMatchObject({ id: rule.id, nextDueDate: rule.nextDueDate });
    }
    const memberList = (await request(app).get("/api/recurring").set(signedHeaders("member")).expect(200)).body.data;
    expect(memberList.map((row: { id: string }) => row.id)).not.toContain(privateRule.id);
    expect(memberList.map((row: { id: string }) => row.id)).not.toContain(privateAccountRule.id);
    await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, ids.privateAccount));
    await request(app).get(`/api/recurring/${privateAccountRule.id}`).set(signedHeaders("owner")).expect(404);
  });

  it("reads back a reopened occurrence, one signed linked payment, and the same month after payment removal", async () => {
    vi.spyOn(calendarClock, "now").mockReturnValue(new Date("2026-11-15T22:15:00Z"));
    await db.update(households).set({ timeZone: null }).where(eq(households.id, a));
    const cookie = actors.get("owner")!.cookie;
    const ruleName = "A52 calendar edit and payment";
    const created = await request(app).post("/api/recurring").set("Cookie", cookie).send({
      accountId: ids.sharedAccount, type: "expense", frequency: "monthly", name: ruleName,
      nextDueDate: "2026-11-14", amount: { amount: "24.00", currency: "ZMW" }, autoLinkEnabled: false,
    }).expect(201);
    const ruleId = created.body.data.id as string;
    const path = `/api/recurring/${ruleId}`;
    const skip = (occurrenceDate: string) => request(app).post(`${path}/skip`)
      .set("Cookie", cookie).send({ occurrenceDate }).expect(200);
    const edit = (nextDueDate: string) => request(app).put(path)
      .set("Cookie", cookie).send({ nextDueDate }).expect(200);
    const occurrences = async () => {
      const { body } = await readCalendar("member").expect(200);
      return (body.data as Array<{ rule: { id: string }; date: string; status: string; amount: unknown }>)
        .filter(row => row.rule.id === ruleId).map(({ date, status, amount }) => ({ date, status, amount }));
    };

    await skip("2026-11-14");
    await edit("2026-11-15");
    await skip("2026-11-15");
    const earlierSkip = { date: "2026-11-14", status: "skipped", amount: null };
    expect(await occurrences()).toEqual([earlierSkip, { date: "2026-11-15", status: "skipped", amount: null }]);

    await edit("2026-11-15");
    expect(await occurrences()).toEqual([
      earlierSkip, { date: "2026-11-15", status: "due", amount: { amount: "24.00", currency: "ZMW" } },
    ]);

    const amount = { amount: "23.78", currency: "ZMW" };
    const payment = await request(app).post("/api/transactions").set("Cookie", cookie).send({
      name: "A52 actual payment", date: "2026-11-14", accountId: ids.sharedAccount, type: "expense", amount,
      ownerUserId: null,
    }).expect(201);
    const transactionId = payment.body.data.id as string;
    await request(app).post(`${path}/link`).set("Cookie", cookie).send({ transactionId }).expect(200);
    expect(await occurrences()).toEqual([earlierSkip, { date: "2026-11-15", status: "paid", amount }]);

    await request(app).delete(`/api/transactions/${transactionId}`).set("Cookie", cookie).expect(200);
    const restored = { amount: "24.00", currency: "ZMW" };
    expect(await occurrences()).toEqual([earlierSkip, { date: "2026-11-15", status: "due", amount: restored }]);
    const detail = await request(app).get(path).set(signedHeaders("member")).expect(200);
    expect(detail.body.data).toMatchObject({ id: ruleId, nextDueDate: "2026-11-15", amount: restored });
    const list = await request(app).get("/api/recurring").set(signedHeaders("member")).expect(200);
    expect(list.body.data).toContainEqual(expect.objectContaining({ id: ruleId, amount: restored }));
    const links = await request(app).get(`${path}/transactions`).set(signedHeaders("member")).expect(200);
    expect(links.body.data).toEqual([]);
    await request(app).post(`${path}/link`).set(signedHeaders("owner")).send({ transactionId }).expect(404);
  });

  it("uses the household midnight for due processing and upcoming bill windows", async () => {
    const utcDate = new Date().toISOString().slice(0, 10);
    const today = shiftCalendarDate(utcDate, 1);
    vi.spyOn(calendarClock, "now").mockReturnValue(new Date(`${utcDate}T22:15:00Z`));
    await db.update(households).set({ timeZone: "Africa/Lusaka" }).where(eq(households.id, a));

    const due = { id: randomUUID(), name: "Midnight bill", nextDueDate: today, endDate: today };
    const boundary = { id: randomUUID(), name: "Last upcoming day", nextDueDate: shiftCalendarDate(today, 7) };
    const later = { id: randomUUID(), name: "Beyond upcoming", nextDueDate: shiftCalendarDate(today, 8) };
    const ended = { id: randomUUID(), name: "Ended yesterday", nextDueDate: utcDate, endDate: utcDate };
    const rules = [due, boundary, later, ended];
    await db.insert(recurringTransactions).values(rules.map<typeof recurringTransactions.$inferInsert>(rule => ({
      ...rule, householdId: a, accountId: ids.sharedAccount, startDate: utcDate,
      frequency: "monthly", type: "expense", amount: "24.00", isActive: true,
    })));

    const owner = signedHeaders("owner");
    const process = (body: object) => request(app).post("/api/recurring/process").set(owner).send(body);
    const dueIds = [ended.id, due.id];
    const expectedUpcoming = [due.id, boundary.id];
    try {
      const defaultPreview = await process({ dryRun: true });
      expect.soft(defaultPreview.status).toBe(200);
      expect.soft(defaultPreview.body.data?.dueRules?.map((rule: { id: string }) => rule.id)).toEqual(dueIds);
      const explicitPreview = await process({ dryRun: true, asOfDate: today });
      expect.soft(explicitPreview.status).toBe(200);
      expect.soft(explicitPreview.body.data?.dueRules?.map((rule: { id: string }) => rule.id)).toEqual(dueIds);
      expect.soft((await process({ dryRun: true, asOfDate: shiftCalendarDate(today, 1) })).status).toBe(400);

      const servicePreview = await recurringService.processRecurring(a, undefined, true);
      expect.soft(servicePreview.dueRules?.map(rule => rule.id)).toEqual(dueIds);
      expect.soft((await recurringRepository.findUpcoming(a, 7)).map(rule => rule.id)).toEqual(expectedUpcoming);
      const upcoming = await request(app).get("/api/recurring/upcoming").set(owner).query({ days: 7 }).expect(200);
      expect.soft(upcoming.body.data.map((rule: { id: string }) => rule.id)).toEqual(expectedUpcoming);
      const summary = await request(app).get("/api/recurring/summary").set(owner).expect(200);
      expect.soft(summary.body.data.upcomingCount).toBe(2);
      const list = await request(app).get("/api/recurring").set(owner).expect(200);
      expect.soft(list.body.data.map((rule: { id: string }) => rule.id)).toEqual([due.id, boundary.id, later.id]);
    } finally {
      await db.delete(recurringTransactions).where(inArray(recurringTransactions.id, rules.map(rule => rule.id)));
    }
  });

  it("posts the next due occurrence once after an advanced payment is deleted", async () => {
    const now = Date.now();
    const date = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString().slice(0, 10);
    const paymentDate = date(2), nextDueDate = date(1), followingDate = date(0);
    const owner = signedHeaders("owner"), member = signedHeaders("member");
    const amount = { amount: "24.00", currency: "ZMW" };
    const created = await request(app).post("/api/recurring").set(owner).send({
      accountId: ids.sharedAccount, type: "expense", frequency: "daily", name: "A52 advanced payment",
      nextDueDate: paymentDate, amount, autoLinkEnabled: false,
    }).expect(201);
    const ruleId: string = created.body.data.id;
    const path = `/api/recurring/${ruleId}`;
    const paid = await request(app).post("/api/transactions").set(owner).send({
      name: "A52 advanced actual payment", date: paymentDate, accountId: ids.sharedAccount,
      type: "expense", amount, ownerUserId: null,
    }).expect(201);
    const transactionId: string = paid.body.data.id;
    await request(app).post(`${path}/link`).set(owner).send({ transactionId }).expect(200);
    expect((await request(app).get(path).set(member).expect(200)).body.data.nextDueDate).toBe(nextDueDate);
    await request(app).delete(`/api/transactions/${transactionId}`).set(owner).expect(200);
    expect((await request(app).get(path).set(member).expect(200)).body.data.nextDueDate).toBe(nextDueDate);
    const readBalance = async () => {
      const [row] = await db.select({ balance: accounts.balance }).from(accounts).where(eq(accounts.id, ids.sharedAccount));
      return row.balance;
    };
    expect(await readBalance()).toBe("988.89");

    const process = () => request(app).post("/api/recurring/process").set(member).send({ asOfDate: nextDueDate }).expect(200);
    expect((await process()).body.data).toMatchObject({ processed: 1, created: 1, errors: [] });
    expect((await process()).body.data).toMatchObject({ processed: 0, created: 0, errors: [] });
    expect((await request(app).get(path).set(member).expect(200)).body.data.nextDueDate).toBe(followingDate);
    expect(await readBalance()).toBe("964.89");
    const rows = await db.select().from(transactions).where(eq(transactions.recurringTransactionId, ruleId)).orderBy(transactions.date);
    expect(rows).toEqual([
      expect.objectContaining({ id: transactionId, date: paymentDate, deletedAt: expect.any(Date) }),
      expect.objectContaining({ date: nextDueDate, amount: "24.00", currency: "ZMW", deletedAt: null }),
    ]);
    const [retained, posted] = rows;
    await request(app).delete(path).set(member).expect(200);
    await request(app).get(path).set(member).expect(404);
    const remaining = await db.select().from(transactions).where(inArray(transactions.id, [retained.id, posted.id]))
      .orderBy(transactions.date);
    expect(remaining[0]).toEqual(retained);
    expect(remaining[1]).toMatchObject({ id: posted.id, recurringTransactionId: null, isRecurring: false,
      amount: posted.amount, postedBalanceDelta: posted.postedBalanceDelta, deletedAt: null });
    expect(await readBalance()).toBe("964.89");
    expect(await db.select().from(recurringTransactionLinks).where(eq(recurringTransactionLinks.recurringTransactionId, ruleId))).toEqual([]);
    expect(await db.select().from(recurringTransactionHistory).where(eq(recurringTransactionHistory.recurringTransactionId, ruleId))).toEqual([]);
  });
});
