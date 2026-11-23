// NEW-06 (spec R12.2): a purchase on a credit card is an expense in its
// category; a repayment (bank -> card transfer) is neither income nor expense,
// is reported once as debt paid, and never counts the purchase twice. Real HTTP + PG.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { accounts, categories, categoryGroups, fxRates, users } from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../../core/calculations";
import { analyticsCache } from "../../../services/AnalyticsCache";

const userId = randomUUID(), householdId = randomUUID();
const checkingId = randomUUID(), cardId = randomUUID(), groupId = randomUUID(), groceriesId = randomUUID();
const tag = randomUUID().replaceAll("-", "").slice(0, 12);
const email = `r12cs-${tag}@example.invalid`, password = "SyntheticR12CardSpend123!";
const today = new Date().toISOString().slice(0, 10);
const year = today.slice(0, 4);
const range = { from: `${year}-01-01`, to: today };
const zmw = (amount: string) => ({ amount, currency: "ZMW" });
let app: Awaited<ReturnType<typeof getTestApp>>;
let headers: Record<string, string>;

async function get(path: string, query: Record<string, string> = range) {
  await analyticsCache.invalidateHousehold(householdId);
  return (await request(app).get(path).set(headers).query(query).expect(200)).body.data;
}

async function post(path: string, body: Record<string, unknown>) {
  return request(app).post(path).set(headers).send({ ...body, idempotencyKey: randomUUID() }).expect(201);
}

describe("R12 card spend: purchases are expenses, repayments are neither", () => {
  beforeAll(async () => {
    app = await getTestApp();
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates), { cacheTtlSeconds: 300, baseCurrency: "ZMW", fallbackDays: 30 }));
    await db.insert(users).values({ id: userId, email, username: `r12cs-${tag}`, passwordHash: await hashPassword(password), emailVerified: true });
    await pool.query("INSERT INTO households (id, name, currency) VALUES ($1, 'Synthetic R12 card spend', 'ZMW')", [householdId]);
    await pool.query("INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'owner')", [householdId, userId]);
    await db.insert(accounts).values([
      { id: checkingId, householdId, ownerUserId: userId, name: "R12 cs checking", type: "checking", currency: "ZMW", isAsset: true, initialBalance: "1000.00", balance: "1000.00" },
      { id: cardId, householdId, ownerUserId: userId, name: "R12 cs card", type: "credit", currency: "ZMW", isAsset: false, initialBalance: "0.00", balance: "0.00" },
    ]);
    await db.insert(categoryGroups).values({ id: groupId, householdId, name: "R12 cs living", type: "expenses", budgetMode: "by_category", displayOrder: 0 });
    await db.insert(categories).values({ id: groceriesId, householdId, groupId, name: "R12 cs groceries", includeInBudget: true, displayOrder: 0 });
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    headers = { Cookie: (login.headers["set-cookie"] as unknown as string[]).join("; "), "X-Capital-Subject": userId, "X-Capital-Household": householdId };
    await request(app).post("/api/settings/security/step-up").set(headers).send({ password }).expect(200);

    await post("/api/transactions", { accountId: checkingId, name: "R12 cs salary", type: "income", date: today, amount: zmw("2000.00") });
    await post("/api/transactions", { accountId: cardId, name: "R12 cs groceries", type: "expense", date: today, amount: zmw("300.00"), categoryId: groceriesId });
    await post("/api/transactions/transfer", { fromAccountId: checkingId, toAccountId: cardId, date: today, name: "R12 cs card repayment", amount: zmw("200.00") });
    const card = await pool.query("SELECT balance FROM accounts WHERE id = $1", [cardId]);
    expect(card.rows[0].balance, "purchase 300 owed, repayment 200 paid").toBe("100.00");
  }, 30000);

  afterAll(async () => {
    await pool.query("DELETE FROM transactions WHERE household_id = $1", [householdId]);
    for (const table of ["categories", "category_groups", "accounts", "audit_logs", "outbox_events", "household_members"]) {
      await pool.query(`DELETE FROM ${table} WHERE household_id = $1`, [householdId]);
    }
    await pool.query("DELETE FROM households WHERE id = $1", [householdId]);
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1', [userId]);
    await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1 OR target_user_id = $1", [userId]);
    await pool.query("DELETE FROM outbox_events WHERE payload->>'userId' = $1", [userId]);
    await db.delete(users).where(eq(users.id, userId));
  });

  it.each(["false", "true"])("cash flow counts the purchase once and the repayment as debt paid only (includeTransfers=%s)", async (includeTransfers) => {
    const cashflow = await get("/api/reports/cashflow", { ...range, interval: "month", includeTransfers });
    // Net flow = income - expenses = 2000 - 300; the repayment is in neither.
    expect(cashflow.totals).toEqual({ income: zmw("2000.00"), expenses: zmw("300.00"), savings: zmw("1700.00"), debt: zmw("200.00"), savingsRate: 85 });
    const month = cashflow.series.find((point: { periodStart: string }) => point.periodStart === `${today.slice(0, 7)}-01`);
    expect(month).toMatchObject({ income: zmw("2000.00"), expenses: zmw("300.00"), savings: zmw("1700.00"), debt: zmw("200.00") });
  });

  it("the card purchase is an expense in its category", async () => {
    const breakdown = await get("/api/reports/spending/breakdown", { ...range, groupBy: "category", type: "expense" });
    expect(breakdown.total).toEqual(zmw("300.00"));
    expect(breakdown.items).toEqual([expect.objectContaining({ entityId: groceriesId, value: zmw("300.00") })]);
  });

  it.each(["false", "true"])("the Sankey counts the purchase once and never the repayment (includeTransfers=%s)", async (includeTransfers) => {
    const sankey = await get("/api/reports/sankey", { ...range, includeTransfers });
    expect(sankey.totals).toMatchObject({ income: zmw("2000.00"), expenses: zmw("300.00") });
  });

  it("savings rate, the annual summary and debt paid use the purchase once", async () => {
    const ratios = await get("/api/reports/ratios");
    expect(ratios.ratios.savingsRate).toEqual({ value: 85, savings: zmw("1700.00"), income: zmw("2000.00") });
    expect(ratios.ratios.netSavingsRate.value).toBe(85);

    const annual = await get("/api/reports/annual", { year });
    expect(annual.totals).toMatchObject({ income: zmw("2000.00"), expenses: zmw("300.00"), netSavings: zmw("1700.00"),
      savingsContributions: zmw("1700.00"), debtPaid: zmw("200.00"), savingsRate: 85, netSavingsRate: 85 });

    const debt = await get("/api/reports/debt");
    const paid = debt.paymentTrend.filter((point: { amount: { amount: string } }) => point.amount.amount !== "0.00");
    expect(paid.map((point: { amount: unknown }) => point.amount)).toEqual([zmw("200.00")]);
  });
});
