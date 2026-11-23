// NEW-05 / FIN-14: liabilities count as signed debt (an overpaid card raises net
// worth), and the net-worth report fallback values every class the account
// summary values or says it is incomplete. Real HTTP, real PostgreSQL.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { accounts, fxRates, holdings, securities, transactions, users } from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../../core/calculations";
import { analyticsCache } from "../../../services/AnalyticsCache";

const userId = randomUUID(), householdId = randomUUID();
const checkingId = randomUUID(), owedCardId = randomUUID(), overpaidCardId = randomUUID(), brokerageId = randomUUID();
const securityId = randomUUID(), holdingId = randomUUID();
const tag = randomUUID().replaceAll("-", "").slice(0, 12);
const email = `r12nw-${tag}@example.invalid`, password = "SyntheticR12NetWorth123!";
const today = new Date().toISOString().slice(0, 10);
const zmw = (amount: string) => ({ amount, currency: "ZMW" });
const overpaidOpeningBalance = "-50.00";
let app: Awaited<ReturnType<typeof getTestApp>>;
let headers: Record<string, string>;

async function report() {
  await analyticsCache.invalidateHousehold(householdId);
  const response = await request(app).get("/api/reports/net-worth").set(headers).query({ from: "2026-01-01", to: today }).expect(200);
  return response.body.data;
}
const summary = () => request(app).get("/api/accounts/summary").set(headers);

describe("R12 net worth: signed liabilities and a complete-or-flagged fallback", () => {
  beforeAll(async () => {
    app = await getTestApp();
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates), { cacheTtlSeconds: 300, baseCurrency: "ZMW", fallbackDays: 30 }));
    await db.insert(users).values({ id: userId, email, username: `r12nw-${tag}`, passwordHash: await hashPassword(password), emailVerified: true });
    await pool.query("INSERT INTO households (id, name, currency) VALUES ($1, 'Synthetic R12 net worth', 'ZMW')", [householdId]);
    await pool.query("INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'owner')", [householdId, userId]);
    await db.insert(accounts).values([
      { id: checkingId, householdId, ownerUserId: userId, name: "R12 checking", type: "checking", currency: "ZMW", isAsset: true, initialBalance: "1000.00", balance: "1000.00" },
      { id: owedCardId, householdId, ownerUserId: userId, name: "R12 owed card", type: "credit", currency: "ZMW", isAsset: false, initialBalance: "300.00", balance: "300.00" },
      { id: overpaidCardId, householdId, ownerUserId: userId, name: "R12 overpaid card", type: "credit", currency: "ZMW",
        isAsset: false, initialBalance: overpaidOpeningBalance, balance: overpaidOpeningBalance },
    ]);
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    headers = { Cookie: (login.headers["set-cookie"] as unknown as string[]).join("; "), "X-Capital-Subject": userId, "X-Capital-Household": householdId };
  }, 30000);

  beforeEach(async () => {
    await db.transaction(async tx => {
      await tx.delete(holdings).where(eq(holdings.id, holdingId));
      await tx.delete(securities).where(eq(securities.id, securityId));
      await tx.delete(accounts).where(eq(accounts.id, brokerageId));
      // A sibling's signed purchase changes both the postings and the stored card balance.
      await tx.delete(transactions).where(and(eq(transactions.householdId, householdId), eq(transactions.accountId, overpaidCardId)));
      await tx.update(accounts).set({ balance: overpaidOpeningBalance })
        .where(and(eq(accounts.householdId, householdId), eq(accounts.id, overpaidCardId)));
    });
  });

  afterAll(async () => {
    await db.delete(holdings).where(eq(holdings.id, holdingId));
    await db.delete(securities).where(eq(securities.id, securityId));
    for (const table of ["transactions", "audit_logs", "outbox_events", "accounts", "household_members"]) {
      await pool.query(`DELETE FROM ${table} WHERE household_id = $1`, [householdId]);
    }
    await pool.query("DELETE FROM households WHERE id = $1", [householdId]);
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1', [userId]);
    await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [userId]);
    await db.delete(users).where(eq(users.id, userId));
  });

  it("counts an owed card as debt and an overpaid card as money in the holder's favour", async () => {
    // 1000 checking - 300 owed + 50 overpaid = 750 (abs() would give 650).
    const data = await report();
    expect(data.latest).toMatchObject({ assets: zmw("1000.00"), liabilities: zmw("250.00"), netWorth: zmw("750.00") });
    expect(data.incomplete).toBe(false);
    const current = await summary().expect(200);
    expect(current.body.data).toMatchObject({ totalAssets: 1000, totalLiabilities: 250, netWorth: 750 });
  });

  it("still answers the owner's annual report, which reads net worth", async () => {
    await analyticsCache.invalidateHousehold(householdId);
    const response = await request(app).get("/api/reports/annual").set(headers).query({ year: today.slice(0, 4) });
    expect(response.status).toBe(200);
    expect(response.body.data.monthly).toHaveLength(12);
  });

  it("lowers net worth when a purchase is made on the overpaid card", async () => {
    const before = await report();
    await request(app).post("/api/transactions").set(headers).send({ accountId: overpaidCardId, type: "expense", date: today,
      name: "R12 overpaid card purchase", amount: zmw("20.00"), idempotencyKey: randomUUID() }).expect(201);
    const [card] = await db.select({ balance: accounts.balance }).from(accounts).where(eq(accounts.id, overpaidCardId));
    expect(card.balance).toBe("-30.00");
    const after = await report();
    expect(before.latest.netWorth).toEqual(zmw("750.00"));
    expect(after.latest.netWorth).toEqual(zmw("730.00"));
    expect((await summary().expect(200)).body.data.netWorth).toBe(730);
  });

  it("includes a valued holding in the fallback, as the account summary does", async () => {
    await db.insert(accounts).values({ id: brokerageId, householdId, ownerUserId: userId, name: "R12 brokerage", type: "investment", currency: "ZMW", isAsset: true, initialBalance: "0.00", balance: "0.00" });
    await db.insert(securities).values({ id: securityId, symbol: `R12${tag}`.slice(0, 20), name: "R12 valued security", type: "stock", currency: "ZMW", currentPrice: "2.0000" });
    await db.insert(holdings).values({ id: holdingId, householdId, accountId: brokerageId, securityId, quantity: "10", costBasis: "0" });
    const data = await report();
    // 1000 checking + 20 holdings - (300 owed - 50 overpaid) = 770.
    expect(data.latest).toMatchObject({ assets: zmw("1020.00"), liabilities: zmw("250.00"), netWorth: zmw("770.00") });
    expect(data.incomplete).toBe(false);
    expect((await summary().expect(200)).body.data).toMatchObject({ totalAssets: 1020, totalLiabilities: 250, netWorth: 770 });
  });

  it("flags the fallback incomplete, naming holdings, when a holding cannot be valued", async () => {
    await db.insert(accounts).values({ id: brokerageId, householdId, ownerUserId: userId, name: "R12 brokerage", type: "investment", currency: "ZMW", isAsset: true, initialBalance: "0.00", balance: "0.00" });
    await db.insert(securities).values({ id: securityId, symbol: `R12${tag}`.slice(0, 20), name: "R12 unpriced security", type: "stock", currency: "ZMW", currentPrice: null });
    await db.insert(holdings).values({ id: holdingId, householdId, accountId: brokerageId, securityId, quantity: "10", costBasis: "0" });
    const data = await report();
    expect(data.incomplete).toBe(true);
    expect(data.omittedValuations).toEqual(["holdings"]);
    expect(data.latest).toMatchObject({ assets: zmw("1000.00"), liabilities: zmw("250.00"), netWorth: zmw("750.00") });
  });
});
