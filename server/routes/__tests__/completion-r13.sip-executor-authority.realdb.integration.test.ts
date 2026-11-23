import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, or } from "drizzle-orm";
import { accounts, auditLogs, grzTBills, holdings, householdMembers, households, investmentTransactions,
  investmentSipConfirmations, investmentSipConfirmedFills, investmentSipOccurrenceFences, investmentSipOccurrences,
  recurringExecutionLog, recurringInvestments, securities, taxLotDisposals, taxLots, transactions, users, userSessions } from "@shared/schema";
import { db, pool } from "../../db";
import { hashPassword } from "../../auth";
import { getTestApp } from "../../__tests__/fixtures";
import { calculateNextDate, processDueInvestments, type SipExecutionResults } from "../../services/investment/processDueInvestments";
import { sipExecutionKey } from "../../services/investment/investmentCronKeys";
import { lockSipExecutionAuthorization, SIP_EXECUTION_REFUSAL } from "../../services/investment/sipExecutionAuthorization";
import { recordSipPurchase } from "../../services/investment/recordSipPurchase";
import { withTransaction } from "../../utils/withTransaction";

// TEST-ONLY / UNEXECUTED. Corrected0029, Main's retention contract and protected
// serial composition remain prerequisites; no RED/GREEN or runtime claim.
// Preserve bc4ebf40's 33 maintained private-caller cases and 39f/39y/40e receipts.
// Positive authorizations originate ONLY from real password login + signed HTTP
// create/reconfirm with client UUIDs. No grant, proof or signed SID is fabricated.
// Current ticks only materialize held occurrences. Explicit legacy-v1 controls
// alone call the retained old writer; future virtual ticks never attest v2 fills.
const householdId = randomUUID(), securityId = randomUUID(), tbillId = randomUUID();
const sharedAccountId = randomUUID(), privateAccountId = randomUUID();
const actorIds = { owner: randomUUID(), peer: randomUUID() };
type Actor = keyof typeof actorIds;
const actorList = [actorIds.owner, actorIds.peer];
const cookies: Record<Actor, string> = { owner: "", peer: "" };
const password = "SyntheticSipExecutor123!", endpoint = "/api/investments/recurring";
let app: Awaited<ReturnType<typeof getTestApp>>;
const today = () => new Date().toISOString().slice(0, 10);

function signed(actor: Actor, method: "get" | "post" | "put" | "delete", path = endpoint) {
  return request(app)[method](path).set("Cookie", cookies[actor])
    .set("X-Capital-Subject", actorIds[actor]).set("X-Capital-Household", householdId);
}
async function login(actor: Actor) {
  const response = await request(app).post("/api/auth/login").send({
    email: `sip-executor-${actorIds[actor]}@example.invalid`, password }).expect(200);
  cookies[actor] = (response.headers["set-cookie"] as unknown as string[]).join("; ");
}
async function generation(actor: Actor) {
  return (await db.select({ value: users.securityGeneration }).from(users).where(eq(users.id, actorIds[actor])))[0].value;
}
async function stepUp(actor: Actor) {
  await signed(actor, "post", "/api/settings/security/step-up").send({ password }).expect(200);
}
type TestFrequency = "monthly" | "daily" | "custom";
function declaration(accountId = sharedAccountId, frequency: TestFrequency = "monthly", nextExecutionDate = today()) {
  return { accountId, securityId, type: "sip", frequency, amount: "10.00", currency: "ZMW", nextExecutionDate };
}
async function createPlan(actor: Actor = "owner", accountId = sharedAccountId, frequency: TestFrequency = "monthly", initialDate = today()) {
  const input = declaration(accountId, frequency, initialDate), operationId = randomUUID(), expectedGeneration = await generation(actor);
  const response = await signed(actor, "post").send({ ...input, operationId }).expect(200);
  const [plan] = await db.select().from(recurringInvestments).where(eq(recurringInvestments.id, response.body.data.id));
  expect(plan).toMatchObject({ ...input, householdId, isActive: true, authorizationRevision: 1 });
  const grants = (await pool.query(`select *,authorized_at::text as exact_authorized_at,
    initial_execution_date::text as initial_execution_date from investment_plan_authorizations where plan_id=$1`, [plan.id])).rows;
  expect(grants).toEqual([expect.objectContaining({ id: plan.currentAuthorizationId, plan_id: plan.id,
    author_user_id: actorIds[actor], household_id: householdId, revision: 1, security_generation: expectedGeneration,
    initial_execution_date: input.nextExecutionDate })]);
  const operations = (await pool.query("select * from investment_plan_operations where plan_id=$1", [plan.id])).rows;
  expect(operations).toEqual([expect.objectContaining({ actor_user_id: actorIds[actor], operation_id: operationId,
    authorization_id: plan.currentAuthorizationId, action: "create" })]);
  return { plan, grant: grants[0], input, operationId, actor };
}
type Created = Awaited<ReturnType<typeof createPlan>>;
type ActualCommand = { operationId: string; expectedRevision: 0; finalStatement: true; outcome: "filled";
  brokerReference: string; fills: [{ executionDate: string; quantity: string; price: string; fees: string }] };
function actualCommand(created: Created): ActualCommand {
  const command: ActualCommand = { operationId: randomUUID(), expectedRevision: 0, finalStatement: true, outcome: "filled",
    brokerReference: `synthetic-executor-statement-${randomUUID()}`,
    fills: [{ executionDate: created.input.nextExecutionDate, quantity: "5.00000000", price: "2.0000", fees: "0.00" }] };
  Object.freeze(command.fills[0]); Object.freeze(command.fills); return Object.freeze(command);
}
async function postActual(created: Created, command: ActualCommand, cookie = cookies[created.actor]) {
  return request(app).post(`${endpoint}/${created.plan.id}/occurrences/${created.input.nextExecutionDate}/confirm`)
    .set("Cookie", cookie).set("X-Capital-Subject", actorIds[created.actor]).set("X-Capital-Household", householdId).send(command);
}

async function snapshot() {
  const plans = await db.select().from(recurringInvestments).where(eq(recurringInvestments.householdId, householdId)).orderBy(recurringInvestments.id);
  const purchases = await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, householdId)).orderBy(investmentTransactions.id);
  const grants = (await pool.query("select * from investment_plan_authorizations where household_id=$1 order by id", [householdId])).rows;
  const confirmations = await db.select().from(investmentSipConfirmations).where(eq(investmentSipConfirmations.householdId, householdId))
    .orderBy(investmentSipConfirmations.id);
  const entityIds = [householdId, securityId, tbillId, sharedAccountId, privateAccountId,
    ...plans.map(row => row.id), ...purchases.map(row => row.id), ...grants.map(row => row.id), ...confirmations.map(row => row.id)];
  return {
    plans, purchases, grants,
    confirmations,
    occurrences: await db.select().from(investmentSipOccurrences).where(eq(investmentSipOccurrences.householdId, householdId))
      .orderBy(investmentSipOccurrences.planId, investmentSipOccurrences.originalDueDate),
    fences: await db.select().from(investmentSipOccurrenceFences).where(inArray(investmentSipOccurrenceFences.planId, plans.map(row => row.id)))
      .orderBy(investmentSipOccurrenceFences.planId, investmentSipOccurrenceFences.originalDueDate),
    fills: await db.select().from(investmentSipConfirmedFills).where(inArray(investmentSipConfirmedFills.confirmationId, confirmations.map(row => row.id)))
      .orderBy(investmentSipConfirmedFills.confirmationId, investmentSipConfirmedFills.fillIndex),
    accounts: await db.select().from(accounts).where(eq(accounts.householdId, householdId)).orderBy(accounts.id),
    holdings: await db.select().from(holdings).where(eq(holdings.householdId, householdId)).orderBy(holdings.id),
    lots: await db.select().from(taxLots).where(eq(taxLots.householdId, householdId)).orderBy(taxLots.id),
    disposals: await db.select().from(taxLotDisposals).where(eq(taxLotDisposals.householdId, householdId)).orderBy(taxLotDisposals.id),
    cash: await db.select().from(transactions).where(eq(transactions.householdId, householdId)).orderBy(transactions.id),
    bills: await db.select().from(grzTBills).where(eq(grzTBills.householdId, householdId)).orderBy(grzTBills.id),
    instruments: await db.select().from(securities).where(inArray(securities.id, [securityId, tbillId])).orderBy(securities.id),
    operations: (await pool.query("select * from investment_plan_operations where household_id=$1 order by actor_user_id,operation_id", [householdId])).rows,
    reservations: (await pool.query(`select r.* from investment_sip_purchase_reservations r
      join investment_plan_authorizations a on a.id=r.authorization_id where a.household_id=$1 order by r.purchase_id`, [householdId])).rows,
    proofs: (await pool.query(`select p.* from investment_purchase_authorization_proofs p
      join investment_transactions t on t.id=p.purchase_id where t.household_id=$1 order by p.purchase_id`, [householdId])).rows,
    logs: (await pool.query(`select l.* from recurring_execution_log l join recurring_investments p
      on p.id=l.recurring_investment_id where p.household_id=$1 order by l.id`, [householdId])).rows,
    audits: await db.select().from(auditLogs).where(or(eq(auditLogs.householdId, householdId),
      inArray(auditLogs.userId, actorList), inArray(auditLogs.entityId, entityIds))).orderBy(auditLogs.id),
  };
}
type Frame = Awaited<ReturnType<typeof snapshot>>;
function effectAudits(frame: Frame) {
  return frame.audits.filter(row => row.entityType === "investment_transaction" && row.action === "CREATE");
}
function expectNoEffect(before: Frame, after: Frame) {
  // Failed operation logs may be appended separately. They may not stand in for
  // financial effects, proof or authority, and must not advance the due date.
  for (const key of ["accounts", "holdings", "purchases", "lots", "disposals", "cash", "bills", "plans",
    "grants", "operations", "reservations", "proofs", "audits", "instruments", "occurrences", "fences", "confirmations", "fills"] as const)
    expect.soft(after[key], key).toEqual(before[key]);
  expect.soft(after.logs.filter(row => row.status === "success")).toEqual(before.logs.filter(row => row.status === "success"));
}
function termsOracle(created: Created, purchase: Frame["purchases"][number]) {
  // Independent retained-proof v1 tuple, built from persisted BUY economics
  // plus the genuine grant's cadence/start. No product digest helper is used.
  return createHash("sha256").update(JSON.stringify([1, "record_only_sip", purchase.accountId,
    purchase.securityId, purchase.amount, purchase.currency, created.input.frequency, created.input.nextExecutionDate]), "utf8").digest("hex");
}
async function expectLegacyProof(created: Created, purchase: Frame["purchases"][number]) {
  const proof = (await pool.query("select * from investment_purchase_authorization_proofs where purchase_id=$1", [purchase.id])).rows;
  expect.soft(proof).toHaveLength(1);
  if (!proof[0]) return; // Keep the financial/audit assertions reachable in RED.
  expect.soft(Object.keys(proof[0]).sort()).toEqual(["purchase_id", "author_user_id", "authorized_at",
    "authorization_contract_version", "authorized_frequency", "authorized_initial_date", "authorized_terms_digest"].sort());
  const checks = (await pool.query(`select p.author_user_id,p.authorization_contract_version,p.authorized_frequency,
    p.authorized_initial_date::text as initial_date,p.authorized_terms_digest,
    p.authorized_at::text as exact_proof_time,a.authorized_at::text as exact_grant_time,
    p.authorized_at=a.authorized_at as same_grant_time,
    t.created_at>=a.authorized_at as purchase_after_grant,
    t.created_at<=clock_timestamp() as purchase_not_future,
    r.authorization_id,r.posting_confirmed
    from investment_purchase_authorization_proofs p join investment_transactions t on t.id=p.purchase_id
    join investment_sip_purchase_reservations r on r.purchase_id=p.purchase_id
    join investment_plan_authorizations a on a.id=r.authorization_id where p.purchase_id=$1`, [purchase.id])).rows;
  expect.soft(checks).toEqual([expect.objectContaining({ author_user_id: actorIds[created.actor], authorization_contract_version: 1,
    authorized_frequency: created.input.frequency, initial_date: created.input.nextExecutionDate,
    authorized_terms_digest: termsOracle(created, purchase), exact_proof_time: created.grant.exact_authorized_at,
    exact_grant_time: created.grant.exact_authorized_at, same_grant_time: true, purchase_after_grant: true,
    purchase_not_future: true, authorization_id: created.plan.currentAuthorizationId, posting_confirmed: true })]);
}
async function expectLegacyPurchase(created: Created, before: Frame, execute = () => legacyTick(created)) {
  const result = await execute(), after = await snapshot();
  expect.soft(result).toMatchObject({ success: 1, failed: 0, skipped: 0, errors: [] });
  const added = after.purchases.filter(row => !before.purchases.some(prior => prior.id === row.id));
  expect.soft(added).toEqual([expect.objectContaining({ householdId, accountId: created.plan.accountId, securityId,
    type: "buy", quantity: "5.00000000", price: "2.0000", amount: "10.00", currency: "ZMW", transactionDate: today() })]);
  expect.soft(after.accounts).toEqual(before.accounts); expect.soft(after.cash).toEqual(before.cash);
  expect.soft(after.disposals).toEqual(before.disposals); expect.soft(after.bills).toEqual(before.bills);
  expect.soft(after.grants).toEqual(before.grants); expect.soft(after.operations).toEqual(before.operations);
  const [plan] = after.plans.filter(row => row.id === created.plan.id);
  const oldPlan = before.plans.find(row => row.id === plan.id)!;
  expect.soft(plan).toEqual({ ...oldPlan, nextExecutionDate: plan.nextExecutionDate, updatedAt: plan.updatedAt });
  expect.soft(plan.nextExecutionDate > oldPlan.nextExecutionDate).toBe(true);
  const purchase = added[0];
  if (purchase) {
    expect.soft(after.lots.filter(row => row.transactionId === purchase.id)).toEqual([expect.objectContaining({
      householdId, holdingId: purchase.holdingId, quantity: purchase.quantity, remainingQuantity: purchase.quantity,
      costBasis: purchase.amount, acquiredDate: purchase.transactionDate })]);
    expect.soft(after.logs.filter(row => row.status === "success" && row.result_entity_id === purchase.id)).toHaveLength(1);
    const audit = effectAudits(after).filter(row => row.entityId === purchase.id);
    expect.soft(audit).toEqual([expect.objectContaining({ userId: null,
      householdId: created.plan.accountId === privateAccountId ? null : householdId,
      details: expect.objectContaining({ actor: "system", trigger: "sip", authorizationContractVersion: 1,
        authorizationProofPurchaseId: purchase.id, newValue: expect.objectContaining({ accountId: purchase.accountId,
          securityId, type: "buy", amount: "10.00", currency: "ZMW" }) }) })]);
    expect.soft(JSON.stringify(audit)).not.toContain(created.operationId);
    expect.soft(JSON.stringify(audit)).not.toContain(String(created.plan.currentAuthorizationId));
    await expectLegacyProof(created, purchase);
  }
  return after;
}
async function legacyTick(created: Created): Promise<SipExecutionResults> {
  // Historical writer control only. Its authority is minted by the real lock
  // helper from a signed mandate, and remains branded to this transaction.
  const date = today(), result: SipExecutionResults = { success: 0, held: 0, skipped: 0, failed: 0, errors: [] };
  try {
    const posted = await withTransaction(async tx => {
      const authority = await lockSipExecutionAuthorization(tx, created.plan, date);
      if (!authority) return false;
      const nextExecutionDate = calculateNextDate(new Date(authority.plan.nextExecutionDate), authority.plan.frequency,
        authority.terms.initialDate).toISOString().slice(0, 10);
      if (nextExecutionDate <= date) throw new Error("Legacy control schedule does not advance");
      const purchaseId = await recordSipPurchase(tx, authority, date, sipExecutionKey(created.plan.id, date));
      await tx.update(recurringInvestments).set({ nextExecutionDate, updatedAt: new Date() }).where(eq(recurringInvestments.id, created.plan.id));
      await tx.insert(recurringExecutionLog).values({ recurringInvestmentId: created.plan.id, status: "success",
        amount: authority.plan.amount, resultEntityId: purchaseId, executionDate: new Date() });
      return true;
    });
    if (posted) result.success++; else result.skipped++;
  } catch {
    result.failed++;
    result.errors.push(`Plan ${created.plan.id}: ${SIP_EXECUTION_REFUSAL}`);
    await withTransaction(async tx => {
      const [household] = await tx.select({ id: households.id }).from(households).where(eq(households.id, householdId)).for("share");
      if (!household) return;
      const [plan] = await tx.select({ id: recurringInvestments.id }).from(recurringInvestments)
        .where(and(eq(recurringInvestments.id, created.plan.id), eq(recurringInvestments.householdId, householdId))).for("share");
      if (plan) await tx.insert(recurringExecutionLog).values({ recurringInvestmentId: created.plan.id, status: "failed",
        amount: created.input.amount, errorMessage: SIP_EXECUTION_REFUSAL, executionDate: new Date() });
    });
  }
  return result;
}
async function expectHeld(created: Created, execute = processDueInvestments) {
  const scheduledDate = today(), before = await snapshot(), result = await execute(), after = await snapshot();
  expect(result).toMatchObject({ success: 0, held: 1, failed: 0, skipped: 0, errors: [] });
  for (const key of ["accounts", "holdings", "purchases", "lots", "disposals", "cash", "bills", "grants", "operations",
    "reservations", "proofs", "logs", "audits", "instruments", "confirmations", "fills"] as const) expect(after[key], key).toEqual(before[key]);
  const oldPlan = before.plans.find(row => row.id === created.plan.id)!, plan = after.plans.find(row => row.id === created.plan.id)!;
  expect(oldPlan.nextExecutionDate).toBe(scheduledDate); expect(plan.nextExecutionDate > scheduledDate).toBe(true);
  expect(after.plans).toEqual(before.plans.map(row => row.id === plan.id
    ? { ...row, nextExecutionDate: plan.nextExecutionDate, updatedAt: plan.updatedAt } : row));
  expect(after.fences.filter(row => row.planId === plan.id && row.originalDueDate === scheduledDate))
    .toEqual([{ planId: plan.id, originalDueDate: scheduledDate, terminal: false }]);
  expect(after.occurrences.filter(row => row.planId === plan.id && row.originalDueDate === scheduledDate))
    .toEqual([expect.objectContaining({ householdId, accountId: plan.accountId, securityId, plannedAmount: "10.00", currency: "ZMW",
      authorizedFrequency: created.input.frequency, authorizedInitialDate: created.input.nextExecutionDate,
      occurrenceRevision: 0, state: "pending" })]);
  expect(after.fences).toHaveLength(before.fences.length + 1); expect(after.occurrences).toHaveLength(before.occurrences.length + 1);
  return after;
}
async function expectActualPurchase(created: Created, before: Frame, command = actualCommand(created), execute = () => postActual(created, command)) {
  const response = await execute(); expect(response.status).toBe(200);
  expect(response.body.data).toMatchObject({ requestVersion: 1, operationId: command.operationId, occurrence: {
    planId: created.plan.id, scheduledDate: created.input.nextExecutionDate, state: "closed", occurrenceRevision: 1,
    result: { outcome: "filled", fills: [{ fillIndex: 0, ...command.fills[0], amount: "10.00" }],
      totals: { grossAmount: "10.00", fees: "0.00", amount: "10.00" } },
  } });
  expect(response.body.data.occurrence.result.fills).toHaveLength(1);
  const after = await snapshot(), purchaseId: string = response.body.data.occurrence.result.fills[0].purchaseId;
  expect(after.confirmations).toHaveLength(before.confirmations.length + 1);
  expect(after.fills).toHaveLength(before.fills.length + 1); expect(after.proofs).toHaveLength(before.proofs.length + 1);
  const added = after.purchases.filter(row => !before.purchases.some(prior => prior.id === row.id));
  expect(added).toEqual([expect.objectContaining({ id: purchaseId, householdId, accountId: created.plan.accountId, securityId,
    type: "buy", quantity: "5.00000000", price: "2.0000", fees: "0.00", amount: "10.00", currency: "ZMW",
    transactionDate: command.fills[0].executionDate, notes: null, linkedTransactionId: null, fxRate: null, amountZmw: null })]);
  const purchase = added[0];
  for (const key of ["accounts", "cash", "disposals", "bills", "grants", "operations", "reservations", "plans", "logs", "instruments"] as const)
    expect(after[key], key).toEqual(before[key]);
  for (const original of before.purchases) expect(after.purchases.find(row => row.id === original.id)).toEqual(original);
  for (const original of before.lots) expect(after.lots.find(row => row.id === original.id)).toEqual(original);
  for (const original of before.proofs) expect(after.proofs.find(row => row.purchase_id === original.purchase_id)).toEqual(original);
  for (const original of before.audits) expect(after.audits.find(row => row.id === original.id)).toEqual(original);
  expect(after.lots.filter(row => row.transactionId === purchaseId)).toEqual([expect.objectContaining({ householdId,
    holdingId: purchase.holdingId, quantity: "5.00000000", remainingQuantity: "5.00000000", costBasis: "10.00",
    acquiredDate: command.fills[0].executionDate })]);
  const receipt = after.confirmations.find(row => row.operationId === command.operationId)!;
  expect(receipt).toMatchObject({ householdId, actorUserId: actorIds[created.actor], planId: created.plan.id,
    originalDueDate: created.input.nextExecutionDate, brokerReference: command.brokerReference, fillCount: 1, outcome: "filled" });
  expect(after.fills.filter(row => row.confirmationId === receipt.id)).toEqual([expect.objectContaining({ purchaseId,
    fillIndex: 0, postingConfirmed: true, ...command.fills[0], amount: "10.00" })]);
  expect(after.fences.filter(row => row.planId === created.plan.id)).toEqual([
    { planId: created.plan.id, originalDueDate: created.input.nextExecutionDate, terminal: true },
  ]);
  expect(after.occurrences.filter(row => row.planId === created.plan.id)).toEqual([expect.objectContaining({
    originalDueDate: created.input.nextExecutionDate, state: "closed", occurrenceRevision: 1,
  })]);
  const proof = after.proofs.filter(row => row.purchase_id === purchaseId);
  expect(proof).toHaveLength(1);
  expect(Object.keys(proof[0]).sort()).toEqual(["purchase_id", "author_user_id", "authorized_at", "authorization_contract_version",
    "authorized_frequency", "authorized_initial_date", "authorized_terms_digest"].sort());
  const digest = createHash("sha256").update(JSON.stringify([2, "record_only_sip_actual_fill", purchase.accountId, purchase.securityId,
    purchase.quantity, purchase.price, purchase.fees, purchase.amount, purchase.currency, purchase.transactionDate,
    created.input.frequency, created.input.nextExecutionDate, null, null]), "utf8").digest("hex");
  expect(proof[0]).toMatchObject({ author_user_id: actorIds[created.actor], authorization_contract_version: 2,
    authorized_frequency: created.input.frequency, authorized_terms_digest: digest });
  expect((await pool.query<{ same_instant: boolean; initial_date: string }>(`select p.authorized_at=c.authorized_at as same_instant,
    p.authorized_initial_date::text as initial_date from investment_purchase_authorization_proofs p
    join investment_sip_confirmed_fills f on f.purchase_id=p.purchase_id join investment_sip_confirmations c on c.id=f.confirmation_id
    where p.purchase_id=$1 and c.id=$2 and c.plan_id=$3 and c.original_due_date=$4 and c.household_id=$5
      and c.actor_user_id=$6 and p.author_user_id=$6`,
  [purchaseId, receipt.id, created.plan.id, created.input.nextExecutionDate, householdId, actorIds[created.actor]])).rows)
    .toEqual([{ same_instant: true, initial_date: created.input.nextExecutionDate }]);
  const audit = effectAudits(after).filter(row => row.entityId === purchaseId);
  expect(audit).toEqual([expect.objectContaining({ userId: actorIds[created.actor],
    householdId: created.plan.accountId === privateAccountId ? null : householdId,
    details: { newValue: { type: "buy", accountId: purchase.accountId, holdingId: purchase.holdingId, securityId,
      quantity: "5.00000000", price: "2.0000", fees: "0.00", feesDeclared: true, amount: "10.00", currency: "ZMW",
      transactionDate: command.fills[0].executionDate } } })]);
  expect(after.audits.filter(row => row.entityId === receipt.id)).toEqual([expect.objectContaining({
    userId: actorIds[created.actor], householdId: null, action: "CREATE", entityType: "investment_sip_confirmation",
    details: { authorizationEvent: "sip_final_confirmation_v1", requestVersion: 1 },
  })]);
  const retained = JSON.stringify({ purchase, proof, audit, lot: after.lots.filter(row => row.transactionId === purchaseId) });
  for (const secret of [command.operationId, created.operationId, String(created.plan.currentAuthorizationId), command.brokerReference,
    createHash("sha256").update(command.brokerReference, "utf8").digest("hex")]) expect(retained).not.toContain(secret);
  expect(JSON.stringify(response.body)).not.toContain(command.brokerReference);
  const replay = await postActual(created, command); expect(replay.status).toBe(200); expect(replay.body).toEqual(response.body);
  expect(await snapshot()).toEqual(after);
  return after;
}
async function expectActualRefusal(created: Created, command: ActualCommand, status: number, cookie = cookies[created.actor], expectedCode?: string) {
  const before = await snapshot(), response = await postActual(created, command, cookie), after = await snapshot();
  expect(response.status).toBe(status); expect(response.body).not.toHaveProperty("data");
  if (expectedCode) expect(response.body.error.code).toBe(expectedCode);
  expect(JSON.stringify(response.body)).not.toContain(command.brokerReference);
  if (status === 500) expect(response.body).toEqual({ success: false, error: { code: "INTERNAL_ERROR",
    message: "Occurrence confirmation is unavailable; retry with the original operation.", timestamp: expect.any(String) } });
  expect(after).toEqual(before);
  return after;
}
async function expectLegacyRefusal(created: Created) {
  const before = await snapshot(), result = await legacyTick(created), after = await snapshot();
  expect(result).toMatchObject({ success: 0, held: 0, failed: 1 }); expectNoEffect(before, after); return after;
}
async function expectRefusal() {
  const before = await snapshot(), result = await processDueInvestments(), after = await snapshot();
  expect.soft(result).toMatchObject({ success: 0, failed: 1 });
  expectNoEffect(before, after);
  return after;
}
async function atSipTick<T>(date: string, action: () => Promise<T>): Promise<T> {
  // Scope the synthetic clock to the executor. HTTP session admission and
  // PostgreSQL timestamps use their real clocks.
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date(`${date}T12:00:00.000Z`));
    return await action();
  } finally { vi.useRealTimers(); }
}
async function drainOperations<T>(operations: Promise<T>[]): Promise<T[]> {
  // Every operation is already started. Drain all siblings before propagating
  // rejection to a caller that may restore its clock or begin fixture cleanup.
  const settled = await Promise.allSettled(operations), values: T[] = [];
  for (const result of settled) {
    if (result.status === "rejected") throw result.reason;
    values.push(result.value);
  }
  return values;
}
async function overlapDueTicks() {
  const results = await drainOperations([processDueInvestments(), processDueInvestments()]);
  const winners = results.filter(result => result.held === 1);
  expect(winners).toHaveLength(1);
  expect(results.every(result => result.failed === 0 && result.errors.length === 0)).toBe(true);
  return winners[0];
}
async function overlapLegacyTicks(created: Created) {
  const results = await drainOperations([legacyTick(created), legacyTick(created)]), winners = results.filter(result => result.success === 1);
  expect(winners).toHaveLength(1);
  expect(results.every(result => result.failed === 0 && result.errors.length === 0)).toBe(true);
  return winners[0];
}
async function reconfirmCalendarPlan(created: Created, due: string): Promise<Created> {
  const { nextExecutionDate, ...terms } = created.input;
  const operationId = randomUUID();
  await signed(created.actor, "post", `${endpoint}/${created.plan.id}/authorize`).send({ ...terms,
    initialExecutionDate: nextExecutionDate, expectedRevision: 1, operationId }).expect(200);
  const [plan] = await db.select().from(recurringInvestments).where(eq(recurringInvestments.id, created.plan.id));
  expect(plan).toMatchObject({ nextExecutionDate: due, authorizationRevision: 2 });
  expect(plan.currentAuthorizationId).not.toBe(created.plan.currentAuthorizationId);
  const [grant] = (await pool.query(`select *,authorized_at::text as exact_authorized_at,
    initial_execution_date::text as initial_execution_date from investment_plan_authorizations where id=$1`,
    [plan.currentAuthorizationId])).rows;
  expect(grant).toMatchObject({ revision: 2, author_user_id: actorIds[created.actor], initial_execution_date: nextExecutionDate });
  return { ...created, plan, grant, operationId };
}
async function cleanEffects() {
  const before = await snapshot();
  await db.delete(auditLogs).where(inArray(auditLogs.id, before.audits.map(row => row.id)));
  // Normal guarded lifecycle: deleting plans releases operational children;
  // completed proof remains until its genuine purchase is then deleted.
  await db.delete(recurringInvestments).where(eq(recurringInvestments.householdId, householdId));
  await db.delete(taxLotDisposals).where(eq(taxLotDisposals.householdId, householdId));
  await db.delete(taxLots).where(eq(taxLots.householdId, householdId));
  await db.delete(investmentTransactions).where(eq(investmentTransactions.householdId, householdId));
  await db.delete(holdings).where(eq(holdings.householdId, householdId));
  await db.delete(grzTBills).where(eq(grzTBills.householdId, householdId));
  await pool.query(`delete from "session" where sess->>'userId'=any($1::text[])
    or sess->>'mfaPendingUserId'=any($1::text[])`, [actorList]);
  await db.delete(userSessions).where(inArray(userSessions.userId, actorList));
}

describe("UNVERIFIED R13 actual signed SIP executor authority and completed proof", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const passwordHash = await hashPassword(password);
    await db.insert(households).values({ id: householdId, name: "Synthetic SIP executor authority", currency: "ZMW" });
    for (const actor of ["owner", "peer"] as const) {
      const id = actorIds[actor];
      await db.insert(users).values({ id, email: `sip-executor-${id}@example.invalid`, username: `sip-executor-${id}`,
        passwordHash, emailVerified: true, timezone: "Africa/Lusaka" });
      await db.insert(householdMembers).values({ householdId, userId: id, role: actor === "owner" ? "owner" : "member" });
    }
    await db.insert(accounts).values([
      { id: sharedAccountId, householdId, name: "Synthetic shared executor custody", type: "investment", currency: "ZMW",
        initialBalance: "100.00", balance: "100.00", isPrivate: false, ownerUserId: actorIds.owner },
      { id: privateAccountId, householdId, name: "Synthetic private executor custody", type: "investment", currency: "ZMW",
        initialBalance: "100.00", balance: "100.00", isPrivate: true, ownerUserId: actorIds.owner },
    ]);
    await db.insert(securities).values([
      { id: securityId, symbol: `SIPEX${securityId.slice(0, 8)}`, name: "Synthetic SIP executor stock", type: "stock", currency: "ZMW", currentPrice: "2.00" },
      { id: tbillId, symbol: `SIPEX${tbillId.slice(0, 8)}`, name: "Synthetic pending instrument", type: "tbill", currency: "ZMW" },
    ]);
  }, 30_000);
  beforeEach(async () => {
    await db.update(accounts).set({ isPrivate: false, ownerUserId: actorIds.owner, deletedAt: null }).where(eq(accounts.id, sharedAccountId));
    await db.update(accounts).set({ isPrivate: true, ownerUserId: actorIds.owner, deletedAt: null }).where(eq(accounts.id, privateAccountId));
    await db.update(securities).set({ currency: "ZMW", currentPrice: "2.00" }).where(eq(securities.id, securityId));
    for (const actor of ["owner", "peer"] as const) {
      await db.update(users).set({ emailVerified: true }).where(eq(users.id, actorIds[actor]));
      await db.insert(householdMembers).values({ householdId, userId: actorIds[actor], role: actor === "owner" ? "owner" : "member" })
        .onConflictDoUpdate({ target: [householdMembers.householdId, householdMembers.userId], set: { role: actor === "owner" ? "owner" : "member" } });
      await login(actor);
    }
    await signed("owner", "put", "/api/investments/calendar").send({ timeZone: "UTC" }).expect(200);
  });
  afterEach(async () => { vi.useRealTimers(); await cleanEffects(); });
  afterAll(async () => {
    await cleanEffects();
    await db.delete(households).where(eq(households.id, householdId));
    await db.delete(securities).where(inArray(securities.id, [securityId, tbillId]));
    await db.delete(users).where(inArray(users.id, actorList));
  });

  it.each(["shared", "private"] as const)("holds a real %s signed mandate before an actual signed fill creates its scoped audit and seven-field proof", async source => {
    const created = await createPlan("owner", source === "private" ? privateAccountId : sharedAccountId);
    const held = await expectHeld(created), after = await expectActualPurchase(created, held);
    expect.soft(after.holdings).toEqual([expect.objectContaining({ householdId, accountId: created.plan.accountId,
      securityId, quantity: "5.00000000", costBasis: "10.00" })]);
    expect.soft(after.reservations).toHaveLength(0); expect.soft(after.proofs).toHaveLength(1);
    expect.soft(await processDueInvestments()).toMatchObject({ success: 0, failed: 0, errors: [] });
    expect.soft(await snapshot()).toEqual(after);
  });

  it.each(["logout", "expiry", "selected-device revoke"] as const)("keeps a durable mandate after %s but requires a current genuine session for actual confirmation", async ending => {
    const created = await createPlan(), originalCookie = cookies.owner, originalGeneration = await generation("owner");
    const originalSessions = (await pool.query<{ sid: string }>('select sid from "session" where sess->>\'userId\'=$1', [actorIds.owner])).rows;
    expect(originalSessions).toHaveLength(1);
    if (ending === "logout") await signed("owner", "post", "/api/auth/logout").expect(200);
    if (ending === "expiry") {
      // Expire ONLY the real login's existing persisted SID; do not mint one.
      await pool.query('update "session" set expire=now()-interval \'1 minute\' where sid=$1', [originalSessions[0].sid]);
    }
    if (ending === "selected-device revoke") {
      const [tracked] = await db.select().from(userSessions).where(and(eq(userSessions.userId, actorIds.owner),
        eq(userSessions.sessionToken, originalSessions[0].sid)));
      expect(tracked).toBeDefined();
      await login("owner"); await stepUp("owner");
      await signed("owner", "delete", `/api/settings/security/sessions/${tracked.id}`).expect(200);
    }
    await request(app).get("/api/auth/me").set("Cookie", originalCookie).expect(401);
    expect(await generation("owner")).toBe(originalGeneration);
    await expectHeld(created);
    const command = actualCommand(created);
    await expectActualRefusal(created, command, 401, originalCookie);
    await login("owner");
    await expectActualPurchase(created, await snapshot(), command);
  });

  it("refuses the actual revoke-all generation change until a current signed person explicitly reconfirms", async () => {
    const created = await createPlan(), oldGeneration = await generation("owner");
    await stepUp("owner");
    await signed("owner", "delete", "/api/settings/security/sessions").expect(200);
    expect(await generation("owner")).toBe(oldGeneration + 1);
    await expectRefusal();
    await login("owner");
    const { nextExecutionDate, ...terms } = created.input;
    await signed("owner", "post", `${endpoint}/${created.plan.id}/authorize`).send({ ...terms,
      initialExecutionDate: nextExecutionDate, expectedRevision: 1, operationId: randomUUID() }).expect(200);
    const [plan] = await db.select().from(recurringInvestments).where(eq(recurringInvestments.id, created.plan.id));
    const [grant] = (await pool.query(`select *,authorized_at::text as exact_authorized_at
      from investment_plan_authorizations where id=$1`, [plan.currentAuthorizationId])).rows;
    expect(grant).toMatchObject({ author_user_id: actorIds.owner, security_generation: oldGeneration + 1, revision: 2 });
    const refreshed = { ...created, plan, grant };
    await expectHeld(refreshed); await expectActualPurchase(refreshed, await snapshot());
  });

  it("requires a fresh real session after generation revocation to confirm an already-materialized occurrence", async () => {
    const created = await createPlan(); await expectHeld(created);
    const command = actualCommand(created), oldCookie = cookies.owner, oldGeneration = await generation("owner");
    // Revoke-all keeps the device that runs it (upgrading its generation), so revoke
    // from a second device and prove the older, now-revoked session is refused.
    await login("owner");
    await stepUp("owner"); await signed("owner", "delete", "/api/settings/security/sessions").expect(200);
    expect(await generation("owner")).toBe(oldGeneration + 1);
    await expectActualRefusal(created, command, 401, oldCookie);
    await login("owner");
    const before = await snapshot(), after = await expectActualPurchase(created, before, command);
    // Closing held actual facts uses current writer admission. It neither
    // revives the stale standing mandate nor invents a replacement grant.
    expect(after.grants).toEqual(before.grants); expect(after.operations).toEqual(before.operations);
    expect(after.confirmations[0]).toMatchObject({ actorUserId: actorIds.owner, securityGeneration: oldGeneration + 1 });
  });

  it("serializes distinct real signed final confirmations and replays only the winning immutable command", async () => {
    const created = await createPlan(); await expectHeld(created);
    const before = await snapshot(), first = actualCommand(created), second = actualCommand(created);
    const responses = await drainOperations([postActual(created, first), postActual(created, second)]);
    const attempts = [{ command: first, response: responses[0] }, { command: second, response: responses[1] }];
    const winners = attempts.filter(item => item.response.status === 200), losers = attempts.filter(item => item.response.status === 409);
    expect(winners).toHaveLength(1); expect(losers).toHaveLength(1);
    expect(losers[0].response.body).toMatchObject({ success: false, error: { code: "CONFLICT",
      details: { reason: "OCCURRENCE_ALREADY_CLOSED" } } });
    expect(losers[0].response.body).not.toHaveProperty("data");
    const winner = winners[0];
    const after = await expectActualPurchase(created, before, winner.command, async () => winner.response);
    expect(after.purchases).toHaveLength(1); expect(after.lots).toHaveLength(1); expect(after.proofs).toHaveLength(1);
    expect(after.confirmations).toHaveLength(1); expect(after.fills).toHaveLength(1);
    expect(after.holdings).toEqual([expect.objectContaining({ quantity: "5.00000000", costBasis: "10.00" })]);
  });

  it.each(["professional", "membership removed", "unverified identity"] as const)("refuses a previously signed author after current authority becomes %s", async withdrawal => {
    const held = await createPlan("peer"); await expectHeld(held);
    await createPlan("peer");
    if (withdrawal === "professional") await db.update(householdMembers).set({ role: "professional" }).where(and(
      eq(householdMembers.householdId, householdId), eq(householdMembers.userId, actorIds.peer)));
    if (withdrawal === "membership removed") await db.delete(householdMembers).where(and(
      eq(householdMembers.householdId, householdId), eq(householdMembers.userId, actorIds.peer)));
    if (withdrawal === "unverified identity") await db.update(users).set({ emailVerified: false }).where(eq(users.id, actorIds.peer));
    await expectRefusal();
    // The real first-party household expectation detects removed membership
    // before the route writer; email withdrawal has its own verified-user code.
    await expectActualRefusal(held, actualCommand(held), withdrawal === "membership removed" ? 409 : 403, cookies.peer,
      withdrawal === "membership removed" ? "SESSION_CONTEXT_CHANGED" : withdrawal === "unverified identity" ? "EMAIL_VERIFICATION_REQUIRED" : undefined);
  });

  it.each(["private ownership withdrawn", "deleted custody", "instrument denomination changed"] as const)("refuses and preserves a genuine mandate when %s", async withdrawal => {
    const held = await createPlan("owner", withdrawal === "private ownership withdrawn" ? privateAccountId : sharedAccountId);
    await expectHeld(held);
    const created = await createPlan("owner", withdrawal === "private ownership withdrawn" ? privateAccountId : sharedAccountId);
    if (withdrawal === "private ownership withdrawn") await db.update(accounts).set({ ownerUserId: actorIds.peer }).where(eq(accounts.id, privateAccountId));
    if (withdrawal === "deleted custody") await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, sharedAccountId));
    if (withdrawal === "instrument denomination changed") await db.update(securities).set({ currency: "USD" }).where(eq(securities.id, securityId));
    const after = await expectRefusal();
    expect.soft(after.plans.find(row => row.id === created.plan.id))
      .toMatchObject({ currentAuthorizationId: created.plan.currentAuthorizationId, nextExecutionDate: created.input.nextExecutionDate });
    await expectActualRefusal(held, actualCommand(held), withdrawal === "instrument denomination changed" ? 409 : 404);
  });

  it("refuses an unattributed legacy plan without inventing authority or completed proof", async () => {
    const [plan] = await db.insert(recurringInvestments).values({ ...declaration(), householdId }).returning();
    expect(plan).toMatchObject({ currentAuthorizationId: null, authorizationRevision: 0 });
    const after = await expectRefusal();
    expect.soft(after.grants).toEqual([]); expect.soft(after.operations).toEqual([]); expect.soft(after.proofs).toEqual([]);
  });

  it.each(["rollover/stock", "rollover/tbill", "sip/tbill"] as const)("keeps the signed pending %s declaration unexecuted without inferred rollover terms", async pair => {
    const response = await signed("owner", "post").send({ ...declaration(), operationId: randomUUID(),
      type: pair.startsWith("rollover") ? "rollover" : "sip", securityId: pair.endsWith("tbill") ? tbillId : securityId }).expect(200);
    expect(response.body.data).toMatchObject({ authorizationStatus: "pending_reconciliation", authorizationRevision: 0 });
    const after = await expectRefusal();
    expect.soft(after.grants).toEqual([]); expect.soft(after.proofs).toEqual([]); expect.soft(after.bills).toEqual([]);
  });

  it.each(["shared audit", "private audit", "private proof"] as const)("rolls back the whole actual posting on %s INSERT failure and retries once", async fault => {
    const created = await createPlan("owner", fault.startsWith("private") ? privateAccountId : sharedAccountId);
    await expectHeld(created); const command = actualCommand(created);
    const hook = `sip_exec_fault_${randomUUID().replace(/-/g, "")}`;
    const witness = `${hook}_seen`;
    const proofFault = fault === "private proof", table = proofFault ? "investment_purchase_authorization_proofs" : "audit_logs";
    try {
      // Fault injection only. No grant/purchase clock, reservation or evidence
      // content is rewritten; normal product triggers remain enabled.
      // Sequence advancement survives rollback and proves the intended INSERT
      // was actually reached, rather than passing on an earlier private refusal.
      await pool.query(`create sequence public.${witness}`);
      await pool.query(`create function public.${hook}() returns trigger language plpgsql as $guard$
        begin if ${proofFault
          ? `NEW.author_user_id='${actorIds.owner}'::uuid and NEW.authorization_contract_version=2`
          : `NEW.entity_type='investment_transaction' and NEW.action='CREATE' and NEW.user_id='${actorIds.owner}'::uuid
            and NEW.details->'newValue'->>'accountId'='${created.plan.accountId}'`}
        then perform nextval('public.${witness}');
          raise exception 'Synthetic SIP executor INSERT refusal' using errcode='23514'; end if; return NEW; end $guard$`);
      await pool.query(`create trigger ${hook} before insert on ${table} for each row execute function public.${hook}()`);
      await expectActualRefusal(created, command, 500);
      expect.soft((await pool.query(`select last_value::text,is_called from public.${witness}`)).rows)
        .toEqual([{ last_value: "1", is_called: true }]);
    } finally {
      await pool.query(`drop trigger if exists ${hook} on ${table}`);
      await pool.query(`drop function if exists public.${hook}()`);
      await pool.query(`drop sequence if exists public.${witness}`);
    }
    const after = await expectActualPurchase(created, await snapshot(), command);
    expect.soft(after.purchases).toHaveLength(1); expect.soft(after.lots).toHaveLength(1);
    expect.soft(after.reservations).toHaveLength(0); expect.soft(after.proofs).toHaveLength(1);
    expect.soft(effectAudits(after)).toHaveLength(1);
    expect.soft(await processDueInvestments()).toMatchObject({ success: 0, failed: 0, errors: [] });
    expect.soft(await snapshot()).toEqual(after);
  });

  it("preserves legacy-v1 daily financial proof while current daily ticks only materialize held occurrences", async () => {
    const created = await createPlan("owner", sharedAccountId, "daily");
    const current = await createPlan("owner", sharedAccountId, "daily");
    await expectLegacyPurchase(created, await snapshot()); const first = await expectHeld(current);
    const nextDate = first.plans.find(row => row.id === created.plan.id)!.nextExecutionDate;
    expect(nextDate > created.input.nextExecutionDate).toBe(true);
    await atSipTick(nextDate, async () => {
      // The future virtual tick exercises only held scheduling and the explicit
      // old writer control. It never supplies a future v2 final statement.
      await expectLegacyPurchase(created, await snapshot()); const second = await expectHeld(current);
      expect.soft(second.purchases).toHaveLength(2); expect.soft(second.lots).toHaveLength(2);
      expect.soft(second.proofs).toHaveLength(2); expect.soft(second.reservations).toHaveLength(2);
      expect.soft(second.holdings).toEqual([expect.objectContaining({ quantity: "10.00000000", costBasis: "20.00" })]);
      expect.soft(second.grants).toEqual(first.grants); expect.soft(second.operations).toEqual(first.operations);
      expect.soft(second.plans.find(row => row.id === created.plan.id))
        .toMatchObject({ currentAuthorizationId: created.plan.currentAuthorizationId, authorizationRevision: 1 });
      expect(second.occurrences).toHaveLength(2); expect(second.confirmations).toEqual([]); expect(second.fills).toEqual([]);
      expect.soft(await processDueInvestments()).toMatchObject({ success: 0, held: 0, failed: 0, errors: [] });
      expect.soft(await snapshot()).toEqual(second);
    });
  });

  it.each([
    ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", false],
    ["2028-01-31", "2028-02-29", "2028-03-31", "2028-04-30", false],
    ["2027-08-31", "2027-09-30", "2027-10-31", "2027-11-30", true],
  ] as const)("keeps the signed monthly anchor from %s through %s and %s", async (initial, short, recovered, next, reconfirm) => {
    let created = await createPlan("owner", sharedAccountId, "monthly", initial);
    let current = await createPlan("owner", sharedAccountId, "monthly", initial);
    const start = await snapshot();
    const first = await atSipTick(initial, async () => {
      await expectLegacyPurchase(created, start); return expectHeld(current);
    });
    expect(first.plans.find(row => row.id === created.plan.id)!.nextExecutionDate).toBe(short);
    expect(first.plans.find(row => row.id === current.plan.id)!.nextExecutionDate).toBe(short);
    if (reconfirm) {
      // Real HTTP reconfirmation runs after the virtual application clock ends.
      created = await reconfirmCalendarPlan(created, short); current = await reconfirmCalendarPlan(current, short);
    }

    const beforeSecond = await snapshot();
    const second = await atSipTick(short, async () => {
      await expectLegacyPurchase(created, beforeSecond, () => overlapLegacyTicks(created));
      return expectHeld(current, overlapDueTicks);
    });
    expect(second.plans.find(row => row.id === created.plan.id)!.nextExecutionDate).toBe(recovered);
    expect(second.plans.find(row => row.id === current.plan.id)!.nextExecutionDate).toBe(recovered);

    const third = await atSipTick(recovered, async () => {
      await expectLegacyPurchase(created, second); const after = await expectHeld(current);
      expect(await processDueInvestments()).toEqual({ success: 0, held: 0, skipped: 0, failed: 0, errors: [] });
      expect(await snapshot()).toEqual(after);
      return after;
    });
    expect(third.plans.find(row => row.id === created.plan.id)!.nextExecutionDate).toBe(next);
    expect(third.plans.find(row => row.id === current.plan.id)!.nextExecutionDate).toBe(next);
    expect(third.purchases.map(row => row.transactionDate).sort()).toEqual([initial, short, recovered]);
    expect(third.holdings).toEqual([expect.objectContaining({ quantity: "15.00000000", costBasis: "30.00" })]);
    expect(third.lots).toHaveLength(3);
    expect(third.proofs).toHaveLength(3);
    expect(third.reservations).toHaveLength(3);
    expect(third.logs.map(row => row.status)).toEqual(["success", "success", "success"]);
    expect(third.occurrences).toHaveLength(3); expect(third.fences).toHaveLength(3);
    expect(third.confirmations).toEqual([]); expect(third.fills).toEqual([]);
    expect(effectAudits(third)).toHaveLength(3);
    expect(third.accounts).toEqual(start.accounts);
    expect(third.cash).toEqual(start.cash);
  }, 30_000);

  it("rolls back the explicit legacy-v1 month-end writer when its success log insert fails", async () => {
    const initial = "2027-08-31";
    const created = await createPlan("owner", sharedAccountId, "monthly", initial);
    const hook = `sip_calendar_fault_${randomUUID().replace(/-/g, "")}`;
    const witness = `${hook}_seen`;
    try {
      await pool.query(`create sequence public.${witness}`);
      await pool.query(`create function public.${hook}() returns trigger language plpgsql as $guard$
        begin if NEW.recurring_investment_id='${created.plan.id}'::uuid and NEW.status='success'
        then perform nextval('public.${witness}');
          raise exception 'Synthetic calendar success-log refusal' using errcode='23514'; end if; return NEW; end $guard$`);
      await pool.query(`create trigger ${hook} before insert on public.recurring_execution_log
        for each row execute function public.${hook}()`);
      const refused = await atSipTick(initial, () => expectLegacyRefusal(created));
      expect(refused.plans[0].nextExecutionDate).toBe(initial);
      expect((await pool.query(`select last_value::text,is_called from public.${witness}`)).rows)
        .toEqual([{ last_value: "1", is_called: true }]);
    } finally {
      await pool.query(`drop trigger if exists ${hook} on public.recurring_execution_log`);
      await pool.query(`drop function if exists public.${hook}()`);
      await pool.query(`drop sequence if exists public.${witness}`);
    }
    const beforeRetry = await snapshot();
    const after = await atSipTick(initial, () => expectLegacyPurchase(created, beforeRetry));
    expect(after.plans[0].nextExecutionDate).toBe("2027-09-30");
    expect(after.purchases).toHaveLength(1);
    expect(after.proofs).toHaveLength(1);
  });

  // FIN-12: an overdue mandate is no longer left untouched; see the catch-up tests below.
  it("leaves signed future and inactive declarations untouched", async () => {
    const tick = "2027-01-31";
    await createPlan("owner", sharedAccountId, "monthly", "2027-02-01");
    const inactive = await createPlan("owner", sharedAccountId, "monthly", tick);
    await signed("owner", "delete", `${endpoint}/${inactive.plan.id}`).expect(200);
    const before = await snapshot();
    expect(await atSipTick(tick, processDueInvestments)).toEqual({ success: 0, held: 0, skipped: 0, failed: 0, errors: [] });
    expect(await snapshot()).toEqual(before);
  });

  // FIN-12 catch-up. The per-plan cap is SIP_CATCH_UP_LIMIT (12) occurrences a run.
  const dayRange = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, index) => `2027-01-${String(from + index).padStart(2, "0")}`);

  it("books each missed occurrence of an overdue mandate once, capped per run, and a re-run books nothing", async () => {
    const tick = "2027-01-20";
    const created = await createPlan("owner", sharedAccountId, "daily", "2027-01-01");
    const dueDates = (frame: Frame) => frame.occurrences.filter(row => row.planId === created.plan.id).map(row => row.originalDueDate);
    const fenceDates = (frame: Frame) => frame.fences.filter(row => row.planId === created.plan.id).map(row => row.originalDueDate);

    expect(await atSipTick(tick, processDueInvestments)).toEqual({ success: 0, held: 12, skipped: 0, failed: 0, errors: [] });
    const first = await snapshot();
    expect(dueDates(first)).toEqual(dayRange(1, 12));
    expect(fenceDates(first)).toEqual(dueDates(first));
    expect(first.plans[0].nextExecutionDate).toBe("2027-01-13");
    expect(first.occurrences.every(row => row.state === "pending" && row.plannedAmount === "10.00")).toBe(true);

    expect(await atSipTick(tick, processDueInvestments)).toEqual({ success: 0, held: 8, skipped: 0, failed: 0, errors: [] });
    const second = await snapshot();
    expect(dueDates(second)).toEqual(dayRange(1, 20));
    expect(fenceDates(second)).toEqual(dayRange(1, 20));
    expect(second.plans[0].nextExecutionDate).toBe("2027-01-21");

    expect(await atSipTick(tick, processDueInvestments)).toEqual({ success: 0, held: 0, skipped: 0, failed: 0, errors: [] });
    expect(await snapshot()).toEqual(second);
    // Scheduled occurrences are record-only: no purchase, cash, holding or proof appears.
    for (const key of ["purchases", "cash", "holdings", "lots", "proofs", "logs"] as const) expect(second[key], key).toEqual([]);
  });

  it("catches up an overdue mandate once when two runs overlap", async () => {
    const tick = "2027-04-15";
    const created = await createPlan("owner", sharedAccountId, "monthly", "2027-01-31");

    const results = await atSipTick(tick, () => drainOperations([processDueInvestments(), processDueInvestments()]));
    expect(results.reduce((sum, result) => sum + result.held, 0)).toBe(3);
    expect(results.every(result => result.failed === 0)).toBe(true);
    const after = await snapshot();
    expect(after.occurrences.filter(row => row.planId === created.plan.id).map(row => row.originalDueDate))
      .toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
    expect(after.plans[0].nextExecutionDate).toBe("2027-04-30");
  });

  it("refuses a due-today custom SIP even with a genuine signed grant", async () => {
    const tick = "2027-01-31";
    const created = await createPlan("owner", sharedAccountId, "custom", tick);
    const after = await atSipTick(tick, expectRefusal);
    expect(after.plans[0]).toMatchObject({ currentAuthorizationId: created.plan.currentAuthorizationId, nextExecutionDate: tick });
    expect(after.logs.map(row => row.status)).toEqual(["failed"]);
  });
});
