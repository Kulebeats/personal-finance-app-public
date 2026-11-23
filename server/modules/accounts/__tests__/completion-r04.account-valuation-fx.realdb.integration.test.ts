import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { accounts, fxRates, grzTBills, holdings, households, pensionHoldings, providerFxQuotes, securities } from "@shared/schema";
import { db } from "../../../db";
import { portfolioValuationService } from "../../../services/PortfolioValuationService";
import { accountService } from "../accounts.service";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../../core/calculations/currency/fxRates";
import { a, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

// Requires the independently reviewed 0017 provider observation dependency.
// The date is outside other fixtures; observations are inserted only as synthetic
// trusted-store inputs, never represented as real provider/network evidence.
const date = "1988-03-03", instant = new Date(`${date}T12:00:00Z`);
const securityId = randomUUID(), sourceId = randomUUID(), legacyId = randomUUID();
const quoteIds: string[] = [];
type Kind = "cash" | "holding" | "T-bill" | "pension";
const kinds: Kind[] = ["cash", "holding", "T-bill", "pension"];
function basis(kind: Kind) { return kind === "cash" || kind === "holding" ? { from: "USD", base: "ZMW" } : { from: "ZMW", base: "USD" }; }
async function clean() {
  await db.delete(grzTBills).where(eq(grzTBills.id, sourceId));
  await db.delete(pensionHoldings).where(eq(pensionHoldings.id, sourceId));
  await db.delete(holdings).where(eq(holdings.id, sourceId));
  await db.delete(securities).where(eq(securities.id, securityId));
  await db.delete(fxRates).where(eq(fxRates.id, legacyId));
  if (quoteIds.length) await db.delete(providerFxQuotes).where(inArray(providerFxQuotes.id, quoteIds.splice(0)));
}
async function prepare(kind: Kind) {
  const { from, base } = basis(kind);
  await db.update(households).set({ currency: base }).where(eq(households.id, a));
  await db.update(accounts).set({ balance: "0.00", currency: base }).where(eq(accounts.householdId, a));
  if (kind === "cash") await db.update(accounts).set({ balance: "100.00", currency: from }).where(eq(accounts.id, ids.sharedAccount));
  if (kind === "holding") {
    await db.insert(securities).values({ id: securityId, symbol: "R04DATEDFX", name: "Dated FX proof", type: "stock", currency: from, currentPrice: "1.00" });
    await db.insert(holdings).values({ id: sourceId, householdId: a, accountId: ids.sharedAccount, securityId, quantity: "100", costBasis: "0" });
  }
  if (kind === "T-bill") await db.insert(grzTBills).values({ id: sourceId, householdId: a, accountId: ids.sharedAccount,
    tbillName: "Dated FX bill", faceValue: "100", purchasePrice: "100", purchaseDate: "1988-01-01", maturityDate: "1988-05-01", tenorDays: 121 });
  if (kind === "pension") await db.insert(pensionHoldings).values({ id: sourceId, householdId: a, accountId: ids.sharedAccount,
    providerName: "Dated FX pension", pensionType: "private", currentBalance: "100" });
  // A future legacy row with a provider-shaped user string is never attestation.
  await db.insert(fxRates).values({ id: legacyId, fromCurrency: from, toCurrency: base, date: "2099-01-01", rate: "9", source: "yahoo_finance" });
}
async function quote(kind: Kind, rate = "2", effectiveDate = date, quotedAt = new Date(`${effectiveDate}T10:00:00Z`), validThrough = effectiveDate) {
  const id = randomUUID(); quoteIds.push(id);
  const { from, base } = basis(kind);
  await db.insert(providerFxQuotes).values({ id, fromCurrency: from, toCurrency: base,
    provider: "yahoo_finance", effectiveDate, quotedAt, validThrough, rate });
}
function summary() { return request(app).get("/api/accounts/summary").set("Cookie", actors.get("member")!.cookie); }

describe("R04 current account wealth uses a trusted same-day as-of quote", () => {
  beforeAll(async () => { await start(); setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates))); }, 20_000);
  beforeEach(async () => {
    await clean(); await reset();
    const actual = accountService.getNetWorthSummary.bind(accountService);
    // Exercise the real signed route and service. Scope the historical valuation
    // clock to that call: session load/touch/save must use the real wall clock.
    vi.spyOn(accountService, "getNetWorthSummary").mockImplementation(async (...args) => {
      vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(instant);
      try { return await actual(...args); } finally { vi.useRealTimers(); }
    });
  });
  afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); await clean(); });
  afterAll(async () => { await clean(); await stop(); });

  it.each(kinds)("values visible %s with a same-day trusted quote rather than a future legacy label", async kind => {
    await prepare(kind); await quote(kind);
    const response = await summary().expect(200);
    expect(response.body.data).toMatchObject({ totalAssets: 200, netWorth: 200, currency: basis(kind).base });
  });
  it.each(kinds)("declines unproven legacy FX for visible %s", async kind => {
    await prepare(kind);
    const response = await summary().expect(422);
    expect(response.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
  });
  it.each(kinds)("does not carry an older flow quote into %s balance valuation", async kind => {
    await prepare(kind); await quote(kind, "2", "1988-03-02", new Date("1988-03-02T10:00:00Z"), "1988-03-05");
    const response = await summary().expect(422);
    expect(response.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
  });
  it.each(kinds)("excludes a future-effective observation from %s", async kind => {
    await prepare(kind); await quote(kind, "2", "1988-03-04");
    const response = await summary().expect(422);
    expect(response.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
  });
  it.each(kinds)("excludes a same-day observation made after the %s valuation instant", async kind => {
    await prepare(kind); await quote(kind, "2", date, new Date(`${date}T13:00:00Z`));
    const response = await summary().expect(422);
    expect(response.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
  });
  it.each(kinds)("rebuilds %s when the selected provider observation changes before publication", async kind => {
    await prepare(kind); await quote(kind);
    const original = portfolioValuationService.getHouseholdInvestmentValue.bind(portfolioValuationService);
    let changed = false;
    vi.spyOn(portfolioValuationService, "getHouseholdInvestmentValue").mockImplementation(async (...args) => {
      const result = await original(...args);
      if (!changed) { changed = true; await quote(kind, "3", date, new Date(`${date}T11:00:00Z`)); }
      return result;
    });
    const response = await summary().expect(200);
    expect(changed).toBe(true);
    expect(response.body.data).toMatchObject({ totalAssets: 300, netWorth: 300 });
  });
  it("does not let an inaccessible foreign-currency source change visible status or total", async () => {
    await db.update(households).set({ currency: "ZMW" }).where(eq(households.id, a));
    await db.update(accounts).set({ balance: "0.00", currency: "ZMW" }).where(eq(accounts.householdId, a));
    await db.update(accounts).set({ balance: "100.00", currency: "ZMW" }).where(eq(accounts.id, ids.sharedAccount));
    const before = await summary().expect(200);
    await db.update(accounts).set({ balance: "99999.00", currency: "USD" }).where(eq(accounts.id, ids.privateAccount));
    const after = await summary().expect(200);
    expect(after.body.data).toEqual(before.body.data);
    expect(after.body.data.netWorth).toBe(100);
  });
});
