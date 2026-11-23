// NEW-05 follow-ups: an overpaid card (a liability with a credit balance) gives
// the same signed figure on the live report, in the worker-written snapshot and
// in captured history; debt metrics count only what is owed. Real HTTP + PG.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { accounts, fxRates, netWorthSnapshots, users } from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../../core/calculations";
import { analyticsCache } from "../../../services/AnalyticsCache";
import { snapshotWorker } from "../../../jobs/snapshotWorker";

const userId = randomUUID(), householdId = randomUUID();
const checkingId = randomUUID(), owedCardId = randomUUID(), overpaidCardId = randomUUID();
const tag = randomUUID().replaceAll("-", "").slice(0, 12);
const email = `r12wc-${tag}@example.invalid`, password = "SyntheticR12Worth123!";
const today = new Date().toISOString().slice(0, 10);
const range = { from: `${today.slice(0, 4)}-01-01`, to: today };
const zmw = (amount: string) => ({ amount, currency: "ZMW" });
let app: Awaited<ReturnType<typeof getTestApp>>;
let headers: Record<string, string>;

async function get(path: string, query: Record<string, string> = range) {
  await analyticsCache.invalidateHousehold(householdId);
  return (await request(app).get(path).set(headers).query(query).expect(200)).body.data;
}

describe("R12 worth consistency: signed liabilities everywhere", () => {
  beforeAll(async () => {
    app = await getTestApp();
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates), { cacheTtlSeconds: 300, baseCurrency: "ZMW", fallbackDays: 30 }));
    await db.insert(users).values({ id: userId, email, username: `r12wc-${tag}`, passwordHash: await hashPassword(password), emailVerified: true });
    await pool.query("INSERT INTO households (id, name, currency) VALUES ($1, 'Synthetic R12 worth consistency', 'ZMW')", [householdId]);
    await pool.query("INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'owner')", [householdId, userId]);
    await db.insert(accounts).values([
      { id: checkingId, householdId, ownerUserId: userId, name: "R12 checking", type: "checking", currency: "ZMW", isAsset: true, initialBalance: "1000.00", balance: "1000.00" },
      { id: owedCardId, householdId, ownerUserId: userId, name: "R12 owed card", type: "credit", currency: "ZMW", isAsset: false, initialBalance: "300.00", balance: "300.00" },
      { id: overpaidCardId, householdId, ownerUserId: userId, name: "R12 overpaid card", type: "credit", currency: "ZMW", isAsset: false, initialBalance: "-50.00", balance: "-50.00" },
    ]);
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    headers = { Cookie: (login.headers["set-cookie"] as unknown as string[]).join("; "), "X-Capital-Subject": userId, "X-Capital-Household": householdId };
  }, 30000);

  afterAll(async () => {
    for (const table of ["net_worth_snapshots", "audit_logs", "outbox_events", "household_members"]) {
      await pool.query(`DELETE FROM ${table} WHERE household_id = $1`, [householdId]);
    }
    await pool.query("DELETE FROM households WHERE id = $1", [householdId]);
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1', [userId]);
    await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [userId]);
    await db.delete(users).where(eq(users.id, userId));
  });

  it("debt metrics count only owed debt: the overpaid card is not debt", async () => {
    const debt = await get("/api/reports/debt");
    expect(debt.totalDebt).toEqual(zmw("300.00"));
    expect(debt.debtByType).toEqual([{ type: "credit", balance: zmw("300.00"), accounts: 1 }]);
    expect(debt.topDebtAccounts.map((account: { id: string }) => account.id)).toEqual([owedCardId]);
    const ratios = await get("/api/reports/ratios");
    expect(ratios.ratios.liquidityRatio.currentLiabilities).toEqual(zmw("300.00"));
  });

  it("the live report, the worker snapshot and captured history agree on 750.00", async () => {
    // 1000 - 300 owed + 50 credit = 750 (abs() would give 650).
    const live = await get("/api/reports/net-worth");
    expect(live.latest).toMatchObject({ netWorth: zmw("750.00"), liabilities: zmw("250.00") });

    expect(await snapshotWorker.processHousehold(householdId)).toBe(true);
    const [snapshot] = await db.select().from(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, householdId));
    expect(snapshot).toMatchObject({ netWorth: "750.00", totalAssets: "1000.00", totalLiabilities: "250.00" });
    expect(snapshot.liabilitiesByType).toEqual({ credit: "250.00" });

    const fromSnapshot = await get("/api/reports/net-worth");
    expect(fromSnapshot.latest.netWorth).toEqual(zmw("750.00"));

    // The captured-history proof re-derives the stored totals with the same rule.
    const history = await get("/api/accounts/summary/history", { dateRange: "all", scope: "user" });
    expect(history.series).toEqual([expect.objectContaining({ date: snapshot.date, provenance: "captured_snapshot", netWorth: 750 })]);
    // Household scope reads the snapshot row through projectCapturedWorth (the
    // path the weekly recap uses), not the native capture: assets and signed
    // liabilities must both be projected.
    const household = await get("/api/accounts/summary/history", { dateRange: "all", scope: "household" });
    expect(household.series).toEqual([expect.objectContaining({ date: snapshot.date, provenance: "captured_snapshot",
      assets: 1000, liabilities: 250, netWorth: 750 })]);
  });
});
