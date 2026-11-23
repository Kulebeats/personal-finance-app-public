import { randomUUID } from "node:crypto";
import { Client } from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { accounts, auditLogs, holdings, householdMembers, investmentTransactions, securities, taxLotDisposals, taxLots, transactions } from "@shared/schema";
import { db, pool } from "../../db";
import { businessAuditService } from "../../services/BusinessAuditService";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";

const year = 2031, publicSecurity = randomUUID(), privateSecurity = randomUUID();
const publicHolding = randomUUID(), privateHolding = randomUUID(), privateBuyHolding = randomUUID(), privateSaleHolding = randomUUID();
const publicIncome = randomUUID(), sharedCash = randomUUID(), privateCash = randomUUID();
let publicLot: string;
const privateMarker = "R13_TAX_PRIVATE_SOURCE", visibleMarker = "R13_TAX_VISIBLE_SOURCE";
const summaryPath = `/api/investments/tax/summary?year=${year}`;
const exportPath = (format = "json") => `/api/investments/tax/zra-export?year=${year}&format=${format}`;
const get = (path: string, role: Role | "outsider" = "member") => request(app).get(path).set("Cookie", actors.get(role)!.cookie)
  .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", role === "outsider" ? b : a);
async function clean() {
  await db.delete(taxLotDisposals).where(inArray(taxLotDisposals.householdId, [a, b]));
  await db.delete(taxLots).where(inArray(taxLots.householdId, [a, b]));
  await db.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b]));
  await db.delete(holdings).where(inArray(holdings.householdId, [a, b]));
  await db.delete(securities).where(inArray(securities.id, [publicSecurity, privateSecurity]));
}
async function disposal(holdingId: string, gain: string, buyAccount = ids.sharedAccount, closingCash?: string) {
  const buy = randomUUID(), sell = randomUUID(), lot = randomUUID();
  const proceeds = (Number(gain) + 100).toFixed(2); // exact whole-unit synthetic fixture, never product arithmetic
  await db.insert(investmentTransactions).values([
    { id: buy, householdId: a, accountId: buyAccount, holdingId, type: "buy", amount: "100.00", currency: "ZMW", withholdingTax: "0.00", transactionDate: "2030-01-01" },
    { id: sell, householdId: a, accountId: ids.sharedAccount, holdingId, type: "sell", amount: proceeds, currency: "ZMW", withholdingTax: "0.00", linkedTransactionId: closingCash, transactionDate: `${year}-08-01` },
  ]);
  await db.insert(taxLots).values({ id: lot, householdId: a, holdingId, transactionId: buy, quantity: "1", remainingQuantity: "0",
    costBasis: "100.00", costBasisZmw: "100.00", acquiredDate: "2030-01-01" });
  await db.insert(taxLotDisposals).values({ householdId: a, holdingId, taxLotId: lot, transactionId: sell, quantity: "1",
    proceeds, proceedsZmw: proceeds, costBasis: "100.00", costBasisZmw: "100.00", realizedGain: gain, realizedGainZmw: gain, disposedDate: `${year}-08-01` });
  return lot;
}
async function seed() {
  const owner = actors.get("owner")!.id;
  await db.insert(securities).values([
    { id: publicSecurity, symbol: `TAXPUB_${publicSecurity.slice(0, 8)}`, name: visibleMarker, type: "stock", currency: "ZMW" },
    { id: privateSecurity, symbol: `TAXPRIV_${privateSecurity.slice(0, 8)}`, name: privateMarker, type: "stock", currency: "ZMW" },
  ]);
  await db.insert(holdings).values([
    { id: publicHolding, householdId: a, accountId: ids.sharedAccount, securityId: publicSecurity, quantity: "1", costBasis: "100.00" },
    { id: privateHolding, householdId: a, accountId: ids.privateAccount, securityId: privateSecurity, quantity: "1", costBasis: "100.00" },
    { id: privateBuyHolding, householdId: a, accountId: ids.sharedAccount, securityId: publicSecurity, quantity: "1", costBasis: "100.00" },
    { id: privateSaleHolding, householdId: a, accountId: ids.sharedAccount, securityId: publicSecurity, quantity: "1", costBasis: "100.00" },
  ]);
  await db.insert(transactions).values([
    { id: sharedCash, householdId: a, accountId: ids.sharedAccount, ownerUserId: owner, name: visibleMarker, type: "income", amount: "100.00", currency: "ZMW", date: `${year}-02-01` },
    { id: privateCash, householdId: a, accountId: ids.sharedAccount, ownerUserId: owner, name: privateMarker, type: "income", amount: "400.00", currency: "ZMW", date: `${year}-02-01`, isPrivate: true },
  ]);
  await db.insert(investmentTransactions).values([
    { id: publicIncome, householdId: a, accountId: ids.sharedAccount, holdingId: publicHolding, securityId: publicSecurity,
      linkedTransactionId: sharedCash, type: "interest", amount: "100.00", withholdingTax: "15.00", currency: "ZMW", transactionDate: `${year}-02-01` },
    { householdId: a, accountId: ids.privateAccount, securityId: privateSecurity, type: "interest", amount: "200.00", withholdingTax: "30.00", currency: "ZMW", transactionDate: `${year}-03-01` },
    { householdId: a, accountId: ids.sharedAccount, holdingId: privateHolding, securityId: privateSecurity,
      type: "interest", amount: "300.00", withholdingTax: "45.00", currency: "ZMW", transactionDate: `${year}-04-01` },
    { householdId: a, accountId: ids.sharedAccount, linkedTransactionId: privateCash, securityId: privateSecurity,
      type: "interest", amount: "400.00", withholdingTax: "60.00", currency: "ZMW", transactionDate: `${year}-05-01` },
  ]);
  publicLot = await disposal(publicHolding, "50.00");
  await disposal(privateHolding, "200.00", ids.privateAccount);
  await disposal(privateBuyHolding, "300.00", ids.privateAccount);
  await disposal(privateSaleHolding, "400.00", ids.sharedAccount, privateCash);
}
function beforeTaxRead(change: () => Promise<unknown>) {
  const original = Client.prototype.query; let changed = false;
  const gate = vi.fn(change);
  vi.spyOn(Client.prototype, "query").mockImplementation(function(this: Client, ...args: unknown[]) {
    const input = args[0], text = typeof input === "string" ? input : input && typeof input === "object" && "text" in input ? String(input.text) : "";
    if (!changed && /^\s*(with|select)\b/i.test(text) && /investment_transactions|tax_lot_disposals/.test(text)) {
      changed = true; return gate().then(() => Reflect.apply(original, this, args));
    }
    return Reflect.apply(original, this, args);
  } as typeof Client.prototype.query);
  return gate;
}
function duringExportAudit(change: () => Promise<unknown>) {
  const original = businessAuditService.log.bind(businessAuditService); let changed = false;
  const gate = vi.fn(change);
  vi.spyOn(businessAuditService, "log").mockImplementation(async entry => {
    if (!changed && entry.entityType === "data_export") { changed = true; await gate(); }
    return original(entry);
  });
  return gate;
}

describe("R13 signed tax summary and ZRA export preserve the current source audience", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await clean(); await reset(); await seed(); });
  afterEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => { await clean(); await stop(); });

  it.each(["admin", "member", "view_only", "professional"] as const)("does not aggregate another actor's private account, holding, basis or cash for %s", async role => {
    const response = await get(summaryPath, role).expect(200);
    expect(response.body).toMatchObject({ year, interestIncome: "115.00", realizedGains: "50.00", dividendIncome: "0.00",
      grossIncome: "165.00", totalWht: "15.00", netIncome: "150.00", currency: "ZMW" });
  });
  it("retains the private source owner's complete exact summary", async () => {
    const response = await get(summaryPath, "owner").expect(200);
    expect(response.body).toMatchObject({ interestIncome: "1150.00", realizedGains: "950.00", grossIncome: "2100.00", totalWht: "150.00", netIncome: "1950.00" });
  });
  it.each(["json", "csv"])("exports only authorized rows via the existing %s caller", async format => {
    const response = await get(exportPath(format)).expect(200);
    expect(response.text).not.toContain(privateMarker);
    if (format === "json") expect(response.body).toEqual([expect.objectContaining({ security: visibleMarker, grossAmount: "115.00", whtPaid: "15.00", netAmount: "100.00" })]);
    else { expect(response.text).toContain(visibleMarker); expect(response.text.split("\n").filter(Boolean)).toHaveLength(2); }
  });
  it.each(["json", "csv"])("permits the owner's own private %s export", async format => {
    const response = await get(exportPath(format), "owner").expect(200);
    expect(response.text).toContain(privateMarker); if (format === "json") expect(response.body).toHaveLength(4);
  });
  it.each(["view_only", "professional"] as const)("does not grant financial export capability to %s", async role => {
    await get(exportPath(), role).expect(403); await get(exportPath("csv"), role).expect(403);
  });
  it("ignores query scope/household selectors that would promote another actor's source", async () => {
    const response = await get(`${exportPath()}&householdId=${b}&scope=household&ownerUserId=${actors.get("owner")!.id}`).expect(200);
    expect(response.body).toHaveLength(1); expect(response.text).not.toContain(privateMarker);
  });
  it("does not expose these households to an authenticated outsider", async () => {
    const summary = await get(`${summaryPath}&householdId=${a}`, "outsider").expect(200);
    expect(summary.body.grossIncome).toBe("0.00"); expect((await get(exportPath(), "outsider").expect(200)).body).toEqual([]);
  });
  it("requires signed authentication on both callers", async () => {
    await request(app).get(summaryPath).expect(401); await request(app).get(exportPath()).expect(401);
  });
  it.each(["activity household", "cash household", "holding household", "lot household", "deleted account"])("checks every source scope: %s", async source => {
    if (source === "activity household") await db.update(investmentTransactions).set({ householdId: b }).where(eq(investmentTransactions.id, publicIncome));
    if (source === "cash household") await db.update(transactions).set({ householdId: b }).where(eq(transactions.id, sharedCash));
    if (source === "holding household") await db.update(holdings).set({ householdId: b }).where(eq(holdings.id, publicHolding));
    if (source === "lot household") await db.update(taxLots).set({ householdId: b }).where(eq(taxLots.id, publicLot));
    if (source === "deleted account") await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, ids.sharedAccount));
    const response = await get(summaryPath).expect(200);
    const expected = source === "lot household" ? { interestIncome: "115.00", realizedGains: "0.00", netIncome: "100.00" }
      : source === "activity household" || source === "cash household" ? { interestIncome: "0.00", realizedGains: "50.00", netIncome: "50.00" }
      : { interestIncome: "0.00", realizedGains: "0.00", netIncome: "0.00" };
    expect(response.body).toMatchObject(expected);
  });
  it("rechecks membership in the actual protected tax read", async () => {
    const gate = beforeTaxRead(() => db.delete(householdMembers).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id))));
    await get(summaryPath).expect(403); expect(gate).toHaveBeenCalledOnce();
  });
  it.each(["json", "csv"])("withdraws financial data if visibility changes while the %s export audit is awaited", async format => {
    const gate = duringExportAudit(() => db.update(transactions).set({ isPrivate: true, ownerUserId: actors.get("owner")!.id }).where(eq(transactions.id, sharedCash)));
    const response = await get(exportPath(format)).expect(200); expect(gate).toHaveBeenCalledOnce();
    expect(response.text).not.toContain(visibleMarker); expect(response.text).not.toContain(privateMarker);
    if (format === "json") expect(response.body).toEqual([]);
  });
  it("withdraws export authority changed during the audit await", async () => {
    const gate = duringExportAudit(() => db.update(householdMembers).set({ role: "view_only" }).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id))));
    await get(exportPath()).expect(403); expect(gate).toHaveBeenCalledOnce();
  });
  it("does not publish private export row counts into a household-audience audit", async () => {
    await get(exportPath(), "owner").expect(200);
    const rows = await db.select().from(auditLogs).where(and(eq(auditLogs.userId, actors.get("owner")!.id), eq(auditLogs.entityType, "data_export")));
    expect(rows).toHaveLength(1);
    if (rows[0].householdId !== null) expect(rows[0].details).not.toHaveProperty("recordCount");
  });
  it.each(["json", "csv"])("fails closed when the actual %s export audit INSERT is rejected", async format => {
    const fault = `r13_tax_audit_fault_${randomUUID().replace(/-/g, "")}`;
    try {
      await pool.query(`CREATE FUNCTION public."${fault}"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
        BEGIN RAISE EXCEPTION 'Synthetic tax export audit persistence failure' USING ERRCODE='23514'; END $body$`);
      await pool.query(`CREATE TRIGGER "${fault}" BEFORE INSERT ON public.audit_logs FOR EACH ROW
        WHEN (NEW.user_id='${actors.get("member")!.id}'::uuid AND NEW.entity_type='data_export') EXECUTE FUNCTION public."${fault}"()`);
      const response = await get(exportPath(format)).expect(500);
      expect(response.text).not.toContain(visibleMarker); expect(response.text).not.toContain(privateMarker);
      const audit = await db.select().from(auditLogs).where(and(eq(auditLogs.userId, actors.get("member")!.id), eq(auditLogs.entityType, "data_export")));
      expect(audit).toEqual([]);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS "${fault}" ON public.audit_logs`);
      await pool.query(`DROP FUNCTION IF EXISTS public."${fault}"()`);
    }
  });
  it.each(["json", "csv"])("commits exactly one source-free requested audit before a successful %s download", async format => {
    await get(exportPath(format)).expect(200);
    const rows = await db.select().from(auditLogs).where(and(eq(auditLogs.userId, actors.get("member")!.id), eq(auditLogs.entityType, "data_export")));
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ action: "PROCESS", householdId: a, userId: actors.get("member")!.id });
    expect(rows[0].details).toEqual({ exportType: "investment_tax_zra", fileFormat: format, year, phase: "requested" });
  });
});
