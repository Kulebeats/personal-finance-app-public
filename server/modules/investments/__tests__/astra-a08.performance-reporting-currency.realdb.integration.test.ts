// A-08: investment returns in a non-ZMW household. Account snapshots are
// stored in the household currency, so each cash flow must be expressed in
// that currency too, at its dated rate; the stored ZMW amount is not a USD
// amount. A deposit equal to the value change is a zero return. A flow with
// no rate makes the series unavailable (422), never a number.
// Real HTTP against real Postgres over both performance routes; no mocks.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import type { PerformanceDataPoint as PerformancePoint } from "@shared/investment-performance";
import {
  accountBalanceSnapshots, accounts, auditLogs, householdFxRateOverrides, householdMembers, households, investmentTransactions, users,
} from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";

interface Flow { amount: string; currency: string; fxRate?: string; amountZmw?: string }

const password = "SyntheticA08Return123!";
const FIRST_DAY = "2026-10-01";
const SECOND_DAY = "2026-10-02";
const ROUTES = ["/api/investments/performance", "/api/investments/analytics/performance"] as const;
const householdIds: string[] = [];
const userIds: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;

// A USD household whose investment account (in accountCurrency) is valued
// 100 then 110 USD, with one deposit on day two.
async function seedUsdHousehold(accountCurrency: string, flow: Flow) {
  const householdId = randomUUID(), userId = randomUUID(), accountId = randomUUID();
  householdIds.push(householdId);
  userIds.push(userId);
  await db.insert(households).values({ id: householdId, name: "Synthetic A-08 USD household", currency: "USD" });
  const email = `a08-${userId}@example.invalid`;
  await db.insert(users).values({ id: userId, email, username: `a08-${userId}`, passwordHash: await hashPassword(password), emailVerified: true });
  await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
  await db.insert(accounts).values({ id: accountId, householdId, name: "A08 brokerage", type: "investment", currency: accountCurrency,
    initialBalance: "0", balance: "110.00", isPrivate: false, ownerUserId: userId });
  // The worker stores account snapshots in the household currency (USD).
  await db.insert(accountBalanceSnapshots).values([
    { accountId, date: FIRST_DAY, balance: "100.00" }, { accountId, date: SECOND_DAY, balance: "110.00" },
  ]);
  await db.insert(investmentTransactions).values({ householdId, accountId, type: "transfer_in", transactionDate: SECOND_DAY, ...flow });
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return { householdId, userId, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") };
}

async function readSeries(cookie: string, route: (typeof ROUTES)[number]): Promise<PerformancePoint[]> {
  const response = await request(app).get(route).query({ timeframe: "ALL" }).set("Cookie", cookie).expect(200);
  return Array.isArray(response.body) ? response.body : response.body.data;
}

beforeAll(async () => { app = await getTestApp(); }, 30_000);

afterAll(async () => {
  if (householdIds.length) {
    await db.delete(auditLogs).where(inArray(auditLogs.householdId, householdIds));
    await db.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, householdIds));
    const ids = (await db.select({ id: accounts.id }).from(accounts).where(inArray(accounts.householdId, householdIds))).map(row => row.id);
    if (ids.length) await db.delete(accountBalanceSnapshots).where(inArray(accountBalanceSnapshots.accountId, ids));
    await db.delete(accounts).where(inArray(accounts.householdId, householdIds));
    await db.delete(householdFxRateOverrides).where(inArray(householdFxRateOverrides.householdId, householdIds));
    await db.delete(householdMembers).where(inArray(householdMembers.householdId, householdIds));
    await db.delete(households).where(inArray(households.id, householdIds));
  }
  for (const id of userIds) {
    await db.delete(auditLogs).where(eq(auditLogs.userId, id));
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [id]);
    await db.delete(users).where(eq(users.id, id));
  }
});

describe("A-08 investment returns are measured in the household currency", () => {
  it.each(ROUTES)("a USD 10 deposit into a USD account in a USD household is a zero return on %s", async route => {
    // The dated ZMW base stored with the deposit (K200 at 20) is not a USD amount.
    const { cookie } = await seedUsdHousehold("USD", { amount: "10.00", currency: "USD", fxRate: "20.00000000", amountZmw: "200.00" });
    const series = await readSeries(cookie, route);
    expect(series.map(point => [point.date, point.value])).toEqual([
      [FIRST_DAY, { amount: "100.00", currency: "USD" }],
      [SECOND_DAY, { amount: "110.00", currency: "USD" }],
    ]);
    expect(series[1]).toMatchObject({ twrIndex: 100, twrReturnPercent: 0 });
  });

  it.each(ROUTES)("a K200 deposit into a ZMW account in a USD household converts at the dated rate on %s", async route => {
    const { householdId, userId, cookie } = await seedUsdHousehold("ZMW", { amount: "200.00", currency: "ZMW", amountZmw: "200.00" });
    // The household's own ZMW to USD rate for that day: K200 is USD 10.
    await db.insert(householdFxRateOverrides).values({ householdId, actorUserId: userId, fromCurrency: "ZMW", toCurrency: "USD",
      effectiveDate: SECOND_DAY, validThrough: SECOND_DAY, rate: "0.05" });
    const series = await readSeries(cookie, route);
    expect(series[1]).toMatchObject({ twrIndex: 100, twrReturnPercent: 0 });
  });

  it.each(ROUTES)("a deposit with no rate into the household currency makes the series unavailable on %s", async route => {
    const { cookie } = await seedUsdHousehold("BWP", { amount: "10.00", currency: "BWP" });
    const response = await request(app).get(route).query({ timeframe: "ALL" }).set("Cookie", cookie).expect(422);
    expect(response.body.error).toMatchObject({ code: "MISSING_FX_RATE", details: { from: "BWP", to: "USD", date: SECOND_DAY } });
  });
});
