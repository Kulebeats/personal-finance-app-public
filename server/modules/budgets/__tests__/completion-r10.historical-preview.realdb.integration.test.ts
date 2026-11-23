import { randomUUID } from "node:crypto";
import { Client } from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { BudgetRecalculationPreview as Preview } from "@shared/budget-recalculation-preview";
import type { MoneyDto } from "@shared/money";
import { accounts, auditLogs, budgetPeriods, budgets, categories, categoryGroups, fxRates, householdMembers, households, transactions, transactionSplits } from "@shared/schema";
import { db } from "../../../db";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const group = randomUUID(), groceries = randomUUID(), dining = randomUUID(), transport = randomUUID();
const groceryBudget = randomUUID(), diningBudget = randomUUID(), foreignBudget = randomUUID();
const currentOverride = randomUUID(), previousOverride = randomUUID(), priorAudit = randomUUID();
const foreignGroup = randomUUID(), foreignCategory = randomUUID(), quoteId = randomUUID(), fxAccount = randomUUID(), ownAccount = randomUUID();
const groupBudgetId = randomUUID(), incomeGroup = randomUUID(), salary = randomUUID(), bonus = randomUUID(), incomeBudget = randomUUID();
const ungroupedA = randomUUID(), ungroupedB = randomUUID(), ungroupedBudget = randomUUID();
const trustedQuotes: string[] = [];
let periods: string[], targetPeriod: string, nextPeriod: string, targetEnd: string, previousEnd: string;
const money = (amount: string): MoneyDto => ({ amount, currency: "ZMW" });
type Source = { amount: string; date?: string; householdId?: string; accountId?: string; categoryId?: string; currency?: string;
  type?: "income" | "expense"; isPending?: boolean; status?: "pending" | "cleared" | "reconciled" | null;
  isPrivate?: boolean; ownerUserId?: string; excluded?: boolean; deleted?: boolean; notes?: string;
  splits?: Array<{ categoryId: string; amount: string }> };
async function source(input: Source) {
  const id = randomUUID();
  await db.insert(transactions).values({ id, householdId: input.householdId ?? a, accountId: input.accountId ?? ids.sharedAccount,
    ownerUserId: input.ownerUserId ?? actors.get("member")!.id, categoryId: input.categoryId ?? groceries,
    date: input.date ?? `${periods[2]}-15`, name: "Synthetic historical budget activity", amount: input.amount,
    currency: input.currency ?? "ZMW", type: input.type ?? "expense", source: "manual", isPending: input.isPending ?? false,
    ...(input.status === undefined ? {} : { status: input.status }), isPrivate: input.isPrivate ?? false,
    isExcludedFromBudget: input.excluded ?? false, deletedAt: input.deleted ? new Date(`${periods[2]}-16T00:00:00Z`) : null,
    notes: input.notes ?? null });
  if (input.splits) await db.insert(transactionSplits).values(input.splits.map((part, displayOrder) => ({ transactionId: id, ...part, displayOrder })));
  return id;
}
async function clean() {
  await db.delete(budgets).where(inArray(budgets.householdId, [a, b]));
  await db.delete(categories).where(inArray(categories.householdId, [a, b]));
  await db.delete(categoryGroups).where(inArray(categoryGroups.householdId, [a, b]));
  await db.delete(fxRates).where(eq(fxRates.id, quoteId));
  if (trustedQuotes.length) await db.delete(fxRates).where(inArray(fxRates.id, trustedQuotes.splice(0)));
}
// FIN-06: the preview reads the rate Reports uses, the latest shared fx_rates
// row dated on or before the flow (the market refresh's mirror). Synthetic.
async function trustedQuote(rateDate: string) {
  const id = randomUUID(); trustedQuotes.push(id);
  await db.insert(fxRates).values({ id, fromCurrency: "USD", toCurrency: "ZMW", rate: "2", date: rateDate, source: "yahoo_finance" });
}
async function financialState() {
  const budgetIds = [groceryBudget, diningBudget, foreignBudget, groupBudgetId, incomeBudget, ungroupedBudget];
  return {
    budgets: await db.select().from(budgets).where(inArray(budgets.householdId, [a, b])).orderBy(budgets.id),
    periods: await db.select().from(budgetPeriods).where(inArray(budgetPeriods.budgetId, budgetIds)).orderBy(budgetPeriods.id),
    audit: await db.select().from(auditLogs).where(and(inArray(auditLogs.householdId, [a, b]), eq(auditLogs.entityType, "budget"))).orderBy(auditLogs.id),
    accounts: await db.select().from(accounts).where(inArray(accounts.householdId, [a, b])).orderBy(accounts.id),
  };
}
function post(body: object = {}, role: Role = "member") {
  return request(app).post("/api/budgets/recalculate").set("Cookie", actors.get(role)!.cookie)
    .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a).send(body);
}
function get(role: Role = "member", months = 3) {
  return request(app).get(`/api/budgets/recalculate/preview?months=${months}`).set("Cookie", actors.get(role)!.cookie)
    .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);
}
function preview(value: Preview) {
  expect(value).toMatchObject({ mode: "preview", scope: "visible_posted_activity", targetPeriod, periods });
  const keys = value.suggestions.map(item => {
    expect((item.categoryId !== null) !== (item.categoryGroupId !== null)).toBe(true);
    return item.categoryId !== null ? `category:${item.categoryId}` : `group:${item.categoryGroupId}`;
  });
  expect(keys).toEqual([...keys].sort());
  expect(new Set(keys).size).toBe(keys.length);
  return value.suggestions.find(item => item.categoryId === groceries)!;
}
function expectGroceries(value: Preview, historicalTotal = "550.00", amount = "183.33") {
  expect(preview(value)).toEqual({ categoryId: groceries, categoryGroupId: null, historicalTotal: money(historicalTotal), amount: money(amount),
    currentBudget: { id: groceryBudget, amount: money("710.00"), periodId: currentOverride, periodVersion: 3 } });
}
async function seedUngrouped() {
  await db.insert(categories).values([{ id: ungroupedA, name: "Ungrouped A" }, { id: ungroupedB, name: "Ungrouped B" }]
    .map((row, displayOrder) => ({ ...row, householdId: a, groupId: null, includeInBudget: true, isArchived: false, displayOrder })));
  await db.insert(budgets).values({ id: ungroupedBudget, householdId: a, name: "Ungrouped manual limit", categoryId: ungroupedA, amount: "500" });
}
function beforeActivity(change: () => Promise<unknown>, atRead = 1) {
  const actual = Client.prototype.query, gate = vi.fn(change);
  let changed = false, reads = 0;
  const intercepted = function(this: Client, ...args: unknown[]) {
    const command = args[0];
    const text = typeof command === "string" ? command : command && typeof command === "object" && "text" in command ? String(command.text) : "";
    if (!changed && /^\s*(select|with)\b/i.test(text) && /from\s+"transactions"/i.test(text) && ++reads === atRead) {
      changed = true; return gate().then(() => Reflect.apply(actual, this, args));
    }
    return Reflect.apply(actual, this, args);
  };
  vi.spyOn(Client.prototype, "query").mockImplementation(intercepted as typeof Client.prototype.query);
  return gate;
}

describe("FIN-07 fresh signed historical preview preserves manual financial state", () => {
  beforeAll(async () => {
    await start();
    const clock = await db.execute<{ date: string }>(sql`select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD') as date`);
    const now = new Date(`${clock.rows[0].date}T12:00:00Z`), year = now.getUTCFullYear(), month = now.getUTCMonth();
    periods = [3, 2, 1].map(offset => new Date(Date.UTC(year, month - offset, 1)).toISOString().slice(0, 7));
    targetPeriod = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
    nextPeriod = new Date(Date.UTC(year, month + 1, 1)).toISOString().slice(0, 7);
    targetEnd = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
    previousEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  }, 20_000);
  beforeEach(async () => {
    await reset(); await clean();
    await db.update(households).set({ currency: "ZMW" }).where(eq(households.id, a));
    await db.insert(categoryGroups).values([
      { id: group, householdId: a, name: "Historical expenses", type: "expenses", budgetMode: "by_category", displayOrder: 0 },
      { id: foreignGroup, householdId: b, name: "FOREIGN private household group", type: "expenses", budgetMode: "by_category", displayOrder: 0 },
    ]);
    await db.insert(categories).values([
      ...[{ id: groceries, name: "Groceries" }, { id: dining, name: "Dining" }, { id: transport, name: "Transport" }]
        .map((item, displayOrder) => ({ ...item, householdId: a, groupId: group, includeInBudget: true, displayOrder })),
      { id: foreignCategory, householdId: b, groupId: foreignGroup, name: "FOREIGN household category", includeInBudget: true, displayOrder: 0 },
    ]);
    await db.insert(budgets).values([
      { id: groceryBudget, householdId: a, name: "Manual groceries", categoryId: groceries, amount: "700", rolloverEnabled: true, rolloverAmount: "45" },
      { id: diningBudget, householdId: a, name: "Manual dining", categoryId: dining, amount: "500" },
      // An old cross-household attribution must not become the current manual limit.
      { id: foreignBudget, householdId: b, name: "FOREIGN manual limit", categoryId: groceries, amount: "9999" },
    ]);
    await db.insert(budgetPeriods).values([
      { id: currentOverride, budgetId: groceryBudget, startDate: `${targetPeriod}-01`, endDate: targetEnd, budgetAmount: "710", spentAmount: "42", rolloverIn: "11", version: 3 },
      { id: previousOverride, budgetId: groceryBudget, startDate: `${periods[2]}-01`, endDate: previousEnd, budgetAmount: "999", spentAmount: "17", version: 7 },
    ]);
    await db.insert(auditLogs).values({ id: priorAudit, householdId: a, userId: actors.get("owner")!.id, action: "UPDATE", entityType: "budget",
      entityId: groceryBudget, details: { operation: "existing-manual-budget", amount: "700.00" } });
    // Exactly two legitimate zero months and 550 groceries in the third month.
    await source({ amount: "450" });
    await source({ amount: "150", splits: [{ categoryId: groceries, amount: "100" }, { categoryId: transport, amount: "50" }] });
  });
  afterEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => { await clean(); await stop(); });

  it.each([{}, { months: 3 }, { months: 3, mode: "preview" }])("makes legacy/default POST %j a non-mutating 550/3 preview", async body => {
    const before = await financialState();
    const response = await post(body).expect(200);
    expect(await financialState()).toEqual(before);
    expectGroceries(response.body.data);
    const repeated = await post(body).expect(200);
    expect(repeated.body.data).toEqual(response.body.data);
    expect(await financialState()).toEqual(before);
  });
  it("exposes an unambiguous read-only GET preview equivalent to the safe legacy POST", async () => {
    const before = await financialState();
    const response = await get().expect(200);
    expectGroceries(response.body.data);
    expect(await financialState()).toEqual(before);
    expect((await post({ months: 3 }).expect(200)).body.data).toEqual(response.body.data);
    expect(await financialState()).toEqual(before);
  });
  it("GET cannot fall through to the old recalculation writer even before the preview handler exists", async () => {
    const before = await financialState(), response = await get();
    expect([200, 404]).toContain(response.status); // Cross-version read safety, separate from availability above.
    expect(response.body.success).toBe(response.status === 200);
    expect(await financialState()).toEqual(before);
  });
  it("includes zero closed months and excludes current/future and out-of-window activity", async () => {
    await source({ amount: "900", date: `${targetPeriod}-01` });
    await source({ amount: "800", date: `${nextPeriod}-01` });
    const old = new Date(`${periods[0]}-01T12:00:00Z`); old.setUTCMonth(old.getUTCMonth() - 1);
    await source({ amount: "700", date: old.toISOString().slice(0, 10) });
    expectGroceries((await post({ months: 3 }).expect(200)).body.data);
  });
  it.each(["isPending", "status"] as const)("excludes ordinary and split activity carrying the %s pending marker", async marker => {
    const pending = { isPending: marker === "isPending", status: marker === "status" ? "pending" as const : "cleared" as const };
    await source({ amount: "25", ...pending });
    await source({ amount: "40", ...pending, splits: [{ categoryId: groceries, amount: "30" }, { categoryId: transport, amount: "10" }] });
    await source({ amount: "50", excluded: true });
    await source({ amount: "60", deleted: true, splits: [{ categoryId: groceries, amount: "40" }, { categoryId: transport, amount: "20" }] });
    expectGroceries((await post({ months: 3 }).expect(200)).body.data);
  });
  it.each(["isPending", "status"] as const)("preserves posted ordinary/split income estimates and excludes their %s pending marker", async marker => {
    await db.insert(categoryGroups).values({ id: incomeGroup, householdId: a, name: "Income estimates", type: "income", budgetMode: "by_category", displayOrder: 1 });
    await db.insert(categories).values([{ id: salary, name: "Salary" }, { id: bonus, name: "Bonus" }]
      .map((item, displayOrder) => ({ ...item, householdId: a, groupId: incomeGroup, includeInBudget: true, displayOrder })));
    await db.insert(budgets).values({ id: incomeBudget, householdId: a, categoryId: salary, name: "Manual income estimate", amount: "900" });
    await source({ amount: "900", type: "income", categoryId: salary });
    await source({ amount: "300", type: "income", categoryId: salary, splits: [{ categoryId: salary, amount: "200" }, { categoryId: bonus, amount: "100" }] });
    const pending = { isPending: marker === "isPending", status: marker === "status" ? "pending" as const : "cleared" as const };
    await source({ amount: "1200", type: "income", categoryId: salary, ...pending });
    await source({ amount: "900", type: "income", categoryId: salary, ...pending, splits: [{ categoryId: salary, amount: "600" }, { categoryId: bonus, amount: "300" }] });
    const before = await financialState(), data: Preview = (await post({ months: 3 }).expect(200)).body.data;
    expectGroceries(data);
    expect(data.suggestions.find(item => item.categoryId === salary)).toEqual({ categoryId: salary, categoryGroupId: null,
      historicalTotal: money("1100.00"), amount: money("366.67"),
      currentBudget: { id: incomeBudget, amount: money("900.00"), periodId: null, periodVersion: null } });
    expect(data.suggestions.find(item => item.categoryId === bonus)).toMatchObject({ historicalTotal: money("100.00"), amount: money("33.33") });
    expect(await financialState()).toEqual(before);
  });
  it("previews group totals without deleting the preserved category limits and periods", async () => {
    await db.update(categoryGroups).set({ budgetMode: "by_group" }).where(eq(categoryGroups.id, group));
    await db.insert(budgets).values({ id: groupBudgetId, householdId: a, categoryGroupId: group, name: "Manual group limit", amount: "800" });
    const before = await financialState(), data: Preview = (await post({ months: 3 }).expect(200)).body.data;
    preview(data);
    expect(data.suggestions.find(item => item.categoryGroupId === group)).toEqual({ categoryId: null, categoryGroupId: group,
      historicalTotal: money("600.00"), amount: money("200.00"),
      currentBudget: { id: groupBudgetId, amount: money("800.00"), periodId: null, periodVersion: null } });
    const groupedCategoryIds: readonly string[] = [groceries, dining, transport];
    expect(data.suggestions.some(item => item.categoryId !== null && groupedCategoryIds.includes(item.categoryId))).toBe(false);
    expect(await financialState()).toEqual(before);
  });
  it.each(["soft-deleted category", "archived category", "archived group"] as const)("excludes %s without changing preserved manual records", async kind => {
    if (kind === "archived group") await db.update(categoryGroups).set({ isArchived: true }).where(eq(categoryGroups.id, group));
    else {
      await db.insert(categories).values({ id: ungroupedA, householdId: a, groupId: group, name: "Inactive historical category",
        includeInBudget: true, isArchived: kind === "archived category", deletedAt: kind === "soft-deleted category" ? new Date() : null, displayOrder: 3 });
      await source({ amount: "900", categoryId: ungroupedA });
    }
    const before = await financialState(), data: Preview = (await post({ months: 3 }).expect(200)).body.data;
    if (kind === "archived group") { preview(data); expect(data.suggestions).toEqual([]); }
    else {
      expectGroceries(data);
      expect(data.suggestions.some(item => item.categoryId === ungroupedA)).toBe(false);
    }
    expect(await financialState()).toEqual(before);
  });
  it.each(["expense", "income"] as const)("preserves unambiguous posted %s activity for tenant-owned ungrouped categories", async type => {
    await seedUngrouped();
    await source({ amount: "90", type, categoryId: ungroupedA });
    await source({ amount: "60", type, categoryId: ungroupedA, splits: [{ categoryId: ungroupedA, amount: "30" }, { categoryId: ungroupedB, amount: "30" }] });
    const before = await financialState(), data: Preview = (await post({ months: 3 }).expect(200)).body.data;
    expectGroceries(data);
    expect(data.suggestions.find(item => item.categoryId === ungroupedA)).toEqual({ categoryId: ungroupedA, categoryGroupId: null,
      historicalTotal: money("120.00"), amount: money("40.00"),
      currentBudget: { id: ungroupedBudget, amount: money("500.00"), periodId: null, periodVersion: null } });
    expect(data.suggestions.find(item => item.categoryId === ungroupedB)).toEqual({ categoryId: ungroupedB, categoryGroupId: null,
      historicalTotal: money("30.00"), amount: money("10.00"), currentBudget: null });
    expect((await get().expect(200)).body.data).toEqual(data);
    expect(await financialState()).toEqual(before);
  });
  it("surfaces ambiguous visible income and expense on an ungrouped category instead of inventing a refund or net sum", async () => {
    await seedUngrouped();
    await source({ amount: "90", categoryId: ungroupedA });
    await source({ amount: "30", categoryId: ungroupedA, type: "income" });
    const before = await financialState(), response = await post({ months: 3 }).expect(422);
    expect(response.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
    expect(response.body.data).toBeUndefined();
    expect(await financialState()).toEqual(before);
  });
  it("decides ungrouped ambiguity only from the requester's visible activity", async () => {
    await seedUngrouped();
    await source({ amount: "90", categoryId: ungroupedA });
    await source({ amount: "30", categoryId: ungroupedA, type: "income", isPrivate: true, ownerUserId: actors.get("owner")!.id });
    const data: Preview = (await post({ months: 3 }).expect(200)).body.data;
    expectGroceries(data);
    expect(data.suggestions.find(item => item.categoryId === ungroupedA)).toMatchObject({ historicalTotal: money("90.00"), amount: money("30.00") });
    expect((await post({ months: 3 }, "owner").expect(422)).body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
  });
  it("does not treat a foreign household group pointer as an authorized ungrouped category", async () => {
    await seedUngrouped();
    await db.update(categories).set({ groupId: foreignGroup }).where(eq(categories.id, ungroupedA));
    await source({ amount: "900", categoryId: ungroupedA });
    const before = await financialState(), data: Preview = (await post({ months: 3 }).expect(200)).body.data;
    expectGroceries(data);
    expect(data.suggestions.some(item => item.categoryId === ungroupedA || item.categoryGroupId === foreignGroup)).toBe(false);
    expect(await financialState()).toEqual(before);
  });
  it("does not infer an expense refund from generic income or refund wording", async () => {
    await source({ amount: "110", type: "income", notes: "Customer called this a refund; no original expense reference exists" });
    expectGroceries((await post({ months: 3 }).expect(200)).body.data);
  });
  it("does not let private or another household's activity change member amounts or metadata", async () => {
    const before = (await post({ months: 3 }).expect(200)).body.data;
    expectGroceries(before);
    const owner = actors.get("owner")!.id;
    await source({ amount: "17", accountId: ids.privateAccount, ownerUserId: owner });
    await source({ amount: "31", accountId: ids.privateAccount, ownerUserId: owner,
      splits: [{ categoryId: groceries, amount: "17" }, { categoryId: transport, amount: "14" }] });
    await source({ amount: "49", isPrivate: true, ownerUserId: owner });
    await source({ amount: "300000", householdId: b, accountId: ids.foreignAccount, categoryId: foreignCategory, ownerUserId: actors.get("outsider")!.id });
    await source({ amount: "50000", accountId: ids.foreignAccount, ownerUserId: actors.get("outsider")!.id });
    expect((await post({ months: 3, householdId: b, userId: actors.get("outsider")!.id }).expect(200)).body.data).toEqual(before);
    expectGroceries((await post({ months: 3 }, "owner").expect(200)).body.data, "633.00", "211.00");
  });
  it("includes the member's own private account and transaction without granting the owner access to them", async () => {
    await db.insert(accounts).values({ id: ownAccount, householdId: a, name: "Member's private history", type: "checking", currency: "ZMW",
      isPrivate: true, ownerUserId: actors.get("member")!.id });
    await source({ amount: "90", accountId: ownAccount });
    await source({ amount: "60", isPrivate: true });
    expectGroceries((await post({ months: 3 }).expect(200)).body.data, "700.00", "233.33");
    expectGroceries((await post({ months: 3 }, "owner").expect(200)).body.data);
  });
  it("surfaces visible missing FX without writing limits", async () => {
    await db.insert(accounts).values({ id: fxAccount, householdId: a, name: "Visible foreign history", type: "checking", currency: "QPX" });
    await source({ amount: "10", accountId: fxAccount, currency: "QPX" });
    const before = await financialState(), response = await post({ months: 3 }).expect(422);
    expect(response.body).toMatchObject({ success: false, error: { code: "FINANCIAL_DATA_UNAVAILABLE" } });
    expect(response.body.data).toBeUndefined();
    expect(await financialState()).toEqual(before);
  });
  it("converts with the shared rate Reports would use for the same flow, still without writing limits (FIN-06)", async () => {
    await db.insert(accounts).values({ id: fxAccount, householdId: a, name: "Visible foreign history", type: "checking", currency: "QPX" });
    await source({ amount: "10", accountId: fxAccount, currency: "QPX" });
    await db.insert(fxRates).values({ id: quoteId, fromCurrency: "QPX", toCurrency: "ZMW", rate: "25", date: `${periods[2]}-15`, source: "yahoo_finance" });
    const before = await financialState();
    expectGroceries((await post({ months: 3 }).expect(200)).body.data, "800.00", "266.67");
    expect(await financialState()).toEqual(before);
  });
  it("does not reveal a private unpriceable source through availability or warnings", async () => {
    const before = (await post({ months: 3 }).expect(200)).body.data;
    expectGroceries(before);
    await db.insert(accounts).values({ id: fxAccount, householdId: a, name: "Private unpriceable history", type: "checking", currency: "QPX",
      isPrivate: true, ownerUserId: actors.get("owner")!.id });
    await source({ amount: "10", accountId: fxAccount, currency: "QPX", ownerUserId: actors.get("owner")!.id });
    expect((await post({ months: 3 }).expect(200)).body.data).toEqual(before);
    expect((await post({ months: 3 }, "owner").expect(422)).body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
  });
  it("converts ordinary and split history at the dated shared rate", async () => {
    await db.insert(accounts).values({ id: fxAccount, householdId: a, name: "Trusted USD history", type: "checking", currency: "USD" });
    await trustedQuote(`${periods[2]}-15`);
    await source({ amount: "10", accountId: fxAccount, currency: "USD" });
    await source({ amount: "10", accountId: fxAccount, currency: "USD", splits: [{ categoryId: groceries, amount: "6" }, { categoryId: transport, amount: "4" }] });
    const before = await financialState();
    expectGroceries((await post({ months: 3 }).expect(200)).body.data, "582.00", "194.00");
    expectGroceries((await get().expect(200)).body.data, "582.00", "194.00");
    expect(await financialState()).toEqual(before);
  });
  it("carries the latest earlier shared rate forward, as Reports does", async () => {
    await db.insert(accounts).values({ id: fxAccount, householdId: a, name: "Earlier-rated USD history", type: "checking", currency: "USD" });
    await source({ amount: "10", accountId: fxAccount, currency: "USD" });
    await trustedQuote(`${periods[2]}-14`);
    expectGroceries((await post({ months: 3 }).expect(200)).body.data, "570.00", "190.00");
  });
  it("does not adopt a shared rate dated after the flow", async () => {
    await db.insert(accounts).values({ id: fxAccount, householdId: a, name: "Later-rated USD history", type: "checking", currency: "USD" });
    await source({ amount: "10", accountId: fxAccount, currency: "USD" });
    await trustedQuote(`${periods[2]}-16`);
    const before = await financialState(), response = await post({ months: 3 }).expect(422);
    expect(response.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
    expect(await financialState()).toEqual(before);
  });
  it.each(["owner", "admin", "member"] as const)("preserves the existing %s role floor for GET and POST previews", async role => {
    expectGroceries((await get(role).expect(200)).body.data);
    expectGroceries((await post({ months: 3 }, role).expect(200)).body.data);
  });
  it.each(["view_only", "professional"] as const)("does not turn the new preview entry into a %s role escalation", async role => {
    const before = await financialState();
    await get(role).expect(403); await post({ months: 3 }, role).expect(403);
    expect(await financialState()).toEqual(before);
  });
  it("checks live role after login and rejects unauthenticated previews", async () => {
    await db.update(householdMembers).set({ role: "view_only" }).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id)));
    const before = await financialState();
    await post({ months: 3 }).expect(403); await get().expect(403);
    await request(app).post("/api/budgets/recalculate").send({ months: 3 }).expect(401);
    await request(app).get("/api/budgets/recalculate/preview?months=3").expect(401);
    expect(await financialState()).toEqual(before);
  });
  it("rechecks a grant removed after admission before publishing any preview", async () => {
    const before = await financialState();
    const gate = beforeActivity(() => db.delete(householdMembers).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id))));
    await post({ months: 3 }).expect(403);
    expect(gate).toHaveBeenCalledOnce();
    expect(await financialState()).toEqual(before);
  });
  it.each(["amount", "transaction privacy", "account privacy"] as const)("publishes a fresh estimate after %s changes between input and final reads", async kind => {
    if (kind === "account privacy") await db.insert(accounts).values({ id: fxAccount, householdId: a, name: "Shared until final publication", type: "checking", currency: "ZMW" });
    const id = await source({ amount: "90", accountId: kind === "account privacy" ? fxAccount : ids.sharedAccount });
    const before = await financialState();
    const gate = beforeActivity(() => kind === "account privacy"
      ? db.update(accounts).set({ isPrivate: true, ownerUserId: actors.get("owner")!.id }).where(eq(accounts.id, fxAccount))
      : db.update(transactions).set(kind === "amount" ? { amount: "120" } : { isPrivate: true, ownerUserId: actors.get("owner")!.id }).where(eq(transactions.id, id)), 2);
    const data: Preview = (await post({ months: 3 }).expect(200)).body.data;
    expect(gate).toHaveBeenCalledOnce();
    expectGroceries(data, kind === "amount" ? "670.00" : "550.00", kind === "amount" ? "223.33" : "183.33");
    const after = await financialState();
    expect({ budgets: after.budgets, periods: after.periods, audit: after.audit })
      .toEqual({ budgets: before.budgets, periods: before.periods, audit: before.audit });
    expect((await get().expect(200)).body.data).toEqual(data);
  });
  it("retains a non-default household denomination for native history and its effective manual limit", async () => {
    await db.update(households).set({ currency: "USD" }).where(eq(households.id, a));
    await db.update(accounts).set({ currency: "USD" }).where(eq(accounts.householdId, a));
    await db.update(transactions).set({ currency: "USD" }).where(eq(transactions.householdId, a));
    await db.update(budgets).set({ currency: "USD" }).where(eq(budgets.householdId, a));
    await db.update(budgetPeriods).set({ currency: "USD" }).where(inArray(budgetPeriods.budgetId, [groceryBudget, diningBudget]));
    const before = await financialState(), data: Preview = (await get().expect(200)).body.data;
    expect(preview(data)).toEqual({ categoryId: groceries, categoryGroupId: null,
      historicalTotal: { amount: "550.00", currency: "USD" }, amount: { amount: "183.33", currency: "USD" },
      currentBudget: { id: groceryBudget, amount: { amount: "710.00", currency: "USD" }, periodId: currentOverride, periodVersion: 3 } });
    expect((await post({ months: 3 }).expect(200)).body.data).toEqual(data);
    expect(await financialState()).toEqual(before);
  });
  it("reports overlapping target-month manual overrides as unavailable without choosing or rewriting one", async () => {
    await db.insert(budgetPeriods).values({ budgetId: groceryBudget, startDate: `${targetPeriod}-15`, endDate: targetEnd,
      budgetAmount: "950", currency: "ZMW", version: 2 });
    const before = await financialState(), response = await post({ months: 3 }).expect(422);
    expect(response.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
    expect((await get().expect(422)).body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
    expect(await financialState()).toEqual(before);
  });
});
