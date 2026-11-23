import { randomUUID } from "node:crypto";
import { Client } from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { BudgetRecalculationPreview, BudgetRecalculationSuggestion } from "@shared/budget-recalculation-preview";
import { accounts, auditLogs, budgetPeriods, budgets, categories, categoryGroups, householdMembers, households, transactions } from "@shared/schema";
import { db } from "../../../db";
import { analyticsCache } from "../../../services/AnalyticsCache";
import type { AnalyticsCacheBackend } from "../../../services/analytics-cache-backend";
import { OrdinaryAnalyticsInvalidationError } from "../../../services/ordinary-analytics-invalidation";
import { analyticsLogicalKeyMatches } from "../../../config/redis/keys.mjs";
import { cashflowReportRepository } from "../../../repositories/reports";
import { AIAnalyticsService } from "../../ai/ai.analytics.service";
import { geminiClient } from "../../ai/ai.gemini";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const group = randomUUID(), groceries = randomUUID(), dining = randomUUID(), transport = randomUUID();
const groceryBudget = randomUUID(), diningBudget = randomUUID(), currentOverride = randomUUID(), historicOverride = randomUUID();
let targetPeriod: string, previousPeriod: string, targetEnd: string, previousEnd: string;
let restoreCache: (() => void) | undefined;
function cachedReports(failure: () => "ordinary" | "required" | undefined = () => undefined) {
  // Exercise the real HTTP report service and AnalyticsCache, with no external
  // Redis authority. The backend applies the actual admitted key matcher.
  const descriptor = Object.getOwnPropertyDescriptor(analyticsCache, "backend")!, store = new Map<string, unknown>();
  const observed = { hits: 0 };
  const backend: AnalyticsCacheBackend = {
    assertCurrent() {},
    async getJson<T>(key: string) { if (!store.has(key)) return null; observed.hits++; return structuredClone(store.get(key)) as T; },
    async setJson(key, value) { store.set(key, structuredClone(value)); },
    async invalidate(filter) {
      const fail = failure();
      if (fail === "ordinary") throw new OrdinaryAnalyticsInvalidationError(new Error("Synthetic optional cache failure"));
      if (fail === "required") throw new Error("Synthetic required cache generation refusal");
      let removed = 0;
      for (const key of store.keys()) if (analyticsLogicalKeyMatches(key, filter)) { store.delete(key); removed++; }
      return removed;
    },
  };
  Object.defineProperty(analyticsCache, "backend", { ...descriptor, value: backend });
  restoreCache = () => Object.defineProperty(analyticsCache, "backend", descriptor);
  return observed;
}
async function currentReportActivity() {
  await db.insert(transactions).values({ householdId: a, accountId: ids.sharedAccount, categoryId: groceries, ownerUserId: actors.get("member")!.id,
    date: `${targetPeriod}-01`, name: "Synthetic report cache readback", amount: "15.00", type: "expense", currency: "ZMW" });
}
function comparison(role: Role = "member") {
  return request(app).get(`/api/reports/cashflow/budget?from=${targetPeriod}-01&to=${targetEnd}&interval=month`)
    .set("Cookie", actors.get(role)!.cookie);
}
function expense(amount = "40.00") {
  return request(app).post("/api/transactions").set("Cookie", actors.get("member")!.cookie)
    .send({ accountId: ids.sharedAccount, categoryId: groceries, amount: { amount, currency: "ZMW" },
      date: `${targetPeriod}-01`, name: "Synthetic old-caller expense", type: "expense" });
}
async function source(amount: string, categoryId = groceries, privacy: "shared" | "account" | "transaction" = "shared") {
  await db.insert(transactions).values({ householdId: a, accountId: privacy === "account" ? ids.privateAccount : ids.sharedAccount,
    categoryId, ownerUserId: actors.get("owner")!.id, date: `${previousPeriod}-15`, name: "Synthetic confirmed estimate source",
    amount, type: "expense", currency: "ZMW", isPrivate: privacy === "transaction", isPending: false });
}
async function clean() {
  await db.delete(budgets).where(inArray(budgets.householdId, [a, b]));
  await db.delete(categories).where(inArray(categories.householdId, [a, b]));
  await db.delete(categoryGroups).where(inArray(categoryGroups.householdId, [a, b]));
}
async function state() {
  const rows = await db.select().from(budgets).where(inArray(budgets.householdId, [a, b])).orderBy(budgets.id);
  return { budgets: rows,
    periods: rows.length ? await db.select().from(budgetPeriods).where(inArray(budgetPeriods.budgetId, rows.map(row => row.id))).orderBy(budgetPeriods.id) : [],
    audits: await db.select().from(auditLogs).where(inArray(auditLogs.householdId, [a, b])).orderBy(auditLogs.id),
    accounts: await db.select().from(accounts).where(inArray(accounts.householdId, [a, b])).orderBy(accounts.id) };
}
function signed(path: string, role: Role | "outsider" = "member") {
  return request(app).post(`/api/budgets${path}`).set("Cookie", actors.get(role)!.cookie)
    .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", role === "outsider" ? b : a);
}
async function preview(role: Role = "member"): Promise<BudgetRecalculationPreview> {
  return (await signed("/recalculate", role).send({ months: 3 }).expect(200)).body.data;
}
function intent(suggestions: BudgetRecalculationSuggestion[], operationId = randomUUID()) {
  return { operationId, months: 3, targetPeriod, suggestions };
}
async function selected(role: Role = "member") {
  const value = await preview(role);
  return [groceries, dining].map(id => value.suggestions.find(row => row.categoryId === id)!);
}

describe("FIN-07 explicitly confirmed signed budget suggestion apply", () => {
  beforeAll(async () => {
    await start();
    const clock = await db.execute<{ date: string }>(sql`select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD') as date`);
    const now = new Date(`${clock.rows[0].date}T12:00:00Z`), year = now.getUTCFullYear(), month = now.getUTCMonth();
    targetPeriod = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
    previousPeriod = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 7);
    targetEnd = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
    previousEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  }, 20_000);
  beforeEach(async () => {
    await reset(); await clean();
    await db.insert(categoryGroups).values({ id: group, householdId: a, name: "Confirmed estimates", type: "expenses", budgetMode: "by_category", displayOrder: 0 });
    await db.insert(categories).values([{ id: groceries, name: "Groceries" }, { id: dining, name: "Dining" }, { id: transport, name: "Transport" }]
      .map((row, displayOrder) => ({ ...row, householdId: a, groupId: group, includeInBudget: true, displayOrder })));
    await db.insert(budgets).values([
      { id: groceryBudget, householdId: a, name: "Manual groceries", categoryId: groceries, amount: "700", rolloverEnabled: true, rolloverAmount: "45" },
      { id: diningBudget, householdId: a, name: "Manual dining", categoryId: dining, amount: "500" },
    ]);
    await db.insert(budgetPeriods).values([
      { id: currentOverride, budgetId: groceryBudget, startDate: `${targetPeriod}-01`, endDate: targetEnd, budgetAmount: "710", spentAmount: "42", rolloverIn: "11", version: 3 },
      { id: historicOverride, budgetId: groceryBudget, startDate: `${previousPeriod}-01`, endDate: previousEnd, budgetAmount: "999", spentAmount: "17", version: 7 },
    ]);
    await source("550"); await source("300", dining); await source("120", transport);
  });
  afterEach(async () => { vi.restoreAllMocks(); restoreCache?.(); restoreCache = undefined; await clean(); });
  afterAll(async () => { await clean(); await stop(); });

  it("applies only selected existing target-month periods, preserving all manual defaults, history, cached spending and accounts", async () => {
    const before = await state(), suggestions = await selected(), body = intent(suggestions.slice(0, 1));
    const response = await signed("/recalculate/apply").send(body).expect(200);
    expect(response.body).toEqual({ success: true, data: { operationId: body.operationId, targetPeriod, appliedCount: 1 } });
    const after = await state();
    expect(after.budgets).toEqual(before.budgets); expect(after.accounts).toEqual(before.accounts);
    expect(after.periods.find(row => row.id === historicOverride)).toEqual(before.periods.find(row => row.id === historicOverride));
    expect(after.periods.find(row => row.id === currentOverride)).toMatchObject({ budgetAmount: "183.33", spentAmount: "42.00", rolloverIn: "11.00", version: 4 });
    expect(after.periods).toHaveLength(before.periods.length);
    expect(after.audits).toHaveLength(before.audits.length + 1);
    expect(after.audits.at(-1)).toMatchObject({ id: body.operationId, entityId: body.operationId, entityType: "budget", userId: actors.get("member")!.id });
  });
  it("creates a target override for a selected manual budget without an override and retains its default", async () => {
    const suggestion = (await selected()).find(row => row.categoryId === dining)!;
    await signed("/recalculate/apply").send(intent([suggestion])).expect(200);
    expect((await state()).periods.find(row => row.budgetId === diningBudget)).toMatchObject({ startDate: `${targetPeriod}-01`, endDate: targetEnd, budgetAmount: "100.00", currency: "ZMW" });
    expect((await state()).budgets.find(row => row.id === diningBudget)?.amount).toBe("500.00");
  });
  it("creates an absent category limit only for the confirmed month and keeps every other month unbudgeted", async () => {
    const shown = (await preview()).suggestions.find(row => row.categoryId === transport)!;
    expect(shown.currentBudget).toBeNull();
    await signed("/recalculate/apply").send(intent([shown])).expect(200);
    const after = await state(), created = after.budgets.find(row => row.categoryId === transport)!;
    expect(created).toBeDefined(); expect(created.amount).toBeNull();
    expect(after.periods.filter(row => row.budgetId === created.id)).toMatchObject([
      { startDate: `${targetPeriod}-01`, endDate: targetEnd, budgetAmount: "40.00", currency: "ZMW" },
    ]);
    const month = new Date(`${targetPeriod}-01T12:00:00Z`);
    for (const offset of [-1, 0, 1]) {
      const date = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + offset, 1));
      const response = await request(app).get(`/api/budgets/progress?year=${date.getUTCFullYear()}&month=${date.getUTCMonth() + 1}`)
        .set("Cookie", actors.get("member")!.cookie).expect(200);
      expect(response.body.data.some((row: { id: string }) => row.id === created.id)).toBe(offset === 0);
    }
    const previous = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1));
    const forecast = await request(app).get(`/api/budgets/forecast?year=${previous.getUTCFullYear()}&month=${previous.getUTCMonth() + 1}&months=3`)
      .set("Cookie", actors.get("member")!.cookie).expect(200);
    expect(forecast.body.data.budgets.find((row: { id: string }) => row.id === created.id).periods.map((row: { amount: unknown }) => row.amount))
      .toEqual([null, { amount: "40.00", currency: "ZMW" }, null]);
    for (const offset of [-1, 0, 1]) {
      const date = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + offset, 1));
      const first = date.toISOString().slice(0, 10), last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      await db.insert(transactions).values({ householdId: a, accountId: ids.sharedAccount, categoryId: transport, ownerUserId: actors.get("member")!.id,
        date: first, name: "Synthetic report readback", amount: "15", type: "expense", currency: "ZMW" });
      const report = await request(app).get(`/api/reports/cashflow/budget?from=${first}&to=${last}&interval=month`)
        .set("Cookie", actors.get("member")!.cookie).expect(200);
      const row = report.body.data.comparison.find((item: { categoryId: string }) => item.categoryId === transport);
      expect(row.budgeted).toEqual({ amount: offset === 0 ? "40.00" : "0.00", currency: "ZMW" });
      if (offset !== 0) expect(row.status).toBe("unbudgeted");
    }
  });
  it("replays one operation without writes after source changes, but rejects changed intent with that UUID", async () => {
    const body = intent(await selected());
    const first = await signed("/recalculate/apply").send(body).expect(200), applied = await state();
    await source("900");
    const replay = await signed("/recalculate/apply").send({ ...body, suggestions: [...body.suggestions].reverse() }).expect(200);
    expect(replay.body).toEqual(first.body); expect(await state()).toEqual(applied);
    await signed("/recalculate/apply").send({ ...body, suggestions: body.suggestions.slice(0, 1) }).expect(409);
    await signed("/recalculate/apply", "admin").send(body).expect(409);
    expect(await state()).toEqual(applied);
  });
  it.each(["group", "ungrouped"] as const)("creates a month-only %s limit through signed apply and progress readback", async mode => {
    if (mode === "group") await db.update(categoryGroups).set({ budgetMode: "by_group" }).where(eq(categoryGroups.id, group));
    else await db.update(categories).set({ groupId: null }).where(eq(categories.id, transport));
    const shown = (await preview()).suggestions.find(row => mode === "group" ? row.categoryGroupId === group : row.categoryId === transport)!;
    expect(shown.currentBudget).toBeNull();
    const before = await state(); await signed("/recalculate/apply").send(intent([shown])).expect(200);
    const after = await state(), created = after.budgets.find(row => mode === "group" ? row.categoryGroupId === group : row.categoryId === transport)!;
    expect(created.amount).toBeNull();
    expect(after.budgets.filter(row => row.id !== created.id)).toEqual(before.budgets);
    expect(after.periods.find(row => row.budgetId === created.id)).toMatchObject({ startDate: `${targetPeriod}-01`, endDate: targetEnd,
      budgetAmount: mode === "group" ? "323.33" : "40.00", currency: "ZMW" });
    const read = await request(app).get(`/api/budgets/progress?year=${targetPeriod.slice(0, 4)}&month=${targetPeriod.slice(5)}`)
      .set("Cookie", actors.get("member")!.cookie).expect(200);
    expect(read.body.data.find((row: { id: string }) => row.id === created.id)?.amount)
      .toEqual({ amount: mode === "group" ? "323.33" : "40.00", currency: "ZMW" });
  });
  it("reuses a dormant month-only shell without creating a recurring default or rewriting its past limit", async () => {
    const dormant = randomUUID();
    await db.insert(budgets).values({ id: dormant, householdId: a, name: "Previous month-only limit", categoryId: transport, amount: null, currency: "ZMW" });
    await db.insert(budgetPeriods).values({ budgetId: dormant, startDate: `${previousPeriod}-01`, endDate: previousEnd, budgetAmount: "30", version: 2 });
    const shown = (await preview()).suggestions.find(row => row.categoryId === transport)!;
    expect(shown.currentBudget).toBeNull();
    const before = await state(); await signed("/recalculate/apply").send(intent([shown])).expect(200);
    const after = await state(); expect(after.budgets).toEqual(before.budgets);
    expect(after.periods.find(row => row.budgetId === dormant && row.startDate === `${previousPeriod}-01`))
      .toEqual(before.periods.find(row => row.budgetId === dormant));
    expect(after.periods.find(row => row.budgetId === dormant && row.startDate === `${targetPeriod}-01`)).toMatchObject({ budgetAmount: "40.00" });
  });
  it("rechecks live edit permissions on durable replay after the HTTP role guard already admitted the request", async () => {
    const body = intent(await selected()); await signed("/recalculate/apply").send(body).expect(200);
    const before = await state(), actual = Client.prototype.query; let revoked = false;
    vi.spyOn(Client.prototype, "query").mockImplementation(function(this: Client, ...args: unknown[]) {
      const command = args[0], text = typeof command === "string" ? command : command && typeof command === "object" && "text" in command ? String(command.text) : "";
      if (!revoked && /from "household_members"/i.test(text) && /for share/i.test(text)) {
        revoked = true;
        return (async () => {
          await db.update(householdMembers).set({ role: "view_only" }).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id)));
          return Reflect.apply(actual, this, args);
        })();
      }
      return Reflect.apply(actual, this, args);
    } as typeof Client.prototype.query);
    await signed("/recalculate/apply").send(body).expect(403); expect(revoked).toBe(true); expect(await state()).toEqual(before);
  });
  it("serializes concurrent identical UUIDs into one durable application", async () => {
    const body = intent(await selected());
    const responses = await Promise.all([signed("/recalculate/apply").send(body), signed("/recalculate/apply").send(body)]);
    expect(responses.map(row => row.status)).toEqual([200, 200]); expect(responses[0].body).toEqual(responses[1].body);
    const after = await state(); expect(after.audits).toHaveLength(1);
    expect(after.periods.find(row => row.id === currentOverride)?.version).toBe(4);
  });
  it("lets one of two concurrent distinct operations apply the same shown version", async () => {
    const suggestions = await selected();
    const responses = await Promise.all([signed("/recalculate/apply").send(intent(suggestions)), signed("/recalculate/apply").send(intent(suggestions))]);
    expect(responses.map(row => row.status).sort()).toEqual([200, 409]);
    const after = await state(); expect(after.audits).toHaveLength(1);
    expect(after.periods.find(row => row.id === currentOverride)?.version).toBe(4);
  });
  it.each(["history", "amount", "version", "manual save", "default", "target"] as const)("rejects a stale %s atomically", async change => {
    const body = intent(await selected());
    if (change === "history") await source("900");
    if (change === "amount") await db.update(budgetPeriods).set({ budgetAmount: "711" }).where(eq(budgetPeriods.id, currentOverride));
    if (change === "version") await db.update(budgetPeriods).set({ version: 4 }).where(eq(budgetPeriods.id, currentOverride));
    if (change === "manual save") await request(app).put(`/api/budgets/forecast/${groceryBudget}`).set("Cookie", actors.get("member")!.cookie)
      .send({ year: parseInt(targetPeriod.slice(0, 4), 10), month: parseInt(targetPeriod.slice(5), 10), amount: { amount: "710.00", currency: "ZMW" }, applyScope: "this_month" }).expect(200);
    if (change === "default") await db.update(budgets).set({ amount: "501" }).where(eq(budgets.id, diningBudget));
    if (change === "target") body.targetPeriod = previousPeriod;
    const before = await state(); await signed("/recalculate/apply").send(body).expect(409); expect(await state()).toEqual(before);
  });
  it.each(["view_only", "professional"] as const)("denies %s editing including durable replay", async role => {
    const body = intent(await selected());
    await signed("/recalculate/apply", role).send(body).expect(403);
    await signed("/recalculate/apply").send(body).expect(200);
    await db.update(householdMembers).set({ role }).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id)));
    const before = await state(); await signed("/recalculate/apply").send(body).expect(403); expect(await state()).toEqual(before);
  });
  it("denies unsigned and cross-household selected intent", async () => {
    const body = intent(await selected()), before = await state();
    await request(app).post("/api/budgets/recalculate/apply").send(body).expect(401);
    await signed("/recalculate/apply", "outsider").send(body).expect(409); expect(await state()).toEqual(before);
  });
  it.each(["account", "transaction"] as const)("prevents the owner's visible private %s money entering household limits or audit", async privacy => {
    await source("777.77", groceries, privacy);
    const body = intent((await selected("owner")).filter(row => row.categoryId === groceries)), before = await state();
    expect(body.suggestions[0].historicalTotal.amount).toBe("1327.77");
    await signed("/recalculate/apply", "owner").send(body).expect(409); expect(await state()).toEqual(before);
    // An editor who cannot see that private source can still apply the public estimate.
    await signed("/recalculate/apply").send(intent((await selected()).filter(row => row.categoryId === groceries))).expect(200);
    expect(JSON.stringify((await state()).audits)).not.toContain("1327.77");
    expect(JSON.stringify((await state()).audits)).not.toContain("777.77");
  });
  it("rejects changed suggestion or current-limit denominations instead of silently replacing manual currency", async () => {
    const rows = await selected(), forged = structuredClone(rows); forged[0].amount.currency = "USD";
    const before = await state(); await signed("/recalculate/apply").send(intent(forged)).expect(409); expect(await state()).toEqual(before);
    await db.update(budgetPeriods).set({ currency: "USD" }).where(eq(budgetPeriods.id, currentOverride));
    const incompatible = await selected(), changed = await state();
    await signed("/recalculate/apply").send(intent(incompatible)).expect(409); expect(await state()).toEqual(changed);
  });
  it.each(["missing operation", "empty selection", "duplicate", "months", "unknown"])("rejects invalid explicit apply intent: %s", async invalid => {
    const body: Record<string, unknown> = intent(await selected());
    if (invalid === "missing operation") delete body.operationId;
    if (invalid === "empty selection") body.suggestions = [];
    if (invalid === "duplicate") body.suggestions = [(body.suggestions as unknown[])[0], (body.suggestions as unknown[])[0]];
    if (invalid === "months") body.months = 12;
    if (invalid === "unknown") body.confirm = true;
    const before = await state(); await signed("/recalculate/apply").send(body).expect(400); expect(await state()).toEqual(before);
  });
  it("rolls back all period writes when durable batch audit insertion fails", async () => {
    const body = intent(await selected()), before = await state(), actual = Client.prototype.query;
    vi.spyOn(Client.prototype, "query").mockImplementation(function(this: Client, ...args: unknown[]) {
      const command = args[0], text = typeof command === "string" ? command : command && typeof command === "object" && "text" in command ? String(command.text) : "";
      if (/insert into "audit_logs"/i.test(text)) return Promise.reject(new Error("Synthetic audit insert failure"));
      return Reflect.apply(actual, this, args);
    } as typeof Client.prototype.query);
    await signed("/recalculate/apply").send(body).expect(500); expect(await state()).toEqual(before);
  });
  it("keeps legacy POST and GET preview non-mutating after confirmed apply exists", async () => {
    const before = await state(); await preview();
    await request(app).get("/api/budgets/recalculate/preview?months=3").set("Cookie", actors.get("member")!.cookie).expect(200);
    expect(await state()).toEqual(before);
  });
  it("keeps signed comparisons live for every actor across repeated reads and confirmed apply", async () => {
    const observed = cachedReports(); await currentReportActivity();
    for (const role of ["member", "owner"] as const) {
      const warm = await comparison(role).expect(200);
      expect(warm.body.data.comparison.find((row: { categoryId: string }) => row.categoryId === groceries).budgeted.amount).toBe("710.00");
      expect((await comparison(role).expect(200)).body.data.comparison).toEqual(warm.body.data.comparison);
    }
    expect(observed.hits).toBe(0); // This live financial response never reuses cache.
    await signed("/recalculate/apply").send(intent((await selected()).slice(0, 1))).expect(200);
    for (const role of ["member", "owner"] as const) {
      const read = await comparison(role).expect(200);
      expect(read.body.data.comparison.find((row: { categoryId: string }) => row.categoryId === groceries).budgeted.amount).toBe("183.33");
    }
  });
  it.each(["ordinary", "required"] as const)("retains one durable financial application across %s postcommit cache failure and retry", async kind => {
    let failure: "ordinary" | "required" | undefined;
    cachedReports(() => failure); await currentReportActivity(); await comparison().expect(200);
    const body = intent((await selected()).slice(0, 1)); failure = kind;
    await signed("/recalculate/apply").send(body).expect(kind === "ordinary" ? 200 : 500);
    const applied = await state();
    expect(applied.periods.find(row => row.id === currentOverride)?.version).toBe(4);
    expect(applied.audits.filter(row => row.id === body.operationId)).toHaveLength(1);
    failure = undefined;
    await signed("/recalculate/apply").send(body).expect(200);
    expect(await state()).toEqual(applied);
    expect((await comparison().expect(200)).body.data.comparison.find((row: { categoryId: string }) => row.categoryId === groceries).budgeted.amount).toBe("183.33");
  });
  it.each(["forecast", "default"] as const)("keeps both actors' comparison current after the existing manual %s writer", async kind => {
    cachedReports(); await currentReportActivity();
    if (kind === "default") await db.insert(transactions).values({ householdId: a, accountId: ids.sharedAccount, categoryId: dining,
      ownerUserId: actors.get("member")!.id, date: `${targetPeriod}-01`, name: "Synthetic dining readback", amount: "15", type: "expense", currency: "ZMW" });
    const selectedCategory = kind === "forecast" ? groceries : dining;
    for (const role of ["owner", "member"] as const) await comparison(role).expect(200);
    if (kind === "forecast") await request(app).put(`/api/budgets/forecast/${groceryBudget}`).set("Cookie", actors.get("member")!.cookie)
      .send({ year: parseInt(targetPeriod.slice(0, 4), 10), month: parseInt(targetPeriod.slice(5), 10), amount: { amount: "850.00", currency: "ZMW" } }).expect(200);
    else await request(app).put(`/api/budgets/${diningBudget}`).set("Cookie", actors.get("member")!.cookie)
      .send({ amount: { amount: "600.00", currency: "ZMW" } }).expect(200);
    for (const role of ["owner", "member"] as const) {
      const read = await comparison(role).expect(200);
      expect(read.body.data.comparison.find((row: { categoryId: string }) => row.categoryId === selectedCategory).budgeted.amount)
        .toBe(kind === "forecast" ? "850.00" : "600.00");
    }
  });
  it("keeps both actors' actual spending current after the existing signed expense writer", async () => {
    cachedReports(); await currentReportActivity();
    for (const role of ["owner", "member"] as const) await comparison(role).expect(200);
    await expense().expect(201);
    for (const role of ["owner", "member"] as const) {
      const read = await comparison(role).expect(200);
      expect(read.body.data.comparison.find((row: { categoryId: string }) => row.categoryId === groceries).actual.amount).toBe("55.00");
    }
  });
  it.each(["comparison", "cashflow forecast"] as const)("an in-flight old %s read cannot populate a stale cache after apply", async kind => {
    cachedReports(); await currentReportActivity();
    let release!: () => void, observed!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { observed = resolve; });
    const read = () => kind === "comparison" ? comparison() : request(app)
      .get(`/api/reports/cashflow?from=${previousPeriod}-01&to=${previousPeriod}-01&interval=month&includeForecast=true&forecastMonths=1`)
      .set("Cookie", actors.get("member")!.cookie);
    if (kind === "comparison") {
      const actual = cashflowReportRepository.getBudgetComparison.bind(cashflowReportRepository);
      vi.spyOn(cashflowReportRepository, "getBudgetComparison").mockImplementationOnce(async (...args) => {
        const result = await actual(...args); observed(); await gate; return result;
      });
    } else {
      const actual = cashflowReportRepository.getCashflowWithForecast.bind(cashflowReportRepository);
      vi.spyOn(cashflowReportRepository, "getCashflowWithForecast").mockImplementationOnce(async (...args) => {
        const result = await actual(...args); observed(); await gate; return result;
      });
    }
    const pending = read().expect(200).then(response => response);
    try { await entered; await signed("/recalculate/apply").send(intent((await selected()).slice(0, 1))).expect(200); }
    finally { release(); }
    const old = await pending, fresh = await read().expect(200);
    if (kind === "comparison") {
      expect(old.body.data.comparison.find((row: { categoryId: string }) => row.categoryId === groceries).budgeted.amount).toBe("710.00");
      expect(fresh.body.data.comparison.find((row: { categoryId: string }) => row.categoryId === groceries).budgeted.amount).toBe("183.33");
    } else {
      expect(old.body.data.series.find((row: { isForecast?: boolean }) => row.isForecast).expenses.amount).toBe("1210.00");
      expect(fresh.body.data.series.find((row: { isForecast?: boolean }) => row.isForecast).expenses.amount).toBe("683.33");
    }
  });
  it("the signed no-provider AI budget caller reads current actor-bound data after manual and expense writes", async () => {
    expect(geminiClient.isAvailable()).toBe(false);
    await db.update(households).set({ aiConsentGiven: true }).where(eq(households.id, a));
    await currentReportActivity();
    await db.insert(transactions).values({ householdId: a, accountId: ids.privateAccount, categoryId: groceries, ownerUserId: actors.get("owner")!.id,
      date: `${targetPeriod}-01`, name: "Synthetic private AI visibility", amount: "50.00", type: "expense", currency: "ZMW" });
    const reads: Array<{ actor: string; budgeted: string; spent: string }> = [], actual = AIAnalyticsService.prototype.getBudgetStatus;
    vi.spyOn(AIAnalyticsService.prototype, "getBudgetStatus").mockImplementation(async function(this: AIAnalyticsService, context) {
      const rows = await actual.call(this, context), grocery = rows.find(row => row.categoryId === groceries)!;
      reads.push({ actor: context.userId, budgeted: grocery.budgeted.toString(), spent: grocery.spent.toString() }); return rows;
    });
    const chat = async (role: Role) => {
      const response = await request(app).post("/api/ai/chat").set("Cookie", actors.get(role)!.cookie).send({ message: "Show budget status" }).expect(200);
      expect(response.body.toolsUsed).toContain("get_budget_status");
    };
    await chat("owner"); await chat("member");
    await request(app).put(`/api/budgets/forecast/${groceryBudget}`).set("Cookie", actors.get("member")!.cookie)
      .send({ year: parseInt(targetPeriod.slice(0, 4), 10), month: parseInt(targetPeriod.slice(5), 10), amount: { amount: "850.00", currency: "ZMW" } }).expect(200);
    await expense().expect(201); await chat("member"); await chat("owner");
    expect(reads).toEqual([
      { actor: actors.get("owner")!.id, budgeted: "710.00", spent: "65.00" },
      { actor: actors.get("member")!.id, budgeted: "710.00", spent: "15.00" },
      { actor: actors.get("member")!.id, budgeted: "850.00", spent: "55.00" },
      { actor: actors.get("owner")!.id, budgeted: "850.00", spent: "105.00" },
    ]);
  });
});
