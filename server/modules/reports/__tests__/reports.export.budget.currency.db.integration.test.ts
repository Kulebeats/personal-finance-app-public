import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { accounts, budgets, categories, categoryGroups, dataExports, households, transactions } from "@shared/schema";
import { db } from "../../../db";
import { Money } from "../../../core/money";
import { a, b, actors, app, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const groupId = randomUUID(), categoryId = randomUUID(), accountId = randomUUID();
const first = "2026-01-01", last = "2026-01-31";
function signed(method: "post" | "put", path: string, body: object) {
  return request(app)[method](`/api/budgets${path}`).set("Cookie", actors.get("owner")!.cookie).send(body);
}
function comparison() {
  return request(app).get(`/api/reports/cashflow/budget?from=${first}&to=${last}&interval=month&scope=household`)
    .set("Cookie", actors.get("owner")!.cookie);
}
async function csv() {
  const [item] = await db.insert(dataExports).values({ householdId: a, userId: actors.get("owner")!.id, exportType: "budget", fileFormat: "csv",
    status: "completed", dateRangeStart: first, dateRangeEnd: last, recordCount: 1,
    parameters: { reportType: "budget", format: "csv", startDate: first, endDate: last, interval: "month", scope: "household",
      includeCharts: false, includeForecast: false, forecastMonths: 3 } }).returning({ id: dataExports.id });
  return request(app).get(`/api/reports/exports/${item.id}?download=true`).set("Cookie", actors.get("owner")!.cookie);
}
async function readback(amount: string, variance: string) {
  const response = await comparison().expect(200);
  expect(response.body.data.comparison).toMatchObject([{ categoryId, categoryName: "Groceries",
    actual: { amount: "400.00", currency: "USD" }, budgeted: { amount, currency: "USD" }, variance: { amount: variance, currency: "USD" } }]);
  const download = await csv(); expect(download.status).toBe(200);
  const [header, line] = download.text.trim().split(/\r?\n/).map(row => row.split(",").map(cell => cell.replace(/^"|"$/g, "")));
  const cell = (name: string) => line[header.indexOf(name)];
  expect(cell("category")).toBe("Groceries"); expect(cell("currency")).toBe("USD");
  expect(new Money(cell("budgeted"), "USD").toString()).toBe(amount);
  expect(new Money(cell("actual"), "USD").toString()).toBe("400.00");
  expect(new Money(cell("variance"), "USD").toString()).toBe(variance);
  expect(download.text).not.toContain("ZMW");
}
async function clean() {
  await db.delete(dataExports).where(inArray(dataExports.householdId, [a, b]));
  await db.delete(budgets).where(inArray(budgets.householdId, [a, b]));
  await db.delete(categories).where(inArray(categories.householdId, [a, b]));
  await db.delete(categoryGroups).where(inArray(categoryGroups.householdId, [a, b]));
}

describe("manual captured budget denomination through signed SQL, comparison and CSV", () => {
  beforeAll(async () => { await start(); }, 20_000);
  beforeEach(async () => {
    await reset(); await clean();
    await db.update(households).set({ currency: "USD" }).where(eq(households.id, a));
    await db.insert(accounts).values({ id: accountId, householdId: a, ownerUserId: actors.get("owner")!.id, name: "USD checking",
      type: "checking", currency: "USD", balance: "10000", isPrivate: false });
    await db.insert(categoryGroups).values({ id: groupId, householdId: a, name: "Expenses", type: "expenses", budgetMode: "by_category", displayOrder: 0 });
    await db.insert(categories).values({ id: categoryId, householdId: a, groupId, name: "Groceries", includeInBudget: true, displayOrder: 0 });
    await db.insert(transactions).values(["250.00", "150.00"].map((amount, index) => ({ householdId: a, accountId,
      ownerUserId: actors.get("owner")!.id, categoryId, name: "USD posted groceries", amount, currency: "USD", type: "expense" as const,
      date: index === 0 ? "2026-01-10" : "2026-01-20", isPrivate: false, isPending: false, isExcludedFromReports: false })));
  });
  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  it("persists captured USD from a genuine manual POST and reports exact USD amounts", async () => {
    const response = await signed("post", "", { name: "Groceries", categoryId, amount: { amount: "500.00", currency: "USD" }, period: "monthly" }).expect(201);
    const [stored] = await db.select().from(budgets).where(eq(budgets.id, response.body.data.id));
    expect(stored).toMatchObject({ amount: "500.00", currency: "USD" });
    expect(response.body.data.amount).toEqual({ amount: "500.00", currency: "USD" });
    await readback("500.00", "100.00");
  });
  it("keeps matching captured denomination coherent through a genuine manual PUT", async () => {
    const [created] = await db.insert(budgets).values({ householdId: a, categoryId, name: "Groceries", amount: "500.00", currency: "USD" }).returning();
    const response = await signed("put", `/${created.id}`, { amount: { amount: "650.00", currency: "USD" } }).expect(200);
    expect(response.body.data.amount).toEqual({ amount: "650.00", currency: "USD" });
    expect((await db.select().from(budgets).where(eq(budgets.id, created.id)))[0]).toMatchObject({ amount: "650.00", currency: "USD" });
    await readback("650.00", "250.00");
  });
  it.each(["amount", "rolloverAmount"] as const)("rejects a mismatched %s denomination on an existing USD limit", async field => {
    const [created] = await db.insert(budgets).values({ householdId: a, categoryId, name: "Groceries", amount: "500.00", currency: "USD" }).returning();
    await signed("put", `/${created.id}`, { [field]: { amount: "650.00", currency: "ZMW" } }).expect(409);
    expect((await db.select().from(budgets).where(eq(budgets.id, created.id)))[0]).toEqual(created);
    await readback("500.00", "100.00");
  });
  it("rejects conflicting money denominations in one manual update before either value is written", async () => {
    const [created] = await db.insert(budgets).values({ householdId: a, categoryId, name: "Groceries", amount: "500.00", currency: "USD" }).returning();
    await signed("put", `/${created.id}`, { amount: { amount: "650.00", currency: "USD" }, rolloverAmount: { amount: "10.00", currency: "ZMW" } }).expect(400);
    expect((await db.select().from(budgets).where(eq(budgets.id, created.id)))[0]).toEqual(created);
  });
  it("withholds an ambiguous legacy ZMW-default row in a USD household without relabeling it", async () => {
    const [legacy] = await db.insert(budgets).values({ householdId: a, categoryId, name: "Groceries", amount: "500.00" }).returning();
    expect(legacy.currency).toBe("ZMW");
    expect((await comparison().expect(422)).body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
    const download = await csv(); expect(download.status).toBe(422); expect(download.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
    expect((await db.select().from(budgets).where(eq(budgets.id, legacy.id)))[0]).toEqual(legacy);
  });
  it.each(["post", "put"] as const)("%s refuses a sub-cent recurring default instead of storing zero", async method => {
    let path = "";
    if (method === "put") {
      const [created] = await db.insert(budgets).values({ householdId: a, categoryId, name: "Groceries", amount: "500.00", currency: "USD" }).returning();
      path = `/${created.id}`;
    }
    const before = await db.select().from(budgets).where(eq(budgets.householdId, a));
    await signed(method, path, { name: "Groceries", categoryId, amount: { amount: "0.001", currency: "USD" } }).expect(400);
    expect(await db.select().from(budgets).where(eq(budgets.householdId, a))).toEqual(before);
  });
});
