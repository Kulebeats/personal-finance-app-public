import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql, type SQL } from "drizzle-orm";
import request from "supertest";
import { accountBalanceSnapshots, accountWorthCaptures, accounts, grzBonds, grzTBills, holdings, households, netWorthSnapshots, pensionHoldings, securities } from "@shared/schema";
import { db } from "../../../db";
import { snapshotWorker } from "../../../jobs/snapshotWorker";
import { portfolioValuationService } from "../../../services/PortfolioValuationService";
import { CalculationError } from "../../../core/calculations/errors";
import { createSnapshotProvenance } from "../../../jobs/snapshotProvenance";
import { a, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const securityId = randomUUID(), interestId = randomUUID();
function day(offset: number) { const value = new Date(); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); }
let date: string, earlier: string;
async function capture() { return snapshotWorker.processHousehold(a); }
/** Explicit synthetic legacy fixture, independent of today's account data or
 * the new DB-clock receipt writer. It exercises backward-compatible reads only. */
async function seedLegacyCash(at: string) {
  const contributions = [
    { accountId: ids.sharedAccount, kind: "asset" as const, accountType: "checking", baseAmount: "100.00", sourceCurrency: "ZMW", baseCurrency: "ZMW", fx: "same_currency" as const },
    { accountId: ids.privateAccount, kind: "asset" as const, accountType: "savings", baseAmount: "200.00", sourceCurrency: "ZMW", baseCurrency: "ZMW", fx: "same_currency" as const },
  ];
  await db.insert(netWorthSnapshots).values({ householdId: a, date: at, currency: "ZMW", totalAssets: "300", totalLiabilities: "0", netWorth: "300",
    accountBalances: contributions.map(item => ({ accountId: item.accountId, balance: item.baseAmount })),
    provenance: createSnapshotProvenance(a, at, "ZMW", { holdings: 0, tbills: 0, pensions: 0, bonds: 0 }, contributions, 0) });
}
function history(viewer: "member" | "owner" = "member", scope = "user") {
  return request(app).get(`/api/accounts/net-worth/history?dateRange=all&scope=${scope}`).set("Cookie", actors.get(viewer)!.cookie);
}
function point(at = date) { return expect.objectContaining({ date: at, currency: "ZMW", netWorth: 100, provenance: "captured_snapshot" }); }
async function clean() {
  await db.delete(grzBonds).where(eq(grzBonds.id, interestId));
  await db.delete(grzTBills).where(eq(grzTBills.id, interestId));
  await db.delete(pensionHoldings).where(eq(pensionHoldings.id, interestId));
  await db.delete(holdings).where(eq(holdings.id, interestId));
  await db.delete(securities).where(eq(securities.id, securityId));
  await db.delete(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, a));
  await db.delete(accountWorthCaptures).where(eq(accountWorthCaptures.householdId, a));
}
async function interest(kind: "holding" | "unattributed pension" | "bill" | "pension" | "bond", accountId: string | null = ids.privateAccount) {
  if (kind === "holding") {
    if (accountId === null) throw new Error("Synthetic holding requires an account");
    await db.insert(securities).values({ id: securityId, symbol: "R04SCOPED", name: "Captured scoped interest", type: "stock", currency: "ZMW", currentPrice: "3" });
    await db.insert(holdings).values({ id: interestId, householdId: a, accountId,
      securityId, quantity: "50", costBasis: "100" });
  } else if (kind.includes("pension")) await db.insert(pensionHoldings).values({ id: interestId, householdId: a, accountId: kind === "unattributed pension" ? null : accountId,
    providerName: "Captured pension", pensionType: "private", currentBalance: "150" });
  else {
    const common = { id: interestId, householdId: a, accountId, faceValue: "150", purchasePrice: "150", purchaseDate: earlier, maturityDate: day(365) };
    if (kind === "bill") await db.insert(grzTBills).values({ ...common, tbillName: "Captured bill", tenorDays: 91 });
    else await db.insert(grzBonds).values({ ...common, bondName: "Captured bond", tenorYears: 2, couponRate: "0.10" });
  }
}
function betweenCaptureReads(change: () => Promise<unknown>) {
  const actual = Client.prototype.query;
  let reads = 0;
  const gate = vi.fn(change);
  const intercepted = function(this: Client, ...args: unknown[]) {
    const command = args[0];
    const text = typeof command === "string" ? command : command && typeof command === "object" && "text" in command ? String(command.text) : "";
    if (/^\s*select\b/i.test(text) && /from\s+"(?:net_worth_snapshots|account_worth_captures)"/i.test(text) && ++reads === 2)
      return gate().then(() => Reflect.apply(actual, this, args));
    return Reflect.apply(actual, this, args);
  };
  vi.spyOn(Client.prototype, "query").mockImplementation(intercepted as typeof Client.prototype.query);
  return gate;
}

describe("R04 ordinary account history uses independently captured visible facts", () => {
  beforeAll(async () => {
    await start();
    const clock = await db.execute<{ date: string }>(sql`select to_char(transaction_timestamp() at time zone 'UTC', 'YYYY-MM-DD') as date`);
    date = clock.rows[0].date;
    const prior = new Date(`${date}T12:00:00Z`); prior.setUTCDate(prior.getUTCDate() - 1); earlier = prior.toISOString().slice(0, 10);
  }, 20_000);
  beforeEach(async () => {
    await clean(); await reset();
    await db.update(households).set({ currency: "ZMW" }).where(eq(households.id, a));
    await db.update(accounts).set({ balance: "100", currency: "ZMW" }).where(eq(accounts.id, ids.sharedAccount));
    await db.update(accounts).set({ balance: "200", currency: "ZMW" }).where(eq(accounts.id, ids.privateAccount));
  });
  afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); await clean(); });
  afterAll(async () => { await clean(); await stop(); });

  it.each(["holding", "unattributed pension", "bill", "pension", "bond"] as const)("keeps member history identical after the actual worker captures an out-of-scope %s", async kind => {
    expect(await capture()).toBe(true);
    const before = await history().expect(200);
    expect(before.body.data.series).toEqual([point()]);
    const priorGlobal = await db.select().from(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, a));
    await interest(kind);
    if (kind === "bond") {
      await expect(capture()).rejects.toMatchObject({ code: "INSUFFICIENT_DATA" });
      expect(await db.select().from(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, a))).toEqual(priorGlobal);
    } else expect(await capture()).toBe(true);
    const after = await history().expect(200);
    expect(after.body.data).toEqual(before.body.data);
    const household = await history("owner", "household").expect(200);
    // An unvalued bond cannot replace the genuine earlier household capture.
    // Successfully captured portfolios still have no supported complete series.
    expect(household.body.data.series).toEqual(kind === "bond" ? [{ date, currency: "ZMW", assets: 300, liabilities: 0, netWorth: 300, provenance: "captured_snapshot" }] : []);
  });
  it("refreshes native evidence when an account edit commits during a failed FX valuation", async () => {
    const id = randomUUID(), owner = actors.get("owner")!;
    await db.insert(accounts).values({ id, householdId: a, ownerUserId: owner.id, name: "Unused capture account",
      type: "checking", currency: "ZMW", initialBalance: "100.00", balance: "100.00" });
    await db.update(accounts).set({ currency: "QPX" }).where(eq(accounts.id, ids.privateAccount));
    let edited = false;
    const actual = Client.prototype.query;
    const intercept = function(this: Client, ...args: unknown[]) {
      const query = args[0];
      const text = typeof query === "string" ? query : query && typeof query === "object" && "text" in query ? String(query.text) : "";
      const result = Reflect.apply(actual, this, args);
      if (edited || !text.includes("public.r04_account_capture_records(")) return result;
      edited = true;
      return Promise.resolve(result).then(async observation => {
        await request(app).put(`/api/accounts/${id}`).set("Cookie", owner.cookie).send({ initialBalance: "125.00" }).expect(200);
        return observation;
      });
    };
    vi.spyOn(Client.prototype, "query").mockImplementation(intercept as typeof Client.prototype.query);
    await expect(capture()).rejects.toMatchObject({ code: "MISSING_FX_RATE" });
    expect(edited).toBe(true);
    const [receipt] = await db.select().from(accountWorthCaptures).where(eq(accountWorthCaptures.householdId, a));
    expect(receipt.evidence?.accounts.find(account => account.accountId === id)).toMatchObject({ sourceAmount: "125.00", sourceCurrency: "ZMW" });
    expect(await db.select().from(accountBalanceSnapshots).where(eq(accountBalanceSnapshots.accountId, id))).toEqual([]);
    await request(app).put(`/api/accounts/${id}`).set("Cookie", owner.cookie).send({ initialBalance: "150.00" }).expect(409);
  });
  it("persists visible native facts on a fresh date despite an actual missing private FX rate", async () => {
    await db.update(accounts).set({ currency: "QPX" }).where(eq(accounts.id, ids.privateAccount));
    await expect(capture()).rejects.toMatchObject({ code: "MISSING_FX_RATE" });
    const stored = await db.select().from(netWorthSnapshots).where(and(eq(netWorthSnapshots.householdId, a), eq(netWorthSnapshots.date, date)));
    expect(stored).toEqual([]); // No zero or partial legacy aggregate may be inserted.
    expect((await history().expect(200)).body.data.series).toEqual([point()]);
    expect((await history("owner", "household").expect(200)).body.data).toMatchObject({ series: [], latest: null, currentStatus: "unavailable" });
  });
  it("persists visible native facts on a fresh date after a known private portfolio valuation failure", async () => {
    await interest("holding");
    const actual = portfolioValuationService.getHouseholdInvestmentValue.bind(portfolioValuationService);
    const unavailable = new CalculationError("MISSING_FX_RATE", { from: "QPX", to: "ZMW" });
    vi.spyOn(portfolioValuationService, "getHouseholdInvestmentValue").mockImplementation((...args) =>
      args[2]?.accountIds === undefined ? Promise.reject(unavailable) : actual(...args));
    await expect(capture()).rejects.toBe(unavailable);
    expect(await db.select().from(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, a))).toEqual([]);
    expect((await history().expect(200)).body.data.series).toEqual([point()]);
  });
  it("does not label a visible uncovered portfolio as complete captured cash", async () => {
    await interest("holding", ids.sharedAccount); expect(await capture()).toBe(true);
    const response = await history().expect(200);
    expect(response.body.data.series).toEqual([]);
    expect(response.body.data.latest).toMatchObject({ assets: 250, netWorth: 250, currency: "ZMW" });
  });
  it("keeps newly captured cash on the same date when private denomination is unavailable", async () => {
    expect(await capture()).toBe(true);
    const before = await history().expect(200);
    expect(before.body.data.series).toEqual([point()]);
    await db.update(accounts).set({ balance: "101" }).where(eq(accounts.id, ids.sharedAccount));
    await db.update(accounts).set({ currency: "12!" }).where(eq(accounts.id, ids.privateAccount));
    await expect(capture()).rejects.toMatchObject({ code: "MISSING_FX_RATE" });
    expect((await history().expect(200)).body.data.series).toEqual([expect.objectContaining({ date, currency: "ZMW", netWorth: 101 })]);
  });
  it("publishes a newly eligible in-range date created between assembly and final read", async () => {
    await seedLegacyCash(earlier);
    const gate = betweenCaptureReads(() => capture());
    const response = await history().expect(200);
    expect(gate).toHaveBeenCalledOnce();
    expect(response.body.data.series).toEqual([point(earlier), point(date)]);
  });
  it("does not certify a visible foreign-currency account when its valuation is unavailable", async () => {
    await db.update(accounts).set({ currency: "QPX" }).where(eq(accounts.id, ids.sharedAccount));
    await expect(capture()).rejects.toMatchObject({ code: "MISSING_FX_RATE" });
    expect(await db.select().from(accountWorthCaptures).where(eq(accountWorthCaptures.householdId, a))).toHaveLength(1);
    const response = await history().expect(200);
    expect(response.body.data).toMatchObject({ series: [], latest: null, currentStatus: "unavailable" });
  });
  it.each(["SQL", "programming"] as const)("rolls back independent and household receipts after a private %s failure", async failure => {
    await interest("holding");
    const actual = portfolioValuationService.getHouseholdInvestmentValue.bind(portfolioValuationService);
    vi.spyOn(portfolioValuationService, "getHouseholdInvestmentValue").mockImplementation(async (...args) => {
      if (args[2]?.accountIds !== undefined) return actual(...args);
      if (failure === "SQL") await (args[2]!.database as unknown as { execute: (query: SQL) => Promise<unknown> }).execute(sql`select 1 / 0`);
      throw new Error("Synthetic programming boundary failure");
    });
    await expect(capture()).rejects.toThrow();
    expect(await db.select().from(accountWorthCaptures).where(eq(accountWorthCaptures.householdId, a))).toEqual([]);
    expect(await db.select().from(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, a))).toEqual([]);
    expect((await history().expect(200)).body.data.series).toEqual([]);
  });
  it("withdraws a same-day proof invalidated by an old aggregate writer before publication", async () => {
    expect(await capture()).toBe(true);
    const gate = betweenCaptureReads(() => db.update(netWorthSnapshots).set({ totalAssets: "900", netWorth: "900" })
      .where(and(eq(netWorthSnapshots.householdId, a), eq(netWorthSnapshots.date, date))));
    const response = await history().expect(200);
    expect(gate).toHaveBeenCalledOnce();
    expect(response.body.data.series).toEqual([]);
  });
  it("retains strict complete legacy proof and rejects unattested legacy values", async () => {
    expect(await capture()).toBe(true);
    const [row] = await db.select().from(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, a));
    const provenance: Record<string, unknown> = { ...(row.provenance as Record<string, unknown>), captureId: randomUUID() };
    delete provenance.accountProof;
    await db.update(netWorthSnapshots).set({ provenance }).where(eq(netWorthSnapshots.id, row.id));
    expect((await history().expect(200)).body.data.series).toEqual([point()]);
    await db.update(netWorthSnapshots).set({ provenance: null }).where(eq(netWorthSnapshots.id, row.id));
    expect((await history().expect(200)).body.data.series).toEqual([]);
  });
});
