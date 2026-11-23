/**
 * NEW-32: market refresh writes (security prices, the FX rate) are audited in
 * the same database transaction as the write (Rule 9). REAL DB; the quote
 * provider is the only fake.
 *
 * Market data is global, not household data: a scheduled run is attributed to
 * nobody (user and household null); a manual refresh to the member who ran it.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fxRates, providerFxQuotes, securities, securityPrices, systemRoles, userSystemRoles } from "@shared/schema";
import { db, pool } from "../../db";
import { marketDataService } from "../MarketDataService";
import { a, actors, app, reset, start, stop } from "../../modules/tags/__tests__/completion-r04.tags.fixture";

const quote = vi.hoisted(() => vi.fn());
vi.mock("yahoo-finance2", () => ({ default: class { quote = quote } }));

const SYMBOL = "AUDITMKT";
let securityId: string;

const signed = (call: request.Test) => call.set("Cookie", actors.get("owner")!.cookie)
  .set("X-Capital-Subject", actors.get("owner")!.id).set("X-Capital-Household", a);
const auditRows = async (entityType: string, entityId: string) =>
  (await pool.query("select * from audit_logs where entity_type=$1 and entity_id=$2 order by created_at, id", [entityType, entityId])).rows;
const currentPrice = async () =>
  (await pool.query("select current_price from securities where id=$1", [securityId])).rows[0].current_price as string | null;

/** Only this test's security is quoted; every other seeded symbol fails and stays untouched. */
const quoteOnlyOurs = (price: number) => quote.mockImplementation(async (symbol: string) => {
  if (symbol === SYMBOL) return { symbol, regularMarketPrice: price };
  throw new Error("not under test");
});

const blockAudit = async (entityType: string) => {
  await pool.query(`create or replace function block_market_audit() returns trigger language plpgsql as $$
    begin
      if new.entity_type = '${entityType}' then raise exception 'audit blocked for test'; end if;
      return new;
    end $$`);
  await pool.query("create trigger block_market_audit before insert on audit_logs for each row execute function block_market_audit()");
};
const unblockAudit = () => pool.query("drop trigger if exists block_market_audit on audit_logs");

describe("NEW-32 market refresh audit (real DB)", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await reset();
    securityId = randomUUID();
    await db.insert(securities).values({ id: securityId, symbol: SYMBOL, name: "Audit market security", type: "stock", currency: "USD", currentPrice: "10.0000" });
    quote.mockReset();
  });
  afterEach(async () => {
    await unblockAudit();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await pool.query("delete from audit_logs where entity_id=$1", [securityId]);
    await db.delete(securityPrices).where(eq(securityPrices.securityId, securityId));
    await db.delete(securities).where(eq(securities.id, securityId));
  });
  afterAll(async () => {
    await pool.query("drop function if exists block_market_audit()");
    await stop();
  });

  it("audits a scheduled price refresh with the old and new price and no actor", async () => {
    quoteOnlyOurs(12.5);
    await marketDataService.updateSecurityPrices();

    expect(await currentPrice()).toBe("12.5000");
    const [row, ...rest] = await auditRows("security_price", securityId);
    expect(rest).toHaveLength(0);
    expect(row.action).toBe("UPDATE");
    expect(row.user_id).toBeNull();
    expect(row.household_id).toBeNull();
    expect(row.details).toMatchObject({ symbol: SYMBOL, source: "yahoo_finance" });
    expect(row.details.changes.currentPrice).toEqual({ from: "10.0000", to: "12.5" });
  });

  it("attributes a manual refresh to the operator who ran it", async () => {
    // NEW-13: only a super_admin may refresh the global reference prices.
    const owner = actors.get("owner")!.id;
    await db.insert(systemRoles).values({ name: "super_admin" }).onConflictDoNothing();
    const [{ id: roleId }] = await db.select({ id: systemRoles.id }).from(systemRoles).where(eq(systemRoles.name, "super_admin"));
    await db.insert(userSystemRoles).values({ userId: owner, roleId });
    try {
      quoteOnlyOurs(13);
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Synthetic network boundary")));
      await signed(request(app).post("/api/investments/market/refresh")).expect(200);

      // Global reference prices belong to no household, whoever runs the refresh.
      const [row] = await auditRows("security_price", securityId);
      expect(row.user_id).toBe(owner);
      expect(row.household_id).toBeNull();
    } finally {
      await db.delete(userSystemRoles).where(eq(userSystemRoles.userId, owner));
    }
  });

  it("rolls the price update and history row back when the audit insert fails", async () => {
    quoteOnlyOurs(14);
    await blockAudit("security_price");
    const result = await marketDataService.updateSecurityPrices();

    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(await currentPrice()).toBe("10.0000");
    expect(await db.select().from(securityPrices).where(eq(securityPrices.securityId, securityId))).toHaveLength(0);
    expect(await auditRows("security_price", securityId)).toHaveLength(0);
  });

  describe("FX rate", () => {
    const monday = "1988-02-29";
    const observed = new Date(`${monday}T12:15:00Z`);
    const identity = and(eq(providerFxQuotes.fromCurrency, "USD"), eq(providerFxQuotes.toCurrency, "ZMW"), eq(providerFxQuotes.effectiveDate, monday));
    const mirror = and(eq(fxRates.fromCurrency, "USD"), eq(fxRates.toCurrency, "ZMW"), eq(fxRates.date, monday));
    let rateIds: string[] = [];

    beforeEach(async () => {
      expect(await db.select().from(providerFxQuotes).where(identity)).toHaveLength(0);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("1988-03-03T22:30:00Z"));
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Synthetic network boundary")));
      quote.mockResolvedValue({ symbol: "USDZMW=X", regularMarketTime: observed, regularMarketPrice: 20 });
    });
    afterEach(async () => {
      const quotes = await db.select({ id: providerFxQuotes.id }).from(providerFxQuotes).where(identity);
      rateIds = quotes.map((row) => row.id);
      if (rateIds.length) await pool.query("delete from audit_logs where entity_type='fx_rate' and entity_id = any($1::uuid[])", [rateIds]);
      await db.delete(providerFxQuotes).where(identity);
      await db.delete(fxRates).where(mirror);
    });

    it("audits the stored provider rate, with the provider and the date it applies to", async () => {
      expect(await marketDataService.updateFXRates()).toEqual({ success: true, rate: 20 });

      const [fx] = await db.select().from(providerFxQuotes).where(identity);
      const [row, ...rest] = await auditRows("fx_rate", fx.id);
      expect(rest).toHaveLength(0);
      expect(row.user_id).toBeNull();
      expect(row.household_id).toBeNull();
      expect(row.details).toMatchObject({ pair: "USD/ZMW", provider: "yahoo_finance", effectiveDate: monday });
      expect(Number(row.details.rate)).toBe(20);
    });

    it("rolls the provider quote and the rate mirror back when the audit insert fails", async () => {
      await blockAudit("fx_rate");
      expect(await marketDataService.updateFXRates()).toEqual({ success: false, rate: null });

      expect(await db.select().from(providerFxQuotes).where(identity)).toHaveLength(0);
      expect(await db.select().from(fxRates).where(mirror)).toHaveLength(0);
    });
  });
});
