import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { accounts, fxRates, holdings, householdFxRateOverrides, investmentTransactions, securities, taxLotDisposals, taxLots } from "@shared/schema";
import { db } from "../../db";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../core/calculations/currency/fxRates";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";

// NEW-21 / INV-04 remainder: FX attribution reports ZMW from the stored dated
// base, refuses a foreign cost with no ZMW base instead of reporting the native
// figure as ZMW, and shows a member only the holdings they may see (Rule 11).
// Hand values: buy 9 USD shares @ 20.00 = 180.00 USD at 20 = 3600.00 ZMW; now
// @ 25.00 at rate 25 = 225.00 USD = 5625.00 ZMW. Gain 2025.00 = asset 900.00
// ((225 - 180) x 20) + FX 1125.00. Defect 10: each amount is a ZMW MoneyDto
// (decimal string plus currency), never a JSON number.
const securityId = randomUUID(), sharedHolding = randomUUID(), privateHolding = randomUUID();
const unpricedSecurity = randomUUID(), unpricedHolding = randomUUID();
const headers = (req: request.Test, role: Role) => req.set("Cookie", actors.get(role)!.cookie)
  .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);
const get = (path: string, role: Role = "member") => headers(request(app).get(path), role);
const attributionPath = "/api/investments/analytics/fx-attribution";
const zmw = (amount: string) => ({ amount, currency: "ZMW" });

async function rate(effectiveDate: string, validThrough: string, value: string) {
  await db.insert(householdFxRateOverrides).values({ householdId: a, actorUserId: actors.get("owner")!.id,
    fromCurrency: "USD", toCurrency: "ZMW", effectiveDate, validThrough, rate: value });
}
async function clean() {
  await db.delete(taxLotDisposals).where(inArray(taxLotDisposals.householdId, [a, b]));
  await db.delete(taxLots).where(inArray(taxLots.householdId, [a, b]));
  await db.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b]));
  await db.delete(holdings).where(inArray(holdings.householdId, [a, b]));
  await db.delete(securities).where(inArray(securities.id, [securityId, unpricedSecurity]));
  await db.delete(householdFxRateOverrides).where(inArray(householdFxRateOverrides.householdId, [a, b]));
}
async function buyThroughWriter() {
  await headers(request(app).post("/api/investments/transactions"), "member").send({ accountId: ids.sharedAccount,
    holdingId: sharedHolding, securityId, currency: "USD", type: "buy", quantity: "9", price: "20.00", amount: "180.00",
    transactionDate: "2020-01-10" }).expect(201);
}

describe("R13 NEW-21 FX attribution uses the stored ZMW base and the caller's visible holdings", () => {
  beforeAll(async () => {
    await start();
    // The app sets this at startup (server/startup.ts); the test app does not.
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates)));
  }, 30_000);
  beforeEach(async () => {
    await clean(); await reset();
    await db.update(accounts).set({ type: "investment", currency: "USD" }).where(inArray(accounts.id, [ids.sharedAccount, ids.privateAccount]));
    await db.insert(securities).values({ id: securityId, symbol: `FXA_${securityId.slice(0, 8)}`, name: "R13_FX_ATTRIBUTION",
      type: "stock", currency: "USD", currentPrice: "25.00" });
    await db.insert(holdings).values({ id: sharedHolding, householdId: a, accountId: ids.sharedAccount, securityId, quantity: "0", costBasis: "0" });
    await rate("2020-01-01", "2020-01-31", "20");
    await rate("2020-02-01", "2099-12-31", "25");
  });
  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  it("reports the ZMW value, basis, gain and its asset/FX split from the dated purchase base", async () => {
    await buyThroughWriter();
    const response = await get(attributionPath).expect(200);
    expect(response.body).toEqual([{ holdingId: sharedHolding, securityName: "R13_FX_ATTRIBUTION",
      symbol: `FXA_${securityId.slice(0, 8)}`, currency: "USD", currentValue: zmw("5625.00"), costBasis: zmw("3600.00"),
      totalGain: zmw("2025.00"), assetReturn: zmw("900.00"), fxReturn: zmw("1125.00"),
      totalReturnPercent: 56.25, assetReturnPercent: 25, fxReturnPercent: 31.25 }]);
  });

  it("refuses a foreign holding whose cost has no ZMW base as a 422, never reporting 180 USD as 180 ZMW", async () => {
    await db.update(holdings).set({ quantity: "9.00000000", costBasis: "180.00", costBasisZmw: null })
      .where(eq(holdings.id, sharedHolding));
    const response = await get(attributionPath);
    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({ code: "FINANCIAL_DATA_UNAVAILABLE" });
    expect(Array.isArray(response.body)).toBe(false);
  });

  it("refuses with a 422, not a 500, when today's rate for a held currency is missing", async () => {
    // XTS (the ISO test code) has no household or provider rate.
    await db.update(securities).set({ currency: "XTS" }).where(eq(securities.id, securityId));
    await db.update(holdings).set({ quantity: "9.00000000", costBasis: "180.00", costBasisZmw: "3600.00" })
      .where(eq(holdings.id, sharedHolding));
    const response = await get(attributionPath);
    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({ code: "FINANCIAL_DATA_UNAVAILABLE" });
  });

  // A-11: the per-holding read values only the requested holding, so another
  // visible holding with no price cannot fail it. The list still fails closed.
  it("A-11: reports one holding's attribution while another visible holding has no price", async () => {
    await buyThroughWriter();
    await db.insert(securities).values({ id: unpricedSecurity, symbol: `FXU_${unpricedSecurity.slice(0, 8)}`, name: "R13_FX_UNPRICED",
      type: "stock", currency: "USD", currentPrice: null });
    await db.insert(holdings).values({ id: unpricedHolding, householdId: a, accountId: ids.sharedAccount, securityId: unpricedSecurity,
      quantity: "3.00000000", costBasis: "60.00", costBasisZmw: "1200.00" });
    expect((await get(`${attributionPath}/${sharedHolding}`).expect(200)).body).toMatchObject({ holdingId: sharedHolding,
      currentValue: zmw("5625.00"), costBasis: zmw("3600.00"), totalGain: zmw("2025.00"),
      assetReturn: zmw("900.00"), fxReturn: zmw("1125.00") });
    expect((await get(attributionPath)).status).toBe(422);
    const unpriced = await get(`${attributionPath}/${unpricedHolding}`);
    expect(unpriced.status).toBe(422);
    expect(unpriced.body.error).toMatchObject({ code: "FINANCIAL_DATA_UNAVAILABLE" });
  });

  it("never shows a member another member's private holding, in the list or by id", async () => {
    await buyThroughWriter();
    await db.insert(holdings).values({ id: privateHolding, householdId: a, accountId: ids.privateAccount, securityId,
      quantity: "4.00000000", costBasis: "80.00", costBasisZmw: "1600.00" });
    const member = await get(attributionPath, "member").expect(200);
    expect(member.body.map((row: { holdingId: string }) => row.holdingId)).toEqual([sharedHolding]);
    await get(`${attributionPath}/${privateHolding}`, "member").expect(404);
    const owner = await get(attributionPath, "owner").expect(200);
    expect(owner.body.map((row: { holdingId: string }) => row.holdingId).sort()).toEqual([sharedHolding, privateHolding].sort());
    expect((await get(`${attributionPath}/${privateHolding}`, "owner").expect(200)).body)
      .toMatchObject({ currentValue: zmw("2500.00"), costBasis: zmw("1600.00"), totalGain: zmw("900.00") });
  });
});
