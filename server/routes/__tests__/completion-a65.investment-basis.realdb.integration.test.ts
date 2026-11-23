import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fxRates, holdings, householdFxRateOverrides, investmentTransactions, securities, taxLotDisposals, taxLots } from "@shared/schema";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../core/calculations";
import { db } from "../../db";
import { a, actors, app, ids, resetAccountsAndMembership, start, stop } from "../../modules/tags/__tests__/completion-r04.tags.fixture";
import { seedDatedFxRate } from "../../testing/fixtures/dated-fx-rate";

const acquisitionDate = "2020-01-01";
const knownSecurity = randomUUID(), unknownSecurity = randomUUID();
const zmw = (amount: string) => ({ amount, currency: "ZMW" });
const usd = (amount: string) => ({ amount, currency: "USD" });

function signed(path: string, method: "get" | "post" = "get") {
  const actor = actors.get("member")!;
  return request(app)[method](`/api/investments${path}`).set("Cookie", actor.cookie)
    .set("X-Capital-Subject", actor.id).set("X-Capital-Household", a);
}

function opening(securityId: string, fields: { costBasisZmw?: string; acquisitionFxRate?: string; costBasis?: string | null; quantity?: string } = {}) {
  return signed("/holdings", "post").send({
    operationId: randomUUID(), accountId: ids.sharedAccount, securityId, expectedCurrency: "USD",
    costBasis: "10.00", quantity: "5", acquiredDate: acquisitionDate, ...fields,
  });
}

async function holdingList(currency: "ZMW" | "USD" = "ZMW") {
  const response = await signed(`/holdings?currency=${currency}`).expect(200);
  expect(response.body.meta).toMatchObject({ baseCurrency: currency });
  return response.body.data;
}

async function assertPortfolio(expected: object, currency: "ZMW" | "USD" = "ZMW") {
  for (const path of ["/portfolio", "/portfolio/summary"]) {
    const response = await signed(`${path}?currency=${currency}`).expect(200);
    expect(response.body).toMatchObject({ meta: { baseCurrency: currency }, data: expected });
  }
}

async function clean() {
  await db.delete(taxLotDisposals).where(eq(taxLotDisposals.householdId, a));
  await db.delete(taxLots).where(eq(taxLots.householdId, a));
  await db.delete(investmentTransactions).where(eq(investmentTransactions.householdId, a));
  await db.delete(holdings).where(eq(holdings.householdId, a));
  await db.delete(securities).where(inArray(securities.id, [knownSecurity, unknownSecurity]));
  await db.delete(householdFxRateOverrides).where(eq(householdFxRateOverrides.householdId, a));
}

describe("A-65 signed holdings and portfolio acquisition basis", () => {
  beforeAll(async () => {
    await start();
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates),
      { cacheTtlSeconds: 300, baseCurrency: "USD", fallbackDays: 30 }));
  }, 30_000);

  beforeEach(async () => {
    await resetAccountsAndMembership();
    await db.insert(securities).values([knownSecurity, unknownSecurity].map((id) => ({
      id, symbol: "A65" + id.slice(0, 8), name: "Synthetic USD position", type: "stock" as const, currency: "USD", currentPrice: "3",
    })));
    const actorUserId = actors.get("owner")!.id;
    await seedDatedFxRate(a, actorUserId, "20", { effectiveDate: acquisitionDate, validThrough: acquisitionDate });
    await seedDatedFxRate(a, actorUserId, "25", { effectiveDate: "2025-01-01", validThrough: "2099-12-31" });
  });

  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  it.each([[null, null], ["20", null], ["20", acquisitionDate]] as const)(
    "withholds the ZMW basis of a legacy holding without verified acquisition (%s on %s)", async (acquisitionFxRate, acquiredDate) => {
    const [legacy] = await db.insert(holdings).values({
      householdId: a, accountId: ids.sharedAccount, securityId: unknownSecurity,
      quantity: "5", costBasis: "10.00", costBasisZmw: null, acquiredDate, acquisitionFxRate,
    }).returning();
    if (acquiredDate) {
      // Older stored purchases and lots could repeat a declared rate without a dated verification audit.
      const [purchase] = await db.insert(investmentTransactions).values({ householdId: a, accountId: ids.sharedAccount,
        holdingId: legacy.id, securityId: unknownSecurity, type: "buy", quantity: "5", amount: "10.00", currency: "USD",
        fxRate: acquisitionFxRate, transactionDate: acquiredDate }).returning();
      await db.insert(taxLots).values({ householdId: a, holdingId: legacy.id, transactionId: purchase.id,
        quantity: "5", remainingQuantity: "5", costBasis: "10.00", acquisitionFxRate, acquiredDate });
    }
    expect(await holdingList()).toEqual([expect.objectContaining({
      id: legacy.id, costBasis: "10.00", security: expect.objectContaining({ currency: "USD" }),
      currentValue: zmw("375.00"), fxRateUsed: 25, costBasisBase: null, gainLoss: null, gainLossPercent: null,
    })]);
    await assertPortfolio({ totalValue: zmw("375.00"), byType: { stock: zmw("375.00") }, holdingsCount: 1,
      totalCostBasis: null, totalGainLoss: null, totalGainLossPercent: null });

    expect(await holdingList("USD")).toEqual([expect.objectContaining({
      id: legacy.id, costBasisBase: usd("10.00"), currentValue: usd("15.00"), gainLoss: usd("5.00"), fxRateUsed: 1,
    })]);
    await assertPortfolio({ totalValue: usd("15.00"), totalCostBasis: usd("10.00"), totalGainLoss: usd("5.00"), totalGainLossPercent: 50 }, "USD");
  });

  it("keeps verified stored ZMW cost fixed when the current rate changes", async () => {
    const opened = (await opening(knownSecurity, { costBasisZmw: "200.00", acquisitionFxRate: "20" }).expect(201)).body.data;
    expect(opened).toMatchObject({ acquiredDate: acquisitionDate, costBasis: "10.00", costBasisZmw: "200.00", acquisitionFxRate: "20.00000000" });
    expect(await holdingList()).toEqual([expect.objectContaining({
      id: opened.id, costBasisBase: zmw("200.00"), currentValue: zmw("375.00"), gainLoss: zmw("175.00"), fxRateUsed: 25,
    })]);
    await assertPortfolio({ totalValue: zmw("375.00"), totalCostBasis: zmw("200.00"), totalGainLoss: zmw("175.00"), totalGainLossPercent: 87.5 });

    // Recorded quotes are immutable. A newer eligible row changes the current rate.
    await seedDatedFxRate(a, actors.get("owner")!.id, "30", { effectiveDate: new Date().toISOString().slice(0, 10) });
    expect(await holdingList()).toEqual([expect.objectContaining({
      id: opened.id, costBasisBase: zmw("200.00"), currentValue: zmw("450.00"), gainLoss: zmw("250.00"), fxRateUsed: 30,
    })]);
    await assertPortfolio({ totalValue: zmw("450.00"), totalCostBasis: zmw("200.00"), totalGainLoss: zmw("250.00"), totalGainLossPercent: 125 });
  });

  it("keeps a new undeclared basis unknown beside a new verified acquisition rate", async () => {
    await opening(knownSecurity, { acquisitionFxRate: "19" }).expect(400);
    const known = (await opening(knownSecurity, { acquisitionFxRate: "20" }).expect(201)).body.data;
    const unknown = (await opening(unknownSecurity).expect(201)).body.data;
    expect(known).toMatchObject({ costBasisZmw: null, acquisitionFxRate: "20.00000000", acquiredDate: acquisitionDate });
    expect(unknown).toMatchObject({ costBasisZmw: null, acquisitionFxRate: null, acquiredDate: acquisitionDate });
    expect(await holdingList()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: known.id, costBasisBase: zmw("200.00"), currentValue: zmw("375.00"), gainLoss: zmw("175.00") }),
      expect.objectContaining({ id: unknown.id, costBasis: "10.00", currentValue: zmw("375.00"), costBasisBase: null, gainLoss: null, gainLossPercent: null }),
    ]));
    await assertPortfolio({ totalValue: zmw("750.00"), byType: { stock: zmw("750.00") }, totalIncludingAlternatives: zmw("750.00"),
      totalCostBasis: null, totalGainLoss: null, totalGainLossPercent: null, holdingsCount: 2 });
  });

  it("preserves a recorded legacy ZMW basis with no stored rate", async () => {
    const [legacy] = await db.insert(holdings).values({
      householdId: a, accountId: ids.sharedAccount, securityId: knownSecurity,
      quantity: "5", costBasis: "10.00", costBasisZmw: "200.00", acquiredDate: acquisitionDate, acquisitionFxRate: null,
    }).returning();
    expect(await holdingList()).toEqual([expect.objectContaining({
      id: legacy.id, costBasis: "10.00", costBasisBase: zmw("200.00"), currentValue: zmw("375.00"), gainLoss: zmw("175.00"), fxRateUsed: 25,
    })]);
    await assertPortfolio({ totalValue: zmw("375.00"), totalCostBasis: zmw("200.00"), totalGainLoss: zmw("175.00"), totalGainLossPercent: 87.5 });
  });

  it("keeps the ZMW basis unknown when a signed partial sale leaves positive shares with rounded native zero", async () => {
    const opened = (await opening(unknownSecurity, { quantity: "2", costBasis: "0.01" }).expect(201)).body.data;
    await signed("/transactions", "post").send({
      accountId: ids.sharedAccount, securityId: unknownSecurity, holdingId: opened.id, type: "sell", quantity: "1",
      price: "1", amount: "1.00", currency: "USD", transactionDate: acquisitionDate,
    }).expect(201);
    expect(await holdingList()).toEqual([expect.objectContaining({ id: opened.id, quantity: "1.00000000",
      costBasis: "0.00", costBasisZmw: null, currentValue: zmw("75.00"), costBasisBase: null, gainLoss: null, gainLossPercent: null })]);
    await assertPortfolio({ totalValue: zmw("75.00"), totalCostBasis: null, totalGainLoss: null, totalGainLossPercent: null });
  });

  it("keeps known portfolio returns when another signed opening is an empty shell", async () => {
    await opening(knownSecurity, { costBasisZmw: "200.00", acquisitionFxRate: "20" }).expect(201);
    const shell = (await opening(unknownSecurity, { quantity: "0", costBasis: null }).expect(201)).body.data;
    expect(await holdingList()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: shell.id, quantity: "0.00000000", costBasis: null, costBasisBase: zmw("0.00"), currentValue: zmw("0.00") }),
    ]));
    await assertPortfolio({ totalValue: zmw("375.00"), totalCostBasis: zmw("200.00"), totalGainLoss: zmw("175.00"),
      totalGainLossPercent: 87.5, holdingsCount: 2 });
  });
});
