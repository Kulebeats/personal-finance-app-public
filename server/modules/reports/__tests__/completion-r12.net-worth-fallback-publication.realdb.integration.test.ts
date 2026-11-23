// FIN-14 follow-up (Astra on #195): the net-worth report fallback publishes only
// what the reader may still see, a missing required rate is always the 422, and
// omission flags count only sources net worth includes. Real HTTP, real PostgreSQL.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import { accounts, fxRates, holdings, securities, users } from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../../core/calculations";
import { analyticsCache } from "../../../services/AnalyticsCache";
import { logger } from "../../../utils/logger";

const householdId = randomUUID(), aliceId = randomUUID(), bobId = randomUUID();
const checkingId = randomUUID(), bobAccountId = randomUUID();
const tag = randomUUID().replaceAll("-", "").slice(0, 10), password = "SyntheticR12Fallback123!";
const today = new Date().toISOString().slice(0, 10);
// No provider quote exists for this code, so it is a missing rate on every run.
const UNQUOTED = "QPX";
const zmw = (amount: string) => ({ amount, currency: "ZMW" });
let app: Awaited<ReturnType<typeof getTestApp>>;
let headers: Record<string, string>;
const extraAccounts: string[] = [], extraSecurities: string[] = [];

type AccountExtra = Partial<typeof accounts.$inferInsert>;

async function report() {
  await analyticsCache.invalidateHousehold(householdId);
  return request(app).get("/api/reports/net-worth").set(headers).query({ from: `${today.slice(0, 4)}-01-01`, to: today });
}
async function reportData() {
  const response = await report();
  expect(response.status, JSON.stringify(response.body.error)).toBe(200);
  return response.body.data;
}

async function brokerage(ownerUserId: string, extra: AccountExtra = {}) {
  const id = randomUUID();
  extraAccounts.push(id);
  await db.insert(accounts).values({ id, householdId, ownerUserId, name: `R12F brokerage ${id.slice(0, 6)}`, type: "investment",
    currency: "ZMW", isAsset: true, initialBalance: "0.00", balance: "0.00", ...extra });
  return id;
}

/** A holding of 10 units; `price` null means the security cannot be valued. */
async function holding(accountId: string, price: string | null, currency = "ZMW") {
  const securityId = randomUUID();
  extraSecurities.push(securityId);
  await db.insert(securities).values({ id: securityId, symbol: `R12F${securityId.slice(0, 8)}`, name: "R12F security", type: "stock", currency, currentPrice: price });
  await db.insert(holdings).values({ householdId, accountId, securityId, quantity: "10", costBasis: "0" });
}

/**
 * Run `change` on another connection once the fallback's read transaction has
 * taken its snapshot (the positions read comes after the audience and account
 * reads), so the read cannot see the change but publication can.
 */
function midRead(change: () => Promise<unknown>) {
  const actual = Client.prototype.query, gate = vi.fn(change);
  let fired = false;
  const intercepted = function(this: Client, ...args: unknown[]) {
    const command = args[0];
    const text = typeof command === "string" ? command : command && typeof command === "object" && "text" in command ? String(command.text) : "";
    if (!fired && /^\s*select\b/i.test(text) && text.includes('from "holdings" inner join "securities"')) {
      fired = true;
      return gate().then(() => Reflect.apply(actual, this, args));
    }
    return Reflect.apply(actual, this, args);
  };
  vi.spyOn(Client.prototype, "query").mockImplementation(intercepted as typeof Client.prototype.query);
  return gate;
}
const bobGoesPrivate = () => db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, bobAccountId));

describe("R12 net-worth fallback: publication recheck, required rates, eligible omissions", () => {
  beforeAll(async () => {
    app = await getTestApp();
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates), { cacheTtlSeconds: 300, baseCurrency: "ZMW", fallbackDays: 30 }));
    const passwordHash = await hashPassword(password);
    await db.insert(users).values([
      { id: aliceId, email: `r12fa-${tag}@example.invalid`, username: `r12fa-${tag}`, passwordHash, emailVerified: true },
      { id: bobId, email: `r12fb-${tag}@example.invalid`, username: `r12fb-${tag}`, passwordHash, emailVerified: true },
    ]);
    await pool.query("INSERT INTO households (id, name, currency) VALUES ($1, 'Synthetic R12 fallback', 'ZMW')", [householdId]);
    await pool.query("INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')", [householdId, aliceId, bobId]);
    await db.insert(accounts).values([
      { id: checkingId, householdId, ownerUserId: aliceId, name: "R12F alice checking", type: "checking", currency: "ZMW", isAsset: true, initialBalance: "1000.00", balance: "1000.00" },
      { id: bobAccountId, householdId, ownerUserId: bobId, name: "R12F bob savings", type: "savings", currency: "ZMW", isAsset: true, initialBalance: "500.00", balance: "500.00" },
    ]);
    const login = await request(app).post("/api/auth/login").send({ email: `r12fa-${tag}@example.invalid`, password }).expect(200);
    headers = { Cookie: (login.headers["set-cookie"] as unknown as string[]).join("; "), "X-Capital-Subject": aliceId, "X-Capital-Household": householdId };
  }, 30000);

  afterEach(async () => {
    vi.restoreAllMocks();
    await pool.query("DELETE FROM holdings WHERE household_id = $1", [householdId]);
    if (extraSecurities.length) await db.delete(securities).where(inArray(securities.id, extraSecurities.splice(0)));
    if (extraAccounts.length) await db.delete(accounts).where(inArray(accounts.id, extraAccounts.splice(0)));
    await db.update(accounts).set({ isPrivate: false, currency: "ZMW", balance: "500.00" }).where(eq(accounts.id, bobAccountId));
  });

  afterAll(async () => {
    for (const table of ["holdings", "transactions", "audit_logs", "outbox_events", "accounts", "household_members"]) {
      await pool.query(`DELETE FROM ${table} WHERE household_id = $1`, [householdId]);
    }
    await pool.query("DELETE FROM households WHERE id = $1", [householdId]);
    for (const id of [aliceId, bobId]) {
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1', [id]);
      await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1 OR target_user_id = $1", [id]);
    }
    await db.delete(users).where(inArray(users.id, [aliceId, bobId]));
  });

  it("does not publish a balance whose account became private during the read", async () => {
    const gate = midRead(bobGoesPrivate);
    const data = await reportData();
    expect(gate).toHaveBeenCalledOnce();
    expect(data.latest.netWorth).toEqual(zmw("1000.00"));
    expect(data.incomplete).toBe(false);
  });

  it("does not publish an omission flag from an account that became private during the read", async () => {
    const bobBrokerage = await brokerage(bobId);
    await holding(bobBrokerage, null);
    const gate = midRead(() => db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, bobBrokerage)));
    const data = await reportData();
    expect(gate).toHaveBeenCalledOnce();
    expect(data).toMatchObject({ incomplete: false, omittedValuations: [] });
    // 1000 checking + 500 Bob's still-shared savings.
    expect(data.latest.netWorth).toEqual(zmw("1500.00"));
  });

  it("does not publish a valuation failure caused by an account that became private during the read", async () => {
    await db.update(accounts).set({ currency: UNQUOTED, balance: "100.00" }).where(eq(accounts.id, bobAccountId));
    const gate = midRead(bobGoesPrivate);
    const data = await reportData();
    expect(gate).toHaveBeenCalledOnce();
    expect(data.latest.netWorth).toEqual(zmw("1000.00"));
  });

  it("logs why the fallback is incomplete: the cause's code and error name", async () => {
    await holding(await brokerage(aliceId), null);
    const logged = vi.spyOn(logger, "error");
    const data = await reportData();
    expect(data).toMatchObject({ incomplete: true, omittedValuations: ["holdings"] });
    expect(logged).toHaveBeenCalledWith("Net worth valuation unavailable; returning account balances flagged incomplete", expect.objectContaining({
      householdId, omittedValuations: ["holdings"], code: "FINANCIAL_DATA_UNAVAILABLE", errorName: "AccountFinancialDataUnavailable" }));
  });

  it("answers the 422 for a missing required rate even when a holding is also unpriced", async () => {
    const account = await brokerage(aliceId);
    await holding(account, null);
    await holding(account, "2.0000", UNQUOTED);
    const response = await report();
    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({ code: "MISSING_FX_RATE", details: { from: UNQUOTED, to: "ZMW" } });
  });

  it.each([["excluded from net worth", { excludeFromNetWorth: true }], ["archived", { isArchived: true }]] as const)(
    "an unpriced holding in an account %s leaves net worth complete", async (_label, extra) => {
      await holding(await brokerage(aliceId), "2.0000");
      await holding(await brokerage(aliceId, extra), null);
      const data = await reportData();
      expect(data).toMatchObject({ incomplete: false, omittedValuations: [] });
      // 1000 checking + 500 Bob's shared savings + 10 x 2 valued holding.
      expect(data.latest.netWorth).toEqual(zmw("1520.00"));
      // The account summary is unchanged: it still values every visible
      // holding, so the same unpriced holding leaves it unavailable.
      const summary = await request(app).get("/api/accounts/summary").set(headers);
      expect(summary.status).toBe(422);
      expect(summary.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
    });

  it("does not count a valued holding held in an account excluded from net worth", async () => {
    await holding(await brokerage(aliceId, { excludeFromNetWorth: true }), "2.0000");
    const data = await reportData();
    expect(data).toMatchObject({ incomplete: false, omittedValuations: [] });
    expect(data.latest.netWorth).toEqual(zmw("1500.00"));
  });
});
