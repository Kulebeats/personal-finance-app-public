import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fxRates, providerFxQuotes } from "@shared/schema";
import { db } from "../../db";
import { providerFlowRate } from "../../repositories/reports/providerFxQuote";
import { marketDataService } from "../MarketDataService";

const quote = vi.hoisted(() => vi.fn());
vi.mock("yahoo-finance2", () => ({ default: class { quote = quote } }));

// A leap-day window chosen outside the seeded report years.
const monday = "1988-02-29";
const observed = new Date(monday + "T12:15:00Z");
const identity = and(eq(providerFxQuotes.fromCurrency, "USD"), eq(providerFxQuotes.toCurrency, "ZMW"),
  eq(providerFxQuotes.effectiveDate, monday));
const legacy = and(eq(fxRates.fromCurrency, "USD"), eq(fxRates.toCurrency, "ZMW"), eq(fxRates.date, monday));
let owned = false;

beforeEach(async () => {
  expect(await db.select().from(providerFxQuotes).where(identity)).toHaveLength(0);
  expect(await db.select().from(fxRates).where(legacy)).toHaveLength(0);
  owned = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("1988-03-03T22:30:00Z"));
  vi.stubEnv("FX_FLOW_MAX_CARRY_DAYS", "3");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Synthetic network boundary")));
  quote.mockReset().mockResolvedValue({ symbol: "USDZMW=X", regularMarketTime: observed, regularMarketPrice: 20 });
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (owned) {
    await db.delete(providerFxQuotes).where(identity);
    await db.delete(fxRates).where(legacy);
    owned = false;
  }
});

async function read(date: string) {
  const result = await db.execute(sql`select ${providerFlowRate(sql`'USD'`, "ZMW", sql`${date}::date`)}::text as rate`);
  return result.rows[0].rate;
}

it("uses the provider date through its third calendar day, preserves a legacy read, and serializes concurrent retries", async () => {
  const refresh = () => marketDataService.updateFXRates();
  expect(await Promise.all([refresh(), refresh()])).toEqual([{ success: true, rate: 20 }, { success: true, rate: 20 }]);
  const rows = await db.select().from(providerFxQuotes).where(identity);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ effectiveDate: monday, validThrough: "1988-03-03", quotedAt: observed });
  expect(await db.select().from(fxRates).where(legacy)).toHaveLength(1);
  expect(await read("1988-02-28")).toBeNull();
  expect(Number(await read(monday))).toBe(20);
  expect(Number(await read("1988-03-03"))).toBe(20);
  expect(await read("1988-03-04")).toBeNull();
  quote.mockResolvedValueOnce({ symbol: "USDZMW=X", regularMarketTime: observed, regularMarketPrice: 21 });
  expect(await refresh()).toEqual({ success: false, rate: null });
  expect(Number(await read(monday))).toBe(20);
});

it("accepts a dated fallback response when Yahoo gives no observed instant", async () => {
  quote.mockResolvedValue({ symbol: "USDZMW=X", regularMarketPrice: 99 });
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ base: "USD", date: monday,
    time_last_updated: observed.getTime() / 1000, rates: { ZMW: 25 } })));
  expect(await marketDataService.updateFXRates()).toEqual({ success: true, rate: 25 });
  expect(await db.select().from(providerFxQuotes).where(identity)).toMatchObject([{ provider: "exchangerate_api" }]);
  expect(Number(await read("1988-03-03"))).toBe(25);
});

it("preserves an existing manual rate when carrying a Monday observation into Thursday", async () => {
  await db.insert(fxRates).values({ fromCurrency: "USD", toCurrency: "ZMW", date: monday, rate: "13", source: "yahoo_finance" });
  expect(await marketDataService.updateFXRates()).toEqual({ success: true, rate: 20 });
  const old = await db.select().from(fxRates).where(legacy);
  expect(old).toHaveLength(1);
  expect(Number(old[0].rate)).toBe(13);
  expect(Number(await read("1988-03-03"))).toBe(20);
});

it("declines an expired observation even when the feed was fetched today", async () => {
  vi.setSystemTime(new Date("1988-03-04T00:00:00Z"));
  expect(await marketDataService.updateFXRates()).toEqual({ success: false, rate: null });
  expect(await db.select().from(providerFxQuotes).where(identity)).toHaveLength(0);
  expect(await db.select().from(fxRates).where(legacy)).toHaveLength(0);
});

it.each([20.1234567890123, 0.00000001, 1000000])("declines a rate outside storage precision before either financial write (%s)", async rate => {
  quote.mockResolvedValue({ symbol: "USDZMW=X", regularMarketTime: observed, regularMarketPrice: rate });
  expect(await marketDataService.updateFXRates()).toEqual({ success: false, rate: null });
  expect(await db.select().from(providerFxQuotes).where(identity)).toHaveLength(0);
  expect(await db.select().from(fxRates).where(legacy)).toHaveLength(0);
});
