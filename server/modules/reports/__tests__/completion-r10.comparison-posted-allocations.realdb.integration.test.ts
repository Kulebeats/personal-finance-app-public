import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { budgets, budgetPeriods, categories, categoryGroups, dataExports, fxRates, households, providerFxQuotes, transactions, transactionSplits } from "@shared/schema";
import { db } from "../../../db";
import { Money } from "../../../core/money";
import { a, b, actors, app, ids, resetAccountsAndMembership, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const group = randomUUID(), grocery = randomUUID(), dining = randomUUID(), transport = randomUUID(), foreign = randomUUID();
const first = "2026-10-01", last = "2026-10-31", day = "2026-10-15";
const quoteIds: string[] = [], manualRateIds: string[] = [];
type Part = { categoryId: string | null; amount: string };
type Options = { categoryId?: string | null; currency?: string | null; date?: string; pending?: boolean;
  status?: "pending" | "cleared" | "reconciled" | null; type?: "income" | "expense" | "transfer" | "balance_adjustment";
  householdId?: string; accountId?: string; ownerUserId?: string; private?: boolean; excluded?: boolean; deleted?: boolean; notes?: string };
async function posting(amount: string, parts?: Part[], input: Options = {}) {
  const [parent] = await db.insert(transactions).values({ householdId: input.householdId ?? a, accountId: input.accountId ?? ids.sharedAccount,
    ownerUserId: input.ownerUserId ?? actors.get("member")!.id, categoryId: input.categoryId === undefined ? parts ? null : grocery : input.categoryId,
    name: "Synthetic comparison activity", date: input.date ?? day, amount, currency: input.currency === undefined ? "ZMW" : input.currency,
    type: input.type ?? "expense", isPending: input.pending ?? false, ...(input.status === undefined ? {} : { status: input.status }),
    isPrivate: input.private ?? false, isExcludedFromReports: input.excluded ?? false, notes: input.notes,
    deletedAt: input.deleted ? new Date("2026-10-16T00:00:00Z") : null }).returning({ id: transactions.id });
  if (parts) await db.insert(transactionSplits).values(parts.map((part, displayOrder) => ({ transactionId: parent.id, ...part, displayOrder })));
  return parent.id;
}
function report(role: Role = "owner") {
  const scope = role === "owner" || role === "admin" ? "household" : "mine";
  return request(app).get(`/api/reports/cashflow/budget?from=${first}&to=${last}&interval=month&scope=${scope}&includePending=true`)
    .set("Cookie", actors.get(role)!.cookie);
}
async function csv(role: "owner" | "admin" | "member" = "owner") {
  // Exercise the actual signed download and stored scope, without creating a
  // second export-build timer. A download recomputes through the shared reader.
  const [item] = await db.insert(dataExports).values({ userId: actors.get(role)!.id, householdId: a, exportType: "budget", fileFormat: "csv",
    dateRangeStart: first, dateRangeEnd: last, status: "completed", recordCount: 0,
    parameters: { reportType: "budget", format: "csv", startDate: first, endDate: last, interval: "month", scope: role === "member" ? "mine" : "household",
      includeCharts: false, includeForecast: false, forecastMonths: 3, includePending: true } }).returning({ id: dataExports.id });
  return request(app).get(`/api/reports/exports/${item.id}?download=true`).set("Cookie", actors.get(role)!.cookie);
}
function values(response: request.Response) {
  return Object.fromEntries(response.body.data.comparison.map((row: { categoryName: string; actual: { amount: string } }) => [row.categoryName, row.actual.amount]));
}
function csvValues(content: string) {
  const rows = content.trim().split(/\r?\n/).map(line => line.split(",").map(cell => cell.replace(/^"|"$/g, "")));
  const [headers, ...data] = rows;
  return Object.fromEntries(data.map(row => [row[headers.indexOf("category")], new Money(row[headers.indexOf("actual")], row[headers.indexOf("currency")]).toString()]));
}
async function unavailable() {
  const response = await report().expect(422);
  expect(response.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
  const download = await csv(); expect(download.status).toBe(422); expect(download.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
  for (const secret of [foreign, "FOREIGN-MEMBER", "PRIVATE-MEMBER"]) {
    expect(JSON.stringify(response.body)).not.toContain(secret); expect(JSON.stringify(download.body)).not.toContain(secret);
  }
}
async function trusted(date = day, validThrough = date) {
  const id = randomUUID(); quoteIds.push(id);
  await db.insert(providerFxQuotes).values({ id, fromCurrency: "USD", toCurrency: "ZMW", rate: "2", provider: "yahoo_finance",
    effectiveDate: date, validThrough, quotedAt: new Date(`${date}T10:00:00Z`) });
}
async function clean() {
  await db.delete(dataExports).where(inArray(dataExports.householdId, [a, b]));
  await db.delete(budgets).where(inArray(budgets.householdId, [a, b]));
  await db.delete(categories).where(inArray(categories.householdId, [a, b]));
  await db.delete(categoryGroups).where(inArray(categoryGroups.householdId, [a, b]));
  if (quoteIds.length) await db.delete(providerFxQuotes).where(inArray(providerFxQuotes.id, quoteIds.splice(0)));
  if (manualRateIds.length) await db.delete(fxRates).where(inArray(fxRates.id, manualRateIds.splice(0)));
}

describe("NEW-14 signed budget comparison and CSV use posted expense allocations", () => {
  beforeAll(async () => { await start(); }, 20_000);
  beforeEach(async () => {
    await resetAccountsAndMembership(); await clean();
    await db.update(households).set({ currency: "ZMW" }).where(eq(households.id, a));
    await db.insert(categoryGroups).values({ id: group, householdId: a, name: "Comparison expenses", type: "expenses", budgetMode: "by_category", displayOrder: 0 });
    await db.insert(categories).values([
      ...[{ id: grocery, name: "Groceries" }, { id: dining, name: "Dining" }, { id: transport, name: "Transport" }].map((row, displayOrder) =>
        ({ ...row, householdId: a, groupId: group, includeInBudget: true, displayOrder })),
      { id: foreign, householdId: b, name: "FOREIGN-MEMBER category", displayOrder: 0 },
    ]);
    await db.insert(budgets).values([{ categoryId: grocery, name: "Groceries", amount: "100" }, { categoryId: dining, name: "Dining", amount: "70" },
      { categoryId: transport, name: "Transport", amount: "40" }].map(row => ({ ...row, householdId: a, currency: "ZMW" })));
  });
  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  it("attributes a split-only parent once to its child categories and the same CSV amounts", async () => {
    await posting("90", [{ categoryId: grocery, amount: "60" }, { categoryId: dining, amount: "30" }]);
    for (const role of ["owner", "admin", "member"] as const) {
      const response = await report(role).expect(200); expect(values(response)).toEqual({ Groceries: "60.00", Dining: "30.00" });
      expect(response.body.data.summary).toMatchObject({ totalActual: { amount: "90.00", currency: "ZMW" }, totalBudgeted: { amount: "170.00", currency: "ZMW" } });
      const download = await csv(role); expect(download.status).toBe(200); expect(csvValues(download.text)).toEqual({ Groceries: "60.00", Dining: "30.00" });
    }
  });
  it("does not also attribute the split parent's stale category or inflate its magnitude", async () => {
    await posting("20");
    await posting("90", [{ categoryId: grocery, amount: "60" }, { categoryId: dining, amount: "30" }], { categoryId: transport });
    const response = await report().expect(200); expect(values(response)).toEqual({ Groceries: "80.00", Dining: "30.00" });
    expect(response.body.data.summary.totalActual.amount).toBe("110.00");
  });
  for (const shape of ["ordinary", "split"] as const) {
    it.each([null, foreign])(`keeps ${shape} category60 plus uncategorized40 complete without exposing foreign pointers %j`, async categoryId => {
      if (shape === "ordinary") {
        await posting("60"); await posting("40", undefined, { categoryId });
      } else {
        await posting("100", [{ categoryId: grocery, amount: "60" }, { categoryId, amount: "40" }], { categoryId: transport });
      }
      for (const role of ["owner", "admin", "member"] as const) {
        const response = await report(role).expect(200);
        expect(values(response)).toEqual({ Groceries: "60.00", Uncategorized: "40.00" });
        expect(response.body.data.summary).toMatchObject({ totalActual: { amount: "100.00", currency: "ZMW" }, totalBudgeted: { amount: "100.00", currency: "ZMW" } });
        expect(response.body.data.comparison).toContainEqual(expect.objectContaining({ categoryId: "uncategorized", categoryName: "Uncategorized",
          actual: { amount: "40.00", currency: "ZMW" }, budgeted: { amount: "0.00", currency: "ZMW" }, status: "unbudgeted" }));
        expect(response.body.data.metadata.categoriesWithoutBudget).toEqual(["Uncategorized"]);
        const download = await csv(role); expect(download.status).toBe(200);
        expect(csvValues(download.text)).toEqual({ Groceries: "60.00", Uncategorized: "40.00" });
        const csvTotal = Object.values(csvValues(download.text)).reduce((total, value) => total.add(new Money(value, "ZMW")), Money.zero("ZMW"));
        expect(csvTotal.toString()).toBe("100.00");
        for (const secret of [foreign, "FOREIGN-MEMBER", "PRIVATE-MEMBER"]) expect(JSON.stringify(response.body) + download.text).not.toContain(secret);
      }
    });
  }
  it("returns an entirely Uncategorized split without looking up a synthetic UUID budget", async () => {
    await posting("100", [{ categoryId: null, amount: "60" }, { categoryId: foreign, amount: "40" }], { categoryId: transport });
    const response = await report("admin").expect(200); expect(values(response)).toEqual({ Uncategorized: "100.00" });
    expect(response.body.data.summary).toMatchObject({ totalActual: { amount: "100.00", currency: "ZMW" }, totalBudgeted: { amount: "0.00", currency: "ZMW" } });
    expect(response.body.data.metadata).toMatchObject({ budgetsCovered: 0, categoriesWithoutBudget: ["Uncategorized"] });
    const download = await csv("admin"); expect(download.status).toBe(200); expect(csvValues(download.text)).toEqual({ Uncategorized: "100.00" });
    expect(JSON.stringify(response.body) + download.text).not.toContain(foreign); expect(JSON.stringify(response.body) + download.text).not.toContain("FOREIGN-MEMBER");
  });
  it.each(["isPending", "status"] as const)("ignores the %s marker until ordinary and split parents are posted, despite pending display preferences", async marker => {
    await posting("20");
    const pending = { pending: marker === "isPending", status: marker === "status" ? "pending" as const : "cleared" as const };
    const ordinary = await posting("40", undefined, { ...pending, categoryId: dining });
    const split = await posting("90", [{ categoryId: grocery, amount: "60" }, { categoryId: dining, amount: "30" }], pending);
    expect(values(await report().expect(200))).toEqual({ Groceries: "20.00" });
    await db.update(transactions).set({ isPending: false, status: "reconciled" }).where(inArray(transactions.id, [ordinary, split]));
    expect(values(await report().expect(200))).toEqual({ Groceries: "80.00", Dining: "70.00" });
    const download = await csv(); expect(download.status).toBe(200); expect(csvValues(download.text)).toEqual({ Groceries: "80.00", Dining: "70.00" });
  });
  it("never guesses an expense refund from generic income, wording, transfer or adjustment activity", async () => {
    await posting("20");
    await posting("50", undefined, { type: "income", notes: "Refund wording without an original expense reference" });
    await posting("90", [{ categoryId: grocery, amount: "60" }, { categoryId: dining, amount: "30" }], { type: "income", currency: "USD" });
    await posting("50", undefined, { type: "transfer", currency: "USD" }); await posting("50", undefined, { type: "balance_adjustment", currency: "USD" });
    expect(values(await report().expect(200))).toEqual({ Groceries: "20.00" });
  });
  it("does not let excluded, deleted, out-of-range or pending foreign activity change amounts or FX availability", async () => {
    await posting("20");
    for (const options of [{ excluded: true }, { deleted: true }, { pending: true }, { status: "pending" as const }, { date: "2026-09-30" }, { date: "2026-11-01" }]) {
      await posting("90", [{ categoryId: grocery, amount: "60" }, { categoryId: dining, amount: "30" }], { ...options, currency: "USD" });
    }
    expect(values(await report().expect(200))).toEqual({ Groceries: "20.00" });
  });
  it("withholds another member's malformed private or foreign-parent presence from JSON and CSV", async () => {
    await posting("20"); const before = await report("admin").expect(200);
    await posting("90", [{ categoryId: grocery, amount: "100" }, { categoryId: dining, amount: "-10" }],
      { accountId: ids.privateAccount, ownerUserId: actors.get("owner")!.id, currency: null, notes: "PRIVATE-MEMBER evidence" });
    await posting("90", [{ categoryId: grocery, amount: "100" }, { categoryId: dining, amount: "-10" }],
      { private: true, ownerUserId: actors.get("owner")!.id, currency: null });
    await posting("900", [{ categoryId: grocery, amount: "900" }], { householdId: b, accountId: ids.foreignAccount, currency: null });
    await posting("900", [{ categoryId: grocery, amount: "900" }], { accountId: ids.foreignAccount, currency: null });
    const hidden = await report("admin").expect(200); expect(hidden.body.data.comparison).toEqual(before.body.data.comparison);
    expect(hidden.body.data.summary).toEqual(before.body.data.summary); expect(hidden.body.data.metadata).toEqual(before.body.data.metadata);
    const download = await csv("admin"); expect(download.status).toBe(200); expect(csvValues(download.text)).toEqual({ Groceries: "20.00" });
    expect(JSON.stringify(hidden.body) + download.text).not.toMatch(/PRIVATE-MEMBER|FOREIGN-MEMBER/);
    await unavailable();
  });
  it("treats foreign and null child category pointers identically without parent-category fallback", async () => {
    const parent = await posting("90", [{ categoryId: grocery, amount: "60" }, { categoryId: foreign, amount: "30" }], { categoryId: transport });
    const foreignResult = await report().expect(200); expect(values(foreignResult)).toEqual({ Groceries: "60.00", Uncategorized: "30.00" });
    await db.update(transactionSplits).set({ categoryId: null }).where(eq(transactionSplits.categoryId, foreign));
    const nullResult = await report().expect(200);
    expect(nullResult.body.data.comparison).toEqual(foreignResult.body.data.comparison); expect(nullResult.body.data.metadata).toEqual(foreignResult.body.data.metadata);
    expect(JSON.stringify(foreignResult.body)).not.toContain(foreign);
    await db.update(transactionSplits).set({ categoryId: foreign }).where(eq(transactionSplits.transactionId, parent));
    await db.update(transactions).set({ currency: null }).where(eq(transactions.id, parent));
    await unavailable();
  });
  it("requires trusted dated FX for the Uncategorized allocation as part of the same posted parent", async () => {
    await posting("100", [{ categoryId: grocery, amount: "60" }, { categoryId: null, amount: "40" }], { currency: "USD" });
    await unavailable(); await trusted();
    const response = await report().expect(200); expect(values(response)).toEqual({ Groceries: "120.00", Uncategorized: "80.00" });
    expect(response.body.data.summary.totalActual).toEqual({ amount: "200.00", currency: "ZMW" });
    const download = await csv(); expect(download.status).toBe(200); expect(csvValues(download.text)).toEqual({ Groceries: "120.00", Uncategorized: "80.00" });
  });
  it.each(["negative expense", "mixed-sign allocations", "unreconciled allocations"] as const)("keeps unproven legacy %s unavailable instead of taking ABS or dropping it", async legacy => {
    if (legacy === "negative expense") await posting("-10", undefined, { notes: "Unproven legacy refund" });
    if (legacy === "mixed-sign allocations") await posting("30", [{ categoryId: grocery, amount: "40" }, { categoryId: dining, amount: "-10" }]);
    if (legacy === "unreconciled allocations") await posting("90", [{ categoryId: grocery, amount: "60" }, { categoryId: dining, amount: "20" }]);
    await unavailable();
  });
  it.each([null, "usd"])("does not replace an unknown captured transaction currency %j with the current account currency", async currency => {
    await posting("90", [{ categoryId: grocery, amount: "60" }, { categoryId: dining, amount: "30" }], { currency });
    await unavailable();
  });
  it("uses an in-validity trusted dated quote for ordinary and split allocations, ignoring editable fx_rates", async () => {
    await trusted("2026-10-14", "2026-10-15");
    const id = randomUUID(); manualRateIds.push(id);
    await db.insert(fxRates).values({ id, fromCurrency: "USD", toCurrency: "ZMW", rate: "999", date: day, source: "manual" });
    await posting("3", undefined, { currency: "USD" });
    await posting("10", [{ categoryId: grocery, amount: "6" }, { categoryId: dining, amount: "4" }], { currency: "USD" });
    const response = await report().expect(200); expect(values(response)).toEqual({ Groceries: "18.00", Dining: "8.00" });
    expect(response.body.data.summary.totalActual).toEqual({ amount: "26.00", currency: "ZMW" });
    const download = await csv(); expect(download.status).toBe(200); expect(csvValues(download.text)).toEqual({ Groceries: "18.00", Dining: "8.00" });
  });
  it.each(["missing", "expired", "future", "editable only"] as const)("rejects %s conversion evidence for contributing posted allocations", async evidence => {
    if (evidence === "expired") await trusted("2026-10-13", "2026-10-14");
    if (evidence === "future") await trusted("2026-10-16");
    if (evidence === "editable only") {
      const id = randomUUID(); manualRateIds.push(id); await db.insert(fxRates).values({ id, fromCurrency: "USD", toCurrency: "ZMW", rate: "2", date: day, source: "manual" });
    }
    await posting("10", [{ categoryId: grocery, amount: "6" }, { categoryId: dining, amount: "4" }], { currency: "USD" });
    await unavailable();
  });
  it("does not arbitrarily select among multiple active limits for a contributing category", async () => {
    await posting("20");
    await db.insert(budgets).values({ householdId: a, categoryId: grocery, name: "Competing limit", amount: "200", currency: "ZMW" });
    await unavailable();
  });
  it.each(["partial", "cross-month", "negative", "nonfinite"] as const)("withholds an ambiguous or invalid contributing %s period limit", async kind => {
    await posting("20");
    const [budget] = await db.select().from(budgets).where(eq(budgets.categoryId, grocery));
    await db.insert(budgetPeriods).values({ budgetId: budget.id, startDate: kind === "partial" ? "2026-10-10" : kind === "cross-month" ? "2026-09-01" : first,
      endDate: kind === "cross-month" ? "2026-11-30" : last, budgetAmount: kind === "negative" ? "-10" : kind === "nonfinite" ? "NaN" : "100", currency: "ZMW" });
    await unavailable();
  });
  it("preserves unrelated categories, inactive limits and out-of-window invalid overrides", async () => {
    await posting("20");
    const [budget] = await db.select().from(budgets).where(eq(budgets.categoryId, grocery));
    await db.insert(budgets).values([{ householdId: a, categoryId: grocery, name: "Inactive limit", amount: "200", currency: "USD", isActive: false },
      { householdId: a, categoryId: dining, name: "Other competing limit", amount: "200", currency: "USD" }]);
    await db.insert(budgetPeriods).values({ budgetId: budget.id, startDate: "2026-11-01", endDate: "2026-11-30", budgetAmount: "NaN", currency: "USD" });
    const response = await report().expect(200); expect(values(response)).toEqual({ Groceries: "20.00" });
    expect(response.body.data.summary.totalBudgeted).toEqual({ amount: "100.00", currency: "ZMW" });
  });
  it("only inspects an invalid recurring default when it contributes to the requested window", async () => {
    await posting("20");
    const [budget] = await db.update(budgets).set({ amount: "NaN", currency: "USD" }).where(eq(budgets.categoryId, grocery)).returning();
    await db.insert(budgetPeriods).values({ budgetId: budget.id, startDate: first, endDate: last, budgetAmount: "100", currency: "ZMW" });
    expect((await report().expect(200)).body.data.summary.totalBudgeted.amount).toBe("100.00");
    const longer = await request(app).get(`/api/reports/cashflow/budget?from=${first}&to=2026-11-30&interval=month&scope=household`)
      .set("Cookie", actors.get("owner")!.cookie).expect(422);
    expect(longer.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
  });
});
