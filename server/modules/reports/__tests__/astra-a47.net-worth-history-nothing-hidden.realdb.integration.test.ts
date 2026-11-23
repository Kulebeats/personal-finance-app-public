// A-47 guard: when no account of the household is hidden from the reader, the
// stored snapshot totals and breakdown are exactly what that reader may see,
// so the full history is kept, including captures that hold investments and
// so cannot be proven account by account. Real HTTP + Postgres.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import { accounts, netWorthSnapshots, users } from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { analyticsCache } from "../../../services/AnalyticsCache";
import { createSnapshotProvenance } from "../../../jobs/snapshotProvenance";

const tag = randomUUID().replaceAll("-", "").slice(0, 12);
const password = "SyntheticA47Whole123!";
const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const dates = [day(14), day(7)];
const range = { from: day(30), to: day(0) };
const zmw = (amount: string) => ({ amount, currency: "ZMW" });
const householdIds: string[] = [];
const userIds: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;

async function signIn(householdId: string, role: "owner" | "admin" | "member") {
  const id = randomUUID(), email = `a47w-${role}-${randomUUID().slice(0, 6)}-${tag}@example.invalid`;
  userIds.push(id);
  await db.insert(users).values({ id, email, username: `a47w-${randomUUID().slice(0, 8)}`, passwordHash: await hashPassword(password), emailVerified: true });
  await pool.query("INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, $3)", [householdId, id, role]);
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return { id, headers: { Cookie: (login.headers["set-cookie"] as unknown as string[]).join("; "),
    "X-Capital-Subject": id, "X-Capital-Household": householdId } };
}

/** A household with K100 checking and a K500 investment account, both shared, and two stored captures. */
async function seedHousehold(owners: string[]) {
  const householdId = householdIds[householdIds.length - 1];
  const checking = randomUUID(), investment = randomUUID();
  await db.insert(accounts).values([
    { id: checking, householdId, ownerUserId: owners[0], name: "A47W checking", type: "checking",
      currency: "ZMW", isAsset: true, isPrivate: false, initialBalance: "100.00", balance: "100.00" },
    { id: investment, householdId, ownerUserId: owners[owners.length - 1], name: "A47W investments", type: "investment",
      currency: "ZMW", isAsset: true, isPrivate: false, initialBalance: "0.00", balance: "0.00" },
  ]);
  // As the worker stores a household holding investments: valued, but the
  // capture is not complete account by account (coverage "unavailable").
  const contributions = [
    { accountId: checking, kind: "asset" as const, accountType: "checking", baseAmount: "100.00", sourceCurrency: "ZMW", baseCurrency: "ZMW", fx: "same_currency" as const },
    { accountId: investment, kind: "asset" as const, accountType: "investment", baseAmount: "500.00", sourceCurrency: "ZMW", baseCurrency: "ZMW", fx: "same_currency" as const },
  ];
  await db.insert(netWorthSnapshots).values(dates.map((date) => ({
    householdId, date, currency: "ZMW", totalAssets: "600.00", totalLiabilities: "0.00", netWorth: "600.00",
    assetsByType: { checking: "100.00", investment: "500.00" }, liabilitiesByType: {},
    accountBalances: [{ accountId: checking, balance: "100.00" }, { accountId: investment, balance: "500.00" }],
    provenance: createSnapshotProvenance(householdId, date, "ZMW", { holdings: 1, tbills: 0, pensions: 0, bonds: 0 }, contributions, 0),
  })));
}

async function netWorth(householdId: string, headers: Record<string, string>) {
  await analyticsCache.invalidateHousehold(householdId);
  return (await request(app).get("/api/reports/net-worth").set(headers).query(range).expect(200)).body;
}
function expectFullHistory(body: { data: Record<string, unknown> & { series: Array<{ id: string; data: unknown[] }> } }) {
  expect(body.data.historyCoverage).toBe("snapshots");
  expect(body.data.series.find((line) => line.id === "Net Worth")!.data)
    .toEqual(dates.map((date) => ({ x: date, y: zmw("600.00") })));
  expect(body.data.breakdown).toEqual({
    assetsByType: expect.arrayContaining([{ type: "checking", value: zmw("100.00") }, { type: "investment", value: zmw("500.00") }]),
    liabilitiesByType: [],
  });
}

describe("A-47 guard: nothing hidden from the reader keeps the full stored history", () => {
  beforeAll(async () => { app = await getTestApp(); }, 60_000);

  afterAll(async () => {
    for (const table of ["net_worth_snapshots", "audit_logs", "outbox_events"]) {
      await pool.query(`DELETE FROM ${table} WHERE household_id = ANY($1::uuid[])`, [householdIds]);
    }
    if (householdIds.length) await db.delete(accounts).where(inArray(accounts.householdId, householdIds));
    await pool.query("DELETE FROM household_members WHERE household_id = ANY($1::uuid[])", [householdIds]);
    await pool.query("DELETE FROM households WHERE id = ANY($1::uuid[])", [householdIds]);
    for (const id of userIds) await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1', [id]);
    await pool.query("DELETE FROM security_audit_logs WHERE user_id = ANY($1::uuid[])", [userIds]);
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  });

  it("a sole member whose household holds investments keeps the full history", async () => {
    const householdId = randomUUID();
    householdIds.push(householdId);
    await pool.query("INSERT INTO households (id, name, currency) VALUES ($1, 'Synthetic A-47 sole', 'ZMW')", [householdId]);
    const owner = await signIn(householdId, "owner");
    await seedHousehold([owner.id]);
    expectFullHistory(await netWorth(householdId, owner.headers));
  });

  it("two members with nothing private both keep the full history", async () => {
    const householdId = randomUUID();
    householdIds.push(householdId);
    await pool.query("INSERT INTO households (id, name, currency) VALUES ($1, 'Synthetic A-47 pair', 'ZMW')", [householdId]);
    const owner = await signIn(householdId, "owner");
    const admin = await signIn(householdId, "admin");
    await seedHousehold([owner.id, admin.id]);
    expectFullHistory(await netWorth(householdId, owner.headers));
    expectFullHistory(await netWorth(householdId, admin.headers));
  });
});
