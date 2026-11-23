/**
 * R14: recurring skip, pause/resume and end-date semantics, pinned over real
 * HTTP against real Postgres (services/recurring/RecurringLifecycleRules.ts).
 *
 * - Skip: one period on, nothing posted, one audit row; repeating a skip for
 *   the same occurrence is an idempotent no-op; skipping a later occurrence is
 *   refused.
 * - Pause/resume: a paused rule never posts, is not upcoming and is not in the
 *   forecast; resume moves to the first occurrence on or after today and never
 *   back-posts the missed ones.
 * - End date: inclusive. The occurrence on endDate posts, and the rule then
 *   shows as ended. A next occurrence after endDate is not upcoming, not
 *   listed as active and not forecast, and a month that starts after endDate
 *   forecasts nothing for the rule.
 *
 * The fixture household has no time zone, so its calendar is UTC.
 */
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, recurringTransactionHistory, recurringTransactions, transactions } from "@shared/schema";
import { db } from "../../../db";
import { recurringService } from "../../../services/RecurringService";
import { a, actors, app, ids, resetAccountsAndMembership, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const endpoint = "/api/recurring";
const DAY_MS = 86_400_000;
const utcDay = (offset: number) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
const nextMonthStart = (offset: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1 + offset, 1)).toISOString().slice(0, 10);
};
const withDay = (monthStart: string, day: number) => `${monthStart.slice(0, 8)}${String(day).padStart(2, "0")}`;

function signed(method: "get" | "post", path: string) {
  const actor = actors.get("member")!;
  return request(app)[method](path).set("Cookie", actor.cookie)
    .set("X-Capital-Subject", actor.id).set("X-Capital-Household", a);
}

async function createRule(body: { name: string; amount: string; frequency: string; nextDueDate: string; endDate?: string }) {
  const response = await signed("post", endpoint).send({
    accountId: ids.sharedAccount, type: "expense", ...body, amount: { amount: body.amount, currency: "ZMW" },
  }).expect(201);
  return response.body.data.id as string;
}

const readRule = async (id: string) => (await db.select().from(recurringTransactions).where(eq(recurringTransactions.id, id)))[0];
const ledgerFor = (id: string) => db.select().from(transactions).where(eq(transactions.recurringTransactionId, id));
const upcomingIds = async () => (await signed("get", `${endpoint}/upcoming?days=30`).expect(200)).body.data.map((r: { id: string }) => r.id);
const listedIds = async () => (await signed("get", endpoint).expect(200)).body.data.map((r: { id: string }) => r.id);
const processDue = () => signed("post", `${endpoint}/process`).set("Content-Type", "application/json").send({}).expect(200);

/** Forecast expenses per forecast month, from the cash-flow report. */
async function forecastExpenses(months: number): Promise<Record<string, string>> {
  const response = await signed("get", "/api/reports/cashflow").query({
    from: utcDay(-30), to: utcDay(0), interval: "month", includeForecast: "true", forecastMonths: String(months),
  }).expect(200);
  const points = response.body.data.series as Array<{ periodStart: string; isForecast?: boolean; expenses: { amount: string } }>;
  return Object.fromEntries(points.filter(point => point.isForecast).map(point => [point.periodStart, point.expenses.amount]));
}

describe("R14 recurring skip, pause and end-date semantics", () => {
  beforeAll(start, 20_000);
  beforeEach(resetAccountsAndMembership);
  afterEach(async () => {
    await db.delete(transactions).where(eq(transactions.householdId, a));
    await db.delete(recurringTransactions).where(eq(recurringTransactions.householdId, a));
  });
  afterAll(stop);

  it("skip moves on exactly one period, posts nothing, audits once and is idempotent for the same occurrence", async () => {
    const id = await createRule({ name: "R14 skip rent", amount: "120.00", frequency: "monthly", nextDueDate: "2027-03-10" });
    const skip = (occurrenceDate: string) => signed("post", `${endpoint}/${id}/skip`).send({ occurrenceDate });

    expect((await skip("2027-03-10").expect(200)).body.data.nextDueDate).toBe("2027-04-10");
    expect((await skip("2027-03-10").expect(200)).body.data.nextDueDate).toBe("2027-04-10");
    expect((await skip("2027-06-10").expect(409)).body.error.code).toBe("CONFLICT");

    expect((await readRule(id)).nextDueDate).toBe("2027-04-10");
    expect(await ledgerFor(id)).toEqual([]);
    const history = await db.select().from(recurringTransactionHistory)
      .where(and(eq(recurringTransactionHistory.recurringTransactionId, id), eq(recurringTransactionHistory.action, "skipped")));
    expect(history).toHaveLength(1);
    const audits = await db.select().from(auditLogs)
      .where(and(eq(auditLogs.entityType, "recurring_rule"), eq(auditLogs.entityId, id), eq(auditLogs.action, "UPDATE")));
    expect(audits).toHaveLength(1);
    expect(audits[0].details).toMatchObject({
      operation: "skip", oldValue: { nextDueDate: "2027-03-10" }, newValue: { nextDueDate: "2027-04-10" },
    });
  });

  it("a paused rule never posts, is not upcoming or forecast, and resume does not back-post", async () => {
    const today = utcDay(0);
    const control = await createRule({ name: "R14 control bill", amount: "50.00", frequency: "monthly", nextDueDate: utcDay(3) });
    const paused = await createRule({ name: "R14 paused daily", amount: "7.00", frequency: "daily", nextDueDate: utcDay(-5) });
    await signed("post", `${endpoint}/${paused}/pause`).expect(200);

    expect(await upcomingIds()).toEqual([control]);
    expect(Object.values(await forecastExpenses(2))).toEqual(["50.00", "50.00"]);
    expect((await processDue()).body.data.created).toBe(0);
    expect(await ledgerFor(paused)).toEqual([]);

    const resumed = (await signed("post", `${endpoint}/${paused}/resume`).expect(200)).body.data;
    expect(resumed).toMatchObject({ isPaused: false, nextDueDate: today });
    await processDue();
    const posted = await ledgerFor(paused);
    expect(posted.length).toBeLessThanOrEqual(1);
    for (const row of posted) expect(row.date >= today).toBe(true);
    expect((await readRule(paused)).nextDueDate > today || posted.length === 0).toBe(true);
  });

  it("the end date is inclusive: the last occurrence posts and the rule then shows as ended everywhere", async () => {
    const today = utcDay(0);
    const lastDay = await createRule({ name: "R14 ends today", amount: "9.00", frequency: "monthly", nextDueDate: today, endDate: today });
    const pastEnd = await createRule({ name: "R14 next after end", amount: "11.00", frequency: "monthly", nextDueDate: utcDay(10), endDate: utcDay(5) });
    const m1 = nextMonthStart(0), m2 = nextMonthStart(1);
    const forecastOnly = await createRule({ name: "R14 ends in month one", amount: "40.00", frequency: "monthly", nextDueDate: withDay(m1, 5), endDate: withDay(m1, 20) });

    await processDue();
    const posted = await ledgerFor(lastDay);
    expect(posted.map(row => row.date)).toEqual([today]);
    const ended = await readRule(lastDay);
    expect(ended).toMatchObject({ isActive: false, totalOccurrences: 1 });
    expect((await signed("get", `${endpoint}/${lastDay}`).expect(200)).body.data.isActive).toBe(false);

    const listed = await listedIds();
    expect(listed).toContain(forecastOnly);
    expect(listed).not.toContain(lastDay);
    expect(listed).not.toContain(pastEnd);
    expect(await upcomingIds()).not.toContain(pastEnd);
    expect(await forecastExpenses(2)).toEqual({ [m1]: "40.00", [m2]: "0.00" });

    const rules = await db.select().from(recurringTransactions).where(inArray(recurringTransactions.id, [pastEnd, forecastOnly]));
    expect(rules.every(rule => rule.totalOccurrences === 0)).toBe(true);
  });

  // A-12: the end date bounds the occurrence, not the run date, so a run a day late still posts the last one.
  it.each([
    { path: "member", run: async () => (await processDue()).body.data.created as number },
    { path: "trusted", run: async () => (await recurringService.processRecurring(a)).created },
  ])("$path run: an occurrence due on an end date that has passed posts exactly once, then the rule is ended", async ({ run }) => {
    const yesterday = utcDay(-1);
    const id = await createRule({ name: "R14 late last occurrence", amount: "13.00", frequency: "monthly", nextDueDate: utcDay(0) });
    // The create path refuses a past due date, so the rule is moved to "due and ending yesterday" directly.
    await db.update(recurringTransactions).set({ nextDueDate: yesterday, endDate: yesterday }).where(eq(recurringTransactions.id, id));

    expect(await run()).toBe(1);
    expect((await ledgerFor(id)).map(row => row.date)).toEqual([yesterday]);
    expect(await readRule(id)).toMatchObject({ isActive: false, totalOccurrences: 1 });

    expect(await run()).toBe(0);
    expect(await ledgerFor(id)).toHaveLength(1);
  });
});
