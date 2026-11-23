import { seedLegacyCashCapture } from "../../../testing/fixtures/legacy-cash-capture";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import request from "supertest";
import { accountBalanceSnapshots, accounts, grzBonds, households, netWorthSnapshots } from "@shared/schema";
import { db } from "../../../db";
import { snapshotWorker } from "../../../jobs/snapshotWorker";
import { a, actors, app, b, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const bondId = randomUUID();
let zmwDate: string, usdDate: string, legacyDate: string;
function history(viewer: Role = "member", scope = "user") {
  return request(app).get(`/api/accounts/summary/history?dateRange=all&scope=${scope}`).set("Cookie", actors.get(viewer)!.cookie);
}
async function clean() {
  await db.delete(grzBonds).where(eq(grzBonds.id, bondId));
  await db.delete(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, a));
}
function provenRows(owner: boolean) {
  return [
    expect.objectContaining({ date: zmwDate, currency: "ZMW", provenance: "captured_snapshot", netWorth: owner ? 5211.12 : 988.89 }),
    expect.objectContaining({ date: usdDate, currency: "USD", provenance: "captured_snapshot", netWorth: owner ? 110 : 50 }),
  ];
}

describe("R04 account chart publishes supported captured dates and denominations", () => {
  beforeAll(async () => {
    await start();
    const clock = await db.execute(sql`SELECT d::text AS today, (d-1)::text AS previous, (d-3)::text AS imported
      FROM (SELECT (transaction_timestamp() AT TIME ZONE 'UTC')::date AS d) dates`);
    usdDate = String(clock.rows[0].today);
    zmwDate = String(clock.rows[0].previous);
    legacyDate = String(clock.rows[0].imported);
  }, 20_000);
  beforeEach(async () => {
    await clean(); await reset();
    await db.update(households).set({ currency: "ZMW" }).where(eq(households.id, a));
    await seedLegacyCashCapture(a, zmwDate, { accountId: ids.sharedAccount, balance: "988.89" },
      { accountId: ids.privateAccount, balance: "4222.23" });
    await db.update(households).set({ currency: "USD" }).where(eq(households.id, a));
    await db.update(accounts).set({ currency: "USD", balance: "50.00" }).where(eq(accounts.id, ids.sharedAccount));
    await db.update(accounts).set({ currency: "USD", balance: "60.00" }).where(eq(accounts.id, ids.privateAccount));
    expect(await snapshotWorker.processHousehold(a)).toBe(true);
    await db.update(accounts).set({ balance: "100.00" }).where(eq(accounts.id, ids.sharedAccount));
    await db.update(accounts).set({ balance: "200.00" }).where(eq(accounts.id, ids.privateAccount));
  });
  afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); await clean(); });
  afterAll(async () => { await clean(); await stop(); });

  it.each(["owner", "admin", "member", "view_only", "professional"] as const)("%s sees actual dated values in their original currency", async viewer => {
    const response = await history(viewer).expect(200);
    expect(response.body.data.series).toEqual(provenRows(viewer === "owner"));
    expect(response.body.data).toMatchObject({ historyCoverage: "verified_snapshots_only", unattestedHistory: "not_charted" });
    if (viewer !== "owner") expect(JSON.stringify(response.body.data.series)).not.toMatch(/5211\.12|4222\.23/);
  });

  it("household selection does not grant the owner another member's private history", async () => {
    await db.update(accounts).set({ ownerUserId: actors.get("member")!.id }).where(eq(accounts.id, ids.privateAccount));
    const response = await history("owner", "household").expect(200);
    expect(response.body.data.series).toEqual(provenRows(false));
  });

  it("preserves imported balances while marking their independent denomination evidence unknown", async () => {
    await request(app).post(`/api/accounts/${ids.sharedAccount}/balance-history/import`).set("Cookie", actors.get("member")!.cookie)
      .send({ data: [{ date: legacyDate, amount: "123456.78" }] }).expect(200);
    const stored = await db.select().from(accountBalanceSnapshots).where(and(eq(accountBalanceSnapshots.accountId, ids.sharedAccount), eq(accountBalanceSnapshots.date, legacyDate)));
    expect(stored[0].balance).toBe("123456.78");
    const response = await history().expect(200);
    expect(response.body.data.series).toEqual(provenRows(false));
    expect(response.body.data.unattestedHistory).toBe("not_charted");
  });

  it("makes absent and private unattested legacy history indistinguishable", async () => {
    const before = await history().expect(200);
    await db.insert(netWorthSnapshots).values({ householdId: a, date: legacyDate, currency: "ZMW",
      totalAssets: "877777.77", totalLiabilities: "0.00", netWorth: "877777.77", accountBalances: [{ accountId: ids.privateAccount, balance: "877777.77" }] });
    await db.insert(accountBalanceSnapshots).values({ accountId: ids.privateAccount, date: legacyDate, balance: "877777.77" });
    const after = await history().expect(200);
    expect(after.body.data).toEqual(before.body.data);
    expect(JSON.stringify(after.body)).not.toContain("877777.77");
  });

  it("does not fill a missing historical series using the current household currency and balance", async () => {
    await db.delete(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, a));
    const response = await history().expect(200);
    expect(response.body.data.series).toEqual([]);
    expect(response.body.data).toMatchObject({ historyCoverage: "verified_snapshots_only", unattestedHistory: "not_charted" });
    expect(response.body.data).not.toHaveProperty("accounts");
  });

  it("optionally publishes the existing visible list DTO alongside its protected current frame", async () => {
    const response = await request(app).get("/api/accounts/net-worth/history?dateRange=all&includeAccounts=true")
      .set("Cookie", actors.get("member")!.cookie).expect(200);
    expect(response.body.data.accounts).toEqual([expect.objectContaining({ id: ids.sharedAccount, balance: "100.00", currency: "USD" })]);
    expect(response.body.data.accounts[0]).not.toHaveProperty("accountNumber");
    expect(response.body.data.latest).toMatchObject({ assets: 100, netWorth: 100, currency: "USD" });
  });
  it("narrows the optional current list by owner without granting a peer's private rows or falsifying the visible inventory", async () => {
    const root = "/api/accounts/net-worth/history?dateRange=all&includeAccounts=true&ownerUserId=";
    const cookie = actors.get("member")!.cookie;
    const owner = await request(app).get(root + actors.get("owner")!.id).set("Cookie", cookie).expect(200);
    expect(owner.body.data.accounts.map((account: { id: string }) => account.id)).toEqual([ids.sharedAccount]);
    const uppercase = await request(app).get(root + actors.get("owner")!.id.toUpperCase()).set("Cookie", cookie).expect(200);
    expect(uppercase.body.data.accounts).toEqual(owner.body.data.accounts);
    const shared = await request(app).get(root + "shared").set("Cookie", cookie).expect(200);
    expect(shared.body.data.accounts).toEqual([]);
    expect(shared.body.data.accessibleAccountCount).toBe(1);
    expect(shared.body.data.latest).toEqual(owner.body.data.latest);
    await request(app).get(root + "invalid").set("Cookie", cookie).expect(400);
    await request(app).get(root + "SHARED").set("Cookie", cookie).expect(400);
  });

  it("keeps supported history when a visible current bond valuation is unavailable", async () => {
    await db.insert(grzBonds).values({ id: bondId, householdId: a, accountId: ids.sharedAccount, bondName: "Current valuation unavailable",
      faceValue: "123.45", purchasePrice: "123.45", purchaseDate: legacyDate, maturityDate: "2028-10-28", tenorYears: 2, couponRate: "0.10" });
    const response = await history().expect(200);
    expect(response.body.data.series).toEqual(provenRows(false));
    expect(response.body.data).toMatchObject({ latest: null, currentStatus: "unavailable" });
  });

  it.each([null, "12!"])("preserves dated evidence without inventing current base currency %s", async currency => {
    // Native ZMW inputs isolate the missing-base fallback from missing FX.
    await db.update(accounts).set({ currency: "ZMW" }).where(eq(accounts.householdId, a));
    await db.update(households).set({ currency }).where(eq(households.id, a));
    const summary = await request(app).get("/api/accounts/summary").set("Cookie", actors.get("member")!.cookie).expect(422);
    expect(summary.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
    const response = await history().expect(200);
    expect(response.body.data.series).toEqual(provenRows(false));
    expect(response.body.data).toMatchObject({ latest: null, currentStatus: "unavailable" });
  });

  it.each(["private", "foreign", "deleted"] as const)("uses live account visibility for both proven currencies after the source is %s", async state => {
    if (state === "private") await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, ids.sharedAccount));
    else if (state === "foreign") await db.update(accounts).set({ householdId: b }).where(eq(accounts.id, ids.sharedAccount));
    else await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, ids.sharedAccount));
    const response = await history().expect(200);
    expect(response.body.data.series).toEqual([
      expect.objectContaining({ date: zmwDate, currency: "ZMW", netWorth: 0 }),
      expect.objectContaining({ date: usdDate, currency: "USD", netWorth: 0 }),
    ]);
  });
});
