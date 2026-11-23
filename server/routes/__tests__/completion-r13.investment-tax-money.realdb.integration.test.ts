import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { accounts, auditLogs, holdings, householdFxRateOverrides, investmentTransactions, securities, taxLotDisposals, taxLots } from "@shared/schema";
import { db } from "../../db";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";

const year = 2031, securityId = randomUUID(), holdingId = randomUUID(), marker = "R13_DECLARED_INCOME";
const get = (path: string, role: Role = "member") => request(app).get(path).set("Cookie", actors.get(role)!.cookie)
  .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);
const summaryPath = (taxYear = year) => `/api/investments/tax/summary?year=${taxYear}`;
const exportPath = (format = "json", taxYear = year) => `/api/investments/tax/zra-export?year=${taxYear}&format=${format}`;
function record(body: Record<string, unknown> = {}, role: Role = "member") {
  return request(app).post("/api/investments/transactions").set("Cookie", actors.get(role)!.cookie)
    .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a)
    .send({ accountId: ids.sharedAccount, holdingId, securityId, type: "interest", amount: "34.00", withholdingTax: "6.00",
      currency: "ZMW", transactionDate: `${year}-02-01`, ...body });
}
async function clean() {
  await db.delete(taxLotDisposals).where(inArray(taxLotDisposals.householdId, [a, b]));
  await db.delete(taxLots).where(inArray(taxLots.householdId, [a, b]));
  await db.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b]));
  await db.delete(holdings).where(inArray(holdings.householdId, [a, b]));
  await db.delete(securities).where(eq(securities.id, securityId));
  await db.delete(householdFxRateOverrides).where(inArray(householdFxRateOverrides.householdId, [a, b]));
}
// NEW-21: a foreign event now needs a dated rate at write time; 20 covers every fixture date.
async function usdRate() {
  await db.insert(householdFxRateOverrides).values({ householdId: a, actorUserId: actors.get("owner")!.id,
    fromCurrency: "USD", toCurrency: "ZMW", effectiveDate: "2030-01-01", validThrough: `${year}-12-31`, rate: "20" });
}
async function setCurrency(currency: string) {
  await db.update(accounts).set({ currency }).where(eq(accounts.id, ids.sharedAccount));
  await db.update(securities).set({ currency }).where(eq(securities.id, securityId));
}

describe("R13.3 signed income producers preserve declared money and refuse unproven tax FX", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clean(); await reset();
    await db.update(accounts).set({ type: "investment" }).where(eq(accounts.id, ids.sharedAccount));
    await db.insert(securities).values({ id: securityId, symbol: `TAXM_${securityId.slice(0, 8)}`, name: marker, type: "stock", currency: "ZMW" });
    await db.insert(holdings).values({ id: holdingId, householdId: a, accountId: ids.sharedAccount, securityId, quantity: "1", costBasis: "100.00" });
  });
  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  it.each(["interest", "dividend", "coupon"])("retains actual manual %s NET34 and declared withholding6 as gross40 in summary/export", async type => {
    // The existing modal submits NET, plus the user's explicit withholding.
    // These controlled amounts do not assert an externally applicable tax rate.
    const created = await record({ type }).expect(201);
    const [stored] = await db.select().from(investmentTransactions).where(eq(investmentTransactions.id, created.body.data.id));
    expect.soft(stored).toMatchObject({ amount: "34.00", withholdingTax: "6.00", currency: "ZMW" });
    const summary = await get(summaryPath()).expect(200);
    expect.soft(summary.body).toMatchObject({ interestIncome: type === "dividend" ? "0.00" : "40.00",
      dividendIncome: type === "dividend" ? "40.00" : "0.00", grossIncome: "40.00", totalWht: "6.00", netIncome: "34.00", currency: "ZMW" });
    const exported = await get(exportPath()).expect(200);
    expect.soft(exported.body).toEqual([expect.objectContaining({ type, security: marker, grossAmount: "40.00", whtPaid: "6.00", netAmount: "34.00" })]);
    const csv = await get(exportPath("csv")).expect(200);
    expect.soft(csv.text).toContain('"40.00","6.00","34.00"');
  });
  // A-29: `securities` has no household_id, so a name another household entered can reach this CSV.
  it.each(["=1+1", " @SUM(A1)"])("writes the security name %j as text in the ZRA CSV, not as a formula", async name => {
    await db.update(securities).set({ name }).where(eq(securities.id, securityId));
    await record().expect(201);
    const csv = await get(exportPath("csv")).expect(200);
    expect(csv.text).toContain(`"'${name}","40.00","6.00","34.00"`);
    expect(csv.text).not.toContain(`,"${name}",`);
    // The JSON export keeps the stored name: only the spreadsheet file is neutralized.
    expect((await get(exportPath()).expect(200)).body).toEqual([expect.objectContaining({ security: name })]);
  });
  it("preserves an explicitly declared zero withholding without choosing a default tax rate", async () => {
    const created = await record({ amount: "40.00", withholdingTax: "0.00" }).expect(201);
    const original = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "investment_transaction"),
      eq(auditLogs.entityId, created.body.data.id), eq(auditLogs.action, "CREATE")));
    expect.soft(original).toHaveLength(1);
    expect.soft(original[0]?.details).toMatchObject({ newValue: { amount: "40.00", withholdingTax: "0.00", currency: "ZMW", transactionDate: `${year}-02-01` } });
    expect((await get(summaryPath()).expect(200)).body).toMatchObject({ grossIncome: "40.00", totalWht: "0.00", netIncome: "40.00" });
  });
  it("derives omitted ZMW denomination from the actual selected native instrument", async () => {
    const created = await record({ amount: "34.00", withholdingTax: "6.00", currency: undefined }).expect(201);
    const [stored] = await db.select().from(investmentTransactions).where(eq(investmentTransactions.id, created.body.data.id));
    expect(stored).toMatchObject({ amount: "34.00", withholdingTax: "6.00", currency: "ZMW" });
    const [original] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "investment_transaction"),
      eq(auditLogs.entityId, stored.id), eq(auditLogs.action, "CREATE")));
    expect(original.details).toMatchObject({ newValue: { currency: "ZMW", sourceCurrency: "ZMW" }, incomeCurrencyBasis: "source_bound_currency_v1" });
    expect((await get(summaryPath()).expect(200)).body).toMatchObject({ grossIncome: "40.00", totalWht: "6.00", netIncome: "34.00" });
  });
  it.each(["missing original", "net-only original"])("does not invent historical zero tax from an ambiguous DB default: %s", async history => {
    const id = randomUUID();
    await db.insert(investmentTransactions).values({ id, householdId: a, accountId: ids.sharedAccount, holdingId, securityId,
      type: "interest", amount: "34.00", withholdingTax: "0.00", currency: "ZMW", transactionDate: `${year}-02-01` });
    if (history === "net-only original") await db.insert(auditLogs).values({ userId: actors.get("member")!.id, householdId: a,
      entityType: "investment_transaction", entityId: id, action: "CREATE", details: { newValue: { type: "interest", holdingId, quantity: null, amount: "34.00" } } });
    for (const path of [summaryPath(), exportPath(), exportPath("csv")]) {
      const response = await get(path); expect.soft(response.status).toBe(422); expect.soft(response.body.error?.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
    }
  });
  it("preserves explicitly stored known nonzero historical withholding without choosing a rate", async () => {
    await db.insert(investmentTransactions).values({ householdId: a, accountId: ids.sharedAccount, holdingId, securityId,
      type: "interest", amount: "34.00", withholdingTax: "6.00", currency: "ZMW", transactionDate: `${year}-02-01` });
    expect((await get(summaryPath()).expect(200)).body).toMatchObject({ grossIncome: "40.00", totalWht: "6.00", netIncome: "34.00" });
  });
  it.each(["duplicate", "mismatched"])("withholds an unsupported zero-tax claim with %s original evidence", async problem => {
    const created = await record({ amount: "40.00", withholdingTax: "0.00" }).expect(201);
    const [original] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "investment_transaction"),
      eq(auditLogs.entityId, created.body.data.id), eq(auditLogs.action, "CREATE")));
    if (problem === "duplicate") await db.insert(auditLogs).values({ ...original, id: randomUUID() });
    else {
      const details = original.details as Record<string, unknown>;
      await db.update(auditLogs).set({ details: { ...details, newValue: { ...(details.newValue as Record<string, unknown>), withholdingTax: "6.00" } } })
        .where(eq(auditLogs.id, original.id));
    }
    const response = await get(summaryPath()); expect(response.status).toBe(422); expect(response.body.error?.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
  });
  it("does not downgrade a visibly damaged versioned nonzero declaration into an unaudited legacy row", async () => {
    const created = await record().expect(201);
    const [original] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "investment_transaction"),
      eq(auditLogs.entityId, created.body.data.id), eq(auditLogs.action, "CREATE")));
    const details = original.details as Record<string, unknown>, newValue = { ...(details.newValue as Record<string, unknown>) };
    delete newValue.withholdingTax;
    await db.update(auditLogs).set({ details: { ...details, newValue } }).where(eq(auditLogs.id, original.id));
    const response = await get(summaryPath()); expect(response.status).toBe(422); expect(response.body.error?.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
  });
  it.each(["NaN", "Infinity", "-6.00", "1.001", "10000000000000.00"])("rejects unsupported declared withholding %s before storing the income", async withholdingTax => {
    await record({ withholdingTax }).expect(400);
    expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a))).toEqual([]);
  });
  it.each(["34.009", "NaN", "Infinity", "-34.00", "10000000000000.00"])("does not silently round or persist unsupported declared NET %s", async amount => {
    await record({ amount }).expect(400);
    expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a))).toEqual([]);
  });
  it.each(["omitted", "contradictory"])("never defaults foreign income to ZMW when its currency is %s", async choice => {
    await setCurrency("USD"); await usdRate();
    const created = await record({ amount: "180.00", withholdingTax: "0.00", currency: choice === "omitted" ? undefined : "ZMW" });
    if (created.status !== 201) { expect(created.status).toBe(400); return; }
    const [stored] = await db.select().from(investmentTransactions).where(eq(investmentTransactions.id, created.body.data.id));
    expect.soft(stored).toMatchObject({ currency: "USD", fxRate: "20.00000000", amountZmw: "3600.00" });
    expect((await get(summaryPath()).expect(200)).body).toMatchObject({ interestIncome: "3600.00", grossIncome: "3600.00" });
  });
  it("does not promote contradictory legacy ZMW labels on foreign investment income", async () => {
    await setCurrency("USD");
    await db.insert(investmentTransactions).values({ householdId: a, accountId: ids.sharedAccount, holdingId, securityId,
      type: "interest", amount: "180.00", withholdingTax: "6.00", currency: "ZMW", transactionDate: `${year}-02-01` });
    const response = await get(summaryPath()); expect(response.status).toBe(422); expect(response.body.error?.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
  });
  it.each([false, true])("does not relabel USD180 or trust undated caller FX as ZMW (claimed base=%s)", async claimedBase => {
    await setCurrency("USD");
    const refused = await record({ amount: "180.00", withholdingTax: "0.00", currency: "USD",
      ...(claimedBase ? { amountZmw: "3600.00", fxRate: "20.00" } : {}) });
    expect(refused.status).toBe(422); expect(refused.body.error?.code).toBe("MISSING_FX_RATE");
    expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a))).toEqual([]);
    expect((await get(summaryPath()).expect(200)).body.grossIncome).toBe("0.00");
    const csv = await get(exportPath("csv")).expect(200); expect(csv.text).not.toContain(marker);
  });
  it("does not expose hidden foreign income through an FX error to another household member", async () => {
    await db.update(accounts).set({ currency: "USD" }).where(eq(accounts.id, ids.privateAccount));
    await db.update(securities).set({ currency: "USD" }).where(eq(securities.id, securityId));
    await db.update(holdings).set({ accountId: ids.privateAccount }).where(eq(holdings.id, holdingId)); await usdRate();
    await record({ accountId: ids.privateAccount, currency: "USD", amount: "180.00", withholdingTax: "0.00" }, "owner").expect(201);
    expect((await get(summaryPath()).expect(200)).body.grossIncome).toBe("0.00");
    expect((await get(exportPath()).expect(200)).body).toEqual([]);
  });
  it.each([{ currency: "ZMW", claimedBase: false }, { currency: "USD", claimedBase: false }, { currency: "USD", claimedBase: true }])(
    "keeps actual FIFO source denomination and converts only at the dated rate: %j", async ({ currency, claimedBase }) => {
    await setCurrency(currency); await usdRate(); await db.update(holdings).set({ quantity: "0", costBasis: "0" }).where(eq(holdings.id, holdingId));
    await record({ type: "buy", quantity: "1", price: "100.00", amount: "100.00", withholdingTax: undefined, currency, transactionDate: "2030-01-01",
      ...(claimedBase ? { amountZmw: "2000.00", fxRate: "20.00" } : {}) }).expect(201);
    await record({ type: "sell", quantity: "1", price: "120.00", amount: "120.00", withholdingTax: undefined, currency,
      ...(claimedBase ? { amountZmw: "2400.00", fxRate: "20.00" } : {}) }).expect(201);
    const [gain] = await db.select().from(taxLotDisposals).where(eq(taxLotDisposals.householdId, a));
    expect(gain.realizedGain).toBe("20.00");
    if (currency === "USD") expect(gain.realizedGainZmw).toBe("400.00");
    const summary = await get(summaryPath()).expect(200);
    const zmwGain = currency === "ZMW" ? "20.00" : "400.00";
    expect(summary.body).toMatchObject({ realizedGains: zmwGain, grossIncome: zmwGain, netIncome: zmwGain });
  });
  it("never defaults both foreign FIFO legs to ZMW when callers omit denomination", async () => {
    await setCurrency("USD"); await usdRate(); await db.update(holdings).set({ quantity: "0", costBasis: "0" }).where(eq(holdings.id, holdingId));
    const buy = await record({ type: "buy", quantity: "1", price: "100.00", amount: "100.00", withholdingTax: undefined, currency: undefined, transactionDate: "2030-01-01" });
    if (buy.status !== 201) { expect(buy.status).toBe(400); return; }
    const sell = await record({ type: "sell", quantity: "1", price: "120.00", amount: "120.00", withholdingTax: undefined, currency: undefined });
    if (sell.status !== 201) { expect(sell.status).toBe(400); return; }
    const rows = await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a));
    expect.soft(rows.every(row => row.currency === "USD")).toBe(true);
    expect((await get(summaryPath()).expect(200)).body.realizedGains).toBe("400.00");
  });
  it("does not replace a deleted acquisition denomination with today's security currency", async () => {
    await setCurrency("USD"); await usdRate(); await db.update(holdings).set({ quantity: "0", costBasis: "0" }).where(eq(holdings.id, holdingId));
    const buy = await record({ type: "buy", quantity: "1", price: "100.00", amount: "100.00", withholdingTax: undefined, currency: "USD", transactionDate: "2030-01-01" }).expect(201);
    const sell = await record({ type: "sell", quantity: "1", price: "120.00", amount: "120.00", withholdingTax: undefined, currency: "USD" }).expect(201);
    await db.delete(investmentTransactions).where(eq(investmentTransactions.id, buy.body.data.id));
    await db.update(investmentTransactions).set({ currency: "ZMW" }).where(eq(investmentTransactions.id, sell.body.data.id));
    await setCurrency("ZMW");
    const [lot] = await db.select().from(taxLots).where(eq(taxLots.householdId, a)); expect(lot.transactionId).toBeNull();
    const response = await get(summaryPath()); expect(response.status).toBe(422); expect(response.body.error?.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
  });
  it("withholds an existing foreign FIFO gain whose two historical rows carry the old default ZMW label", async () => {
    await setCurrency("USD"); await usdRate(); await db.update(holdings).set({ quantity: "0", costBasis: "0" }).where(eq(holdings.id, holdingId));
    await record({ type: "buy", quantity: "1", price: "100.00", amount: "100.00", withholdingTax: undefined, currency: "USD", transactionDate: "2030-01-01" }).expect(201);
    await record({ type: "sell", quantity: "1", price: "120.00", amount: "120.00", withholdingTax: undefined, currency: "USD" }).expect(201);
    // Controlled reproduction of the prior producer's defaulted persisted rows:
    // their actual instrument remains USD; neither native label proves ZMW.
    await db.update(investmentTransactions).set({ currency: "ZMW" }).where(eq(investmentTransactions.householdId, a));
    const [gain] = await db.select().from(taxLotDisposals).where(eq(taxLotDisposals.householdId, a));
    expect(gain.realizedGain).toBe("20.00");
    const response = await get(summaryPath()); expect(response.status).toBe(422); expect(response.body.error?.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
  });
  it("counts entered Dec31 and Jan1 income in exactly their declared tax years", async () => {
    await record({ amount: "40.00", withholdingTax: "0.00", transactionDate: `${year}-12-31` }).expect(201);
    await record({ amount: "60.00", withholdingTax: "0.00", transactionDate: `${year + 1}-01-01` }).expect(201);
    expect((await get(summaryPath()).expect(200)).body.grossIncome).toBe("40.00");
    expect((await get(summaryPath(year + 1)).expect(200)).body.grossIncome).toBe("60.00");
    const before = await get(exportPath()).expect(200), after = await get(exportPath("json", year + 1)).expect(200);
    expect(before.body).toEqual([expect.objectContaining({ date: `${year}-12-31`, netAmount: "40.00" })]);
    expect(after.body).toEqual([expect.objectContaining({ date: `${year + 1}-01-01`, netAmount: "60.00" })]);
  });
});
