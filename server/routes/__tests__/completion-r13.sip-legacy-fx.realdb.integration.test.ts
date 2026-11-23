import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { accounts, auditLogs, holdings, investmentOpeningOperationReceipts, investmentPlanAuthorizations, investmentPlanOperations,
  investmentPurchaseAuthorizationProofs, investmentSipConfirmations, investmentSipConfirmedFills,
  investmentSipOccurrenceFences, investmentSipOccurrences, investmentSipPurchaseReservations, investmentTransactions, recurringExecutionLog,
  recurringInvestments, securities, taxLotDisposals, taxLots, transactions, householdFxRateOverrides } from "@shared/schema";
import { db, pool } from "../../db";
import { processDueInvestments } from "../../services/investment/processDueInvestments";
import { digestSipFillProofTerms } from "../../services/investment/sipFillProofContract";
import * as tradeHistory from "../../modules/investments/investmentTradeHistory";
import { a, b, actors, app, ids, reset, start, stop } from "../../modules/tags/__tests__/completion-r04.tags.fixture";
import { seedDatedFxRate } from "../../testing/fixtures/dated-fx-rate";

// SOURCE ONLY / UNRUN. Corrected0029, shared mapping/router composition and
// Main's protected serial window are prerequisites; no historical v1 proof is seeded.
const securityId = randomUUID(), originalDate = "2020-01-01", laterDate = "2021-01-01";
let dueDate: string;
function signed(path: string) {
  const actor = actors.get("member")!;
  return request(app).post(path).set("Cookie", actor.cookie)
    .set("X-Capital-Subject", actor.id).set("X-Capital-Household", a);
}
async function plan() {
  const response = await signed("/api/investments/recurring").send({ operationId: randomUUID(), accountId: ids.sharedAccount, securityId, type: "sip",
    frequency: "monthly", amount: "4.00", currency: "USD", nextExecutionDate: dueDate }).expect(200);
  expect(response.body.data).toMatchObject({ householdId: a, accountId: ids.sharedAccount, securityId, amount: "4.00",
    currency: "USD", nextExecutionDate: dueDate, isActive: true });
  const id = response.body.data.id as string, before = await effects();
  expect(await processDueInvestments()).toMatchObject({ success: 0, held: 1, failed: 0, skipped: 0, errors: [] });
  const held = await effects();
  for (const key of ["holdings", "activity", "lots", "disposals", "accounts", "cash", "openings", "audits", "instruments",
    "authorizations", "operations", "reservations", "proofs", "logs", "confirmations", "fills"] as const) {
    expect(held[key], `Held materialization changed ${key}`).toEqual(before[key]);
  }
  expect(held.fences).toEqual([expect.objectContaining({ planId: id, originalDueDate: dueDate, terminal: false })]);
  expect(held.occurrences).toEqual([expect.objectContaining({ planId: id, originalDueDate: dueDate,
    householdId: a, accountId: ids.sharedAccount, securityId, plannedAmount: "4.00", currency: "USD",
    authorizedFrequency: "monthly", authorizedInitialDate: dueDate, occurrenceRevision: 0, state: "pending" })]);
  const advanced = held.plans.find(row => row.id === id)!;
  expect(advanced.nextExecutionDate > dueDate).toBe(true);
  expect(held.plans).toEqual([{ ...before.plans[0], nextExecutionDate: advanced.nextExecutionDate, updatedAt: advanced.updatedAt }]);
  // These declared actual facts are independent of both the plan and reference quote.
  const command = { operationId: randomUUID(), expectedRevision: 0, finalStatement: true, outcome: "filled",
    fills: [{ executionDate: dueDate, quantity: "2.00000000", price: "2.0000", fees: "0.00" }] };
  return { id, scheduledDate: dueDate, command };
}
type Pending = Awaited<ReturnType<typeof plan>>;
function confirmation(pending: Pending) {
  return signed(`/api/investments/recurring/${pending.id}/occurrences/${pending.scheduledDate}/confirm`).send(pending.command);
}
async function legacy(fields: Partial<typeof holdings.$inferInsert> = {}) {
  const [row] = await db.insert(holdings).values({ householdId: a, accountId: ids.sharedAccount, securityId, quantity: "5",
    costBasis: "10.00", costBasisZmw: "200.00", acquisitionFxRate: "20.0000", acquiredDate: originalDate, ...fields }).returning(); return row;
}
async function effects() {
  return {
    holdings: await db.select().from(holdings).where(inArray(holdings.householdId, [a, b])).orderBy(holdings.id),
    activity: await db.select().from(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b])).orderBy(investmentTransactions.id),
    lots: await db.select().from(taxLots).where(inArray(taxLots.householdId, [a, b])).orderBy(taxLots.id),
    disposals: await db.select().from(taxLotDisposals).where(inArray(taxLotDisposals.householdId, [a, b])).orderBy(taxLotDisposals.id),
    accounts: await db.select().from(accounts).where(inArray(accounts.householdId, [a, b])).orderBy(accounts.id),
    cash: await db.select().from(transactions).where(inArray(transactions.householdId, [a, b])).orderBy(transactions.id),
    plans: await db.select().from(recurringInvestments).where(inArray(recurringInvestments.householdId, [a, b])).orderBy(recurringInvestments.id),
    instruments: await db.select().from(securities).where(eq(securities.id, securityId)),
    logs: await db.select().from(recurringExecutionLog).where(inArray(recurringExecutionLog.recurringInvestmentId,
      db.select({ id: recurringInvestments.id }).from(recurringInvestments).where(inArray(recurringInvestments.householdId, [a, b])),
    )).orderBy(recurringExecutionLog.id),
    authorizations: await db.select().from(investmentPlanAuthorizations).where(inArray(investmentPlanAuthorizations.householdId, [a, b]))
      .orderBy(investmentPlanAuthorizations.id),
    operations: await db.select().from(investmentPlanOperations).where(inArray(investmentPlanOperations.householdId, [a, b]))
      .orderBy(investmentPlanOperations.actorUserId, investmentPlanOperations.operationId),
    reservations: await db.select().from(investmentSipPurchaseReservations).where(inArray(investmentSipPurchaseReservations.authorizationId,
      db.select({ id: investmentPlanAuthorizations.id }).from(investmentPlanAuthorizations)
        .where(inArray(investmentPlanAuthorizations.householdId, [a, b])),
    )).orderBy(investmentSipPurchaseReservations.purchaseId),
    proofs: await db.select().from(investmentPurchaseAuthorizationProofs).where(inArray(investmentPurchaseAuthorizationProofs.purchaseId,
      db.select({ id: investmentTransactions.id }).from(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b])),
    )).orderBy(investmentPurchaseAuthorizationProofs.purchaseId),
    fences: await db.select().from(investmentSipOccurrenceFences).where(inArray(investmentSipOccurrenceFences.planId,
      db.select({ id: recurringInvestments.id }).from(recurringInvestments).where(inArray(recurringInvestments.householdId, [a, b])),
    )).orderBy(investmentSipOccurrenceFences.planId, investmentSipOccurrenceFences.originalDueDate),
    occurrences: await db.select().from(investmentSipOccurrences).where(inArray(investmentSipOccurrences.householdId, [a, b]))
      .orderBy(investmentSipOccurrences.planId, investmentSipOccurrences.originalDueDate),
    confirmations: await db.select().from(investmentSipConfirmations).where(inArray(investmentSipConfirmations.householdId, [a, b]))
      .orderBy(investmentSipConfirmations.id),
    fills: await db.select().from(investmentSipConfirmedFills).where(inArray(investmentSipConfirmedFills.confirmationId,
      db.select({ id: investmentSipConfirmations.id }).from(investmentSipConfirmations)
        .where(inArray(investmentSipConfirmations.householdId, [a, b])),
    )).orderBy(investmentSipConfirmedFills.confirmationId, investmentSipConfirmedFills.fillIndex),
    openings: await db.select().from(investmentOpeningOperationReceipts).where(inArray(investmentOpeningOperationReceipts.householdId, [a, b]))
      .orderBy(investmentOpeningOperationReceipts.operationId),
    // This serial protected fixture owns its synthetic target. Include every
    // audit so an actorless/null-household observation cannot escape equality.
    audits: await db.select().from(auditLogs).orderBy(auditLogs.id),
  };
}
async function clean() {
  await db.delete(recurringInvestments).where(inArray(recurringInvestments.householdId, [a, b]));
  await db.delete(taxLotDisposals).where(inArray(taxLotDisposals.householdId, [a, b]));
  await db.delete(taxLots).where(inArray(taxLots.householdId, [a, b]));
  await db.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b]));
  await db.delete(holdings).where(inArray(holdings.householdId, [a, b]));
  await db.delete(securities).where(eq(securities.id, securityId));
  await db.delete(auditLogs).where(inArray(auditLogs.householdId, [a, b]));
  await db.delete(householdFxRateOverrides).where(eq(householdFxRateOverrides.householdId, a));
}
async function refuseAndRetry(pending: Pending, before: Awaited<ReturnType<typeof effects>>) {
  const secrets = [...before.holdings.map(row => row.id), ...before.activity.map(row => row.id), ...before.lots.map(row => row.id),
    ...before.accounts.map(row => row.id), ...before.audits.map(row => row.id),
    securityId, originalDate, "10.00", "200.00", "20.0000", "0.00", "0.0000"];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await confirmation(pending).expect(500);
    expect(response.body).toEqual({ success: false, error: { code: "INTERNAL_ERROR",
      message: "Occurrence confirmation is unavailable; retry with the original operation.", timestamp: expect.any(String) } });
    expect(response.body).not.toHaveProperty("data");
    // Current plain FX-source/NOWAIT failures are opaque HTTP500. The same
    // command leaves pending closure, financial rows, audits and logs unchanged.
    // The server's per-request timestamp is not acquisition evidence; compare
    // source secrets against the message within the exact allowlisted envelope.
    for (const secret of secrets) expect(response.body.error.message).not.toContain(secret);
    expect(await effects()).toEqual(before);
  }
}
/** #242 P2-2: a foreign fill adds its dated base (100.00) to a known holding base,
 * and an unknown base on a held position stays unknown (null). */
async function confirmRecorded(pending: Pending, holdingBaseZmw: string | null = null) {
  const before = await effects(), response = await confirmation(pending).expect(200);
  const result = response.body.data.occurrence.result;
  expect(result).toMatchObject({ outcome: "filled", fills: [{ fillIndex: 0, ...pending.command.fills[0], amount: "4.00" }],
    totals: { grossAmount: "4.00", fees: "0.00", amount: "4.00" } });
  expect(result.fills).toHaveLength(1);
  const purchaseId: string = result.fills[0].purchaseId, after = await effects();
  const purchase = after.activity.find(row => row.id === purchaseId)!;
  expect(purchase).toMatchObject({ householdId: a, accountId: ids.sharedAccount, securityId, type: "buy",
    transactionDate: pending.scheduledDate, quantity: "2.00000000", price: "2.0000", fees: "0.00", amount: "4.00",
    // #236 F1: the fill takes the dated 25 on its execution date (seeded from 2022).
    currency: "USD", amountZmw: "100.00", fxRate: "25.00000000", linkedTransactionId: null });
  expect(after.holdings.find(row => row.id === purchase.holdingId)).toMatchObject({
    householdId: a, accountId: ids.sharedAccount, securityId, costBasisZmw: holdingBaseZmw, acquisitionFxRate: null,
  });
  expect(after.lots.filter(row => row.transactionId === purchaseId)).toEqual([expect.objectContaining({
    householdId: a, holdingId: purchase.holdingId, quantity: "2.00000000", remainingQuantity: "2.00000000",
    costBasis: "4.00", costBasisZmw: "100.00", acquisitionFxRate: "25.00000000", acquiredDate: pending.scheduledDate,
  })]);
  expect(after.activity).toHaveLength(before.activity.length + 1);
  expect(after.lots).toHaveLength(before.lots.length + 1);
  for (const key of ["accounts", "cash", "disposals", "openings", "plans", "logs", "instruments",
    "authorizations", "operations", "reservations"] as const) expect(after[key]).toEqual(before[key]);
  for (const original of before.activity) expect(after.activity.find(row => row.id === original.id)).toEqual(original);
  for (const original of before.lots) expect(after.lots.find(row => row.id === original.id)).toEqual(original);
  for (const original of before.audits) expect(after.audits.find(row => row.id === original.id)).toEqual(original);
  const proof = after.proofs.filter(row => row.purchaseId === purchaseId);
  expect(proof).toHaveLength(1);
  expect(proof[0]).toMatchObject({ authorUserId: actors.get("member")!.id, authorizationContractVersion: 2,
    authorizedFrequency: "monthly", authorizedInitialDate: pending.scheduledDate });
  expect(Object.keys(proof[0]).sort()).toEqual(["purchaseId", "authorUserId", "authorizedAt", "authorizationContractVersion",
    "authorizedFrequency", "authorizedInitialDate", "authorizedTermsDigest"].sort());
  expect(proof[0].authorizedTermsDigest).toBe(digestSipFillProofTerms({
    contractVersion: 2, contractType: "record_only_sip_actual_fill", accountId: purchase.accountId,
    securityId: purchase.securityId, quantity: purchase.quantity, price: purchase.price, fees: purchase.fees,
    amount: purchase.amount, currency: purchase.currency, executionDate: purchase.transactionDate,
    authorizedFrequency: proof[0].authorizedFrequency, authorizedInitialDate: proof[0].authorizedInitialDate,
    fxRate: purchase.fxRate, amountZmw: purchase.amountZmw,
  }));
  expect(after.proofs).toHaveLength(before.proofs.length + 1);
  for (const original of before.proofs) expect(after.proofs.find(row => row.purchaseId === original.purchaseId)).toEqual(original);
  const receipts = after.confirmations.filter(row => row.planId === pending.id);
  expect(receipts).toEqual([expect.objectContaining({ originalDueDate: pending.scheduledDate,
    householdId: a, actorUserId: actors.get("member")!.id, operationId: pending.command.operationId, outcome: "filled", fillCount: 1 })]);
  const receipt = receipts[0];
  expect((await pool.query<{ same_instant: boolean }>(`
    select p.authorized_at = c.authorized_at as same_instant
    from investment_purchase_authorization_proofs p
    join investment_sip_confirmed_fills f on f.purchase_id=p.purchase_id
    join investment_sip_confirmations c on c.id=f.confirmation_id
    where p.purchase_id=$1 and c.id=$2 and c.plan_id=$3 and c.original_due_date=$4
      and c.household_id=$5 and c.actor_user_id=$6 and p.author_user_id=$6`,
  [purchaseId, receipt.id, pending.id, pending.scheduledDate, a, actors.get("member")!.id])).rows).toEqual([{ same_instant: true }]);
  expect(after.fills.filter(row => row.confirmationId === receipt.id)).toEqual([expect.objectContaining({ purchaseId,
    fillIndex: 0, postingConfirmed: true, ...pending.command.fills[0], amount: "4.00" })]);
  expect(after.occurrences.filter(row => row.planId === pending.id)).toEqual([expect.objectContaining({
    originalDueDate: pending.scheduledDate, state: "closed", occurrenceRevision: 1,
  })]);
  expect(after.fences.filter(row => row.planId === pending.id)).toEqual([expect.objectContaining({
    originalDueDate: pending.scheduledDate, terminal: true,
  })]);
  expect(after.audits.filter(row => row.entityId === purchaseId)).toEqual([expect.objectContaining({
    userId: actors.get("member")!.id, householdId: a, action: "CREATE", entityType: "investment_transaction",
    details: { newValue: { type: "buy", accountId: purchase.accountId, holdingId: purchase.holdingId,
      securityId, quantity: "2.00000000", amount: "4.00", currency: "USD", transactionDate: pending.scheduledDate,
      price: "2.0000", fees: "0.00", feesDeclared: true, fxRate: "25.00000000", amountZmw: "100.00" },
      fxRateBasis: "dated_household_then_provider_fx_v1",
      // 0047: the audit names the dated household rate row it used (seeded from 2022).
      fxRateSource: { kind: "household", id: expect.stringMatching(/^[0-9a-f-]{36}$/), date: "2022-01-01" } },
  })]);
  expect(after.audits.filter(row => row.entityId === receipt.id)).toEqual([expect.objectContaining({
    userId: actors.get("member")!.id, householdId: null, action: "CREATE", entityType: "investment_sip_confirmation",
    details: { authorizationEvent: "sip_final_confirmation_v1", requestVersion: 1 },
  })]);
  expect(after.audits).toHaveLength(before.audits.length + 2);
  const replay = await confirmation(pending).expect(200);
  expect(replay.body).toEqual(response.body);
  expect(await effects()).toEqual(after);
  return after;
}
async function opening(cost = "10.00", base = "200.00") {
  const response = await signed("/api/investments/holdings").send({ operationId: randomUUID(), expectedCurrency: "USD",
    accountId: ids.sharedAccount, securityId, quantity: "5", costBasis: cost, costBasisZmw: base,
    acquisitionFxRate: "20", acquiredDate: originalDate }).expect(201); return response.body.data.id as string;
}
function sourceRow(before: Awaited<ReturnType<typeof effects>>, source: "purchase" | "lot" | "audit") {
  const purchaseId = before.activity[0].id;
  return source === "purchase" ? { table: "investment_transactions", id: purchaseId }
    : source === "lot" ? { table: "tax_lots", id: before.lots[0].id }
    : { table: "audit_logs", id: before.audits.find(row => row.entityType === "investment_transaction" && row.entityId === purchaseId)!.id };
}

describe("UNVERIFIED SIP legacy FX admission preserves original evidence before any top-up mutation", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clean(); await reset(); dueDate = new Date().toISOString().slice(0, 10); await seedDatedFxRate(a, actors.get("owner")!.id, "20", { validThrough: "2021-12-31" }); await seedDatedFxRate(a, actors.get("owner")!.id, "25", { effectiveDate: "2022-01-01" });
    const owner = actors.get("owner")!;
    await request(app).put("/api/investments/calendar").set("Cookie", owner.cookie)
      .set("X-Capital-Subject", owner.id).set("X-Capital-Household", a).send({ timeZone: "UTC" }).expect(200);
    await db.insert(securities).values({ id: securityId, symbol: "SIP_FX_GUARD", name: "Synthetic foreign SIP provenance", type: "stock",
      currency: "USD", currentPrice: "7.1234" });
  });
  afterEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => { await clean(); await stop(); });

  it.each([
    { name: "legacy base and rate", costBasisZmw: "200.00", acquisitionFxRate: "20.0000" },
    { name: "legacy base only", costBasisZmw: "200.00", acquisitionFxRate: null },
    { name: "legacy rate only", costBasisZmw: null, acquisitionFxRate: "20.0000" },
    { name: "explicit zero base", costBasisZmw: "0.00", acquisitionFxRate: null },
    { name: "explicit zero rate", costBasisZmw: null, acquisitionFxRate: "0.0000" },
    { name: "explicit zero base and rate", costBasisZmw: "0.00", acquisitionFxRate: "0.0000" },
  ])("retains $name exactly when no original acquisition source exists, including retry", async ({ name: _name, ...fields }) => {
    const row = await legacy(fields), pending = await plan(), before = await effects();
    // 0047 widened holdings.acquisition_fx_rate to 8 places: the same value reads back as "20.00000000".
    const stored = { ...fields, acquisitionFxRate: fields.acquisitionFxRate === null ? null : `${fields.acquisitionFxRate}0000` };
    expect(before.holdings).toEqual([expect.objectContaining({ id: row.id, acquiredDate: originalDate, ...stored })]);
    expect(before.activity).toEqual([]); expect(before.lots).toEqual([]); await refuseAndRetry(pending, before);
  });

  it("refuses unsupported stored FX before attempting the existing holding UPDATE, not merely after rollback", async () => {
    const row = await legacy(), pending = await plan(), before = await effects(), probe = `r13_sip_phase_${randomUUID().replace(/-/g, "")}`;
    try {
      // Sequence advancement survives a transaction rollback, so this records
      // an attempted mutation without fabricating financial/provenance rows.
      await pool.query(`CREATE SEQUENCE public."${probe}"`);
      await pool.query(`CREATE FUNCTION public."${probe}"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
        BEGIN PERFORM nextval('public."${probe}"'::regclass); RETURN NEW; END $body$`);
      await pool.query(`CREATE TRIGGER "${probe}" BEFORE UPDATE ON public.holdings FOR EACH ROW
        WHEN (OLD.id='${row.id}'::uuid) EXECUTE FUNCTION public."${probe}"()`);
      await refuseAndRetry(pending, before);
      expect((await pool.query<{ is_called: boolean }>(`select is_called from public."${probe}"`)).rows).toEqual([{ is_called: false }]);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS "${probe}" ON public.holdings`);
      await pool.query(`DROP FUNCTION IF EXISTS public."${probe}"()`);
      await pool.query(`DROP SEQUENCE IF EXISTS public."${probe}"`);
    }
  });

  it.each(["complete numeric match", "unproven additional quantity"])("does not borrow a genuine unrelated later BUY/lot as original FX proof: %s", async scenario => {
    const row = await legacy(scenario === "unproven additional quantity" ? { quantity: "7", costBasis: "14.00" } : {}), otherAccount = randomUUID();
    await db.insert(accounts).values({ id: otherAccount, householdId: a, name: "Synthetic later acquisition custody", type: "investment",
      currency: "USD", balance: "0", isPrivate: false, ownerUserId: actors.get("member")!.id });
    const [other] = await db.insert(holdings).values({ householdId: a, accountId: otherAccount, securityId,
      quantity: "0", costBasis: "0", acquiredDate: laterDate }).returning();
    const bought = await signed("/api/investments/transactions").send({ accountId: otherAccount, securityId, holdingId: other.id,
      type: "buy", quantity: "5", price: "2", amount: "10.00", amountZmw: "200.00", fxRate: "20", currency: "USD", transactionDate: laterDate }).expect(201);
    // Deliberate legacy rebind damage moves a REAL other position's BUY/lot.
    // Its genuine signed audit still binds the other holding; matching current
    // quantities/base/rate cannot turn it into this legacy original purchase.
    await db.update(investmentTransactions).set({ holdingId: row.id }).where(eq(investmentTransactions.id, bought.body.data.id));
    await db.update(taxLots).set({ holdingId: row.id }).where(eq(taxLots.transactionId, bought.body.data.id));
    const pending = await plan(), before = await effects();
    expect(before.activity).toEqual([expect.objectContaining({ id: bought.body.data.id, holdingId: row.id, transactionDate: laterDate, amountZmw: "200.00", fxRate: "20.00000000" })]);
    expect(before.lots).toEqual([expect.objectContaining({ transactionId: bought.body.data.id, acquiredDate: laterDate, costBasisZmw: "200.00", acquisitionFxRate: "20.00000000" })]);
    expect(before.audits.filter(audit => audit.entityId === bought.body.data.id)).toEqual([expect.objectContaining({
      userId: actors.get("member")!.id, householdId: a, action: "CREATE", entityType: "investment_transaction", entityId: bought.body.data.id,
      details: expect.objectContaining({ newValue: expect.objectContaining({ type: "buy", accountId: otherAccount,
        holdingId: other.id, securityId, transactionDate: laterDate }) }),
    })]);
    expect(before.holdings.find(holding => holding.id === row.id)).toMatchObject({ acquiredDate: originalDate, acquisitionFxRate: "20.00000000" });
    await refuseAndRetry(pending, before);
  });

  it("requires the genuine original audit binding even when a damaged source matches every current account/date/economic field", async () => {
    const row = await legacy(), otherAccount = randomUUID();
    await db.insert(accounts).values({ id: otherAccount, householdId: a, name: "Synthetic same-date other custody", type: "investment",
      currency: "USD", balance: "0", isPrivate: false, ownerUserId: actors.get("member")!.id });
    const [other] = await db.insert(holdings).values({ householdId: a, accountId: otherAccount, securityId,
      quantity: "0", costBasis: "0", acquiredDate: originalDate }).returning();
    const bought = await signed("/api/investments/transactions").send({ accountId: otherAccount, securityId, holdingId: other.id,
      type: "buy", quantity: "5", price: "2", amount: "10.00", amountZmw: "200.00", fxRate: "20", currency: "USD", transactionDate: originalDate }).expect(201);
    const genuineAudit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, bought.body.data.id));
    expect(genuineAudit).toEqual([expect.objectContaining({ userId: actors.get("member")!.id, householdId: a,
      action: "CREATE", entityType: "investment_transaction", entityId: bought.body.data.id,
      details: expect.objectContaining({ newValue: expect.objectContaining({ type: "buy", accountId: otherAccount,
        holdingId: other.id, securityId, transactionDate: originalDate }) }) })]);
    // Explicit SQL damage, NOT an HTTP attestation: rewrite BOTH current trade
    // bindings and the lot holding. The genuine original audit stays untouched.
    await db.update(investmentTransactions).set({ accountId: ids.sharedAccount, holdingId: row.id }).where(eq(investmentTransactions.id, bought.body.data.id));
    await db.update(taxLots).set({ holdingId: row.id }).where(eq(taxLots.transactionId, bought.body.data.id));
    const matched = await pool.query(`select
      h.household_id=p.household_id and h.household_id=l.household_id as same_household,
      h.account_id=p.account_id as same_current_account,
      h.id=p.holding_id and h.id=l.holding_id and l.transaction_id=p.id as same_current_holding,
      h.security_id=p.security_id and p.currency=s.currency as same_instrument_units,
      h.acquired_date=p.transaction_date and h.acquired_date=l.acquired_date as same_date,
      h.quantity=p.quantity and h.quantity=l.quantity and l.remaining_quantity=l.quantity as same_quantity,
      h.cost_basis=p.amount and h.cost_basis=l.cost_basis and p.price*p.quantity=p.amount as same_native,
      h.cost_basis_zmw=p.amount_zmw and h.cost_basis_zmw=l.cost_basis_zmw as same_base,
      h.acquisition_fx_rate=p.fx_rate and h.acquisition_fx_rate=l.acquisition_fx_rate
        and p.amount*p.fx_rate=p.amount_zmw as same_rate_equation,
      not exists(select 1 from tax_lot_disposals d where d.holding_id=h.id or d.tax_lot_id=l.id) as no_disposals,
      not exists(select 1 from tax_lots sibling where sibling.transaction_id=p.id and sibling.id<>l.id) as unique_lot_claim
      from holdings h join investment_transactions p on p.holding_id=h.id join tax_lots l on l.transaction_id=p.id
      join securities s on s.id=h.security_id where h.id=$1 and p.id=$2`, [row.id, bought.body.data.id]);
    expect(matched.rows).toEqual([{ same_household: true, same_current_account: true, same_current_holding: true,
      same_instrument_units: true, same_date: true, same_quantity: true, same_native: true, same_base: true,
      same_rate_equation: true, no_disposals: true, unique_lot_claim: true }]);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.entityId, bought.body.data.id))).toEqual(genuineAudit);
    const pending = await plan(), before = await effects(); await refuseAndRetry(pending, before);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.entityId, bought.body.data.id))).toEqual(genuineAudit);
  });

  it("keeps a foreign unknown-base/rate legacy top-up supported without manufacturing an opening", async () => {
    const row = await legacy({ costBasisZmw: null, acquisitionFxRate: null }), pending = await plan();
    const after = await confirmRecorded(pending); expect(after.holdings).toEqual([expect.objectContaining({ id: row.id, quantity: "7.00000000", costBasis: "14.00",
      costBasisZmw: null, acquisitionFxRate: null, acquiredDate: originalDate })]);
    expect(after.activity).toHaveLength(1); expect(after.lots).toEqual([expect.objectContaining({ quantity: "2.00000000", costBasis: "4.00", costBasisZmw: "100.00", acquisitionFxRate: "25.00000000" })]);
    const beforeSale = await effects(); await signed("/api/investments/transactions").send({ accountId: ids.sharedAccount, securityId, holdingId: row.id,
      type: "sell", quantity: "1", price: "3", amount: "3.00", currency: "USD", transactionDate: dueDate }).expect(409);
    expect(await effects()).toEqual(beforeSale);
  });

  it("uses actual disposal residuals when a declared foreign opening is partly sold before the next SIP", async () => {
    const holdingId = await opening();
    await signed("/api/investments/transactions").send({ accountId: ids.sharedAccount, securityId, holdingId, type: "sell", quantity: "2",
      price: "3", amount: "6.00", amountZmw: "150.00", fxRate: "25", currency: "USD", transactionDate: dueDate }).expect(201);
    const pending = await plan(), before = await effects();
    expect(before.holdings[0]).toMatchObject({ quantity: "3.00000000", costBasis: "6.00", costBasisZmw: "120.00", acquisitionFxRate: null });
    expect(before.disposals).toEqual([expect.objectContaining({ quantity: "2.00000000", costBasis: "4.00", costBasisZmw: "80.00" })]);
    const after = await confirmRecorded(pending, "220.00");
    expect(after.holdings[0]).toMatchObject({ id: holdingId, quantity: "5.00000000", costBasis: "10.00", costBasisZmw: "220.00", acquisitionFxRate: null });
    for (const original of before.activity) expect(after.activity.find(row => row.id === original.id)).toEqual(original);
    for (const original of before.lots) expect(after.lots.find(row => row.id === original.id)).toEqual(original);
    expect(after.disposals).toEqual(before.disposals); expect(after.openings).toEqual(before.openings);
    expect(after.accounts).toEqual(before.accounts); expect(after.cash).toEqual(before.cash);
    for (const original of before.audits) expect(after.audits.find(row => row.id === original.id)).toEqual(original);
    expect(after.logs).toEqual(before.logs);
  });

  it("recognizes a genuine original dated BUY/lot without inventing a holding creator or requiring an opening receipt", async () => {
    const row = await legacy({ quantity: "0", costBasis: "0", costBasisZmw: null, acquisitionFxRate: null });
    const bought = await signed("/api/investments/transactions").send({ accountId: ids.sharedAccount, securityId, holdingId: row.id,
      type: "buy", quantity: "5", price: "2", amount: "10.00", amountZmw: "200.00", fxRate: "20", currency: "USD", transactionDate: originalDate }).expect(201);
    // Legacy aggregate rate is independently supported by this actual original
    // purchase/lot and its genuine target-binding audit, not a later rebind.
    await db.update(holdings).set({ acquisitionFxRate: "20.0000" }).where(eq(holdings.id, row.id));
    const pending = await plan(), before = await effects();
    expect(before.audits.filter(audit => audit.entityId === row.id && audit.entityType === "holding")).toEqual([]);
    expect(before.audits.filter(audit => audit.entityId === bought.body.data.id)).toEqual([expect.objectContaining({
      userId: actors.get("member")!.id, householdId: a, action: "CREATE", entityType: "investment_transaction", entityId: bought.body.data.id,
      details: expect.objectContaining({ newValue: expect.objectContaining({ type: "buy", accountId: ids.sharedAccount,
        holdingId: row.id, securityId, transactionDate: originalDate }) }),
    })]);
    const after = await confirmRecorded(pending, "300.00");
    expect(after.holdings.find(holding => holding.id === row.id)).toMatchObject({ quantity: "7.00000000", costBasis: "14.00", costBasisZmw: "300.00", acquisitionFxRate: null });
    expect(after.activity.find(purchase => purchase.id === bought.body.data.id)).toEqual(before.activity[0]);
    expect(after.lots.find(lot => lot.id === before.lots[0].id)).toEqual(before.lots[0]);
    expect(after.openings).toEqual(before.openings); expect(after.accounts).toEqual(before.accounts); expect(after.cash).toEqual(before.cash);
  });

  it("allows proven original zero base from an actual declared gift while retaining that original zero evidence", async () => {
    const holdingId = await opening("0.00", "0.00"), before = await effects(), pending = await plan();
    expect(before.activity).toEqual([expect.objectContaining({ holdingId, amount: "0.00", amountZmw: "0.00", fxRate: "20.00000000" })]);
    const after = await confirmRecorded(pending, "100.00");
    expect(after.holdings[0]).toMatchObject({ id: holdingId, quantity: "7.00000000", costBasis: "4.00", costBasisZmw: "100.00", acquisitionFxRate: null });
    expect(after.activity.find(row => row.id === before.activity[0].id)).toEqual(before.activity[0]);
    expect(after.lots.find(row => row.id === before.lots[0].id)).toEqual(before.lots[0]); expect(after.openings).toEqual(before.openings);
    expect(after.accounts).toEqual(before.accounts); expect(after.cash).toEqual(before.cash);
    for (const original of before.audits) expect(after.audits.find(row => row.id === original.id)).toEqual(original);
  });

  it.each(["acquiredDate", "acquisitionFxRate"] as const)("refuses a genuine opening whose original %s audit has changed", async field => {
    const holdingId = await opening(), pending = await plan();
    const [origin] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, holdingId));
    const replacement = field === "acquiredDate" ? laterDate : "21.0000";
    try {
      const changed = await pool.query(`update audit_logs set details=jsonb_set(details,array['newValue',$2]::text[],to_jsonb($3::text),false)
        where id=$1 returning details->'newValue'->>$2 as changed`, [origin.id, field, replacement]);
      expect(changed.rows).toEqual([{ changed: replacement }]);
      const before = await effects(); await refuseAndRetry(pending, before);
    } finally {
      // Restore the exact genuine audit that this fault changed, then submit the
      // original failed command. No replacement author, acquisition or proof is seeded.
      const restored = await db.update(auditLogs).set({ details: origin.details }).where(eq(auditLogs.id, origin.id)).returning();
      expect(restored).toEqual([origin]);
    }
    await confirmRecorded(pending, "300.00");
  });

  it.each(["purchase", "lot", "audit"] as const)("refuses rather than waits on a concurrently mutable original %s", async source => {
    await opening(); const pending = await plan(), before = await effects(), row = sourceRow(before, source), holder = await pool.connect();
    // Deterministic, not a wall-clock race: the holder keeps its row lock until
    // the refusal settles. A server that waited on the lock could only settle
    // after the watchdog released it, so `watchdogFired` proves waiting. The
    // deadline only breaks such a deadlock; it is not a speed budget, so a
    // loaded runner cannot fail an otherwise prompt NOWAIT refusal.
    const deadlockBreakerMs = 10_000;
    let watchdogFired = false;
    let refusalError: unknown, cleanupError: unknown;
    let watchdog: ReturnType<typeof setTimeout> | undefined, releaseTask: Promise<void> | undefined;
    const releaseHolder = () => releaseTask ??= (async () => {
      let discard = false;
      try { await holder.query("ROLLBACK"); }
      catch (error) { discard = true; throw error; }
      finally { holder.release(discard); }
    })();
    try {
      await holder.query("BEGIN");
      const locked = await holder.query(`select id from ${row.table} where id=$1 for update nowait`, [row.id]);
      expect(locked.rows).toEqual([{ id: row.id }]);
      watchdog = setTimeout(() => {
        watchdogFired = true;
        void releaseHolder().catch(error => { cleanupError = error; });
      }, deadlockBreakerMs);
      // Await the actual work even when the watchdog releases its blocker.
      // Racing a timer alone would leave a live executor behind after failure.
      try { await refuseAndRetry(pending, before); }
      catch (error) { refusalError = error; }
    } finally {
      if (watchdog !== undefined) clearTimeout(watchdog);
      try { await releaseHolder(); } catch (error) { cleanupError = error; }
    }
    expect(watchdogFired, "Refusal waited on the held lock: only the watchdog's release let it settle").toBe(false);
    if (cleanupError) throw cleanupError;
    if (refusalError) throw refusalError;
    // The holder is drained; the same signed command now records exactly once.
    await confirmRecorded(pending, "300.00");
  }, 30_000); // above the deadlock breaker, so a wait fails on watchdogFired, not a timeout

  it.each(["purchase", "lot", "audit"] as const)("fences a later original %s mutation until the actual SIP purchase commits", async source => {
    const holdingId = await opening(), pending = await plan(), before = await effects(), row = sourceRow(before, source);
    const record = tradeHistory.recordPurchaseLot;
    let probed = 0, lockCode: string | undefined;
    const gate = vi.spyOn(tradeHistory, "recordPurchaseLot").mockImplementationOnce(async (...args) => {
      expect(args[1]).toMatchObject({ holdingId, type: "buy", amount: "4.00", transactionDate: dueDate });
      const editor = await pool.connect();
      try {
        await editor.query("BEGIN"); await editor.query("SET LOCAL lock_timeout='100ms'");
        // An actual UPDATE conflicts with both source UPDATE and audit SHARE.
        // Always roll it back, even on the baseline that lacks those locks.
        await editor.query(`update ${row.table} set id=id where id=$1`, [row.id]);
      } catch (error) { lockCode = (error as { code?: string }).code; }
      finally { try { await editor.query("ROLLBACK"); } finally { editor.release(); } }
      probed++; return record(...args);
    });
    const after = await confirmRecorded(pending, "300.00");
    expect(gate).toHaveBeenCalledOnce(); expect(probed).toBe(1); expect(lockCode).toBe("55P03");
    expect(after.holdings.find(row => row.id === holdingId)).toMatchObject({ quantity: "7.00000000", costBasis: "14.00", costBasisZmw: "300.00", acquisitionFxRate: null });
    expect(after.activity).toHaveLength(before.activity.length + 1); expect(after.lots).toHaveLength(before.lots.length + 1);
    for (const original of before.activity) expect(after.activity.find(row => row.id === original.id)).toEqual(original);
    for (const original of before.lots) expect(after.lots.find(row => row.id === original.id)).toEqual(original);
    for (const original of before.audits) expect(after.audits.find(row => row.id === original.id)).toEqual(original);
    expect(after.disposals).toEqual(before.disposals); expect(after.openings).toEqual(before.openings);
    expect(after.accounts).toEqual(before.accounts); expect(after.cash).toEqual(before.cash);
  });
});
