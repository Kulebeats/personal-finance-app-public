import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { auditLogs, budgetPeriods, budgets, categories, categoryGroups } from "@shared/schema";
import { db } from "../../../db";
import { a, b, actors, app, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const group = randomUUID(), category = randomUUID(), budgetId = randomUUID();
let year: number, month: number, first: string, last: string, nextFirst: string, nextLast: string;
async function clean() {
  await db.delete(budgets).where(inArray(budgets.householdId, [a, b]));
  await db.delete(categories).where(inArray(categories.householdId, [a, b]));
  await db.delete(categoryGroups).where(inArray(categoryGroups.householdId, [a, b]));
}
async function state() {
  return { budgets: await db.select().from(budgets).where(eq(budgets.householdId, a)).orderBy(budgets.id),
    periods: await db.select().from(budgetPeriods).where(eq(budgetPeriods.budgetId, budgetId)).orderBy(budgetPeriods.startDate),
    audit: await db.select().from(auditLogs).where(eq(auditLogs.householdId, a)).orderBy(auditLogs.id) };
}
function edit(currency = "USD", scope = "this_month", amount = "37.50") {
  return request(app).put(`/api/budgets/forecast/${budgetId}`).set("Cookie", actors.get("member")!.cookie)
    .send({ year, month, amount: { amount, currency }, applyScope: scope, ...(scope === "all_future" ? { months: 2 } : {}) });
}
async function period(currency: string, future = false) {
  return db.insert(budgetPeriods).values({ budgetId, startDate: future ? nextFirst : first, endDate: future ? nextLast : last,
    budgetAmount: "25.00", currency, version: 4 });
}

describe("FIN-07 signed forecast edits retain verified target-month denomination", () => {
  beforeAll(async () => {
    await start();
    const clock = await db.execute<{ date: string }>(sql`select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD') as date`);
    const now = new Date(`${clock.rows[0].date}T12:00:00Z`);
    year = now.getUTCFullYear(); month = now.getUTCMonth() + 1;
    first = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
    last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    nextFirst = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    nextLast = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  }, 20_000);
  beforeEach(async () => {
    await reset(); await clean();
    await db.insert(categoryGroups).values({ id: group, householdId: a, name: "Denominated limit", type: "expenses", budgetMode: "by_category", displayOrder: 0 });
    await db.insert(categories).values({ id: category, householdId: a, groupId: group, name: "USD monthly limit", includeInBudget: true, displayOrder: 0 });
    // A month-only shell stores its actual denomination independently of the
    // household's ZMW display preference; NULL never means a zero default.
    await db.insert(budgets).values({ id: budgetId, householdId: a, categoryId: category, name: "Monthly USD limit", amount: null, currency: "USD" });
  });
  afterAll(async () => { await clean(); await stop(); });

  it("reads an absent USD cell and persists an explicitly confirmed USD edit as USD", async () => {
    const read = await request(app).get(`/api/budgets/forecast?year=${year}&month=${month}&months=2`).set("Cookie", actors.get("member")!.cookie).expect(200);
    expect(read.body.data.budgets[0]).toMatchObject({ id: budgetId, amount: null, currency: "USD", periods: [{ amount: null, currency: "USD" }, { amount: null, currency: "USD" }] });
    await edit().expect(200);
    expect((await state()).periods).toMatchObject([{ startDate: first, endDate: last, budgetAmount: "37.50", currency: "USD" }]);
    expect((await state()).budgets[0].amount).toBeNull();
  });
  it("rejects a display-preference currency that disagrees with the absent cell's verified row currency", async () => {
    const before = await state(); await edit("ZMW").expect(409); expect(await state()).toEqual(before);
  });
  it("retains an existing period's actual denomination and increments its version", async () => {
    await period("USD"); await edit().expect(200);
    expect((await state()).periods[0]).toMatchObject({ budgetAmount: "37.50", currency: "USD", version: 5 });
  });
  it("allows an actual period denomination that differs from its row's default denomination", async () => {
    await period("EUR"); await edit("EUR").expect(200);
    expect((await state()).periods[0]).toMatchObject({ budgetAmount: "37.50", currency: "EUR", version: 5 });
    expect((await state()).budgets[0].currency).toBe("USD");
  });
  it("rejects disagreement with an actual period denomination", async () => {
    await period("EUR"); const before = await state(); await edit("USD").expect(409); expect(await state()).toEqual(before);
  });
  it("checks every selected future month before writing, preserving a mixed-currency range atomically", async () => {
    await period("USD"); await period("EUR", true);
    const before = await state(); await edit("USD", "all_future").expect(409); expect(await state()).toEqual(before);
  });
  it("writes an admitted future range in its actual currency without changing the recurring default", async () => {
    await edit("USD", "all_future").expect(200);
    expect((await state()).periods).toMatchObject([{ startDate: first, endDate: last, budgetAmount: "37.50", currency: "USD" },
      { startDate: nextFirst, endDate: nextLast, budgetAmount: "37.50", currency: "USD" }]);
    expect((await state()).budgets[0].amount).toBeNull();
  });
  it.each([null, { amount: "-1.00", currency: "USD" }])("keeps ordinary manual validation closed for invalid amount %j", async amount => {
    const before = await state();
    await request(app).put(`/api/budgets/forecast/${budgetId}`).set("Cookie", actors.get("member")!.cookie).send({ year, month, amount }).expect(400);
    expect(await state()).toEqual(before);
  });
});
