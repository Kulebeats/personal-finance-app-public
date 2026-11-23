import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  accounts, auditLogs, fxRates, holdings, householdFxRateOverrides, investmentTransactions, securities, taxLotDisposals, taxLots,
} from "@shared/schema";
import { db } from "../../db";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";

// NEW-21: a foreign-currency investment event stores and reports its ZMW
// amount from the dated rate for that event's date. The hand values are the
// 2026-10-13 Fable fixture (USD buy 4 @ 205, sell 4 @ 250) on dated rates.
const year = 2031, securityId = randomUUID(), holdingId = randomUUID(), marker = "R13_ZMW_FX";
const headers = (req: request.Test, role: Role) => req.set("Cookie", actors.get(role)!.cookie)
  .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);
const get = (path: string, role: Role = "member") => headers(request(app).get(path), role);
const summaryPath = `/api/investments/tax/summary?year=${year}`;
const exportPath = `/api/investments/tax/zra-export?year=${year}&format=json`;
function record(body: Record<string, unknown>, role: Role = "member") {
  return headers(request(app).post("/api/investments/transactions"), role)
    .send({ accountId: ids.sharedAccount, holdingId, securityId, currency: "USD", ...body });
}
const buy = (body: Record<string, unknown> = {}) =>
  record({ type: "buy", quantity: "4", price: "205.00", amount: "820.00", transactionDate: `${year}-01-10`, ...body });
const sell = (body: Record<string, unknown> = {}) =>
  record({ type: "sell", quantity: "4", price: "250.00", amount: "1000.00", transactionDate: `${year}-02-10`, ...body });
async function rate(householdId: string, from: string, effectiveDate: string, validThrough: string, value: string) {
  await db.insert(householdFxRateOverrides).values({ householdId, actorUserId: actors.get("owner")!.id,
    fromCurrency: from, toCurrency: "ZMW", effectiveDate, validThrough, rate: value });
}
async function clean() {
  await db.delete(taxLotDisposals).where(inArray(taxLotDisposals.householdId, [a, b]));
  await db.delete(taxLots).where(inArray(taxLots.householdId, [a, b]));
  await db.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b]));
  await db.delete(holdings).where(inArray(holdings.householdId, [a, b]));
  await db.delete(securities).where(eq(securities.id, securityId));
  await db.delete(householdFxRateOverrides).where(inArray(householdFxRateOverrides.householdId, [a, b]));
  await db.delete(fxRates).where(eq(fxRates.fromCurrency, "XTS"));
}
async function useCurrency(currency: string) {
  await db.update(accounts).set({ currency }).where(eq(accounts.id, ids.sharedAccount));
  await db.update(securities).set({ currency }).where(eq(securities.id, securityId));
}
const stored = async (id: string) => (await db.select().from(investmentTransactions).where(eq(investmentTransactions.id, id)))[0];

describe("R13.1 NEW-21 foreign investment events convert with the dated rate", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clean(); await reset();
    await db.update(accounts).set({ type: "investment" }).where(eq(accounts.id, ids.sharedAccount));
    await db.insert(securities).values({ id: securityId, symbol: `ZFX_${securityId.slice(0, 8)}`, name: marker, type: "stock", currency: "USD" });
    await db.insert(holdings).values({ id: holdingId, householdId: a, accountId: ids.sharedAccount, securityId, quantity: "0", costBasis: "0" });
    await useCurrency("USD");
    // January, February and a later March rate the events must not pick up.
    await rate(a, "USD", `${year}-01-01`, `${year}-01-31`, "26.5");
    await rate(a, "USD", `${year}-02-01`, `${year}-02-28`, "27.0");
    await rate(a, "USD", `${year}-03-01`, `${year}-03-31`, "99.0");
  });
  afterEach(clean);
  afterAll(async () => { await clean(); await useCurrency("ZMW"); await stop(); });

  it("stores the event date's rate and ZMW amount on a USD buy, its lot and its audit row", async () => {
    const created = await buy().expect(201);
    expect(await stored(created.body.data.id)).toMatchObject({ currency: "USD", amount: "820.00", fxRate: "26.50000000", amountZmw: "21730.00" });
    const [lot] = await db.select().from(taxLots).where(eq(taxLots.householdId, a));
    expect(lot).toMatchObject({ costBasis: "820.00", costBasisZmw: "21730.00", acquisitionFxRate: "26.50000000" });
    const [original] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "investment_transaction"),
      eq(auditLogs.entityId, created.body.data.id), eq(auditLogs.action, "CREATE")));
    expect(original.details).toMatchObject({ fxRateBasis: "dated_household_then_provider_fx_v1",
      newValue: { currency: "USD", amount: "820.00", fxRate: "26.50000000", amountZmw: "21730.00", transactionDate: `${year}-01-10` } });
  });

  it("reports the USD 180 gain as ZMW proceeds less ZMW basis at their own dated rates, never as 180.00", async () => {
    await buy().expect(201);
    const sale = await sell().expect(201);
    expect(await stored(sale.body.data.id)).toMatchObject({ fxRate: "27.00000000", amountZmw: "27000.00" });
    const [gain] = await db.select().from(taxLotDisposals).where(eq(taxLotDisposals.householdId, a));
    expect(gain).toMatchObject({ realizedGain: "180.00", proceedsZmw: "27000.00", costBasisZmw: "21730.00", realizedGainZmw: "5270.00" });
    const summary = await get(summaryPath).expect(200);
    expect(summary.body).toMatchObject({ realizedGains: "5270.00", grossIncome: "5270.00", netIncome: "5270.00", currency: "ZMW" });
  });

  it("reports the hand value 4770.00 when both legs fall on one dated rate", async () => {
    await buy({ transactionDate: `${year}-01-10` }).expect(201);
    await sell({ transactionDate: `${year}-01-20` }).expect(201);
    expect((await get(summaryPath).expect(200)).body.realizedGains).toBe("4770.00");
  });

  it("converts foreign dividend net and withholding in the summary and the ZRA export", async () => {
    const created = await record({ type: "dividend", amount: "34.00", withholdingTax: "6.00", transactionDate: `${year}-02-10` }).expect(201);
    expect(await stored(created.body.data.id)).toMatchObject({ fxRate: "27.00000000", amountZmw: "918.00", withholdingTax: "6.00" });
    expect((await get(summaryPath).expect(200)).body).toMatchObject({
      dividendIncome: "1080.00", totalWht: "162.00", grossIncome: "1080.00", netIncome: "918.00", currency: "ZMW" });
    expect((await get(exportPath).expect(200)).body).toEqual([expect.objectContaining({
      type: "dividend", security: marker, grossAmount: "1080.00", whtPaid: "162.00", netAmount: "918.00" })]);
  });

  it("uses the shared provider rate dated on or before the event when the household has none", async () => {
    await useCurrency("XTS");
    await db.insert(fxRates).values([
      { id: randomUUID(), fromCurrency: "XTS", toCurrency: "ZMW", rate: "3.2500", date: `${year}-01-05`, source: "provider" },
      { id: randomUUID(), fromCurrency: "XTS", toCurrency: "ZMW", rate: "9.0000", date: `${year}-01-11`, source: "provider" },
    ]);
    const created = await buy({ currency: "XTS" }).expect(201);
    expect(await stored(created.body.data.id)).toMatchObject({ currency: "XTS", fxRate: "3.25000000", amountZmw: "2665.00" });
  });

  it("refuses a foreign event with no dated rate as a 422 naming the pair, and stores nothing", async () => {
    const response = await buy({ transactionDate: `${year - 1}-06-01` });
    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({ code: "MISSING_FX_RATE", details: { from: "USD", to: "ZMW", date: `${year - 1}-06-01` },
      message: `No exchange rate is available for USD to ZMW on ${year - 1}-06-01. An owner or admin can record one.` });
    // The body names only the pair and the date: nothing about the holding, account or amount.
    const body = JSON.stringify(response.body);
    for (const secret of [marker, securityId, holdingId, ids.sharedAccount, "820"]) expect(body).not.toContain(secret);
    expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a))).toEqual([]);
    expect(await db.select().from(taxLots).where(eq(taxLots.householdId, a))).toEqual([]);
  });

  it("never converts with another household's rate", async () => {
    await rate(b, "USD", `${year - 1}-06-01`, `${year - 1}-06-30`, "20.0");
    expect((await buy({ transactionDate: `${year - 1}-06-15` })).status).toBe(422);
  });

  it("refuses a caller conversion that disagrees with the dated rate, and accepts one that matches", async () => {
    expect((await buy({ fxRate: "20.0000", amountZmw: "16400.00" })).status).toBe(400);
    expect((await buy({ fxRate: "26.5000", amountZmw: "21730.00" })).status).toBe(201);
  });

  it("stores and reports an 8-place household rate exactly (0041)", async () => {
    await rate(a, "USD", `${year}-04-01`, `${year}-04-30`, "26.53871234");
    const bought = await buy({ transactionDate: `${year}-04-10` }).expect(201);
    // 820 x 26.53871234 = 21761.7441188, half-up to the cent.
    expect(await stored(bought.body.data.id)).toMatchObject({ fxRate: "26.53871234", amountZmw: "21761.74" });
    const [lot] = await db.select().from(taxLots).where(eq(taxLots.householdId, a));
    expect(lot).toMatchObject({ costBasisZmw: "21761.74", acquisitionFxRate: "26.53871234" });
    const income = await record({ type: "dividend", amount: "34.00", withholdingTax: "6.00", transactionDate: `${year}-04-20` }).expect(201);
    expect(await stored(income.body.data.id)).toMatchObject({ fxRate: "26.53871234", amountZmw: "902.32" });
    // Net 34 -> 902.32, withholding 6 -> 159.23, gross 40 -> 1061.55.
    expect((await get(summaryPath).expect(200)).body).toMatchObject({ dividendIncome: "1061.55", totalWht: "159.23", netIncome: "902.32" });
    expect((await buy({ transactionDate: `${year}-04-11`, fxRate: "26.53871234", amountZmw: "21761.74" })).status).toBe(201);
  });

  it("refuses a malformed claimed conversion on an income event as a 400, not a 500", async () => {
    for (const claim of [{ fxRate: "abc" }, { amountZmw: "abc" }, { fxRate: "1.123456789" }]) {
      expect((await record({ type: "dividend", amount: "34.00", transactionDate: `${year}-02-10`, ...claim })).status).toBe(400);
    }
    expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a))).toEqual([]);
  });

  it("keeps a foreign row with a stored base but no dated-rate proof unavailable in the summary and the export", async () => {
    const created = await record({ type: "dividend", amount: "100.00", withholdingTax: "10.00", transactionDate: `${year}-02-10` }).expect(201);
    expect((await get(summaryPath).expect(200)).body.dividendIncome).toBe("2970.00");
    // The pre-NEW-21 writer stored a caller-typed base with a CREATE audit that
    // has no fxRateBasis. The same base at the dated rate is still not proof.
    const [origin] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "investment_transaction"),
      eq(auditLogs.entityId, created.body.data.id), eq(auditLogs.action, "CREATE")));
    const { fxRateBasis, ...oldStyle } = origin.details as Record<string, unknown>;
    expect(fxRateBasis).toBe("dated_household_then_provider_fx_v1");
    await db.update(auditLogs).set({ details: oldStyle }).where(eq(auditLogs.id, origin.id));
    expect((await get(summaryPath)).status).toBe(422);
    const exported = await get(exportPath);
    expect(exported.status).toBe(422);
    expect(JSON.stringify(exported.body)).not.toContain(marker);
  });

  it("makes a proven row unavailable again once its stored ZMW amount is edited outside the writer", async () => {
    const created = await record({ type: "dividend", amount: "100.00", withholdingTax: "10.00", transactionDate: `${year}-02-10` }).expect(201);
    expect((await get(summaryPath).expect(200)).body.dividendIncome).toBe("2970.00");
    await db.update(investmentTransactions).set({ amountZmw: "2800.00" }).where(eq(investmentTransactions.id, created.body.data.id));
    expect((await get(summaryPath)).status).toBe(422);
    expect((await get(exportPath)).status).toBe(422);
  });

  it("keeps a legacy foreign row with no ZMW base unavailable in the summary and the export, never counted as ZMW", async () => {
    // As the pre-NEW-21 writer stored it: USD income with no rate and no ZMW amount.
    await db.insert(investmentTransactions).values({ householdId: a, accountId: ids.sharedAccount, holdingId, securityId,
      type: "dividend", amount: "34.00", withholdingTax: "6.00", currency: "USD", amountZmw: null, fxRate: null, transactionDate: `${year}-02-10` });
    const summary = await get(summaryPath);
    expect(summary.status).toBe(422);
    expect(JSON.stringify(summary.body)).not.toMatch(/"(dividendIncome|grossIncome|netIncome)"/);
    const exported = await get(exportPath);
    expect(exported.status).toBe(422);
    expect(JSON.stringify(exported.body)).not.toContain(marker);
  });
});
