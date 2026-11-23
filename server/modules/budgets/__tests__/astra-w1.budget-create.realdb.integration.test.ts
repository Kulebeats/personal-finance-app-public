/**
 * Astra post-takeover review, wave 1 (lane 5), over real HTTP and Postgres.
 *
 * A-13: a non-ZMW household's flex budget is created in the household's
 *       currency, so its first edit saves and it shows in progress.
 * A-16: "This month only" on an unbudgeted category creates the budget with
 *       no recurring default and that month's limit, in one request.
 * A-23: an ordinary budget create and its audit row commit together, so a
 *       failed audit insert leaves no budget behind.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, budgetPeriods, budgets, categories, categoryGroups, households } from "@shared/schema";
import { db, pool } from "../../../db";
import { a, b, actors, app, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const group = randomUUID(), category = randomUUID();
const fault = `astra_w1_budget_${randomUUID().replaceAll("-", "")}`;
let year: number, month: number, nextYear: number, nextMonth: number;

const member = (call: request.Test) => {
  const actor = actors.get("member")!;
  return call.set("Cookie", actor.cookie).set("X-Capital-Subject", actor.id).set("X-Capital-Household", a);
};
const createBody = (extra: Record<string, unknown> = {}) => ({
  name: "Groceries", categoryId: category, amount: { amount: "500.00", currency: "ZMW" }, period: "monthly", ...extra,
});
const householdBudgets = () => db.select().from(budgets).where(eq(budgets.householdId, a));
const periodsOf = (ids: string[]) => ids.length
  ? db.select().from(budgetPeriods).where(inArray(budgetPeriods.budgetId, ids)).orderBy(budgetPeriods.startDate)
  : Promise.resolve([]);
const budgetAudits = () => db.select().from(auditLogs)
  .where(and(eq(auditLogs.householdId, a), eq(auditLogs.entityType, "budget")));

async function blockBudgetAudit() {
  await pool.query(`CREATE OR REPLACE FUNCTION ${fault}() RETURNS trigger AS $$ BEGIN
      IF NEW.entity_type = 'budget' THEN RAISE EXCEPTION 'Synthetic A-23 budget audit failure'; END IF; RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE TRIGGER ${fault} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${fault}()`);
}
async function unblockBudgetAudit() {
  await pool.query(`DROP TRIGGER IF EXISTS ${fault} ON audit_logs`);
  await pool.query(`DROP FUNCTION IF EXISTS ${fault}()`);
}
async function clean() {
  await db.delete(budgets).where(inArray(budgets.householdId, [a, b]));
  await db.delete(categories).where(inArray(categories.householdId, [a, b]));
  await db.delete(categoryGroups).where(inArray(categoryGroups.householdId, [a, b]));
  await db.delete(auditLogs).where(inArray(auditLogs.householdId, [a, b]));
}

describe("Astra wave 1: budget create currency, month-only scope and audit atomicity", () => {
  beforeAll(async () => {
    await start();
    const clock = await db.execute<{ date: string }>(sql`select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD') as date`);
    const now = new Date(`${clock.rows[0].date}T12:00:00Z`);
    year = now.getUTCFullYear(); month = now.getUTCMonth() + 1;
    const next = new Date(Date.UTC(year, month, 1));
    nextYear = next.getUTCFullYear(); nextMonth = next.getUTCMonth() + 1;
  }, 30_000);
  beforeEach(async () => {
    await clean();
    await db.insert(categoryGroups).values({ id: group, householdId: a, name: "Astra W1", type: "expenses", budgetMode: "by_category", displayOrder: 0 });
    await db.insert(categories).values({ id: category, householdId: a, groupId: group, name: "Groceries", includeInBudget: true, displayOrder: 0 });
  });
  afterEach(async () => {
    await unblockBudgetAudit();
    await db.update(households).set({ currency: "ZMW" }).where(eq(households.id, a));
  });
  afterAll(async () => { await unblockBudgetAudit(); await clean(); await stop(); });

  describe("A-13 flex budget in a USD household", () => {
    beforeEach(async () => { await db.update(households).set({ currency: "USD" }).where(eq(households.id, a)); });

    it("is created in USD, takes its first USD edit, and shows in progress on reload", async () => {
      const created = await member(request(app).post("/api/budgets/flex")).send({}).expect(200);
      expect(created.body.data).toMatchObject({ isFlexBucket: true, amount: { amount: "0.00", currency: "USD" } });
      const [stored] = await householdBudgets();
      expect({ id: stored.id, currency: stored.currency }).toEqual({ id: created.body.data.id, currency: "USD" });

      await member(request(app).put(`/api/budgets/${stored.id}`)).send({ amount: { amount: "1500.00", currency: "USD" } }).expect(200);
      expect((await householdBudgets())[0]).toMatchObject({ amount: "1500.00", currency: "USD" });

      const progress = await member(request(app).get(`/api/budgets/progress?year=${year}&month=${month}`)).expect(200);
      expect(progress.body.meta.unavailableBudgets).toEqual([]);
      expect(progress.body.data).toEqual([expect.objectContaining({ id: stored.id, isFlexBucket: true })]);
    });
  });

  describe("A-16 this month only on an unbudgeted category", () => {
    it("creates no recurring default and only the selected month's limit", async () => {
      const created = await member(request(app).post("/api/budgets"))
        .send(createBody({ onlyFor: { year, month } })).expect(201);
      const [stored] = await householdBudgets();
      expect(stored).toMatchObject({ id: created.body.data.id, categoryId: category, amount: null, currency: "ZMW" });
      expect(await periodsOf([stored.id])).toMatchObject([{ budgetAmount: "500.00", currency: "ZMW" }]);

      const forecast = await member(request(app).get(`/api/budgets/forecast?year=${year}&month=${month}&months=2`)).expect(200);
      expect(forecast.body.data.budgets).toHaveLength(1);
      expect(forecast.body.data.budgets[0].periods).toEqual([
        { year, month, amount: { amount: "500.00", currency: "ZMW" }, currency: "ZMW" },
        { year: nextYear, month: nextMonth, amount: null, currency: "ZMW" },
      ]);
      expect(await budgetAudits()).toMatchObject([{ action: "CREATE", entityId: stored.id, userId: actors.get("member")!.id }]);
    });

    it("leaves neither the budget nor the month's limit when the audit insert fails", async () => {
      await blockBudgetAudit();
      await member(request(app).post("/api/budgets")).send(createBody({ onlyFor: { year, month } })).expect(500);
      expect(await householdBudgets()).toEqual([]);
      expect(await budgetAudits()).toEqual([]);
    });
  });

  describe("A-23 ordinary budget create and its audit row", () => {
    it("commits the budget with exactly one CREATE audit row", async () => {
      const created = await member(request(app).post("/api/budgets")).send(createBody()).expect(201);
      const [stored] = await householdBudgets();
      expect(stored).toMatchObject({ id: created.body.data.id, amount: "500.00", currency: "ZMW" });
      expect(await periodsOf([stored.id])).toEqual([]);
      expect(await budgetAudits()).toMatchObject([{ action: "CREATE", entityId: stored.id, userId: actors.get("member")!.id }]);
    });

    it("leaves no budget behind when the audit insert fails", async () => {
      await blockBudgetAudit();
      await member(request(app).post("/api/budgets")).send(createBody()).expect(500);
      expect(await householdBudgets()).toEqual([]);
      expect(await budgetAudits()).toEqual([]);
    });
  });
});
