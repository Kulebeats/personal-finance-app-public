// Review follow-ups on the merged budget slices, over real HTTP and Postgres.
// R5-03: "this month only" chosen while viewing a later month creates a budget
//        with no recurring default and only that month's limit. With rollover
//        on, that month's progress must not walk back into months the budget
//        never had a limit for and fail.
// R5-04: the historical preview reads categories in a group typed 'expense'
//        (singular), as progress and spend already do.
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, budgets, categories, categoryGroups, householdPreferences, transactions } from "@shared/schema";
import { db } from "../../../db";
import { a, b, actors, app, ids, resetAccountsAndMembership, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const group = randomUUID(), category = randomUUID();
const zmw = (amount: string) => ({ amount, currency: "ZMW" });
let year: number, month: number, nextYear: number, nextMonth: number, lastMonthDay: string;

const member = (call: request.Test) => {
  const actor = actors.get("member")!;
  return call.set("Cookie", actor.cookie).set("X-Capital-Subject", actor.id).set("X-Capital-Household", a);
};
async function clean() {
  await db.delete(transactions).where(inArray(transactions.householdId, [a, b]));
  await db.delete(budgets).where(inArray(budgets.householdId, [a, b]));
  await db.delete(categories).where(inArray(categories.householdId, [a, b]));
  await db.delete(categoryGroups).where(inArray(categoryGroups.householdId, [a, b]));
  await db.delete(auditLogs).where(inArray(auditLogs.householdId, [a, b]));
  await db.delete(householdPreferences).where(inArray(householdPreferences.householdId, [a, b]));
}
async function seedGroup(type: "expense" | "expenses") {
  await db.insert(categoryGroups).values({ id: group, householdId: a, name: "Astra R5", type, budgetMode: "by_category", displayOrder: 0 });
  await db.insert(categories).values({ id: category, householdId: a, groupId: group, name: "Astra R5 groceries", includeInBudget: true, displayOrder: 0 });
}

describe("Astra R5 budget follow-ups", () => {
  beforeAll(async () => {
    await start();
    await resetAccountsAndMembership();
    const clock = await db.execute<{ date: string }>(sql`select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD') as date`);
    const now = new Date(`${clock.rows[0].date}T12:00:00Z`);
    year = now.getUTCFullYear(); month = now.getUTCMonth() + 1;
    const next = new Date(Date.UTC(year, month, 1));
    nextYear = next.getUTCFullYear(); nextMonth = next.getUTCMonth() + 1;
    lastMonthDay = new Date(Date.UTC(year, month - 2, 15)).toISOString().slice(0, 10);
  }, 60_000);
  beforeEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  it("R5-03: a month-only budget for next month shows in that month's progress with rollover on", async () => {
    await seedGroup("expenses");
    await db.insert(householdPreferences).values({ householdId: a, autoRolloverBudget: true, rolloverPercentage: 100 });
    const created = await member(request(app).post("/api/budgets")).send({ name: "Astra R5 groceries", categoryId: category,
      amount: zmw("500.00"), period: "monthly", onlyFor: { year: nextYear, month: nextMonth } }).expect(201);
    const [stored] = await db.select().from(budgets).where(eq(budgets.householdId, a));
    expect(stored).toMatchObject({ id: created.body.data.id, amount: null });
    await db.update(budgets).set({ rolloverEnabled: true }).where(eq(budgets.id, stored.id));

    // This month the budget has no limit; next month is its first.
    const progress = await member(request(app).get(`/api/budgets/progress?year=${nextYear}&month=${nextMonth}`));
    expect(progress.status).toBe(200);
    expect(progress.body.data).toEqual([expect.objectContaining({ id: stored.id })]);
  });

  it("R5-04: the historical preview includes a category in an 'expense'-typed group", async () => {
    await seedGroup("expense");
    await db.insert(transactions).values({ householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("member")!.id,
      categoryId: category, date: lastMonthDay, name: "Astra R5 last month", amount: "90.00", currency: "ZMW", type: "expense",
      source: "manual", isPending: false, isPrivate: false });
    const preview = await member(request(app).get("/api/budgets/recalculate/preview?months=3")).expect(200);
    expect(preview.body.data.suggestions).toEqual([
      expect.objectContaining({ categoryId: category, categoryGroupId: null, historicalTotal: zmw("90.00") }),
    ]);
  });
});
