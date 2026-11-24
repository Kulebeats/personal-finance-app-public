import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { accounts, budgets, categories, categoryGroups, fxRates, householdFxRateOverrides, households, transactions } from "@shared/schema";
import { db } from "../../../db";
import { Money } from "../../../core/money";
import { BudgetDenominationUnavailable } from "../../../core/money/budget-denomination";
import { calculateBudgetSpentBatch } from "../../../repositories/BudgetSpendBatchQueries";
import { getPostgresError } from "../../../utils/postgresError";
import { a, b, actors, app, resetAccountsAndMembership, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

// FIN-06: Budgets (spend batch, progress, preview), the transaction summary and
// the Reports budget comparison resolve a foreign flow's rate exactly as Reports
// does: the household's own manual rate valid on the flow date, else the
// latest shared rate dated on or before it. No rate fails closed, never 1.
// CHF and NOK are used because no other suite seeds them into the rate tables.
const RATED = "CHF", UNRATED = "NOK";
const group = randomUUID(), category = randomUUID(), budget = randomUUID(), account = randomUUID();
const sharedRateIds: string[] = [];
const positiveRateConstraint = "chk_fx_rates_positive";
let month: string, firstDay: string, lastDay: string, flowDate: string, rateDate: string, year: number, monthNumber: number;
const zmw = (amount: string) => ({ amount, currency: "ZMW" });

function signed(path: string, role: "owner" | "member" = "owner") {
  return request(app).get(path).set("Cookie", actors.get(role)!.cookie)
    .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);
}
async function sharedRate(from: string, date: string, rate: string) {
  const id = randomUUID(); sharedRateIds.push(id);
  // Synthetic shared rate, shaped like the market refresh's fx_rates mirror.
  await db.insert(fxRates).values({ id, fromCurrency: from, toCurrency: "ZMW", rate, date, source: "yahoo_finance" });
}

async function legacySharedRate(rate: string) {
  const id = randomUUID();
  sharedRateIds.push(id);
  await db.transaction(async tx => {
    const existing = await tx.execute<{ definition: string }>(sql`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'fx_rates'::regclass AND conname = ${positiveRateConstraint}
    `);
    const definition = existing.rows[0]?.definition;
    if (definition) await tx.execute(sql`ALTER TABLE fx_rates DROP CONSTRAINT chk_fx_rates_positive`);
    // Recreate the pre-0062 state on the marked synthetic target. The fixture
    // and restored constraint become visible together to the signed requests.
    await tx.insert(fxRates).values({ id, fromCurrency: UNRATED, toCurrency: "ZMW", rate, date: flowDate, source: "test_legacy_rate" });
    if (definition) {
      await tx.execute(sql.raw(`ALTER TABLE fx_rates ADD CONSTRAINT chk_fx_rates_positive ${definition}`));
    }
  });
}
async function householdRate(householdId: string, from: string, rate: string) {
  await db.insert(householdFxRateOverrides).values({ householdId, actorUserId: actors.get(householdId === a ? "owner" : "outsider")!.id,
    fromCurrency: from, toCurrency: "ZMW", effectiveDate: rateDate, validThrough: flowDate, rate });
}
async function expense(amount: string, currency = RATED) {
  await db.insert(transactions).values({ householdId: a, accountId: account, ownerUserId: actors.get("owner")!.id, categoryId: category,
    date: flowDate, name: "Synthetic FIN-06 foreign expense", amount, currency, type: "expense", isPrivate: false });
}
async function noOtherRates(from: string) {
  const rows = await db.select({ id: fxRates.id }).from(fxRates).where(and(eq(fxRates.fromCurrency, from),
    eq(fxRates.toCurrency, "ZMW"), lte(fxRates.date, flowDate)));
  expect(rows.filter(row => !sharedRateIds.includes(row.id))).toEqual([]);
}
async function clean() {
  await db.delete(transactions).where(eq(transactions.accountId, account));
  await db.delete(accounts).where(eq(accounts.id, account));
  await db.delete(budgets).where(inArray(budgets.householdId, [a, b]));
  await db.delete(categories).where(inArray(categories.householdId, [a, b]));
  await db.delete(categoryGroups).where(inArray(categoryGroups.householdId, [a, b]));
  await db.delete(householdFxRateOverrides).where(inArray(householdFxRateOverrides.householdId, [a, b]));
  if (sharedRateIds.length) await db.delete(fxRates).where(inArray(fxRates.id, sharedRateIds.splice(0)));
}

const progress = () => signed(`/api/budgets/progress?year=${year}&month=${monthNumber}`);
const summary = () => signed(`/api/transactions/summary?startDate=${firstDay}&endDate=${lastDay}&accountId=${account}`);
const comparison = () => signed(`/api/reports/cashflow/budget?from=${firstDay}&to=${lastDay}&interval=month&scope=household&includePending=true`);
const preview = () => signed("/api/budgets/recalculate/preview?months=3");
function spendBatch() {
  return calculateBudgetSpentBatch(a, [category], [], firstDay, lastDay, "ZMW", new Map([[category, "expense" as const]]),
    new Map(), { kind: "actor", actor: { householdId: a, userId: actors.get("owner")!.id, role: "owner" } }, false);
}

/** Every reader in scope reports the same converted spend for the category. */
async function expectEverywhere(amount: string) {
  const progressRows = (await progress().expect(200)).body.data as Array<{ id: string; spent: unknown }>;
  expect(progressRows.find(row => row.id === budget)?.spent).toEqual(zmw(amount));
  expect((await spendBatch()).byCategoryId.get(category)?.toString()).toBe(new Money(amount, "ZMW").toString());
  expect((await summary().expect(200)).body.data).toMatchObject({ currency: "ZMW", totalExpenses: zmw(amount) });
  const compared = (await comparison().expect(200)).body.data.comparison as Array<{ categoryName: string; actual: unknown }>;
  expect(compared.find(row => row.categoryName === "FIN-06 spending")?.actual).toEqual(zmw(amount));
  const suggestions = (await preview().expect(200)).body.data.suggestions as Array<{ categoryId: string | null; historicalTotal: unknown }>;
  expect(suggestions.find(row => row.categoryId === category)?.historicalTotal).toEqual(zmw(amount));
}
async function expectUnavailableEverywhere() {
  for (const response of [await progress(), await summary(), await comparison(), await preview()]) {
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
    expect(response.body.data).toBeUndefined();
  }
  await expect(spendBatch()).rejects.toBeInstanceOf(BudgetDenominationUnavailable);
}

describe("FIN-06 Budgets, the transaction summary and Reports share one FX resolution", () => {
  beforeAll(async () => {
    await start();
    // The preview covers the three closed months before the current UTC month.
    const clock = await db.execute<{ date: string }>(sql`select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD') as date`);
    const now = new Date(`${clock.rows[0].date}T12:00:00Z`);
    month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    [year, monthNumber] = month.split("-").map(Number);
    firstDay = `${month}-01`; rateDate = `${month}-02`; flowDate = `${month}-15`;
    lastDay = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  }, 20_000);
  beforeEach(async () => {
    await resetAccountsAndMembership(); await clean();
    await db.update(households).set({ currency: "ZMW" }).where(inArray(households.id, [a, b]));
    await db.insert(accounts).values({ id: account, householdId: a, name: "FIN-06 foreign account", type: "checking",
      currency: RATED, isPrivate: false, ownerUserId: actors.get("owner")!.id, initialBalance: "1000.00", balance: "1000.00" });
    await db.insert(categoryGroups).values({ id: group, householdId: a, name: "FIN-06 expenses", type: "expenses", budgetMode: "by_category", displayOrder: 0 });
    await db.insert(categories).values({ id: category, householdId: a, groupId: group, name: "FIN-06 spending", includeInBudget: true, displayOrder: 0 });
    await db.insert(budgets).values({ id: budget, householdId: a, name: "FIN-06 limit", categoryId: category, amount: "1000", currency: "ZMW",
      createdAt: new Date("2025-01-01T00:00:00Z"), updatedAt: new Date("2025-01-01T00:00:00Z") });
  });
  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  it("converts at the latest earlier shared rate in every reader, as Reports does", async () => {
    await noOtherRates(RATED);
    await sharedRate(RATED, rateDate, "2.5000");
    await expense("15.00");
    await expectEverywhere("37.50");
  });

  it("prefers the household's own manual rate to the shared rate in every reader", async () => {
    await noOtherRates(RATED);
    await sharedRate(RATED, rateDate, "2.5000");
    await householdRate(a, RATED, "4");
    await expense("15.00");
    await expectEverywhere("60.00");
  });

  it.each(["no rate at all", "only a shared rate dated after the flow", "only another household's manual rate"] as const)(
    "fails closed with %s instead of converting at 1", async scenario => {
      await noOtherRates(UNRATED);
      if (scenario === "only a shared rate dated after the flow") await sharedRate(UNRATED, lastDay, "3.0000");
      if (scenario === "only another household's manual rate") await householdRate(b, UNRATED, "3");
      await expense("15.00", UNRATED);
      await expectUnavailableEverywhere();
    });

  it.each(["0.0000", "-2.5000", "NaN"])(
    "returns the missing-rate error for the latest legacy rate %s even with an older positive quote",
    async rate => {
      await noOtherRates(UNRATED);
      await expense("15.00", UNRATED);
      await expectUnavailableEverywhere();

      await sharedRate(UNRATED, rateDate, "2.5000");
      await legacySharedRate(rate);
      await expectUnavailableEverywhere();
    },
  );

  it.each(["0.0000", "-2.5000", "NaN"])("rejects a new shared rate of %s", async rate => {
    const outcome = await sharedRate(UNRATED, rateDate, rate).then(
      () => undefined,
      (error: unknown) => getPostgresError(error),
    );
    expect(outcome).toMatchObject({ code: "23514", constraint: positiveRateConstraint });
  });

  it("re-reads the summary on every request: a new posting and a new rate show at once (FIN-17, no cache)", async () => {
    await noOtherRates(RATED);
    await sharedRate(RATED, rateDate, "2.5000");
    await expense("15.00");
    expect((await summary().expect(200)).body.data).toMatchObject({ transactionCount: 1, totalExpenses: zmw("37.50") });
    const posted = await request(app).post("/api/transactions").set("Cookie", actors.get("owner")!.cookie)
      .set("X-Capital-Subject", actors.get("owner")!.id).set("X-Capital-Household", a)
      .send({ accountId: account, categoryId: category, date: flowDate, type: "expense", name: "FIN-17 second posting",
        amount: { amount: "10.00", currency: RATED }, idempotencyKey: randomUUID() });
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);
    expect((await summary().expect(200)).body.data).toMatchObject({ transactionCount: 2, totalExpenses: zmw("62.50") });
    await householdRate(a, RATED, "4");
    expect((await summary().expect(200)).body.data).toMatchObject({ transactionCount: 2, totalExpenses: zmw("100.00") });
  });
});
