import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, or } from "drizzle-orm";
import { accounts, auditLogs, holdings, investmentOpeningOperationReceipts, investmentTransactions,
  investmentPurchaseAuthorizationProofs, investmentSipConfirmations, investmentSipConfirmedFills,
  investmentSipOccurrences, recurringExecutionLog, recurringInvestments, securities, taxLotDisposals, taxLots, transactions, householdFxRateOverrides } from "@shared/schema";
import { db, pool } from "../../db";
import { a, actors, app, ids, reset, start, stop } from "../../modules/tags/__tests__/completion-r04.tags.fixture";
import { seedDatedFxRate } from "../../testing/fixtures/dated-fx-rate";
import { processDueInvestments } from "../../services/investment/processDueInvestments";
import { digestSipFillProofTerms } from "../../services/investment/sipFillProofContract";

// SOURCE ONLY / UNRUN. Requires the separately reviewed 0029, shared mapping
// and signed occurrence-router composition before Main schedules this caller.
const securityId = randomUUID();
let dueDate: string;
function signed(path: string) {
  const actor = actors.get("member")!;
  return request(app).post(path).set("Cookie", actor.cookie)
    .set("X-Capital-Subject", actor.id).set("X-Capital-Household", a);
}
async function duePlan(amount: string, currency = "ZMW") {
  // Exercise the existing public signed plan caller, then held materialization.
  // Each declaration has its own client operation identity and signed grant.
  const response = await signed("/api/investments/recurring").send({ operationId: randomUUID(), accountId: ids.sharedAccount, securityId,
    type: "sip", frequency: "monthly", amount, currency, nextExecutionDate: dueDate }).expect(200);
  expect(response.body).toMatchObject({ success: true, data: { householdId: a, accountId: ids.sharedAccount, securityId,
    type: "sip", amount, currency, nextExecutionDate: dueDate, isActive: true } });
  return response.body.data.id as string;
}
async function confirmFill(
  planId: string,
  fill: { executionDate: string; quantity: string; price: string; fees: string },
  amount: string,
  // #236 F1: a foreign fill takes the dated rate on its execution date.
  conversion: { fxRate: string | null; amountZmw: string | null } = { fxRate: null, amountZmw: null },
) {
  const before = await effects();
  expect(await processDueInvestments()).toMatchObject({ success: 0, held: 1, failed: 0 });
  const held = await effects();
  for (const field of ["holdings", "activity", "lots", "disposals", "accounts", "cash", "logs", "openings", "audits", "proofs"] as const) {
    expect(held[field], `Held materialization changed ${field}`).toEqual(before[field]);
  }
  const logs = await db.select().from(recurringExecutionLog).where(eq(recurringExecutionLog.recurringInvestmentId, planId));
  expect(logs).toEqual([]);
  expect(held.occurrences.filter(row => row.planId === planId)).toMatchObject([{
    originalDueDate: dueDate, state: "pending", occurrenceRevision: 0,
  }]);
  const plan = held.plans.find(row => row.id === planId)!;
  expect(plan.nextExecutionDate > dueDate).toBe(true);
  const input = {
    operationId: randomUUID(), expectedRevision: 0, finalStatement: true,
    outcome: "filled", fills: [fill],
  };
  const response = await signed(`/api/investments/recurring/${planId}/occurrences/${dueDate}/confirm`)
    .send(input).expect(200);
  const result = response.body.data.occurrence.result;
  expect(result).toMatchObject({
    outcome: "filled", fills: [{ fillIndex: 0, ...fill, amount }],
    totals: { grossAmount: amount, fees: "0.00", amount },
  });
  expect(result.fills).toHaveLength(1);
  const purchaseId: string = result.fills[0].purchaseId;
  const after = await effects();
  const purchase = after.activity.find(row => row.id === purchaseId)!;
  expect(purchase).toMatchObject({
    householdId: a, accountId: ids.sharedAccount, securityId, type: "buy",
    transactionDate: fill.executionDate, quantity: fill.quantity, price: fill.price,
    fees: fill.fees, amount, currency: plan.currency, ...conversion,
  });
  const proof = after.proofs.filter(row => row.purchaseId === purchaseId);
  expect(proof).toHaveLength(1);
  expect(proof).toMatchObject([{
    authorUserId: actors.get("member")!.id, authorizationContractVersion: 2,
    authorizedFrequency: "monthly", authorizedInitialDate: dueDate,
  }]);
  expect(Object.keys(proof[0]).sort()).toEqual([
    "purchaseId", "authorUserId", "authorizedAt", "authorizationContractVersion",
    "authorizedFrequency", "authorizedInitialDate", "authorizedTermsDigest",
  ].sort());
  expect(proof[0].authorizedTermsDigest).toBe(digestSipFillProofTerms({
    contractVersion: 2, contractType: "record_only_sip_actual_fill",
    accountId: purchase.accountId, securityId: purchase.securityId, quantity: purchase.quantity,
    price: purchase.price, fees: purchase.fees, amount: purchase.amount, currency: purchase.currency,
    executionDate: purchase.transactionDate, authorizedFrequency: proof[0].authorizedFrequency,
    authorizedInitialDate: proof[0].authorizedInitialDate, fxRate: purchase.fxRate, amountZmw: purchase.amountZmw,
  }));
  const receipt = after.confirmations.filter(row => row.planId === planId);
  expect(receipt).toMatchObject([{ actorUserId: actors.get("member")!.id, outcome: "filled", fillCount: 1 }]);
  // Compare in PostgreSQL so JS Date cannot hide sub-millisecond differences.
  const authorizationTimes = await pool.query<{ same_instant: boolean }>(`
    select p.authorized_at = c.authorized_at as same_instant
    from investment_purchase_authorization_proofs p
    join investment_sip_confirmed_fills f on f.purchase_id=p.purchase_id
    join investment_sip_confirmations c on c.id=f.confirmation_id
    where p.purchase_id=$1 and c.id=$2 and c.plan_id=$3 and c.original_due_date=$4
      and c.household_id=$5 and c.actor_user_id=$6 and p.author_user_id=$6`,
  [purchaseId, receipt[0].id, planId, dueDate, a, actors.get("member")!.id]);
  expect(authorizationTimes.rows).toEqual([{ same_instant: true }]);
  expect(after.fills.filter(row => row.confirmationId === receipt[0].id))
    .toMatchObject([{ purchaseId, postingConfirmed: true, ...fill }]);
  expect(after.occurrences.filter(row => row.planId === planId))
    .toMatchObject([{ state: "closed", occurrenceRevision: 1 }]);
  expect(after.audits.filter(row => row.entityId === purchaseId)).toMatchObject([{
    userId: actors.get("member")!.id, householdId: a, action: "CREATE", entityType: "investment_transaction",
    details: { newValue: { holdingId: purchase.holdingId, price: fill.price, fees: fill.fees, feesDeclared: true } },
  }]);
  expect(after.audits.filter(row => row.entityId === receipt[0].id)).toMatchObject([{
    userId: actors.get("member")!.id, householdId: null, action: "CREATE", entityType: "investment_sip_confirmation",
    details: { authorizationEvent: "sip_final_confirmation_v1", requestVersion: 1 },
  }]);
  expect(after.logs).toEqual(before.logs);
  return purchaseId;
}
function sale(holdingId: string, quantity: string, amount: string, currency = "ZMW") {
  return signed("/api/investments/transactions").send({ accountId: ids.sharedAccount, securityId, holdingId,
    type: "sell", quantity, price: "3", amount, fees: "0", currency, transactionDate: dueDate });
}
async function stored() { return (await db.select().from(holdings).where(eq(holdings.securityId, securityId)))[0]; }
async function effects() {
  return {
    holdings: await db.select().from(holdings).where(eq(holdings.householdId, a)).orderBy(holdings.id),
    activity: await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a)).orderBy(investmentTransactions.id),
    lots: await db.select().from(taxLots).where(eq(taxLots.householdId, a)).orderBy(taxLots.id),
    disposals: await db.select().from(taxLotDisposals).where(eq(taxLotDisposals.householdId, a)).orderBy(taxLotDisposals.id),
    accounts: await db.select().from(accounts).where(eq(accounts.householdId, a)).orderBy(accounts.id),
    cash: await db.select().from(transactions).where(eq(transactions.householdId, a)).orderBy(transactions.id),
    plans: await db.select().from(recurringInvestments).where(eq(recurringInvestments.householdId, a)).orderBy(recurringInvestments.id),
    logs: (await pool.query(`select l.* from recurring_execution_log l join recurring_investments p on p.id=l.recurring_investment_id
      where p.household_id=$1 order by l.id`, [a])).rows,
    openings: await db.select().from(investmentOpeningOperationReceipts).where(eq(investmentOpeningOperationReceipts.householdId, a))
      .orderBy(investmentOpeningOperationReceipts.operationId),
    audits: await db.select().from(auditLogs).where(or(eq(auditLogs.householdId, a),
      inArray(auditLogs.userId, Array.from(actors.values()).map(actor => actor.id)))).orderBy(auditLogs.id),
    proofs: await db.select().from(investmentPurchaseAuthorizationProofs).where(inArray(
      investmentPurchaseAuthorizationProofs.purchaseId,
      db.select({ id: investmentTransactions.id }).from(investmentTransactions).where(eq(investmentTransactions.householdId, a)),
    )).orderBy(investmentPurchaseAuthorizationProofs.purchaseId),
    occurrences: await db.select().from(investmentSipOccurrences).where(eq(investmentSipOccurrences.householdId, a))
      .orderBy(investmentSipOccurrences.planId, investmentSipOccurrences.originalDueDate),
    confirmations: await db.select().from(investmentSipConfirmations).where(eq(investmentSipConfirmations.householdId, a))
      .orderBy(investmentSipConfirmations.id),
    fills: await db.select().from(investmentSipConfirmedFills).where(inArray(
      investmentSipConfirmedFills.confirmationId,
      db.select({ id: investmentSipConfirmations.id }).from(investmentSipConfirmations).where(eq(investmentSipConfirmations.householdId, a)),
    )).orderBy(investmentSipConfirmedFills.confirmationId, investmentSipConfirmedFills.fillIndex),
  };
}
async function clean() {
  await db.delete(recurringInvestments).where(eq(recurringInvestments.householdId, a));
  await db.delete(taxLotDisposals).where(eq(taxLotDisposals.householdId, a));
  await db.delete(taxLots).where(eq(taxLots.householdId, a));
  await db.delete(investmentTransactions).where(eq(investmentTransactions.householdId, a));
  await db.delete(holdings).where(eq(holdings.householdId, a));
  await db.delete(securities).where(eq(securities.id, securityId));
  await db.delete(auditLogs).where(eq(auditLogs.householdId, a));
  // Immutable opening receipts survive until the fixture household is erased.
  await db.delete(householdFxRateOverrides).where(eq(householdFxRateOverrides.householdId, a));
}

describe("UNREVIEWED actual SIP confirmation preserves ordinary-sale and declared-opening dependencies", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clean(); await reset(); dueDate = new Date().toISOString().slice(0, 10); await seedDatedFxRate(a, actors.get("owner")!.id, "20");
    await db.insert(securities).values({ id: securityId, symbol: "SIPC" + securityId.slice(0, 8),
      name: "Synthetic SIP composition", type: "stock", currency: "ZMW", currentPrice: "2.00" });
    const owner = actors.get("owner")!;
    await request(app).put("/api/investments/calendar").set("Cookie", owner.cookie)
      .set("X-Capital-Subject", owner.id).set("X-Capital-Household", a)
      .send({ timeZone: "UTC" }).expect(200);
  });
  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  it("persists the actual remaining native cost through SIP, ordinary signed sale, then another actual SIP", async () => {
    const balances = await effects();
    const first = await confirmFill(await duePlan("10.00"),
      { executionDate: dueDate, quantity: "5.00000000", price: "2.0000", fees: "0.00" }, "10.00");
    const firstProof = (await effects()).proofs.find(row => row.purchaseId === first);
    const holding = await stored();
    expect(holding).toMatchObject({ quantity: "5.00000000", costBasis: "10.00" });
    const sold = await sale(holding.id, "2", "6.00").expect(201);
    expect(await stored()).toMatchObject({ quantity: "3.00000000", costBasis: "6.00" });
    expect((await pool.query(`select quantity::text,cost_basis::text,proceeds::text,realized_gain::text
      from tax_lot_disposals where transaction_id=$1`, [sold.body.data.id])).rows)
      .toEqual([{ quantity: "2.00000000", cost_basis: "4.00", proceeds: "6.00", realized_gain: "2.00" }]);
    const next = await confirmFill(await duePlan("4.00"),
      { executionDate: dueDate, quantity: "2.00000000", price: "2.0000", fees: "0.00" }, "4.00");
    const after = await effects();
    expect(after.holdings).toHaveLength(1);
    expect(after.holdings[0]).toMatchObject({ id: holding.id, quantity: "5.00000000", costBasis: "10.00" });
    expect(after.lots).toHaveLength(2);
    expect(after.lots).toEqual(expect.arrayContaining([
      expect.objectContaining({ transactionId: first, quantity: "5.00000000", remainingQuantity: "3.00000000", costBasis: "10.00" }),
      expect.objectContaining({ transactionId: next, quantity: "2.00000000", remainingQuantity: "2.00000000", costBasis: "4.00" }),
    ]));
    const reconciliation = (await pool.query(`select sum(l.remaining_quantity)::numeric(18,8)::text as quantity,
      sum(l.cost_basis-coalesce(d.used,0))::numeric(15,2)::text as native_basis,
      bool_and(l.quantity-l.remaining_quantity=coalesce(d.sold,0)) as quantities_reconcile
      from tax_lots l left join (select tax_lot_id,sum(cost_basis) as used,sum(quantity) as sold
        from tax_lot_disposals group by tax_lot_id) d on d.tax_lot_id=l.id where l.holding_id=$1`, [holding.id])).rows;
    expect(reconciliation).toEqual([{ quantity: "5.00000000", native_basis: "10.00", quantities_reconcile: true }]);
    const sipAudits = after.audits.filter(row => row.entityId === first || row.entityId === next);
    expect(sipAudits).toHaveLength(2);
    for (const audit of sipAudits) expect(audit).toMatchObject({ userId: actors.get("member")!.id,
      householdId: a, action: "CREATE", entityType: "investment_transaction",
      details: { newValue: { holdingId: holding.id, feesDeclared: true } } });
    expect(after.proofs).toHaveLength(2);
    expect(after.proofs.find(row => row.purchaseId === first)).toEqual(firstProof);
    expect(after.accounts).toEqual(balances.accounts); expect(after.cash).toEqual(balances.cash);
  });

  it("does not let a new SIP lot mask an unsupported old positive aggregate before explicit reconciliation", async () => {
    const [legacy] = await db.insert(holdings).values({ householdId: a, accountId: ids.sharedAccount, securityId,
      quantity: "5", costBasis: null, costBasisZmw: null, acquiredDate: "2020-01-01" }).returning();
    const purchase = await confirmFill(await duePlan("4.00"),
      { executionDate: dueDate, quantity: "2.00000000", price: "2.0000", fees: "0.00" }, "4.00");
    expect(await stored()).toMatchObject({ id: legacy.id, quantity: "7.00000000", costBasis: null, costBasisZmw: null });
    const before = await effects();
    expect(before.activity).toHaveLength(1); expect(before.lots).toHaveLength(1);
    expect(before.lots[0]).toMatchObject({ holdingId: legacy.id, transactionId: purchase,
      quantity: "2.00000000", remainingQuantity: "2.00000000", costBasis: "4.00" });
    const refused = await sale(legacy.id, "1", "3.00").expect(409);
    expect(refused.body).toMatchObject({ success: false, error: { code: "CONFLICT", message: "Investment sale sources are unavailable" } });
    expect(refused.body).not.toHaveProperty("data");
    for (const privateId of [legacy.id, purchase, before.lots[0].id]) expect(refused.text).not.toContain(privateId);
    expect(await effects()).toEqual(before);
    // No synthetic purchase, lot or cost edit stands in for an accepted legacy
    // reconciliation flow. That product flow remains OPEN.
  });

  it("retains a declared foreign opening's original base and rate while a new SIP adds its dated base to the aggregate", async () => {
    await db.update(securities).set({ currency: "USD" }).where(eq(securities.id, securityId));
    const balances = await effects(), operationId = randomUUID();
    const created = await signed("/api/investments/holdings").send({ operationId, expectedCurrency: "USD",
      accountId: ids.sharedAccount, securityId, quantity: "5", costBasis: "10.00", costBasisZmw: "200.00",
      acquisitionFxRate: "20", acquiredDate: "2020-01-01" }).expect(201);
    const holdingId = created.body.data.id as string, original = await effects();
    expect(original.activity).toHaveLength(1); expect(original.lots).toHaveLength(1);
    const openingBuy = original.activity[0], openingLot = original.lots[0];
    expect(openingBuy).toMatchObject({ holdingId, type: "buy", amount: "10.00", amountZmw: "200.00", fxRate: "20.00000000", currency: "USD" });
    expect(openingLot).toMatchObject({ holdingId, transactionId: openingBuy.id, quantity: "5.00000000",
      costBasis: "10.00", costBasisZmw: "200.00", acquisitionFxRate: "20.00000000" });
    const sipId = await confirmFill(await duePlan("4.00", "USD"),
      { executionDate: dueDate, quantity: "2.00000000", price: "2.0000", fees: "0.00" }, "4.00",
      { fxRate: "20.00000000", amountZmw: "80.00" });
    const after = await effects();
    // #242 P2-2: the known 200.00 base plus the SIP fill's dated 80.00.
    expect(after.holdings[0]).toMatchObject({ id: holdingId, quantity: "7.00000000", costBasis: "14.00", costBasisZmw: "280.00", acquisitionFxRate: null });
    expect(after.activity.find(row => row.id === openingBuy.id)).toEqual(openingBuy);
    expect(after.lots.find(row => row.id === openingLot.id)).toEqual(openingLot);
    expect(after.activity.find(row => row.id === sipId)).toMatchObject({ holdingId, currency: "USD", type: "buy",
      quantity: "2.00000000", amount: "4.00", amountZmw: "80.00", fxRate: "20.00000000" });
    expect(after.lots.find(row => row.transactionId === sipId)).toMatchObject({ holdingId, quantity: "2.00000000",
      costBasis: "4.00", costBasisZmw: "80.00", acquisitionFxRate: "20.00000000" });
    expect(after.openings).toEqual(original.openings);
    for (const prior of original.audits) expect(after.audits.find(row => row.id === prior.id)).toEqual(prior);
    // Exercise the existing manual caller against the composed mixed evidence.
    // The historical200 ZMW is one acquisition's cost, never this new total.
    await signed("/api/investments/transactions").send({ accountId: ids.sharedAccount, securityId, holdingId,
      type: "buy", quantity: "1", price: "2", amount: "2.00", fees: "0", currency: "USD", transactionDate: dueDate }).expect(201);
    // #236 F1: every lot now has a dated base (200 + SIP 80 + this buy 40), so the
    // ordinary writer's recompute agrees with the SIP's 280 plus this buy's 40.
    expect(await stored()).toMatchObject({ quantity: "8.00000000", costBasis: "16.00", costBasisZmw: "320.00", acquisitionFxRate: null });
    const final = await effects();
    expect(final.activity.find(row => row.id === openingBuy.id)).toEqual(openingBuy);
    expect(final.lots.find(row => row.id === openingLot.id)).toEqual(openingLot);
    expect(final.accounts).toEqual(balances.accounts); expect(final.cash).toEqual(balances.cash);
  });
});
