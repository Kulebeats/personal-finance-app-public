import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLogs, holdings, householdFxRateOverrides, investmentPurchaseAuthorizationProofs, investmentSipOccurrences,
  investmentTransactions, recurringInvestments, securities, taxLotDisposals, taxLots } from "@shared/schema";
import { db, pool } from "../../db";
import { a, actors, app, ids, reset, start, stop } from "../../modules/tags/__tests__/completion-r04.tags.fixture";
import { seedDatedFxRate } from "../../testing/fixtures/dated-fx-rate";
import { processDueInvestments } from "../../services/investment/processDueInvestments";
import { digestSipFillProofTerms } from "../../services/investment/sipFillProofContract";

// #236 follow-ups F1 and F2: a confirmed foreign SIP fill and a declared
// foreign opening get their ZMW base from the dated rate (the household's rate
// valid on the date, else the provider rate on or before it), never from the
// caller, so their lots are provable in the ZRA tax summary.
const securityId = randomUUID(), zmwSecurityId = randomUUID(), policy = "dated_household_then_provider_fx_v1";
let dueDate: string, year: number;
function signed(path: string, method: "post" | "get" = "post") {
  const actor = actors.get("member")!;
  return request(app)[method](path).set("Cookie", actor.cookie).set("X-Capital-Subject", actor.id).set("X-Capital-Household", a);
}
const summary = () => signed(`/api/investments/tax/summary?year=${year}`, "get");
async function heldPlan(planSecurityId = securityId, currency = "USD") {
  const created = await signed("/api/investments/recurring").send({ operationId: randomUUID(), accountId: ids.sharedAccount,
    securityId: planSecurityId, type: "sip", frequency: "monthly", amount: "4.00", currency, nextExecutionDate: dueDate }).expect(200);
  expect(await processDueInvestments()).toMatchObject({ success: 0, held: 1, failed: 0 });
  return created.body.data.id as string;
}
const fill = () => ({ executionDate: dueDate, quantity: "2.00000000", price: "2.0000", fees: "0.00" });
function confirm(planId: string) {
  return signed(`/api/investments/recurring/${planId}/occurrences/${dueDate}/confirm`)
    .send({ operationId: randomUUID(), expectedRevision: 0, finalStatement: true, outcome: "filled", fills: [fill()] });
}
function opening(claim: Record<string, string> = {}) {
  return signed("/api/investments/holdings").send({ operationId: randomUUID(), expectedCurrency: "USD", accountId: ids.sharedAccount,
    securityId, quantity: "5", costBasis: "10.00", acquiredDate: "2020-01-01", ...claim });
}
function sell(holdingId: string, quantity: string, amount: string) {
  return signed("/api/investments/transactions").send({ accountId: ids.sharedAccount, securityId, holdingId, type: "sell",
    quantity, price: "3", amount, fees: "0", currency: "USD", transactionDate: dueDate });
}
const activity = () => db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a));
const lots = () => db.select().from(taxLots).where(eq(taxLots.householdId, a));
async function createAudit(entityId: string) {
  return db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "investment_transaction"),
    eq(auditLogs.entityId, entityId), eq(auditLogs.action, "CREATE")));
}
/** Run SQL as a later, separate transaction (a correction, erasure or delete). */
async function later(sql: string, params: unknown[]) { return (await pool.query(sql, params)).rowCount; }
/** 0029's own function text, loaded under pg_temp so both versions run side by side. */
function from0029(name: string) {
  const text = readFileSync(fileURLToPath(new URL("../../../migrations/0029_c306_sip_occurrences.sql", import.meta.url)), "utf8");
  const start = text.indexOf(`CREATE FUNCTION public.${name}(`), end = text.indexOf("$body$;", start);
  if (start < 0 || end < 0) throw new Error(`0029 has no ${name}`);
  return text.slice(start, end + "$body$;".length).replace(`public.${name}(`, `pg_temp.${name}_0029(`);
}
const FILL_JOIN = `from investment_transactions p join investment_sip_confirmed_fills f on f.purchase_id=p.id
  join investment_sip_confirmations c on c.id=f.confirmation_id
  join investment_sip_occurrences o on o.plan_id=c.plan_id and o.original_due_date=c.original_due_date`;
async function clean() {
  await db.delete(recurringInvestments).where(eq(recurringInvestments.householdId, a));
  await db.delete(taxLotDisposals).where(eq(taxLotDisposals.householdId, a));
  await db.delete(taxLots).where(eq(taxLots.householdId, a));
  await db.delete(investmentTransactions).where(eq(investmentTransactions.householdId, a));
  await db.delete(holdings).where(eq(holdings.householdId, a));
  await db.delete(securities).where(eq(securities.id, securityId));
  await db.delete(securities).where(eq(securities.id, zmwSecurityId));
  await db.delete(auditLogs).where(eq(auditLogs.householdId, a));
  await db.delete(householdFxRateOverrides).where(eq(householdFxRateOverrides.householdId, a));
}

describe("#236 F1/F2 SIP fills and declared openings take the dated ZMW base", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clean(); await reset();
    dueDate = new Date().toISOString().slice(0, 10); year = Number(dueDate.slice(0, 4));
    await db.insert(securities).values({ id: securityId, symbol: "SOFX" + securityId.slice(0, 8),
      name: "Synthetic SIP and opening FX", type: "stock", currency: "USD", currentPrice: "2.00" });
    const owner = actors.get("owner")!;
    await request(app).put("/api/investments/calendar").set("Cookie", owner.cookie)
      .set("X-Capital-Subject", owner.id).set("X-Capital-Household", a).send({ timeZone: "UTC" }).expect(200);
  });
  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  it("F1: confirms a USD SIP fill at its execution date's rate on the purchase, lot, audit and fill proof", async () => {
    await seedDatedFxRate(a, actors.get("owner")!.id, "26.5");
    const planId = await heldPlan();
    const confirmed = await confirm(planId).expect(200);
    const purchaseId: string = confirmed.body.data.occurrence.result.fills[0].purchaseId;
    const [purchase] = await activity();
    // 2 shares @ 2.0000 = USD 4.00; x 26.5 = ZMW 106.00.
    expect(purchase).toMatchObject({ id: purchaseId, currency: "USD", amount: "4.00", fxRate: "26.50000000", amountZmw: "106.00" });
    expect((await lots())[0]).toMatchObject({ transactionId: purchaseId, costBasisZmw: "106.00", acquisitionFxRate: "26.50000000" });
    const [audit] = await createAudit(purchaseId);
    expect(audit.details).toMatchObject({ fxRateBasis: policy, newValue: { fxRate: "26.50000000", amountZmw: "106.00", feesDeclared: true } });
    const [proof] = await db.select().from(investmentPurchaseAuthorizationProofs).where(eq(investmentPurchaseAuthorizationProofs.purchaseId, purchaseId));
    expect(proof.authorizedTermsDigest).toBe(digestSipFillProofTerms({ contractVersion: 2, contractType: "record_only_sip_actual_fill",
      accountId: purchase.accountId, securityId, quantity: purchase.quantity, price: purchase.price, fees: purchase.fees, amount: purchase.amount,
      currency: "USD", executionDate: dueDate, authorizedFrequency: "monthly", authorizedInitialDate: dueDate,
      fxRate: "26.50000000", amountZmw: "106.00" }));
    expect(await db.select({ state: investmentSipOccurrences.state }).from(investmentSipOccurrences)
      .where(eq(investmentSipOccurrences.planId, planId))).toEqual([{ state: "closed" }]);
  });

  it("F1: refuses a USD SIP fill with no dated rate as a 422 naming the pair, and leaves the occurrence pending", async () => {
    const planId = await heldPlan();
    const refused = await confirm(planId);
    expect(refused.status).toBe(422);
    expect(refused.body.error).toMatchObject({ code: "MISSING_FX_RATE", details: { from: "USD", to: "ZMW", date: dueDate } });
    expect(await activity()).toEqual([]);
    expect(await db.select({ state: investmentSipOccurrences.state }).from(investmentSipOccurrences)
      .where(eq(investmentSipOccurrences.planId, planId))).toEqual([{ state: "pending" }]);
  });

  it("F1: counts a later sale of SIP-bought USD shares in the ZMW tax summary", async () => {
    await seedDatedFxRate(a, actors.get("owner")!.id, "26.5");
    await confirm(await heldPlan()).expect(200);
    const [holding] = await db.select().from(holdings).where(eq(holdings.securityId, securityId));
    await sell(holding.id, "2", "6.00").expect(201);
    // Proceeds 6 x 26.5 = 159.00 less basis 106.00.
    expect((await summary().expect(200)).body).toMatchObject({ realizedGains: "53.00", currency: "ZMW" });
  });

  it("0042 never re-checks an existing fill: a later audit edit, pseudonymisation, sale and delete of a fill that breaks the new rule all succeed", async () => {
    await seedDatedFxRate(a, actors.get("owner")!.id, "26.5");
    const planId = await heldPlan();
    const purchaseId: string = (await confirm(planId).expect(200)).body.data.occurrence.result.fills[0].purchaseId;
    // A proven SIP purchase is already immutable (0028 guard_proven_investment_purchase),
    // so no fill committed before 0042 can later gain a pair; a ngwee-off base is refused.
    await expect(later("update investment_transactions set amount_zmw=amount_zmw+0.01 where id=$1", [purchaseId]))
      .rejects.toThrow("Completed authorized investment purchase is immutable");
    // Its audit row can change later: the CREATE audit loses its policy, breaking the new evidence rule.
    expect(await later(`update audit_logs set details=details-'fxRateBasis' where entity_id=$1 and action='CREATE'
      and entity_type='investment_transaction'`, [purchaseId])).toBe(1);
    const broken = await pool.query(`select public.c306_sip_fill_evidence(p.id) as evidence ${FILL_JOIN} where p.id=$1`, [purchaseId]);
    expect(broken.rows).toEqual([{ evidence: false }]);
    // Erasure-style audit pseudonymisation and a FIFO sale touch the fill's audit and lot.
    expect(await later("update audit_logs set ip_address=null, user_id=null where entity_id=$1", [purchaseId])).toBe(1);
    const [holding] = await db.select().from(holdings).where(eq(holdings.securityId, securityId));
    await sell(holding.id, "1", "3.00").expect(201);
    expect((await lots())[0]).toMatchObject({ transactionId: purchaseId, remainingQuantity: "1.00000000" });
    // The household-delete order: the plan (cascading occurrence, confirmation and fill), then activity.
    expect(await later("delete from recurring_investments where id=$1", [planId])).toBe(1);
    expect((await pool.query("select 1 from investment_sip_confirmed_fills where purchase_id=$1", [purchaseId])).rowCount).toBe(0);
    await db.delete(taxLotDisposals).where(eq(taxLotDisposals.householdId, a));
    await db.delete(taxLots).where(eq(taxLots.householdId, a));
    expect(await later("delete from investment_transactions where household_id=$1", [a])).toBe(2);
  });

  it("0042 keeps the contract v2 digest and evidence of a null-pair (ZMW) fill byte-identical to 0029", async () => {
    await db.insert(securities).values({ id: zmwSecurityId, symbol: "SOZM" + zmwSecurityId.slice(0, 8),
      name: "Synthetic ZMW SIP", type: "stock", currency: "ZMW", currentPrice: "2.00" });
    const planId = await heldPlan(zmwSecurityId, "ZMW");
    const purchaseId: string = (await confirm(planId).expect(200)).body.data.occurrence.result.fills[0].purchaseId;
    const client = await pool.connect();
    try {
      await client.query(from0029("c306_sip_fill_digest"));
      await client.query(from0029("c306_sip_fill_evidence"));
      const compared = await client.query(`select public.c306_sip_fill_digest(p.id,o.authorized_frequency,o.authorized_initial_date) as now,
        pg_temp.c306_sip_fill_digest_0029(p.id,o.authorized_frequency,o.authorized_initial_date) as was,
        proof.authorized_terms_digest as stored, public.c306_sip_fill_evidence(p.id) as evidence_now,
        pg_temp.c306_sip_fill_evidence_0029(p.id) as evidence_was ${FILL_JOIN}
        join investment_purchase_authorization_proofs proof on proof.purchase_id=p.id where p.id=$1`, [purchaseId]);
      expect(compared.rows).toHaveLength(1);
      const [row] = compared.rows;
      expect(row.now).toMatch(/^[0-9a-f]{64}$/);
      expect(row).toEqual({ now: row.was, was: row.stored, stored: row.now, evidence_now: true, evidence_was: true });
      expect(row.now).toBe(digestSipFillProofTerms({ contractVersion: 2, contractType: "record_only_sip_actual_fill",
        accountId: ids.sharedAccount, securityId: zmwSecurityId, quantity: "2.00000000", price: "2.0000", fees: "0.00", amount: "4.00",
        currency: "ZMW", executionDate: dueDate, authorizedFrequency: "monthly", authorizedInitialDate: dueDate, fxRate: null, amountZmw: null }));
    } finally { client.release(true); }
  });

  it("F2: verifies a declared foreign opening against the dated rate, so its later sale is counted", async () => {
    await seedDatedFxRate(a, actors.get("owner")!.id, "25");
    const created = await opening({ costBasisZmw: "250.00", acquisitionFxRate: "25" }).expect(201);
    const [purchase] = await activity();
    expect(purchase).toMatchObject({ amount: "10.00", amountZmw: "250.00", fxRate: "25.00000000" });
    expect((await createAudit(purchase.id))[0].details).toMatchObject({ fxRateBasis: policy, openingBasis: "declared_record_only_v1" });
    await sell(created.body.data.id, "5", "15.00").expect(201);
    // Proceeds 15 x 25 = 375.00 less the declared 250.00.
    expect((await summary().expect(200)).body).toMatchObject({ realizedGains: "125.00", currency: "ZMW" });
  });

  it("F2: refuses a declared opening whose rate disagrees with the dated rate, and stores nothing", async () => {
    await seedDatedFxRate(a, actors.get("owner")!.id, "25");
    const refused = await opening({ costBasisZmw: "200.00", acquisitionFxRate: "20" });
    expect(refused.status).toBe(400);
    expect(await db.select().from(holdings).where(eq(holdings.securityId, securityId))).toEqual([]);
    expect(await activity()).toEqual([]);
  });

  it("F2: refuses a declared opening base when no rate exists for its date, naming the pair and the date", async () => {
    const refused = await opening({ costBasisZmw: "200.00", acquisitionFxRate: "20" });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toMatchObject({ code: "MISSING_FX_RATE", details: { from: "USD", to: "ZMW", date: "2020-01-01" } });
    expect(await db.select().from(holdings).where(eq(holdings.securityId, securityId))).toEqual([]);
  });

  it("F2: keeps an opening with no declared base unknown rather than inventing one", async () => {
    await seedDatedFxRate(a, actors.get("owner")!.id, "25");
    await opening().expect(201);
    expect((await activity())[0]).toMatchObject({ amountZmw: null, fxRate: null });
    expect((await lots())[0]).toMatchObject({ costBasisZmw: null, acquisitionFxRate: null });
  });
});
