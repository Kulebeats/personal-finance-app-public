import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, budgets, budgetPeriods, categories, transactions } from "@shared/schema";
import { db } from "../../../db";
import { AIAnalyticsService } from "../../ai/ai.analytics.service";
import { a, actors, app, ids, resetAccountsAndMembership, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";
import { analyticsCache } from "../../../services/AnalyticsCache";

const categoryId = randomUUID(), budgetId = randomUUID();
function report(path: string, role: "owner" | "admin" = "owner") {
  const actor = actors.get(role)!;
  return request(app).get(`/api/reports/${path}`).set("Cookie", actor.cookie)
    .set("X-Capital-Subject", actor.id).set("X-Capital-Household", a);
}
async function override(first: string, last: string, currency: string) {
  await db.insert(budgetPeriods).values({ budgetId, startDate: first, endDate: last, budgetAmount: "100", currency });
}
describe("effective monthly limits in report and assistant readers", () => {
  beforeAll(async () => { await start(); }, 20_000);
  beforeEach(async () => {
    await resetAccountsAndMembership();
    await db.insert(categories).values({ id: categoryId, householdId: a, name: "Window test category", displayOrder: 0 });
    await db.insert(budgets).values({ id: budgetId, householdId: a, categoryId, name: "Monthly limit", amount: "100", currency: "ZMW" });
    await db.insert(transactions).values({ householdId: a, accountId: ids.sharedAccount, categoryId,
      name: "Posted expense", amount: "20", type: "expense", currency: "ZMW", date: "2026-11-05" });
    await analyticsCache.invalidateHousehold(a);
  });
  afterEach(async () => {
    await db.delete(budgets).where(eq(budgets.id, budgetId));
    await db.delete(categories).where(eq(categories.id, categoryId));
  });
  afterAll(async () => { await stop(); });

  it("returns the same two monthly limits whether November is implicit or explicitly saved", async () => {
    const path = "cashflow/budget?from=2026-10-01&to=2026-11-30&interval=month";
    const before = (await report(path).expect(200)).body.data.summary.totalBudgeted;
    await override("2026-11-01", "2026-11-30", "ZMW");
    await analyticsCache.invalidateHousehold(a);
    const after = (await report(path).expect(200)).body.data.summary.totalBudgeted;
    expect({ before, after }).toEqual({ before: { amount: "200.00", currency: "ZMW" }, after: { amount: "200.00", currency: "ZMW" } });
  });
  it.each([
    "cashflow/budget?from=2026-11-01&to=2026-11-30&interval=month",
    "cashflow?from=2026-10-01&to=2026-10-31&interval=month&includeForecast=true&forecastMonths=1",
  ])("withholds a foreign override when a signed report has no verified conversion: %s", async path => {
    await override("2026-11-01", "2026-11-30", "USD");
    const result = await report(path).expect(422);
    expect(result.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
  });
  it("checks the effective currency on the local assistant budget tool", async () => {
    const now = new Date();
    const first = now.toISOString().slice(0, 7) + "-01";
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()+1, 0)).toISOString().slice(0, 10);
    await override(first, last, "USD");
    await expect(new AIAnalyticsService().getBudgetStatus({ householdId: a, userId: actors.get("owner")!.id, currency: "ZMW" }))
      .rejects.toMatchObject({ code: "FINANCIAL_DATA_UNAVAILABLE" });
  });
  it("withholds progress when its month limit has no verified conversion", async () => {
    // C3-10, coordinator decision 17 Nov 2026: progress withholds only this budget (named, with its reason); was a household-wide 422.
    const otherCategory = randomUUID(), otherBudget = randomUUID();
    await db.insert(categories).values({ id: otherCategory, householdId: a, name: "Window other category", displayOrder: 1 });
    await db.insert(budgets).values({ id: otherBudget, householdId: a, categoryId: otherCategory, name: "Other limit", amount: "55", currency: "ZMW" });
    try {
      await override("2026-11-01", "2026-11-30", "USD");
      const res = await request(app).get("/api/budgets/progress?year=2026&month=11").set("Cookie", actors.get("owner")!.cookie).expect(200);
      expect(res.body.data.map((row: { id: string }) => row.id)).toEqual([otherBudget]);
      expect(res.body.data[0].amount).toEqual({ amount: "55.00", currency: "ZMW" });
      expect(res.body.meta.unavailableBudgets).toEqual([expect.objectContaining({ id: budgetId, currency: "USD",
        reason: expect.objectContaining({ code: "BUDGET_CURRENCY_MISMATCH" }) })]);
      expect(res.body.meta.unavailableBudgets[0]).not.toHaveProperty("amount");
      expect(JSON.stringify(res.body.data)).not.toContain(budgetId);
      expect(JSON.stringify(res.body)).not.toMatch(/"100(\.00)?"/);
    } finally {
      await db.delete(budgets).where(eq(budgets.id, otherBudget));
      await db.delete(categories).where(eq(categories.id, otherCategory));
    }
  });
  it("ignores a foreign limit for a category with no actuals in this comparison", async () => {
    await override("2026-10-01", "2026-10-31", "USD");
    const result = await report("cashflow/budget?from=2026-10-01&to=2026-10-31&interval=month").expect(200);
    expect(result.body.data.summary.totalBudgeted).toEqual({ amount: "0.00", currency: "ZMW" });
  });
  it("rejects only relevant visible foreign spending in the assistant budget status", async () => {
    const now = new Date(), today = now.toISOString().slice(0, 10);
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    const context = { householdId: a, userId: actors.get("member")!.id, currency: "ZMW" };
    const ai = new AIAnalyticsService();
    const baseline = (await ai.getBudgetStatus(context)).find(r => r.categoryId === categoryId)!.spent.toString();
    const expense = { householdId: a, accountId: ids.sharedAccount, categoryId, ownerUserId: actors.get("owner")!.id,
      name: "Foreign expense", amount: "12", type: "expense" as const, currency: "USD", date: today };
    await db.insert(transactions).values([{ ...expense, date: next }, { ...expense, isPrivate: true }, { ...expense, categoryId: null }]);
    expect((await ai.getBudgetStatus(context)).find(r => r.categoryId === categoryId)!.spent.toString()).toBe(baseline);
    await db.insert(transactions).values(expense);
    await expect(ai.getBudgetStatus(context)).rejects.toMatchObject({ code: "FINANCIAL_DATA_UNAVAILABLE" });
  });
  it.each(["hidden", "archived", "excluded"] as const)("keeps %s activity out of the assistant budget", async restriction => {
    const today = new Date().toISOString().slice(0, 10);
    const actor = actors.get("owner")!;
    const [account] = await db.insert(accounts).values({
      householdId: a, ownerUserId: actor.id, name: "Restricted activity", type: "checking", currency: "ZMW",
      isPrivate: false, hideTransactions: restriction === "hidden", isArchived: restriction === "archived",
    }).returning({ id: accounts.id });
    const context = { householdId: a, userId: actor.id, currency: "ZMW" };
    const ai = new AIAnalyticsService();
    const readSpent = async () => (await ai.getBudgetStatus(context)).find(row => row.categoryId === categoryId)!.spent.toString();
    const before = await readSpent();
    await db.insert(transactions).values({ householdId: a, accountId: account.id, categoryId, ownerUserId: actor.id,
      name: "Restricted expense", amount: "12", type: "expense", currency: "USD", date: today,
      isExcludedFromReports: restriction === "excluded" });
    expect(await readSpent()).toBe(before);
  });
  it("withholds private-account activity and its foreign-limit signal from another household member", async () => {
    const path = "cashflow/budget?from=2026-10-01&to=2026-10-31&interval=month&scope=household";
    await db.insert(transactions).values({ householdId: a, accountId: ids.privateAccount, categoryId,
      ownerUserId: actors.get("owner")!.id, name: "Private expense", amount: "777.77",
      type: "expense", currency: "ZMW", date: "2026-10-05" });
    const visible = await report(path, "owner").expect(200);
    expect(visible.body.data.summary.totalBudgeted.amount).toBe("100.00");
    const hidden = await report(path, "admin").expect(200);
    expect(hidden.body.data.summary.totalBudgeted.amount).toBe("0.00");
    await override("2026-10-01", "2026-10-31", "USD");
    await analyticsCache.invalidateHousehold(a);
    await report(path, "owner").expect(422);
    await report(path, "admin").expect(200);
  });
});
