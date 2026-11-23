import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, gte, inArray, or } from "drizzle-orm";
import { fxRates, holdings, households, securities } from "@shared/schema";
import { db } from "../../db";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../core/calculations";
import { investmentService } from "../../modules/investments/investments.service";
import { portfolioValuationService } from "../../services/PortfolioValuationService";
import { a, actors, app, ids, reset, start, stop } from "../../modules/tags/__tests__/completion-r04.tags.fixture";

// TEST-ONLY/UNVERIFIED: real signed routes and the initialized DB-backed FX
// converter. No converter, rate repository or valuation result is stubbed.
const zmwSecurity = randomUUID(), usdSecurity = randomUUID(), zmwHolding = randomUUID(), usdHolding = randomUUID();
const quoteIds = [randomUUID(), randomUUID()];
const paths = ["/holdings", "/portfolio", "/portfolio/summary"] as const;
const valid = [
  ["currency=ZMW", "ZMW"], ["baseCurrency=ZMW", "ZMW"],
  ["currency=USD", "USD"], ["baseCurrency=USD", "USD"],
  ["currency=%20usd%20", "USD"], ["baseCurrency=%20zmw%20", "ZMW"],
  ["currency=%20usd%20&baseCurrency=Usd", "USD"],
] as const;
const invalid = [
  "currency=USD&baseCurrency=ZMW", "currency=USD&currency=USD", "baseCurrency=USD&baseCurrency=usd",
  "currency=", "baseCurrency=", "currency=%20%20", "currency=US", "baseCurrency=USDX",
  "currency=U%24D", "baseCurrency=123", "currency=USD&baseCurrency=", "currency[]=USD", "baseCurrency[unit]=USD",
];
function get(path: string) {
  const actor = actors.get("member")!;
  return request(app).get("/api/investments" + path).set("Cookie", actor.cookie)
    .set("X-Capital-Subject", actor.id).set("X-Capital-Household", a);
}
async function cleanPositions() {
  await db.delete(holdings).where(inArray(holdings.id, [zmwHolding, usdHolding]));
  await db.delete(securities).where(inArray(securities.id, [zmwSecurity, usdSecurity]));
}
// Amounts are MoneyDto in the selected base currency (NEW-35 class); the
// stored local costBasis string is unchanged; percentages and rates are ratios.
const m = (amount: string, currency: string) => ({ amount, currency });
function assertValuation(path: string, body: Record<string, unknown>, currency: "ZMW" | "USD") {
  expect(body).toMatchObject({ success: true, meta: { baseCurrency: currency } });
  const c = currency;
  if (path === "/holdings") {
    expect(body.data).toHaveLength(2);
    expect(body.data).toEqual(expect.arrayContaining(currency === "ZMW" ? [
      expect.objectContaining({ id: zmwHolding, currentValue: m("100.00", c), costBasis: "80.00", costBasisBase: m("80.00", c), gainLoss: m("20.00", c), fxRateUsed: 1, security: expect.objectContaining({ currency: "ZMW" }) }),
      expect.objectContaining({ id: usdHolding, currentValue: m("200.00", c), costBasis: "8.00", costBasisBase: m("160.00", c), gainLoss: m("40.00", c), fxRateUsed: 20, security: expect.objectContaining({ currency: "USD" }) }),
    ] : [
      expect.objectContaining({ id: zmwHolding, currentValue: m("5.00", c), costBasis: "80.00", costBasisBase: m("4.00", c), gainLoss: m("1.00", c), fxRateUsed: 0.05, security: expect.objectContaining({ currency: "ZMW" }) }),
      expect.objectContaining({ id: usdHolding, currentValue: m("10.00", c), costBasis: "8.00", costBasisBase: m("8.00", c), gainLoss: m("2.00", c), fxRateUsed: 1, security: expect.objectContaining({ currency: "USD" }) }),
    ]));
  } else {
    expect(body.data).toMatchObject(currency === "ZMW" ? {
      totalValue: m("300.00", c), totalCostBasis: m("240.00", c), totalGainLoss: m("60.00", c), totalGainLossPercent: 25,
      holdingsCount: 2, byType: { stock: m("300.00", c) }, tbillsValue: m("0.00", c), pensionValue: m("0.00", c),
      totalIncludingAlternatives: m("300.00", c),
    } : {
      totalValue: m("15.00", c), totalCostBasis: m("12.00", c), totalGainLoss: m("3.00", c), totalGainLossPercent: 25,
      holdingsCount: 2, byType: { stock: m("15.00", c) }, tbillsValue: m("0.00", c), pensionValue: m("0.00", c),
      totalIncludingAlternatives: m("15.00", c),
    });
  }
}

describe("R12 candidate: holdings and both portfolio callers publish the actual selected monetary unit", () => {
  beforeAll(async () => {
    await start();
    const date = new Date().toISOString().slice(0, 10);
    // Refuse ambiguous same-day/future fixture quotes. Never delete or adopt
    // somebody else's quote to force this oracle; ROOT owns a fresh target.
    expect(await db.select().from(fxRates).where(and(gte(fxRates.date, date), or(
      and(eq(fxRates.fromCurrency, "USD"), eq(fxRates.toCurrency, "ZMW")),
      and(eq(fxRates.fromCurrency, "ZMW"), eq(fxRates.toCurrency, "USD")),
    )))).toHaveLength(0);
    await db.insert(fxRates).values([
      { id: quoteIds[0], fromCurrency: "USD", toCurrency: "ZMW", rate: "20.0000", date, source: "synthetic_r12_currency_wire" },
      { id: quoteIds[1], fromCurrency: "ZMW", toCurrency: "USD", rate: "0.0500", date, source: "synthetic_r12_currency_wire" },
    ]);
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates),
      { cacheTtlSeconds: 300, baseCurrency: "USD", fallbackDays: 30 }));
  }, 30_000);
  beforeEach(async () => {
    await cleanPositions(); await reset();
    await db.update(households).set({ currency: "ZMW" }).where(eq(households.id, a));
    await db.insert(securities).values([
      { id: zmwSecurity, symbol: "R12ZMW", name: "Synthetic ZMW hundred", type: "stock", currency: "ZMW", currentPrice: "10" },
      { id: usdSecurity, symbol: "R12USD", name: "Synthetic USD ten", type: "stock", currency: "USD", currentPrice: "5" },
    ]);
    await db.insert(holdings).values([
      { id: zmwHolding, householdId: a, accountId: ids.sharedAccount, securityId: zmwSecurity, quantity: "10", costBasis: "80", costBasisZmw: "80", acquisitionFxRate: "1" },
      { id: usdHolding, householdId: a, accountId: ids.sharedAccount, securityId: usdSecurity, quantity: "2", costBasis: "8", costBasisZmw: "160", acquisitionFxRate: "20" },
    ]);
  });
  afterEach(async () => { vi.restoreAllMocks(); await cleanPositions(); });
  afterAll(async () => {
    await cleanPositions(); await db.delete(fxRates).where(inArray(fxRates.id, quoteIds)); await stop();
  });

  it.each(paths)("converts real amounts and reports matching metadata through %s for both selector names", async path => {
    for (const [query, currency] of valid) {
      const response = await get(`${path}?${query}`).expect(200);
      assertValuation(path, response.body, currency);
    }
    const rows = await db.select().from(holdings).where(inArray(holdings.id, [zmwHolding, usdHolding]));
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: zmwHolding, costBasis: "80.00", costBasisZmw: "80.00", quantity: "10.00000000" }),
      expect.objectContaining({ id: usdHolding, costBasis: "8.00", costBasisZmw: "160.00", quantity: "2.00000000" }),
    ]));
  });

  it.each(paths)("rejects conflicting, repeated or malformed selectors before valuation through %s", async path => {
    // Call-through observers prove admission order; the converter stays real.
    const list = vi.spyOn(investmentService, "getHoldings");
    const summary = vi.spyOn(portfolioValuationService, "getHouseholdInvestmentValue");
    for (const query of invalid) {
      const response = await get(`${path}?${query}`).expect(400);
      expect(response.body).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
      expect(response.body).not.toHaveProperty("data");
      expect(list).not.toHaveBeenCalled(); expect(summary).not.toHaveBeenCalled();
    }
  });

  // P2 value test: a number keeps ~17 significant digits, so a large holding
  // published as a JSON number lost its cents (…456.8). MoneyDto keeps them.
  it("publishes a large holding's value and the totals to the exact cent", async () => {
    await db.update(securities).set({ currentPrice: "1000000.0000" }).where(eq(securities.id, zmwSecurity));
    await db.update(holdings).set({ quantity: "1234567890.12345678" }).where(eq(holdings.id, zmwHolding));
    const list = (await get("/holdings?currency=ZMW").expect(200)).body.data as { id: string; currentValue: unknown }[];
    expect(list.find(row => row.id === zmwHolding)?.currentValue).toEqual(m("1234567890123456.78", "ZMW"));
    const summary = (await get("/portfolio/summary?currency=ZMW").expect(200)).body.data;
    expect(summary).toMatchObject({
      totalValue: m("1234567890123656.78", "ZMW"), byType: { stock: m("1234567890123656.78", "ZMW") },
      totalIncludingAlternatives: m("1234567890123656.78", "ZMW"),
    });
  });

  it.each(paths)("preserves the no-selector household-currency default through %s", async path => {
    assertValuation(path, (await get(path).expect(200)).body, "ZMW");
    await db.update(households).set({ currency: "USD" }).where(eq(households.id, a));
    assertValuation(path, (await get(path).expect(200)).body, "USD");
    // No new preference/default or unsupported-currency policy is chosen here.
  });
});
