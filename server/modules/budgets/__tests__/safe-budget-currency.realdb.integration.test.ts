import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { budgetPeriods, budgets, categories, categoryGroups, transactions } from "@shared/schema";
import { db } from "../../../db";
import { logger } from "../../../utils/logger";
import { a, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

// C3-10: one budget whose limit is not in the household currency must not
// fail budget progress or alerts for every member. It is reported as
// unavailable; every other budget is still computed exactly.
const groupId = randomUUID(), groceries = randomUUID(), transport = randomUUID(), travel = randomUUID();
const groceriesBudget = randomUUID(), transportBudget = randomUUID(), usdBudget = randomUUID();
const date = "2026-02-15";
type Money = { amount: string; currency: string };
type ProgressRow = { id: string; amount: Money; spent: Money; remaining: Money; percentUsed: number };
type AlertRow = { budget: { id: string }; spent: Money; percentUsed: number; alertLevel: string };
type Unavailable = { id: string; name: string; currency: string; reason: { code: string; message: string } };

async function clearBudgets() {
  const owned = await db.select({ id: budgets.id }).from(budgets).where(eq(budgets.householdId, a));
  if (owned.length) await db.delete(budgetPeriods).where(inArray(budgetPeriods.budgetId, owned.map(row => row.id)));
  await db.delete(budgets).where(eq(budgets.householdId, a));
  await db.delete(transactions).where(eq(transactions.householdId, a));
  await db.delete(categories).where(eq(categories.householdId, a));
  await db.delete(categoryGroups).where(eq(categoryGroups.householdId, a));
}
async function expense(categoryId: string, amount: string) {
  await db.insert(transactions).values({ id: randomUUID(), householdId: a, accountId: ids.sharedAccount, categoryId,
    date, name: "Synthetic C3-10 budget posting", amount, type: "expense", currency: "ZMW", isPending: false });
}
const get = (path: string) => request(app).get(path).set("Cookie", actors.get("member")!.cookie);

describe("C3-10 a budget in another currency does not break the household's budget reads", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await reset(); await clearBudgets();
    await db.insert(categoryGroups).values({ id: groupId, householdId: a, name: "C3-10 expenses", type: "expenses", budgetMode: "by_category", isArchived: false, displayOrder: 0 });
    await db.insert(categories).values([
      { id: groceries, householdId: a, groupId, name: "C3-10 groceries", includeInBudget: true, isArchived: false, displayOrder: 0 },
      { id: transport, householdId: a, groupId, name: "C3-10 transport", includeInBudget: true, isArchived: false, displayOrder: 1 },
      { id: travel, householdId: a, groupId, name: "C3-10 travel", includeInBudget: true, isArchived: false, displayOrder: 2 },
    ]);
    // The USD row is inserted directly: the household is ZMW.
    await db.insert(budgets).values([
      { id: groceriesBudget, householdId: a, name: "C3-10 groceries budget", categoryId: groceries, amount: "1000.00", currency: "ZMW", period: "monthly", createdAt: new Date("2026-02-01T00:00:00Z") },
      { id: transportBudget, householdId: a, name: "C3-10 transport budget", categoryId: transport, amount: "500.00", currency: "ZMW", period: "monthly", createdAt: new Date("2026-02-01T00:00:00Z") },
      { id: usdBudget, householdId: a, name: "C3-10 travel budget", categoryId: travel, amount: "200.00", currency: "USD", period: "monthly", createdAt: new Date("2026-02-01T00:00:00Z") },
    ]);
    await expense(groceries, "100.55");
    await expense(groceries, "20.10");
    await expense(transport, "475.00");
    await expense(travel, "300.00");
  });
  afterAll(async () => { await clearBudgets(); await stop(); });

  it("progress returns 200 with exact amounts for the ZMW budgets and marks the USD budget unavailable", async () => {
    const warned = vi.spyOn(logger, "warn");
    const response = await get("/api/budgets/progress?year=2026&month=2").expect(200);
    // Rule 1: the missing conversion is logged on the server, not only surfaced in meta.
    expect(warned).toHaveBeenCalledWith("Budget progress set aside budgets not in the household currency",
      expect.objectContaining({ householdId: a, year: 2026, month: 2, budgets: [{ id: usdBudget, currency: "USD" }] }));
    warned.mockRestore();
    const rows: ProgressRow[] = response.body.data;
    expect(rows.map(row => row.id).sort()).toEqual([groceriesBudget, transportBudget].sort());
    const byId = new Map(rows.map(row => [row.id, row]));
    expect(byId.get(groceriesBudget)).toMatchObject({
      amount: { amount: "1000.00", currency: "ZMW" }, spent: { amount: "120.65", currency: "ZMW" },
      remaining: { amount: "879.35", currency: "ZMW" }, percentUsed: 12.07 });
    expect(byId.get(transportBudget)).toMatchObject({
      amount: { amount: "500.00", currency: "ZMW" }, spent: { amount: "475.00", currency: "ZMW" },
      remaining: { amount: "25.00", currency: "ZMW" }, percentUsed: 95 });
    const unavailable: Unavailable[] = response.body.meta.unavailableBudgets;
    expect(unavailable).toEqual([expect.objectContaining({ id: usdBudget, name: "C3-10 travel budget", currency: "USD",
      reason: expect.objectContaining({ code: "BUDGET_CURRENCY_MISMATCH" }) })]);
    expect(unavailable[0].reason.message).toMatch(/USD/);
    expect(JSON.stringify(rows)).not.toContain(usdBudget);
  });

  it("alerts return 200, alert on the ZMW budget over its threshold, and never alert on the USD budget", async () => {
    const response = await get("/api/budgets/alerts?year=2026&month=2").expect(200);
    const alerts: AlertRow[] = response.body.data;
    expect(alerts).toEqual([expect.objectContaining({ budget: expect.objectContaining({ id: transportBudget }),
      spent: { amount: "475.00", currency: "ZMW" }, percentUsed: 95, alertLevel: "warning" })]);
    const unavailable: Unavailable[] = response.body.meta.unavailableBudgets;
    expect(unavailable.map(row => [row.id, row.reason.code])).toEqual([[usdBudget, "BUDGET_CURRENCY_MISMATCH"]]);
  });

  it("a ZMW budget whose month override is in another currency is unavailable alone", async () => {
    await db.delete(budgets).where(eq(budgets.id, usdBudget));
    await db.insert(budgetPeriods).values({ budgetId: transportBudget, startDate: "2026-02-01", endDate: "2026-02-28",
      budgetAmount: "50.00", currency: "USD", version: 1 });
    const response = await get("/api/budgets/progress?year=2026&month=2").expect(200);
    const rows: ProgressRow[] = response.body.data;
    expect(rows.map(row => row.id)).toEqual([groceriesBudget]);
    expect(rows[0]).toMatchObject({ spent: { amount: "120.65", currency: "ZMW" }, remaining: { amount: "879.35", currency: "ZMW" } });
    expect(response.body.meta.unavailableBudgets.map((row: Unavailable) => [row.id, row.reason.code]))
      .toEqual([[transportBudget, "BUDGET_CURRENCY_MISMATCH"]]);
  });

  it("a household with only household-currency budgets reports no unavailable budgets", async () => {
    await db.delete(budgets).where(eq(budgets.id, usdBudget));
    const response = await get("/api/budgets/progress?year=2026&month=2").expect(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta.unavailableBudgets).toEqual([]);
  });
});
