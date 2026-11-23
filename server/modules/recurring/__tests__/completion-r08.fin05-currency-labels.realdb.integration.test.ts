/**
 * FIN-05: every imported or recurring-created row stores its account's currency,
 * DTOs carry the row's real currency (never a default ZMW), and the recurring
 * summary is labelled in the household base currency and counts only rules
 * proven in it. Synthetic data only; run through the protected disposable runner.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import {
  accounts, auditLogs, householdMembers, households, merchants, outboxEvents,
  recurringTransactionLinks, recurringTransactions, transactions, users,
} from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";

const householdId = randomUUID();
const userId = randomUUID();
const zmwAccountId = randomUUID();
const usdAccountId = randomUUID();
const due = "2026-01-05";
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;

const signed = (req: request.Test) => req.set("Cookie", cookie)
  .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId);

async function rowsFor(accountId: string) {
  const result = await pool.query<{ id: string; currency: string | null; source: string | null }>(
    "SELECT id, currency, source FROM transactions WHERE account_id = $1 AND household_id = $2 AND deleted_at IS NULL ORDER BY id",
    [accountId, householdId],
  );
  return result.rows;
}

/** A rule whose stored denomination is unproven (no receipt), e.g. after an unconfirmed edit. */
async function unprovenRule(accountId: string, amount: string) {
  const [rule] = await db.insert(recurringTransactions).values({ householdId, accountId, name: "Unproven unit",
    amount, type: "expense", frequency: "monthly", startDate: due, nextDueDate: "2099-01-01", detectionMethod: "manual" }).returning();
  return rule;
}

async function clearLedger() {
  await db.delete(recurringTransactions).where(eq(recurringTransactions.householdId, householdId));
  await db.delete(transactions).where(eq(transactions.householdId, householdId));
  await db.update(households).set({ currency: "ZMW" }).where(eq(households.id, householdId));
}

describe("FIN-05 currency of imported and recurring rows and their DTOs", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const email = `fin05-currency-${userId}@example.invalid`;
    const password = "SyntheticFin05Currency123!";
    await db.insert(households).values({ id: householdId, name: "Synthetic FIN-05", currency: "ZMW" });
    await db.insert(users).values({ id: userId, email, username: `fin05-${userId}`,
      passwordHash: await hashPassword(password), emailVerified: true });
    await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
    await db.insert(accounts).values([
      { id: zmwAccountId, householdId, ownerUserId: userId, name: "Synthetic ZMW checking", type: "checking",
        isAsset: true, isPrivate: false, currency: "ZMW", balance: "1000.00", initialBalance: "1000.00" },
      { id: usdAccountId, householdId, ownerUserId: userId, name: "Synthetic USD checking", type: "checking",
        isAsset: true, isPrivate: false, currency: "USD", balance: "500.00", initialBalance: "500.00" },
    ]);
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30_000);

  beforeEach(clearLedger);

  afterAll(async () => {
    await clearLedger();
    await db.delete(outboxEvents).where(eq(outboxEvents.householdId, householdId));
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(merchants).where(eq(merchants.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [userId]);
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
    await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [userId]);
    await db.delete(users).where(eq(users.id, userId));
  });

  it("imports into a USD account as USD, in the row and in the transaction DTO", async () => {
    const imported = await signed(request(app).post("/api/import/execute")).send({
      targetAccountId: usdAccountId, strategy: "prioritize_coppercoin",
      mapping: { date: "Date", amount: "Amount", merchant: "Merchant", description: "Notes" },
      categoryMapping: {}, dateFormat: "auto",
      rows: [{ Date: "2026-01-10", Amount: "-12.50", Merchant: "Synthetic USD store", Notes: "FIN-05 import" }],
    }).expect(200);
    expect(imported.body).toMatchObject({ imported: 1, errors: [] });
    const rows = await rowsFor(usdAccountId);
    expect(rows).toEqual([{ id: expect.any(String), currency: "USD", source: "csv_import" }]);

    const listed = await signed(request(app).get(`/api/transactions/${rows[0].id}`)).expect(200);
    expect(listed.body.data.amount).toEqual({ amount: "12.50", currency: "USD" });
  });

  it("materialises a proven ZMW rule as ZMW and labels its DTO ZMW", async () => {
    const created = await signed(request(app).post("/api/recurring")).send({ accountId: zmwAccountId, name: "Synthetic rent",
      amount: { amount: "7.25", currency: "ZMW" }, type: "expense", frequency: "monthly", nextDueDate: due }).expect(201);
    expect(created.body.data.amount).toEqual({ amount: "7.25", currency: "ZMW" });
    const processed = await signed(request(app).post("/api/recurring/process")).send({}).expect(200);
    expect(processed.body.data.created).toBeGreaterThanOrEqual(1);
    expect(await rowsFor(zmwAccountId)).toEqual(expect.arrayContaining([{ id: expect.any(String), currency: "ZMW", source: "recurring" }]));
    expect((await rowsFor(zmwAccountId)).every(row => row.currency === "ZMW")).toBe(true);
  });

  it("refuses a USD recurring rule rather than storing a row without its currency", async () => {
    await signed(request(app).post("/api/recurring")).send({ accountId: usdAccountId, name: "Synthetic USD bill",
      amount: { amount: "20.00", currency: "USD" }, type: "expense", frequency: "monthly", nextDueDate: due }).expect(400);
    expect(await db.select().from(recurringTransactions).where(eq(recurringTransactions.householdId, householdId))).toEqual([]);
    expect(await rowsFor(usdAccountId)).toEqual([]);
  });

  it("never labels an unproven rule's amount ZMW", async () => {
    const rule = await unprovenRule(usdAccountId, "50.00");
    const listed = await signed(request(app).get("/api/recurring")).expect(200);
    expect(listed.body.data.find((item: { id: string }) => item.id === rule.id).amount).toEqual({ amount: "50.00", currency: null });
    const one = await signed(request(app).get(`/api/recurring/${rule.id}`)).expect(200);
    expect(one.body.data.amount).toEqual({ amount: "50.00", currency: null });
  });

  it("labels linked amounts with the linked transaction's currency and the rule's proven unit", async () => {
    const rule = await unprovenRule(usdAccountId, "50.00");
    const [usdRow] = await db.insert(transactions).values({ householdId, accountId: usdAccountId, date: due, name: "Synthetic USD charge",
      amount: "50.00", currency: "USD", type: "expense", source: "manual", ownerUserId: userId }).returning();
    await db.insert(recurringTransactionLinks).values({ recurringTransactionId: rule.id, transactionId: usdRow.id,
      matchMethod: "manual", matchConfidence: 100, expectedDate: due, actualDate: due, expectedAmount: "50.00", actualAmount: "50.00" });
    const links = await signed(request(app).get(`/api/recurring/${rule.id}/transactions`)).expect(200);
    expect(links.body.data).toHaveLength(1);
    expect(links.body.data[0].actualAmount).toEqual({ amount: "50.00", currency: "USD" });
    expect(links.body.data[0].expectedAmount).toEqual({ amount: "50.00", currency: null });
  });

  it("sums only rules proven in the household base currency and labels the total in it", async () => {
    await signed(request(app).post("/api/recurring")).send({ accountId: zmwAccountId, name: "Synthetic rent",
      amount: { amount: "7.25", currency: "ZMW" }, type: "expense", frequency: "monthly", nextDueDate: "2099-01-01" }).expect(201);
    await unprovenRule(usdAccountId, "50.00");
    const zmw = await signed(request(app).get("/api/recurring/summary")).expect(200);
    expect(zmw.body.data).toMatchObject({
      currency: "ZMW", totalMonthlyExpenses: { amount: "7.25", currency: "ZMW" },
      totalMonthlyIncome: { amount: "0.00", currency: "ZMW" }, activeCount: 2, excludedCount: 1, complete: false,
    });

    await db.update(households).set({ currency: "USD" }).where(eq(households.id, householdId));
    const usd = await signed(request(app).get("/api/recurring/summary")).expect(200);
    expect(usd.body.data).toMatchObject({
      currency: "USD", totalMonthlyExpenses: { amount: "0.00", currency: "USD" }, excludedCount: 2, complete: false,
    });
  });

  it("reports a complete summary when every rule is proven in the base currency", async () => {
    await signed(request(app).post("/api/recurring")).send({ accountId: zmwAccountId, name: "Synthetic rent",
      amount: { amount: "7.25", currency: "ZMW" }, type: "expense", frequency: "monthly", nextDueDate: "2099-01-01" }).expect(201);
    const summary = await signed(request(app).get("/api/recurring/summary")).expect(200);
    expect(summary.body.data).toMatchObject({ currency: "ZMW", excludedCount: 0, complete: true,
      totalMonthlyExpenses: { amount: "7.25", currency: "ZMW" } });
  });
});
