import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  accounts, auditLogs, budgets, categories, categoryGroups, fxRates, holdings, householdMembers,
  households, securities, transactions, users,
} from "@shared/schema";
import { hashPassword } from "../../auth";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../core/calculations";
import { db, pool } from "../../db";
import { getTestApp } from "../../__tests__/fixtures";
import { calculateHoldingsValue } from "../../services/goal/assignment.calculations";

// R12 / NEW-13 + NEW-34: a manual exchange rate belongs to the household that
// recorded it. Only an owner or admin records one; another household can neither
// see it, use it, nor override it; and a missing rate is a 422 naming the pair,
// never a conversion at 1. ISK is used by no other suite, so no shared provider
// row can stand in for the rates these tests withhold.
const FOREIGN = "ISK";
const BASE = "ZMW";
const DATE = "1991-03-15";
const RANGE = { from: "1991-03-01", to: "1991-03-31" };
const DAY_MS = 86_400_000;
const utcDay = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);
// Holdings are valued today (UTC), so their rate needs a window that covers today.
const CURRENT = { date: utcDay(-1), validThrough: utcDay(7) };
const HISTORIC = { date: DATE, validThrough: RANGE.to };
const password = "SyntheticR12FxRates123!";

type ActorName = "aOwner" | "aMember" | "bOwner";
interface Actor { id: string; householdId: string; cookie: string }

const householdA = randomUUID();
const householdB = randomUUID();
const actors = new Map<ActorName, Actor>();
const ids = {
  cashA: randomUUID(), cashB: randomUUID(), brokerA: randomUUID(), brokerB: randomUUID(),
  security: randomUUID(), groupB: randomUUID(), categoryB: randomUUID(), budgetB: randomUUID(),
};
let app: Awaited<ReturnType<typeof getTestApp>>;

function as(name: ActorName, method: "get" | "post", path: string) {
  const actor = actors.get(name)!;
  return request(app)[method](path)
    .set("Cookie", actor.cookie)
    .set("X-Capital-Subject", actor.id)
    .set("X-Capital-Household", actor.householdId);
}

function writeRate(name: ActorName, rate: string, window = HISTORIC) {
  return as(name, "post", "/api/investments/fx-rates")
    .send({ fromCurrency: FOREIGN, toCurrency: BASE, rate, ...window });
}

function cashflow(name: ActorName) {
  return as(name, "get", "/api/reports/cashflow").query(RANGE);
}

async function deleteOverrides() {
  // Guarded so the red run against the pre-R12 schema reaches its assertions.
  const present = await pool.query<{ name: string | null }>(
    "select to_regclass('public.household_fx_rate_overrides')::text as name");
  if (!present.rows[0].name) return;
  await pool.query("delete from household_fx_rate_overrides where household_id = any($1::uuid[])",
    [[householdA, householdB]]);
}

async function seedActor(name: ActorName, householdId: string, role: "owner" | "member", passwordHash: string) {
  const id = randomUUID();
  const email = `r12-fx-${id}@example.invalid`;
  await db.insert(users).values({
    id, email, username: `r12-fx-${id}`, passwordHash, emailVerified: true, timezone: "Africa/Lusaka",
  });
  await db.insert(householdMembers).values({ householdId, userId: id, role });
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  actors.set(name, { id, householdId, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") });
}

async function seedHouseholdMoney(householdId: string, cashId: string, brokerId: string, ownerId: string) {
  await db.insert(accounts).values([
    { id: cashId, householdId, name: "R12 ISK cash", type: "checking", currency: FOREIGN,
      initialBalance: "0.00", balance: "0.00", isPrivate: false, ownerUserId: ownerId },
    { id: brokerId, householdId, name: "R12 brokerage", type: "investment", currency: BASE,
      initialBalance: "0.00", balance: "0.00", isPrivate: false, ownerUserId: ownerId },
  ]);
  await db.insert(transactions).values({
    householdId, accountId: cashId, ownerUserId: ownerId, date: DATE, name: "R12 ISK expense",
    amount: "10.00", currency: FOREIGN, type: "expense", isPrivate: false,
    categoryId: householdId === householdB ? ids.categoryB : null,
  });
  await db.insert(holdings).values({
    householdId, accountId: brokerId, securityId: ids.security, quantity: "5", costBasis: "0",
  });
}

async function seedBudgetB() {
  await db.insert(categoryGroups).values({
    id: ids.groupB, householdId: householdB, name: "R12 group", type: "expenses",
    budgetMode: "by_category", isArchived: false, displayOrder: 0,
  });
  await db.insert(categories).values({
    id: ids.categoryB, householdId: householdB, groupId: ids.groupB, name: "R12 category",
    includeInBudget: true, isArchived: false, displayOrder: 0,
  });
  await db.insert(budgets).values({
    id: ids.budgetB, householdId: householdB, name: "R12 budget", categoryId: ids.categoryB,
    amount: "1000", period: "monthly",
  });
}

async function resetMoney() {
  await deleteOverrides();
  await db.delete(transactions).where(inArray(transactions.householdId, [householdA, householdB]));
  await db.delete(holdings).where(inArray(holdings.householdId, [householdA, householdB]));
  await db.delete(budgets).where(eq(budgets.householdId, householdB));
  await db.delete(categories).where(eq(categories.householdId, householdB));
  await db.delete(categoryGroups).where(eq(categoryGroups.householdId, householdB));
  await db.delete(accounts).where(inArray(accounts.householdId, [householdA, householdB]));
  await db.delete(fxRates).where(eq(fxRates.fromCurrency, FOREIGN));
  await seedBudgetB();
  await seedHouseholdMoney(householdA, ids.cashA, ids.brokerA, actors.get("aOwner")!.id);
  await seedHouseholdMoney(householdB, ids.cashB, ids.brokerB, actors.get("bOwner")!.id);
}

async function globalForeignRows() {
  return db.select().from(fxRates).where(eq(fxRates.fromCurrency, FOREIGN));
}

describe("R12 household-scoped manual exchange rates", () => {
  beforeAll(async () => {
    app = await getTestApp();
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates)));
    await db.insert(households).values([
      { id: householdA, name: "Synthetic R12 A", currency: BASE },
      { id: householdB, name: "Synthetic R12 B", currency: BASE },
    ]);
    await db.insert(securities).values({
      id: ids.security, symbol: `R12${ids.security.slice(0, 8)}`, name: "R12 ISK instrument",
      type: "stock", currency: FOREIGN, currentPrice: "2.00",
    });
    const passwordHash = await hashPassword(password);
    await seedActor("aOwner", householdA, "owner", passwordHash);
    await seedActor("aMember", householdA, "member", passwordHash);
    await seedActor("bOwner", householdB, "owner", passwordHash);
  }, 30_000);

  beforeEach(resetMoney);

  afterAll(async () => {
    await deleteOverrides();
    await db.delete(transactions).where(inArray(transactions.householdId, [householdA, householdB]));
    await db.delete(holdings).where(inArray(holdings.householdId, [householdA, householdB]));
    await db.delete(auditLogs).where(inArray(auditLogs.userId, [...actors.values()].map(actor => actor.id)));
    await db.delete(households).where(inArray(households.id, [householdA, householdB]));
    await db.delete(securities).where(eq(securities.id, ids.security));
    await db.delete(fxRates).where(eq(fxRates.fromCurrency, FOREIGN));
    for (const actor of actors.values()) {
      await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [actor.id]);
      await db.delete(users).where(eq(users.id, actor.id));
    }
  });

  it("refuses a member's rate with 403 and records an owner's rate for that household only", async () => {
    await writeRate("aMember", "20").expect(403);
    expect(await globalForeignRows()).toEqual([]);

    const created = await writeRate("aOwner", "20").expect(201);
    expect(created.body.data).toMatchObject({
      householdId: householdA, fromCurrency: FOREIGN, toCurrency: BASE,
      effectiveDate: DATE, validThrough: RANGE.to, source: "manual",
    });
    // The manual rate never becomes a shared row every household reads.
    expect(await globalForeignRows()).toEqual([]);
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.userId, actors.get("aOwner")!.id));
    expect(audit.some(row => row.entityType === "fx_rate" && row.householdId === householdA)).toBe(true);
  });

  it("keeps household A's manual rate out of household B's list, report and valuation", async () => {
    await writeRate("aOwner", "20").expect(201);
    await writeRate("aOwner", "20", CURRENT).expect(201);

    const listA = await as("aOwner", "get", "/api/investments/fx-rates").query({ from: FOREIGN, to: BASE }).expect(200);
    expect(JSON.stringify(listA.body.data)).toContain("\"20");
    const listB = await as("bOwner", "get", "/api/investments/fx-rates").query({ from: FOREIGN, to: BASE }).expect(200);
    expect(listB.body.data).toEqual([]);

    const reportA = await cashflow("aOwner").expect(200);
    expect(reportA.body.data.totals.expenses).toEqual({ amount: "200.00", currency: BASE });
    const reportB = await cashflow("bOwner").expect(422);
    expect(reportB.body.error).toMatchObject({ code: "MISSING_FX_RATE" });
    expect(JSON.stringify(reportB.body.error)).toContain(FOREIGN);

    expect((await calculateHoldingsValue([ids.brokerA], BASE, householdA, db)).amount.toFixed(2)).toBe("200.00");
    await expect(calculateHoldingsValue([ids.brokerB], BASE, householdB, db))
      .rejects.toMatchObject({ code: "MISSING_FX_RATE" });
  });

  it("lets household B record its own rate without changing household A's totals", async () => {
    await writeRate("aOwner", "20").expect(201);
    await writeRate("bOwner", "30").expect(201);
    await writeRate("aOwner", "20", CURRENT).expect(201);
    await writeRate("bOwner", "30", CURRENT).expect(201);

    const reportA = await cashflow("aOwner").expect(200);
    expect(reportA.body.data.totals.expenses).toEqual({ amount: "200.00", currency: BASE });
    const reportB = await cashflow("bOwner").expect(200);
    expect(reportB.body.data.totals.expenses).toEqual({ amount: "300.00", currency: BASE });

    const holdingsA = await as("aOwner", "get", "/api/investments/holdings").query({ currency: BASE }).expect(200);
    const holdingsB = await as("bOwner", "get", "/api/investments/holdings").query({ currency: BASE }).expect(200);
    const ratesUsed = (body: { data: { fxRateUsed: number }[] }) => body.data.map(row => row.fxRateUsed);
    expect(ratesUsed(holdingsA.body)).toEqual([20]);
    expect(ratesUsed(holdingsB.body)).toEqual([30]);
  });

  it("answers a missing rate with a 422 on the report, summary, budget and holdings paths, never a rate of 1", async () => {
    const report = await cashflow("bOwner").expect(422);
    expect(report.body.error.code).toBe("MISSING_FX_RATE");
    expect(report.body.error.details).toMatchObject({ from: FOREIGN, to: BASE });

    const summary = await as("bOwner", "get", "/api/transactions/summary")
      .query({ startDate: RANGE.from, endDate: RANGE.to }).expect(422);
    expect(summary.body.error.message).toContain(FOREIGN);

    // The budget limit exists only from its creation month, so the budget proof
    // uses a current-month expense; only the missing ISK rate can refuse it.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lusaka" }).format(new Date());
    await db.insert(transactions).values({
      householdId: householdB, accountId: ids.cashB, ownerUserId: actors.get("bOwner")!.id, date: today,
      name: "R12 ISK budget expense", amount: "10.00", currency: FOREIGN, type: "expense",
      isPrivate: false, categoryId: ids.categoryB,
    });
    const [year, month] = today.split("-");
    const budget = await as("bOwner", "get", "/api/budgets/progress")
      .query({ year, month: String(Number.parseInt(month, 10)) }).expect(422);
    // Budget progress keeps its R10 privacy-safe body: the currency is not disclosed.
    expect(budget.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");

    const holdingsB = await as("bOwner", "get", "/api/investments/holdings").query({ currency: BASE }).expect(422);
    // The holdings read keeps its existing privacy-safe body: no pair is disclosed.
    expect(holdingsB.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");

    await expect(calculateHoldingsValue([ids.brokerB], BASE, householdB, db))
      .rejects.toMatchObject({ code: "MISSING_FX_RATE" });
  });
});
