import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { accounts, auditLogs, fxRates, holdings, investmentTransactions, securities, taxLotDisposals, taxLots, householdFxRateOverrides } from "@shared/schema";
import { db, pool } from "../../db";
import { roundMoney } from "../../core/money";
const zmw = (value: number | string) => ({ amount: roundMoney(value), currency: "ZMW" });
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../core/calculations";
import { a, actors, app, ids, reset, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";
import { seedDatedFxRate } from "../../testing/fixtures/dated-fx-rate";

const securityId = randomUUID(), holdingId = randomUUID();
let currency = "ZMW";
function trade(type: "buy" | "sell", quantity: string, price: string, amount: string, date: string,
  extra: { amountZmw?: string; fxRate?: string; fees?: string } = {}, role: Role = "member") {
  return request(app).post("/api/investments/transactions").set("Cookie", actors.get(role)!.cookie)
    .send({ accountId: ids.sharedAccount, securityId, holdingId, type, quantity, price, amount, currency, transactionDate: date, ...extra });
}
async function clear() {
  await db.delete(taxLotDisposals).where(eq(taxLotDisposals.holdingId, holdingId));
  await db.delete(taxLots).where(eq(taxLots.holdingId, holdingId));
  await db.delete(investmentTransactions).where(eq(investmentTransactions.holdingId, holdingId));
  await db.delete(holdings).where(eq(holdings.id, holdingId));
  await db.delete(securities).where(eq(securities.id, securityId));
  await db.delete(householdFxRateOverrides).where(eq(householdFxRateOverrides.householdId, a));
}
async function stored() { return (await db.select().from(holdings).where(eq(holdings.id, holdingId)))[0]; }
async function effects() {
  return {
    holding: await stored(),
    lots: await db.select().from(taxLots).where(eq(taxLots.holdingId, holdingId)).orderBy(taxLots.id),
    sales: await db.select().from(taxLotDisposals).where(eq(taxLotDisposals.holdingId, holdingId)).orderBy(taxLotDisposals.id),
    activity: await db.select().from(investmentTransactions).where(eq(investmentTransactions.holdingId, holdingId)).orderBy(investmentTransactions.id),
    accounts: await db.select().from(accounts).where(eq(accounts.householdId, a)).orderBy(accounts.id),
    audit: await db.select().from(auditLogs).where(inArray(auditLogs.userId, Array.from(actors.values()).map(row => row.id))).orderBy(auditLogs.id),
  };
}
const get = (path: string, role: Role = "member") => request(app).get(`/api/investments${path}`).set("Cookie", actors.get(role)!.cookie);

describe("FIN-10 manual trades keep persisted and ordinary portfolio remaining basis coherent", () => {
  beforeAll(async () => {
    await start();
    // getTestApp registers routes without application startup. Match the
    // production database-backed FX initialization for actual portfolio reads.
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates),
      { cacheTtlSeconds: 5 * 60, baseCurrency: "USD", fallbackDays: 30 }));
  }, 30_000);
  beforeEach(async () => {
    await reset(); currency = "ZMW";
    // The dated rates this suite's foreign trades already claim.
    await seedDatedFxRate(a, actors.get("owner")!.id, "20", { validThrough: "2031-01-01" });
    await seedDatedFxRate(a, actors.get("owner")!.id, "25", { effectiveDate: "2031-01-02", validThrough: "2031-01-31" });
    await seedDatedFxRate(a, actors.get("owner")!.id, "30", { effectiveDate: "2031-02-01" });
    await db.insert(securities).values({ id: securityId, symbol: "SYN_BASIS", name: "Synthetic remaining-basis security", type: "stock", currency, currentPrice: "10.00" });
    await db.insert(holdings).values({ id: holdingId, householdId: a, accountId: ids.sharedAccount, securityId, quantity: "0", costBasis: "0" });
  });
  afterEach(clear);
  afterAll(stop);

  it("has no invented gain after two equal-price signed buys, including portfolio read-back", async () => {
    for (const date of ["2031-01-01", "2031-01-02"]) await trade("buy", "10", "10", "100", date).expect(201);
    expect(await stored()).toMatchObject({ quantity: "20.00000000", costBasis: "200.00" });
    const listed = await get("/holdings?currency=ZMW").expect(200);
    expect(listed.body.data).toEqual([expect.objectContaining({ id: holdingId, currentValue: zmw(200), costBasis: "200.00",
      costBasisBase: zmw(200), gainLoss: zmw(0), gainLossPercent: 0 })]);
    const portfolio = await get("/portfolio?currency=ZMW").expect(200);
    expect(portfolio.body.data).toMatchObject({ totalValue: zmw(200), totalCostBasis: zmw(200), totalGainLoss: zmw(0), totalGainLossPercent: 0 });
  });
  it("subtracts actual FIFO acquisition cost rather than sale proceeds or average basis", async () => {
    await trade("buy", "5", "10", "50", "2031-01-01").expect(201);
    await trade("buy", "5", "12", "60", "2031-01-02").expect(201);
    const sale = await trade("sell", "8", "20", "160", "2031-02-01").expect(201);
    const result = (await pool.query("select sum(cost_basis)::text as basis,sum(proceeds)::text as proceeds from tax_lot_disposals where transaction_id=$1", [sale.body.data.id])).rows[0];
    expect(result).toEqual({ basis: "86.00", proceeds: "160.00" });
    expect(await stored()).toMatchObject({ quantity: "2.00000000", costBasis: "24.00" });
    await db.update(securities).set({ currentPrice: "12" }).where(eq(securities.id, securityId));
    const portfolio = await get("/portfolio?currency=ZMW").expect(200);
    expect(portfolio.body.data).toMatchObject({ totalValue: zmw(24), totalCostBasis: zmw(24), totalGainLoss: zmw(0) });
  });
  it("keeps the booked cent residual through repeated partial sales and closes at zero", async () => {
    await trade("buy", "3", "0.3333", "1", "2031-01-01").expect(201);
    for (const [date, basis, quantity] of [["2031-02-01", "0.67", "2.00000000"], ["2031-02-02", "0.33", "1.00000000"], ["2031-02-03", "0.00", "0.00000000"]]) {
      await trade("sell", "1", "1", "1", date).expect(201);
      expect(await stored()).toMatchObject({ quantity, costBasis: basis });
    }
  });
  it("retains acquisition fees in remaining basis without deducting sale fees twice", async () => {
    await trade("buy", "10", "10", "101", "2031-01-01", { fees: "1" }).expect(201);
    await trade("sell", "2", "12", "23.50", "2031-02-01", { fees: "0.50" }).expect(201);
    expect(await stored()).toMatchObject({ quantity: "8.00000000", costBasis: "80.80" });
  });
  it("reconstructs the known stale aggregate only when actual lot history accounts for the full position", async () => {
    await trade("buy", "10", "10", "100", "2031-01-01").expect(201);
    await trade("buy", "5", "12", "60", "2031-01-02").expect(201);
    // The historical FIN-10 writer persisted quantity/lot provenance but left
    // the opening aggregate at zero. Do not invent or replace either purchase.
    await db.update(holdings).set({ costBasis: "0", costBasisZmw: "0" }).where(eq(holdings.id, holdingId));
    await trade("buy", "1", "5", "5", "2031-01-03").expect(201);
    expect(await stored()).toMatchObject({ quantity: "16.00000000", costBasis: "165.00" });
    expect(await db.select().from(taxLots).where(eq(taxLots.holdingId, holdingId))).toHaveLength(3);
  });
  it("rolls back an unproven legacy opening instead of treating its omitted basis as zero", async () => {
    await db.update(holdings).set({ quantity: "5", costBasis: null }).where(eq(holdings.id, holdingId));
    const before = await effects();
    const denied = await trade("buy", "1", "10", "10", "2031-01-01").expect(409);
    expect(denied.text).not.toContain(holdingId); expect(await effects()).toEqual(before);
  });
  it("rolls back conflicting authoritative purchase denomination without exposing its identity", async () => {
    const buy = await trade("buy", "1", "10", "10", "2031-01-01").expect(201);
    await db.update(investmentTransactions).set({ currency: "USD" }).where(eq(investmentTransactions.id, buy.body.data.id));
    const before = await effects();
    const denied = await trade("buy", "1", "10", "10", "2031-01-02").expect(409);
    expect(denied.text).not.toContain(buy.body.data.id); expect(await effects()).toEqual(before);
  });
  it.each(["equation", "zero native"])("rejects persisted matching purchase/lot rows with contradictory foreign %s without changing any effects", async problem => {
    currency = "USD"; await db.update(securities).set({ currency }).where(eq(securities.id, securityId));
    const buy = await trade("buy", "1", "10", "10", "2031-01-01", { amountZmw: "200", fxRate: "20" }).expect(201);
    const native = problem === "zero native" ? "0" : "10", base = problem === "zero native" ? "100" : "9999";
    const rate = problem === "zero native" ? null : "20";
    await db.update(investmentTransactions).set({ amount: native, amountZmw: base, fxRate: rate }).where(eq(investmentTransactions.id, buy.body.data.id));
    await db.update(taxLots).set({ costBasis: native, costBasisZmw: base, acquisitionFxRate: rate }).where(eq(taxLots.transactionId, buy.body.data.id));
    const before = await effects();
    const response = await trade("buy", "1", "10", "10", "2031-01-02", { amountZmw: "250", fxRate: "25" }).expect(409);
    for (const secret of [buy.body.data.id, holdingId, base]) expect(response.text).not.toContain(secret);
    expect(await effects()).toEqual(before);
  });
  it("uses dated acquisition/disposal base cost rather than the foreign sale settlement rate", async () => {
    currency = "USD"; await db.update(securities).set({ currency }).where(eq(securities.id, securityId));
    await trade("buy", "1", "10", "10", "2031-01-01", { amountZmw: "200", fxRate: "20" }).expect(201);
    await trade("buy", "1", "10", "10", "2031-01-02", { amountZmw: "250", fxRate: "25" }).expect(201);
    await trade("sell", "1", "15", "15", "2031-02-01", { amountZmw: "450", fxRate: "30" }).expect(201);
    expect(await stored()).toMatchObject({ quantity: "1.00000000", costBasis: "10.00", costBasisZmw: "250.00", acquisitionFxRate: null });
    const portfolio = await get("/portfolio?currency=USD").expect(200);
    const usd = (amount: string) => ({ amount, currency: "USD" });
    expect(portfolio.body.data).toMatchObject({ totalValue: usd("10.00"), totalCostBasis: usd("10.00"), totalGainLoss: usd("0.00") });
  });
  it("keeps a missing foreign base component unknown across a later fully evidenced purchase", async () => {
    currency = "USD"; await db.update(securities).set({ currency }).where(eq(securities.id, securityId));
    // NEW-21: a new foreign buy always gets its dated base, so the unknown-base
    // component is a legacy row (as the old writer stored it), inserted directly.
    const [legacy] = await db.insert(investmentTransactions).values({ householdId: a, accountId: ids.sharedAccount, holdingId, securityId,
      type: "buy", quantity: "1", price: "10", amount: "10.00", currency, amountZmw: null, fxRate: null, transactionDate: "2031-01-01" }).returning();
    await db.insert(taxLots).values({ householdId: a, holdingId, transactionId: legacy.id, quantity: "1", remainingQuantity: "1",
      costBasis: "10.00", costBasisZmw: null, acquiredDate: "2031-01-01", acquisitionFxRate: null });
    await db.update(holdings).set({ quantity: "1", costBasis: "10.00" }).where(eq(holdings.id, holdingId));
    await trade("buy", "1", "10", "10", "2031-01-02", { amountZmw: "250", fxRate: "25" }).expect(201);
    expect(await stored()).toMatchObject({ quantity: "2.00000000", costBasis: "20.00", costBasisZmw: null, acquisitionFxRate: null });
  });
  it("serializes concurrent signed purchases without losing either quantity or basis", async () => {
    const results = await Promise.all([trade("buy", "5", "10", "50", "2031-01-01"), trade("buy", "5", "10", "50", "2031-01-02")]);
    expect(results.map(row => row.status)).toEqual([201, 201]);
    expect(await stored()).toMatchObject({ quantity: "10.00000000", costBasis: "100.00" });
  });
  it("preserves the actual owner's accepted sale against independently private acquisition cash", async () => {
    const bought = await trade("buy", "2", "50", "100", "2031-01-01", {}, "owner").expect(201);
    const receipt = await request(app).post("/api/transactions").set("Cookie", actors.get("owner")!.cookie).send({
      accountId: ids.sharedAccount, name: "Private acquisition evidence", type: "expense", date: "2031-01-01", isPrivate: true,
      amount: { amount: "100.00", currency: "ZMW" }, idempotencyKey: randomUUID(),
    }).expect(201);
    await db.update(investmentTransactions).set({ linkedTransactionId: receipt.body.data.id }).where(eq(investmentTransactions.id, bought.body.data.id));
    await trade("sell", "1", "60", "60", "2031-02-01", {}, "owner").expect(201);
    expect(await stored()).toMatchObject({ quantity: "1.00000000", costBasis: "50.00" });
    // Peer basis/gain egress is a separately coordinated reader dependency;
    // this test preserves the authorized writer without claiming its closure.
  });
  it("preserves a peer's buy with private prior cash without returning reconstructed basis", async () => {
    const bought = await trade("buy", "2", "50", "100", "2031-01-01", {}, "owner").expect(201);
    const receipt = await request(app).post("/api/transactions").set("Cookie", actors.get("owner")!.cookie).send({
      accountId: ids.sharedAccount, name: "Private acquisition evidence", type: "expense", date: "2031-01-01", isPrivate: true,
      amount: { amount: "100.00", currency: "ZMW" }, idempotencyKey: randomUUID(),
    }).expect(201);
    await db.update(investmentTransactions).set({ linkedTransactionId: receipt.body.data.id }).where(eq(investmentTransactions.id, bought.body.data.id));
    const created = await trade("buy", "1", "60", "60", "2031-01-02").expect(201);
    expect(created.body.data).not.toHaveProperty("costBasis");
    expect(created.body.data).not.toHaveProperty("costBasisZmw");
    expect(await stored()).toMatchObject({ quantity: "3.00000000", costBasis: "160.00" });
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, created.body.data.id));
    expect(audit).toBeDefined();
    expect(audit.details).toMatchObject({ newValue: { type: "buy", amount: "60.00", currency: "ZMW" } });
    expect(audit.details).not.toHaveProperty("newValue.costBasis");
    expect(audit.details).not.toHaveProperty("newValue.costBasisZmw");
  });
});
