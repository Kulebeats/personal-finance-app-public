import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, or } from "drizzle-orm";
import { accounts, auditLogs, holdings, householdMembers, households, investmentPlanAuthorizations,
  investmentPlanOperations, investmentSipConfirmations, investmentSipConfirmedFills, investmentSipOccurrenceFences,
  investmentSipOccurrences, investmentSipPurchaseReservations, investmentTransactions, passwordHistory,
  recurringExecutionLog, recurringInvestments, securities, securityAuditLogs, taxLotDisposals, taxLots, transactions,
  userLoginHistory, users } from "@shared/schema";
import { db, pool } from "../../db";
import { getTestApp } from "../../__tests__/fixtures";
import { hashPassword } from "../../auth";
import { eraseAccount } from "../../modules/settings/settings.account-deletion.service";
import { calculateNextDate, processDueInvestments } from "../../services/investment/processDueInvestments";
import { sipExecutionKey } from "../../services/investment/investmentCronKeys";
import { lockSipExecutionAuthorization } from "../../services/investment/sipExecutionAuthorization";
import { recordSipPurchase } from "../../services/investment/recordSipPurchase";
import { withTransaction } from "../../utils/withTransaction";

// TEST-ONLY / UNEXECUTED: corrected0029, Main's retention contract and protected
// serial composition remain prerequisites. No RED/GREEN or runtime claim.
// Every grant comes from a real verified user's password login + signed HTTP;
// v2 proofs come from signed final actual-fill confirmations. Distinct legacy-v1
// controls call the retained old writer with its genuine signed mandate. No seeded grant,
// proof, fake SID, trigger bypass or temporary erased flag supplies authority.
// Historical membership moves are explicitly synthetic fixture setup, following
// the existing opening-erasure suite. Actual eraseAccount performs every purge.
// The late-unbound-household binding race needs a reviewed admission seam or
// independent DB barrier design; this suite adds no product hook and claims no
// coverage of that race or the controller's pre-existing credential race.
const password = "SyntheticSipErasure123!", endpoint = "/api/investments/recurring";
const actorNames = ["subject", "peer", "former", "formerPeer"] as const;
type Actor = typeof actorNames[number];
type Household = "current" | "former";
type Proof = { purchase_id: string; author_user_id: string; authorized_at: string;
  authorization_contract_version: number; authorized_frequency: string; authorized_initial_date: string;
  authorized_terms_digest: string };
type ActualCommand = { operationId: string; expectedRevision: 0; finalStatement: true; outcome: "filled";
  brokerReference: string; fills: [{ executionDate: string; quantity: string; price: string; fees: string }] };
type ActualCompletion = { actor: Actor; command: ActualCommand; purchaseId: string; receiptId: string; proof: Proof };
let app: Awaited<ReturnType<typeof getTestApp>>, passwordHash: string;
let householdIds: Record<Household, string>, actorIds: Record<Actor, string>, emails: Record<Actor, string>;
let cookies: Record<Actor, string>, sharedAccounts: Record<Household, string>, privateAccounts: Record<Household, string>;
let securityId: string;
let knownEntities: Set<string>;
let actualCompletions: Map<string, ActualCompletion>;
const today = () => new Date().toISOString().slice(0, 10);
const actors = () => actorNames.map(actor => actorIds[actor]);
const householdsInFixture = () => [householdIds.current, householdIds.former];
function signed(actor: Actor, method: "get" | "post" | "put" | "delete", path = endpoint, household: Household = "current") {
  return request(app)[method](path).set("Cookie", cookies[actor])
    .set("X-Capital-Subject", actorIds[actor]).set("X-Capital-Household", householdIds[household]);
}
function declaration(accountId: string, nextExecutionDate = today()) {
  return { accountId, securityId, type: "sip" as const, frequency: "monthly" as const,
    amount: "10.00", currency: "ZMW", nextExecutionDate };
}
async function create(actor: Actor = "subject", household: Household = "current",
  accountId = sharedAccounts[household], nextExecutionDate = today()) {
  const input = declaration(accountId, nextExecutionDate), operationId = randomUUID();
  const response = await signed(actor, "post", endpoint, household).send({ ...input, operationId }).expect(200);
  const [plan] = await db.select().from(recurringInvestments).where(eq(recurringInvestments.id, response.body.data.id));
  expect(plan).toMatchObject({ ...input, householdId: householdIds[household], isActive: true,
    authorizationRevision: 1, currentAuthorizationId: expect.any(String) });
  const [grant] = await db.select().from(investmentPlanAuthorizations)
    .where(eq(investmentPlanAuthorizations.id, plan.currentAuthorizationId!));
  expect(grant).toMatchObject({ planId: plan.id, authorUserId: actorIds[actor], revision: 1 });
  const exactTime = (await pool.query<{ value: string }>(
    "select authorized_at::text as value from investment_plan_authorizations where id=$1", [grant.id])).rows[0].value;
  knownEntities.add(plan.id); knownEntities.add(grant.id);
  return { plan, grant, input, operationId, actor, household, exactTime };
}
type Created = Awaited<ReturnType<typeof create>>;
function reconfirm(created: Created, actor: Actor, expectedRevision = created.plan.authorizationRevision) {
  const { nextExecutionDate, ...terms } = created.input;
  return signed(actor, "post", `${endpoint}/${created.plan.id}/authorize`, created.household).send({ ...terms,
    initialExecutionDate: nextExecutionDate, expectedRevision, operationId: randomUUID() });
}
async function pending(actor: Actor = "subject", household: Household = "current") {
  const response = await signed(actor, "post", endpoint, household).send({ operationId: randomUUID(),
    accountId: sharedAccounts[household], securityId: null, type: "rollover", frequency: "monthly",
    amount: "10.00", currency: "ZMW", nextExecutionDate: "2099-01-01" }).expect(200);
  knownEntities.add(response.body.data.id);
  expect(response.body.data).toMatchObject({ authorizationStatus: "pending_reconciliation", authorizationRevision: 0 });
}
async function moveMembership(actor: Actor, household: Household) {
  // Only membership is synthetic. The actor signs each historical instruction
  // while this is their sole membership, then leaves before current erasure.
  await db.transaction(async tx => {
    await tx.delete(householdMembers).where(eq(householdMembers.userId, actorIds[actor]));
    await tx.insert(householdMembers).values({ householdId: householdIds[household], userId: actorIds[actor], role: "member" });
  });
}
async function snapshot() {
  const hh = householdsInFixture(), ids = actors();
  const plans = await db.select().from(recurringInvestments).where(inArray(recurringInvestments.householdId, hh)).orderBy(recurringInvestments.id);
  const purchases = await db.select().from(investmentTransactions).where(inArray(investmentTransactions.householdId, hh)).orderBy(investmentTransactions.id);
  const grants = await db.select().from(investmentPlanAuthorizations).where(inArray(investmentPlanAuthorizations.householdId, hh))
    .orderBy(investmentPlanAuthorizations.id);
  const confirmations = await db.select().from(investmentSipConfirmations).where(inArray(investmentSipConfirmations.householdId, hh))
    .orderBy(investmentSipConfirmations.id);
  for (const row of [...plans, ...purchases, ...grants, ...confirmations]) knownEntities.add(row.id);
  return {
    plans, purchases, grants,
    accounts: await db.select().from(accounts).where(inArray(accounts.householdId, hh)).orderBy(accounts.id),
    holdings: await db.select().from(holdings).where(inArray(holdings.householdId, hh)).orderBy(holdings.id),
    lots: await db.select().from(taxLots).where(inArray(taxLots.householdId, hh)).orderBy(taxLots.id),
    disposals: await db.select().from(taxLotDisposals).where(inArray(taxLotDisposals.householdId, hh)).orderBy(taxLotDisposals.id),
    cash: await db.select().from(transactions).where(inArray(transactions.householdId, hh)).orderBy(transactions.id),
    operations: await db.select().from(investmentPlanOperations).where(inArray(investmentPlanOperations.householdId, hh))
      .orderBy(investmentPlanOperations.actorUserId, investmentPlanOperations.operationId),
    reservations: await db.select().from(investmentSipPurchaseReservations)
      .where(inArray(investmentSipPurchaseReservations.authorizationId, grants.map(row => row.id))).orderBy(investmentSipPurchaseReservations.purchaseId),
    confirmations,
    occurrences: await db.select().from(investmentSipOccurrences).where(inArray(investmentSipOccurrences.householdId, hh))
      .orderBy(investmentSipOccurrences.planId, investmentSipOccurrences.originalDueDate),
    fences: await db.select().from(investmentSipOccurrenceFences).where(inArray(investmentSipOccurrenceFences.planId, Array.from(knownEntities)))
      .orderBy(investmentSipOccurrenceFences.planId, investmentSipOccurrenceFences.originalDueDate),
    fills: await db.select().from(investmentSipConfirmedFills).where(inArray(investmentSipConfirmedFills.confirmationId, Array.from(knownEntities)))
      .orderBy(investmentSipConfirmedFills.confirmationId, investmentSipConfirmedFills.fillIndex),
    proofs: (await pool.query<Proof>(`select p.*,p.authorized_at::text as authorized_at,
      p.authorized_initial_date::text as authorized_initial_date from investment_purchase_authorization_proofs p
      where p.author_user_id=any($1::uuid[]) order by p.purchase_id`, [ids])).rows,
    logs: await db.select().from(recurringExecutionLog).where(inArray(recurringExecutionLog.recurringInvestmentId, plans.map(row => row.id)))
      .orderBy(recurringExecutionLog.id),
    audits: await db.select().from(auditLogs).where(or(inArray(auditLogs.householdId, hh), inArray(auditLogs.userId, ids),
      inArray(auditLogs.entityId, Array.from(knownEntities)))).orderBy(auditLogs.id),
    households: await db.select().from(households).where(inArray(households.id, hh)).orderBy(households.id),
    users: await db.select().from(users).where(inArray(users.id, ids)).orderBy(users.id),
    members: await db.select().from(householdMembers).where(inArray(householdMembers.householdId, hh))
      .orderBy(householdMembers.householdId, householdMembers.userId),
    // Fingerprints prove exact session payload/identity rollback without
    // printing real signed SIDs or session tokens in a failed equality diff.
    sessions: (await pool.query(`select sess->>'userId' as user_id,expire,md5(sid) as sid_fingerprint,
      md5(sess::text) as payload_fingerprint from "session" where sess->>'userId'=any($1::text[])
      or sess->>'mfaPendingUserId'=any($1::text[]) order by sid_fingerprint`, [ids])).rows,
    devices: (await pool.query(`select id,user_id,md5(session_token) as token_fingerprint,device_name,device_type,
      browser,os,ip_address,location,is_trusted,last_active_at,expires_at,created_at
      from user_sessions where user_id=any($1::uuid[]) order by id`, [ids])).rows,
    logins: await db.select().from(userLoginHistory).where(inArray(userLoginHistory.userId, ids)).orderBy(userLoginHistory.id),
    passwords: await db.select().from(passwordHistory).where(inArray(passwordHistory.userId, ids)).orderBy(passwordHistory.id),
  };
}
type Frame = Awaited<ReturnType<typeof snapshot>>;
function operational(row: Frame["audits"][number]) {
  const details = row.details as { authorizationEvent?: string; requestVersion?: number } | null;
  const event = details?.authorizationEvent;
  return row.householdId === null && ((row.entityType === "investment_plan_authorization" && event === "sip_grant_v1") ||
    (row.entityType === "recurring_investment" && (event === "pending_plan_v1" || event === "plan_deactivated_v1")) ||
    (row.entityType === "investment_sip_confirmation" && event === "sip_final_confirmation_v1" && details?.requestVersion === 1));
}
function financial(frame: Frame) {
  return { accounts: frame.accounts, holdings: frame.holdings, purchases: frame.purchases, lots: frame.lots,
    disposals: frame.disposals, cash: frame.cash, proofs: frame.proofs, logs: frame.logs,
    audits: frame.audits.filter(row => !operational(row) && row.entityType !== "user_account") };
}
function assertActorPurge(before: Frame, after: Frame, actor: Actor = "subject") {
  const id = actorIds[actor], removedGrants = before.grants.filter(row => row.authorUserId === id).map(row => row.id);
  expect.soft(after.grants.filter(row => row.authorUserId === id)).toEqual([]);
  expect.soft(after.operations.filter(row => row.actorUserId === id)).toEqual([]);
  expect.soft(after.reservations.filter(row => removedGrants.includes(row.authorizationId))).toEqual([]);
  const removedConfirmations = before.confirmations.filter(row => row.actorUserId === id);
  expect.soft(after.confirmations.filter(row => row.actorUserId === id)).toEqual([]);
  expect.soft(after.fills.filter(row => removedConfirmations.some(receipt => receipt.id === row.confirmationId))).toEqual([]);
  for (const receipt of removedConfirmations) {
    expect.soft(after.occurrences.filter(row => row.planId === receipt.planId && row.originalDueDate === receipt.originalDueDate)).toEqual([]);
    if (after.plans.some(row => row.id === receipt.planId)) {
      expect.soft(after.fences.filter(row => row.planId === receipt.planId && row.originalDueDate === receipt.originalDueDate))
        .toEqual([{ planId: receipt.planId, originalDueDate: receipt.originalDueDate, terminal: true }]);
    }
  }
  const retained = JSON.stringify(after);
  for (const completed of actualCompletions.values()) if (actorIds[completed.actor] === id) {
    expect.soft(retained).not.toContain(completed.command.brokerReference);
    expect.soft(retained).not.toContain(createHash("sha256").update(completed.command.brokerReference, "utf8").digest("hex"));
  }
  expect.soft(after.audits.filter(row => row.userId === id && operational(row))).toEqual([]);
  const subject = after.users.find(row => row.id === id)!;
  expect.soft(subject).toMatchObject({ id, emailVerified: false, fullName: null, firstName: null, lastName: null,
    displayName: null, phoneNumber: null, address: null, bio: null });
  expect.soft(subject.erasedAt).not.toBeNull(); expect.soft(subject.passwordHash).toMatch(/^!erased!/);
  expect.soft(subject.email).toMatch(/^deleted_.*@deleted\.invalid$/);
  expect.soft(subject.securityGeneration).toBe(before.users.find(row => row.id === id)!.securityGeneration + 1);
  expect.soft(after.sessions.filter(row => row.user_id === id)).toEqual([]);
  expect.soft(after.devices.filter(row => row.user_id === id)).toEqual([]);
  expect.soft(after.members.filter(row => row.userId === id)).toEqual([]);
  expect.soft(after.audits.filter(row => row.userId === id && row.entityType === "user_account"))
    .toEqual([expect.objectContaining({ householdId: null, action: "DELETE", entityId: id,
      details: expect.objectContaining({ reason: "right_to_erasure" }) })]);
}
function assertStopped(before: Frame, after: Frame, erased: Actor[] = ["subject"]) {
  const ids = erased.map(actor => actorIds[actor]);
  for (const plan of before.plans) {
    const current = before.grants.find(row => row.id === plan.currentAuthorizationId), stored = after.plans.find(row => row.id === plan.id);
    if (current && ids.includes(current.authorUserId)) {
      // Only the pointer/active flag and normal modification timestamp change.
      // In particular, counter, due date and all executable terms survive.
      expect.soft(stored && { ...stored, updatedAt: plan.updatedAt })
        .toEqual({ ...plan, currentAuthorizationId: null, isActive: false });
    } else expect.soft(stored).toEqual(plan);
  }
}
function proofOracle(created: Created, purchase: Frame["purchases"][number]) {
  return createHash("sha256").update(JSON.stringify([1, "record_only_sip", purchase.accountId, purchase.securityId,
    purchase.amount, purchase.currency, created.input.frequency, created.input.nextExecutionDate]), "utf8").digest("hex");
}
function assertLegacyProof(created: Created, frame: Frame) {
  const logs = frame.logs.filter(row => row.recurringInvestmentId === created.plan.id && row.status === "success");
  expect(logs).toHaveLength(1);
  const purchase = frame.purchases.find(row => row.id === logs[0].resultEntityId)!;
  expect(purchase).toMatchObject({ type: "buy", accountId: created.input.accountId, securityId, quantity: "5.00000000",
    amount: "10.00", currency: "ZMW", price: "2.0000", transactionDate: created.input.nextExecutionDate });
  const proof = frame.proofs.find(row => row.purchase_id === purchase.id)!;
  expect(proof).toEqual({ purchase_id: purchase.id, author_user_id: actorIds[created.actor], authorized_at: created.exactTime,
    authorization_contract_version: 1, authorized_frequency: created.input.frequency,
    authorized_initial_date: created.input.nextExecutionDate, authorized_terms_digest: proofOracle(created, purchase) });
  expect(Object.keys(proof).sort()).toEqual(["purchase_id", "author_user_id", "authorized_at", "authorization_contract_version",
    "authorized_frequency", "authorized_initial_date", "authorized_terms_digest"].sort());
  for (const secret of [created.operationId, created.grant.id, created.plan.id, emails[created.actor], password])
    expect(JSON.stringify(proof)).not.toContain(secret);
  expect(frame.lots.filter(row => row.transactionId === purchase.id)).toEqual([expect.objectContaining({ holdingId: purchase.holdingId,
    quantity: "5.00000000", remainingQuantity: "5.00000000", costBasis: "10.00" })]);
  const audit = frame.audits.filter(row => row.entityType === "investment_transaction" && row.entityId === purchase.id);
  expect(audit).toEqual([expect.objectContaining({ userId: null,
    householdId: created.input.accountId === privateAccounts[created.household] ? null : householdIds[created.household],
    details: expect.objectContaining({ actor: "system", trigger: "sip", authorizationProofPurchaseId: purchase.id }) })]);
  return purchase;
}
async function materialize(...created: Created[]) {
  const before = await snapshot();
  expect(await processDueInvestments()).toMatchObject({ success: 0, held: created.length, failed: 0, skipped: 0, errors: [] });
  const after = await snapshot();
  expect(financial(after)).toEqual(financial(before));
  expect(after.grants).toEqual(before.grants); expect(after.operations).toEqual(before.operations);
  expect(after.reservations).toEqual(before.reservations); expect(after.confirmations).toEqual(before.confirmations);
  expect(after.fills).toEqual(before.fills);
  for (const item of created) {
    const advanced = after.plans.find(row => row.id === item.plan.id)!;
    expect(advanced.nextExecutionDate > item.input.nextExecutionDate).toBe(true);
    const original = before.plans.find(row => row.id === item.plan.id)!;
    expect(advanced).toEqual({ ...original, nextExecutionDate: advanced.nextExecutionDate, updatedAt: advanced.updatedAt });
    expect(after.fences.filter(row => row.planId === item.plan.id)).toEqual([
      { planId: item.plan.id, originalDueDate: item.input.nextExecutionDate, terminal: false },
    ]);
    expect(after.occurrences.filter(row => row.planId === item.plan.id)).toEqual([expect.objectContaining({
      originalDueDate: item.input.nextExecutionDate, householdId: householdIds[item.household], accountId: item.input.accountId,
      securityId, plannedAmount: "10.00", currency: "ZMW", authorizedFrequency: "monthly",
      authorizedInitialDate: item.input.nextExecutionDate, occurrenceRevision: 0, state: "pending",
    })]);
  }
}
function actualProofOracle(created: Created, purchase: Frame["purchases"][number]) {
  return createHash("sha256").update(JSON.stringify([2, "record_only_sip_actual_fill", purchase.accountId, purchase.securityId,
    purchase.quantity, purchase.price, purchase.fees, purchase.amount, purchase.currency, purchase.transactionDate,
    created.input.frequency, created.input.nextExecutionDate, null, null]), "utf8").digest("hex");
}
function assertProof(created: Created, frame: Frame) {
  const completed = actualCompletions.get(created.plan.id);
  expect(completed).toBeDefined();
  if (!completed) throw new Error("Actual confirmation evidence was not captured");
  const purchase = frame.purchases.find(row => row.id === completed.purchaseId)!;
  expect(purchase).toMatchObject({ type: "buy", householdId: householdIds[created.household], accountId: created.input.accountId,
    securityId, quantity: "5.00000000", price: "2.0000", fees: "0.00", amount: "10.00", currency: "ZMW",
    transactionDate: created.input.nextExecutionDate, notes: null, linkedTransactionId: null, fxRate: null, amountZmw: null });
  const proof = frame.proofs.find(row => row.purchase_id === completed.purchaseId)!;
  expect(proof).toEqual(completed.proof);
  expect(proof).toEqual({ purchase_id: purchase.id, author_user_id: actorIds[completed.actor], authorized_at: completed.proof.authorized_at,
    authorization_contract_version: 2, authorized_frequency: created.input.frequency,
    authorized_initial_date: created.input.nextExecutionDate, authorized_terms_digest: actualProofOracle(created, purchase) });
  expect(Object.keys(proof).sort()).toEqual(["purchase_id", "author_user_id", "authorized_at", "authorization_contract_version",
    "authorized_frequency", "authorized_initial_date", "authorized_terms_digest"].sort());
  const retained = JSON.stringify({ proof, purchase, lots: frame.lots.filter(row => row.transactionId === purchase.id),
    audits: frame.audits.filter(row => row.entityId === purchase.id), fences: frame.fences.filter(row => row.planId === created.plan.id) });
  for (const secret of [completed.command.operationId, created.operationId, created.grant.id, emails[completed.actor], password,
    completed.command.brokerReference, createHash("sha256").update(completed.command.brokerReference, "utf8").digest("hex")]) {
    expect(retained).not.toContain(secret);
  }
  expect(frame.lots.filter(row => row.transactionId === purchase.id)).toEqual([expect.objectContaining({ holdingId: purchase.holdingId,
    quantity: "5.00000000", remainingQuantity: "5.00000000", costBasis: "10.00", acquiredDate: purchase.transactionDate })]);
  expect(frame.audits.filter(row => row.entityType === "investment_transaction" && row.entityId === purchase.id))
    .toEqual([expect.objectContaining({ userId: actorIds[completed.actor],
      householdId: created.input.accountId === privateAccounts[created.household] ? null : householdIds[created.household],
      details: { newValue: { type: "buy", accountId: purchase.accountId, holdingId: purchase.holdingId, securityId,
        quantity: "5.00000000", price: "2.0000", fees: "0.00", feesDeclared: true, amount: "10.00", currency: "ZMW",
        transactionDate: created.input.nextExecutionDate } } })]);
  expect(frame.logs.filter(row => row.recurringInvestmentId === created.plan.id)).toEqual([]);
  return purchase;
}
async function confirmActual(created: Created, actor: Actor = created.actor) {
  const command: ActualCommand = { operationId: randomUUID(), expectedRevision: 0, finalStatement: true, outcome: "filled",
    brokerReference: `synthetic-statement-${randomUUID()}`,
    fills: [{ executionDate: created.input.nextExecutionDate, quantity: "5.00000000", price: "2.0000", fees: "0.00" }] };
  const before = await snapshot();
  const response = await signed(actor, "post", `${endpoint}/${created.plan.id}/occurrences/${created.input.nextExecutionDate}/confirm`, created.household)
    .send(command).expect(200);
  expect(response.body.data).toMatchObject({ requestVersion: 1, operationId: command.operationId, occurrence: {
    planId: created.plan.id, scheduledDate: created.input.nextExecutionDate, state: "closed", occurrenceRevision: 1,
    result: { outcome: "filled", fills: [{ fillIndex: 0, ...command.fills[0], amount: "10.00" }],
      totals: { grossAmount: "10.00", fees: "0.00", amount: "10.00" } },
  } });
  expect(response.body.data.occurrence.result.fills).toHaveLength(1);
  expect(JSON.stringify(response.body)).not.toContain(command.brokerReference);
  const purchaseId: string = response.body.data.occurrence.result.fills[0].purchaseId;
  const after = await snapshot(), receipts = after.confirmations.filter(row => row.planId === created.plan.id);
  expect(receipts).toEqual([expect.objectContaining({ actorUserId: actorIds[actor], operationId: command.operationId,
    originalDueDate: created.input.nextExecutionDate, brokerReference: command.brokerReference, outcome: "filled", fillCount: 1 })]);
  const receiptId = receipts[0].id, proof = after.proofs.find(row => row.purchase_id === purchaseId)!;
  expect((await pool.query<{ same_instant: boolean }>(`select p.authorized_at=c.authorized_at as same_instant
    from investment_purchase_authorization_proofs p join investment_sip_confirmed_fills f on f.purchase_id=p.purchase_id
    join investment_sip_confirmations c on c.id=f.confirmation_id
    where p.purchase_id=$1 and c.id=$2 and c.plan_id=$3 and c.original_due_date=$4
      and c.household_id=$5 and c.actor_user_id=$6 and p.author_user_id=$6`,
  [purchaseId, receiptId, created.plan.id, created.input.nextExecutionDate, householdIds[created.household], actorIds[actor]])).rows)
    .toEqual([{ same_instant: true }]);
  actualCompletions.set(created.plan.id, { actor, command, purchaseId, receiptId, proof });
  assertProof(created, after);
  expect(after.purchases).toHaveLength(before.purchases.length + 1); expect(after.lots).toHaveLength(before.lots.length + 1);
  for (const original of before.purchases) expect(after.purchases.find(row => row.id === original.id)).toEqual(original);
  for (const original of before.lots) expect(after.lots.find(row => row.id === original.id)).toEqual(original);
  for (const original of before.proofs) expect(after.proofs.find(row => row.purchase_id === original.purchase_id)).toEqual(original);
  for (const original of before.audits) expect(after.audits.find(row => row.id === original.id)).toEqual(original);
  for (const key of ["accounts", "cash", "disposals", "plans", "grants", "operations", "reservations", "logs"] as const)
    expect(after[key]).toEqual(before[key]);
  expect(after.fills.filter(row => row.confirmationId === receiptId)).toEqual([expect.objectContaining({
    purchaseId, fillIndex: 0, postingConfirmed: true, ...command.fills[0], amount: "10.00" })]);
  expect(after.fences.filter(row => row.planId === created.plan.id)).toEqual([
    { planId: created.plan.id, originalDueDate: created.input.nextExecutionDate, terminal: true },
  ]);
  expect(after.audits.filter(row => row.entityId === receiptId)).toEqual([expect.objectContaining({
    userId: actorIds[actor], householdId: null, entityType: "investment_sip_confirmation", action: "CREATE",
    details: { authorizationEvent: "sip_final_confirmation_v1", requestVersion: 1 },
  })]);
  return after;
}
async function execute(...created: Created[]) {
  await materialize(...created);
  for (const item of created) await confirmActual(item);
  return snapshot();
}
async function executeLegacy(created: Created) {
  // Historical v1 control only: call the retained writer with the authority
  // obtained from this actor's genuine signed mandate, never a seeded proof.
  const before = await snapshot();
  await withTransaction(async tx => {
    const authority = await lockSipExecutionAuthorization(tx, created.plan, created.input.nextExecutionDate);
    if (!authority) throw new Error("Legacy signed mandate is unavailable");
    const purchaseId = await recordSipPurchase(tx, authority, created.input.nextExecutionDate,
      sipExecutionKey(created.plan.id, created.input.nextExecutionDate));
    const nextExecutionDate = calculateNextDate(new Date(created.input.nextExecutionDate), authority.plan.frequency,
      authority.terms.initialDate).toISOString().slice(0, 10);
    await tx.update(recurringInvestments).set({ nextExecutionDate, updatedAt: new Date() }).where(eq(recurringInvestments.id, created.plan.id));
    await tx.insert(recurringExecutionLog).values({ recurringInvestmentId: created.plan.id, status: "success",
      amount: authority.plan.amount, resultEntityId: purchaseId, executionDate: new Date() });
  });
  const frame = await snapshot(); assertLegacyProof(created, frame);
  expect(frame.accounts).toEqual(before.accounts); expect(frame.cash).toEqual(before.cash);
  return frame;
}
function retentionState(frame: Frame) {
  return { financial: financial(frame), plans: frame.plans, grants: frame.grants, operations: frame.operations,
    reservations: frame.reservations, occurrences: frame.occurrences, confirmations: frame.confirmations, fills: frame.fills, fences: frame.fences };
}
async function assertClosedDetails(created: Created) {
  const completed = actualCompletions.get(created.plan.id)!;
  const peer: Actor = created.household === "current" ? "peer" : "formerPeer";
  const path = `${endpoint}/${created.plan.id}/occurrences`, before = await snapshot();
  if (created.input.accountId === privateAccounts[created.household]) {
    await signed(peer, "get", path, created.household).expect(404);
    await signed(peer, "post", `${path}/${created.input.nextExecutionDate}/confirm`, created.household).send(completed.command).expect(404);
  } else {
    const listed = await signed(peer, "get", `${path}?state=all`, created.household).expect(200);
    expect(listed.body.data).toEqual([{ planId: created.plan.id, scheduledDate: created.input.nextExecutionDate,
      state: "closed", detailsAvailable: false }]);
    const refused = await signed(peer, "post", `${path}/${created.input.nextExecutionDate}/confirm`, created.household)
      .send(completed.command).expect(409);
    expect(refused.body.error.code).toBe("OCCURRENCE_CLOSED_DETAILS_UNAVAILABLE");
    expect(refused.body).not.toHaveProperty("data");
  }
  expect(retentionState(await snapshot())).toEqual(retentionState(before));
}
function erase(actor: Actor = "subject", household: Household = "current") {
  return eraseAccount({ userId: actorIds[actor], householdId: householdIds[household], userEmail: emails[actor], ipAddress: "127.0.0.1" });
}
async function signedErase(actor: Actor = "subject", household: Household = "current") {
  const step = await signed(actor, "post", "/api/settings/security/step-up", household).send({ password }).expect(200);
  if (step.headers["set-cookie"]) cookies[actor] = (step.headers["set-cookie"] as unknown as string[]).join("; ");
  await signed(actor, "post", "/api/settings/account/delete", household).send({ password }).expect(200);
}
async function settle<T>(operation: Promise<T>): Promise<PromiseSettledResult<T>> {
  try { return { status: "fulfilled", value: await operation }; }
  catch (reason) { return { status: "rejected", reason }; }
}
async function waitingOn(blocker: number, minimum = 1) {
  let reached: number[] = [];
  const deadline = performance.now() + 5_000;
  for (let attempt = 0; attempt < 250 && performance.now() < deadline; attempt++) {
    const rows = (await pool.query<{ pid: number; blockers: number[] }>(`select pid,pg_blocking_pids(pid) as blockers
      from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()`)).rows;
    const chain = new Set([blocker]);
    for (let pass = 0; pass < rows.length; pass++) for (const row of rows)
      if (row.blockers.some(pid => chain.has(pid))) chain.add(row.pid);
    reached = Array.from(chain).filter(pid => pid !== blocker);
    if (reached.length >= minimum) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return reached;
}
async function gate(table: "investment_transactions" | "household_members", event: "INSERT" | "DELETE", predicate: string) {
  const name = `sip_erase_gate_${randomUUID().replaceAll("-", "")}`;
  const key = BigInt("0x" + randomUUID().replaceAll("-", "").slice(0, 15)).toString();
  const control = await pool.connect();
  let released: Promise<void> | undefined;
  const release = () => released ??= (async () => {
    let discard = false;
    try { await control.query("ROLLBACK"); }
    catch (error) { discard = true; throw error; }
    finally { control.release(discard); }
  })();
  try {
    await pool.query(`CREATE FUNCTION public."${name}"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
      BEGIN PERFORM set_config('lock_timeout','15s',true); PERFORM pg_advisory_xact_lock(${key}::bigint);
        RETURN ${event === "INSERT" ? "NEW" : "OLD"}; END $body$`);
    await pool.query(`CREATE TRIGGER "${name}" BEFORE ${event} ON public.${table} FOR EACH ROW
      WHEN (${predicate}) EXECUTE FUNCTION public."${name}"()`);
    await control.query("BEGIN"); await control.query(`SELECT pg_advisory_xact_lock(${key}::bigint)`);
    const pid = (await control.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
    return { pid, release, drop: async () => {
      await pool.query(`DROP TRIGGER IF EXISTS "${name}" ON public.${table}`);
      await pool.query(`DROP FUNCTION IF EXISTS public."${name}"()`);
    } };
  } catch (error) {
    await release();
    await pool.query(`DROP TRIGGER IF EXISTS "${name}" ON public.${table}`);
    await pool.query(`DROP FUNCTION IF EXISTS public."${name}"()`);
    throw error;
  }
}
async function clean() {
  if (!householdIds) return;
  const before = await snapshot(), hh = householdsInFixture();
  await db.delete(auditLogs).where(inArray(auditLogs.id, before.audits.map(row => row.id)));
  // Normal guarded lifecycle only: plans release operational children; deleting
  // actual BUYs cascades completed proofs before holdings can SET their FKs NULL.
  await db.delete(recurringInvestments).where(inArray(recurringInvestments.householdId, hh));
  await db.delete(taxLotDisposals).where(inArray(taxLotDisposals.householdId, hh));
  await db.delete(taxLots).where(inArray(taxLots.householdId, hh));
  await db.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, hh));
  await db.delete(holdings).where(inArray(holdings.householdId, hh));
  await db.delete(transactions).where(inArray(transactions.householdId, hh));
  await db.delete(households).where(inArray(households.id, hh));
  await db.delete(securities).where(eq(securities.id, securityId));
  await pool.query(`delete from "session" where sess->>'userId'=any($1::text[])
    or sess->>'mfaPendingUserId'=any($1::text[])`, [actors()]);
  await db.delete(securityAuditLogs).where(or(inArray(securityAuditLogs.userId, actors()), inArray(securityAuditLogs.targetUserId, actors())));
  await db.delete(users).where(inArray(users.id, actors()));
}

describe("UNVERIFIED R13 actual SIP erasure retains only completed authority proof", () => {
  beforeAll(async () => { app = await getTestApp(); passwordHash = await hashPassword(password); }, 30_000);
  beforeEach(async () => {
    householdIds = { current: randomUUID(), former: randomUUID() };
    actorIds = { subject: randomUUID(), peer: randomUUID(), former: randomUUID(), formerPeer: randomUUID() };
    emails = { subject: `sip-erase-${actorIds.subject}@example.invalid`, peer: `sip-erase-${actorIds.peer}@example.invalid`,
      former: `sip-erase-${actorIds.former}@example.invalid`, formerPeer: `sip-erase-${actorIds.formerPeer}@example.invalid` };
    cookies = { subject: "", peer: "", former: "", formerPeer: "" };
    sharedAccounts = { current: randomUUID(), former: randomUUID() };
    privateAccounts = { current: randomUUID(), former: randomUUID() }; securityId = randomUUID();
    knownEntities = new Set([...householdsInFixture(), ...actors(), ...Object.values(sharedAccounts), ...Object.values(privateAccounts), securityId]);
    actualCompletions = new Map();
    await db.insert(households).values(householdsInFixture().map(id => ({ id, name: "Synthetic SIP erasure household", currency: "ZMW" })));
    for (const actor of actorNames) {
      await db.insert(users).values({ id: actorIds[actor], email: emails[actor], username: `sip-erase-${actorIds[actor]}`,
        passwordHash, emailVerified: true, fullName: "Synthetic SIP Erasure", firstName: "Synthetic", lastName: "Erasure",
        displayName: `Synthetic ${actor}`, phoneNumber: "0970000000", address: "Synthetic fixture address", bio: "Synthetic erasure biography" });
      await db.insert(householdMembers).values({ householdId: householdIds[actor === "subject" || actor === "peer" ? "current" : "former"],
        userId: actorIds[actor], role: actor === "peer" || actor === "formerPeer" ? "owner" : "member" });
      const login = await request(app).post("/api/auth/login").send({ email: emails[actor], password }).expect(200);
      cookies[actor] = (login.headers["set-cookie"] as unknown as string[]).join("; ");
    }
    await signed("peer", "put", "/api/investments/calendar").send({ timeZone: "UTC" }).expect(200);
    await signed("formerPeer", "put", "/api/investments/calendar", "former").send({ timeZone: "UTC" }).expect(200);
    for (const household of ["current", "former"] as const) await db.insert(accounts).values([
      { id: sharedAccounts[household], householdId: householdIds[household], name: "Synthetic shared SIP custody", type: "investment",
        currency: "ZMW", initialBalance: "100.00", balance: "100.00", isPrivate: false, ownerUserId: actorIds[household === "current" ? "subject" : "former"] },
      { id: privateAccounts[household], householdId: householdIds[household], name: "Synthetic private SIP custody", type: "investment",
        currency: "ZMW", initialBalance: "100.00", balance: "100.00", isPrivate: true, ownerUserId: actorIds[household === "current" ? "subject" : "former"] },
    ]);
    await db.insert(securities).values({ id: securityId, symbol: `SIP_ERASE_${securityId.slice(0, 8)}`,
      name: "Synthetic SIP erasure instrument", type: "stock", currency: "ZMW", currentPrice: "2.00" });
  });
  afterEach(clean);

  it("retains a shared completed seven-field proof and financial history while purging unused and superseded actor authority", async () => {
    const completed = await create(); await execute(completed);
    const unused = await create("subject", "current", sharedAccounts.current, "2099-01-01");
    await reconfirm(unused, "subject").expect(200);
    const before = await snapshot(); expect(before.grants.filter(row => row.authorUserId === actorIds.subject)).toHaveLength(3);
    expect(before.proofs).toHaveLength(1);
    await signedErase(); const after = await snapshot();
    assertActorPurge(before, after); assertStopped(before, after); assertProof(completed, after);
    expect(financial(after)).toEqual(financial(before));
    await assertClosedDetails(completed);
    expect(after.logs.filter(row => row.recurringInvestmentId === unused.plan.id)).toEqual([]);
    await signed("subject", "get").expect(401);
    const stable = financial(await snapshot()); expect(await processDueInvestments()).toMatchObject({ success: 0, failed: 0 });
    expect(financial(await snapshot())).toEqual(stable);
  });

  it("retains a private completed proof without widening custody, plan or actual-effect audit audience", async () => {
    const completed = await create("subject", "current", privateAccounts.current); await execute(completed);
    const before = await snapshot(), purchase = assertProof(completed, before);
    await signedErase(); const after = await snapshot();
    assertActorPurge(before, after); assertStopped(before, after); assertProof(completed, after);
    expect(financial(after)).toEqual(financial(before));
    await assertClosedDetails(completed);
    expect(after.accounts.find(row => row.id === privateAccounts.current)).toMatchObject({ isPrivate: true, ownerUserId: actorIds.subject });
    expect(after.audits.filter(row => row.entityId === purchase.id)).toEqual(before.audits.filter(row => row.entityId === purchase.id));
    const listed = await signed("peer", "get").expect(200);
    expect(listed.body.data.some((row: { id: string }) => row.id === completed.plan.id)).toBe(false);
    const stable = await snapshot(); await signed("peer", "delete", `${endpoint}/${completed.plan.id}`).expect(404);
    expect(financial(await snapshot())).toEqual(financial(stable));
  });

  it("purges an old actor grant without stopping or replacing a peer's distinct current signed grant", async () => {
    const replacement = await create(); await reconfirm(replacement, "peer").expect(200);
    const before = await snapshot(), peerGrant = before.grants.find(row => row.authorUserId === actorIds.peer)!;
    expect(before.plans[0]).toMatchObject({ currentAuthorizationId: peerGrant.id, authorizationRevision: 2, isActive: true });
    expect(await erase()).toEqual({ householdDeleted: false }); const after = await snapshot();
    assertActorPurge(before, after); assertStopped(before, after);
    expect(after.grants).toEqual([peerGrant]); expect(after.plans).toEqual(before.plans);
    expect(after.operations).toEqual(before.operations.filter(row => row.actorUserId === actorIds.peer));
    expect(financial(after)).toEqual(financial(before));
    await materialize(replacement); const booked = await confirmActual(replacement, "peer");
    expect(booked.proofs).toEqual([expect.objectContaining({ author_user_id: actorIds.peer })]);
    expect(booked.grants).toEqual([peerGrant]); expect(booked.plans[0].currentAuthorizationId).toBe(peerGrant.id);
  });

  it("purges the actor globally across historical households and both operational audit families while retaining other actors byte-for-byte", async () => {
    await moveMembership("subject", "former"); const historical = await create("subject", "former"); await execute(historical);
    await pending("subject", "former"); await moveMembership("subject", "current");
    const current = await create(), peer = await create("peer"); await execute(current, peer);
    const deactivated = await create("subject", "current", sharedAccounts.current, "2099-01-01");
    await signed("subject", "delete", `${endpoint}/${deactivated.plan.id}`).expect(200);
    const before = await snapshot(), peerAudits = before.audits.filter(row => row.userId !== actorIds.subject || !operational(row));
    expect(before.grants.filter(row => row.authorUserId === actorIds.subject).map(row => row.householdId).sort())
      .toEqual([householdIds.current, householdIds.current, householdIds.former].sort());
    expect(before.audits.filter(row => row.userId === actorIds.subject && operational(row)).map(row =>
      (row.details as { authorizationEvent: string }).authorizationEvent)).toEqual(expect.arrayContaining(["sip_grant_v1", "pending_plan_v1", "plan_deactivated_v1"]));
    expect(await erase()).toEqual({ householdDeleted: false }); const after = await snapshot();
    assertActorPurge(before, after); assertStopped(before, after); assertProof(historical, after); assertProof(current, after); assertProof(peer, after);
    expect(financial(after)).toEqual(financial(before));
    await assertClosedDetails(historical); await assertClosedDetails(current);
    expect(after.confirmations).toEqual(before.confirmations.filter(row => row.actorUserId !== actorIds.subject));
    const peerReceiptIds = after.confirmations.map(row => row.id);
    expect(after.fills).toEqual(before.fills.filter(row => peerReceiptIds.includes(row.confirmationId)));
    expect(after.occurrences).toEqual(before.occurrences.filter(row => row.planId === peer.plan.id));
    expect(after.fences).toEqual(before.fences);
    expect(after.audits.filter(row => row.entityType !== "user_account")).toEqual(peerAudits);
    expect(after.grants).toEqual(before.grants.filter(row => row.authorUserId !== actorIds.subject));
    expect(after.operations).toEqual(before.operations.filter(row => row.actorUserId !== actorIds.subject));
  });

  it("deletes last-household purchases, proofs and their private null-household audits before custody, preserving an unrelated household", async () => {
    const shared = await create(), privatePlan = await create("subject", "current", privateAccounts.current);
    const bystander = await create("former", "former"); await execute(shared, privatePlan, bystander);
    await db.delete(householdMembers).where(eq(householdMembers.userId, actorIds.peer));
    const before = await snapshot(), owned = before.purchases.filter(row => row.householdId === householdIds.current).map(row => row.id);
    expect(owned).toHaveLength(2); expect(before.audits.filter(row => row.entityId === assertProof(privatePlan, before).id))
      .toEqual([expect.objectContaining({ householdId: null, userId: actorIds.subject })]);
    await signedErase(); const after = await snapshot(); assertActorPurge(before, after);
    expect(after.households.map(row => row.id)).toEqual([householdIds.former]);
    for (const key of ["accounts", "holdings", "purchases", "lots", "disposals", "cash", "plans", "grants", "operations"] as const)
      expect(after[key].filter(row => row.householdId === householdIds.current)).toEqual([]);
    expect(after.proofs.filter(row => owned.includes(row.purchase_id))).toEqual([]);
    expect(after.confirmations.filter(row => row.householdId === householdIds.current)).toEqual([]);
    expect(after.occurrences.filter(row => row.householdId === householdIds.current)).toEqual([]);
    const ownedPlanIds = before.plans.filter(row => row.householdId === householdIds.current).map(row => row.id);
    const ownedReceiptIds = before.confirmations.filter(row => row.householdId === householdIds.current).map(row => row.id);
    expect(after.fences.filter(row => ownedPlanIds.includes(row.planId))).toEqual([]);
    expect(after.fills.filter(row => ownedReceiptIds.includes(row.confirmationId))).toEqual([]);
    expect(after.audits.filter(row => row.entityType === "investment_transaction" && row.entityId && owned.includes(row.entityId))).toEqual([]);
    const retained = (frame: Frame) => ({ accounts: frame.accounts.filter(row => row.householdId === householdIds.former),
      holdings: frame.holdings.filter(row => row.householdId === householdIds.former), purchases: frame.purchases.filter(row => row.householdId === householdIds.former),
      lots: frame.lots.filter(row => row.householdId === householdIds.former), proofs: frame.proofs.filter(row => row.author_user_id === actorIds.former),
      audits: frame.audits.filter(row => row.householdId === householdIds.former || row.userId === actorIds.former),
      confirmations: frame.confirmations.filter(row => row.householdId === householdIds.former),
      occurrences: frame.occurrences.filter(row => row.householdId === householdIds.former),
      fences: frame.fences.filter(row => row.planId === bystander.plan.id),
      fills: frame.fills.filter(row => row.confirmationId === actualCompletions.get(bystander.plan.id)!.receiptId) });
    expect(retained(after)).toEqual(retained(before)); assertProof(bystander, after);
    expect(after.audits.filter(row => row.entityType === "user_account" && row.userId === actorIds.subject))
      .toEqual([expect.objectContaining({ householdId: null, details: expect.objectContaining({ householdDeleted: true }) })]);
  });

  it("keeps the lifetime revision after actual purge and requires a peer's explicit next revision without reactivating the plan", async () => {
    const created = await create(), before = await snapshot();
    expect(await erase()).toEqual({ householdDeleted: false }); const erased = await snapshot();
    assertActorPurge(before, erased); assertStopped(before, erased);
    await reconfirm(created, "peer", 0).expect(409); const stale = await snapshot();
    expect(financial(stale)).toEqual(financial(erased)); expect(stale.plans).toEqual(erased.plans);
    expect(stale.grants).toEqual(erased.grants); expect(stale.operations).toEqual(erased.operations);
    expect(stale.reservations).toEqual(erased.reservations); expect(stale.audits).toEqual(erased.audits);
    await reconfirm(created, "peer", 1).expect(200); const after = await snapshot();
    expect(after.plans[0]).toMatchObject({ id: created.plan.id, authorizationRevision: 2, isActive: false, nextExecutionDate: created.input.nextExecutionDate });
    expect(after.grants).toEqual([expect.objectContaining({ authorUserId: actorIds.peer, revision: 2 })]);
    expect(after.plans[0].currentAuthorizationId).toBe(after.grants[0].id);
    expect(after.operations).toEqual([expect.objectContaining({ actorUserId: actorIds.peer, action: "reconfirm", expectedRevision: 1 })]);
    const stable = await snapshot(); expect(await processDueInvestments()).toMatchObject({ success: 0, failed: 0, skipped: 0 });
    expect(await snapshot()).toEqual(stable); expect(after.proofs).toEqual([]);
  });

  it("lets an already fenced real purchase commit before erasure purges its grant and retains exactly that completed proof", async () => {
    const created = await create(); await materialize(created); const before = await snapshot();
    const barrier = await gate("investment_transactions", "INSERT", `NEW.household_id='${householdIds.current}'::uuid AND NEW.type='buy'`);
    // Hold erasure before its marker/purge too, so the real receipt can supply
    // exact SQL-time evidence after the purchase commits and before it is erased.
    let erasureBarrier: Awaited<ReturnType<typeof gate>> | undefined;
    let purchaseRun: Promise<PromiseSettledResult<Awaited<ReturnType<typeof confirmActual>>>> | undefined;
    let erasureRun: Promise<PromiseSettledResult<Awaited<ReturnType<typeof erase>>>> | undefined;
    // The HTTP response is not the commit signal: express-session's end-of-request
    // touch locks the user row FOR UPDATE after the purchase commits. Erasure takes
    // that row before its DELETE, so parking erasure at the DELETE gate while
    // awaiting the response is a circular wait that only the gate's lock_timeout
    // breaks. Hold erasure at its member lock instead (after households, before
    // users) until the response, including that touch, has completed.
    const memberHold = await pool.connect();
    let memberHoldOpen = false, holdWaiters: number[] = [];
    const releaseMemberHold = async () => {
      if (!memberHoldOpen) return;
      memberHoldOpen = false;
      await memberHold.query("ROLLBACK");
    };
    let executorWaiters: number[] = [], erasureWaiters: number[] = [], purgeWaiters: number[] = [];
    try {
      erasureBarrier = await gate("household_members", "DELETE", `OLD.user_id='${actorIds.subject}'::uuid`);
      await memberHold.query("BEGIN"); memberHoldOpen = true;
      await memberHold.query("select 1 from household_members where household_id=$1 and user_id=$2 for share",
        [householdIds.current, actorIds.subject]);
      const memberHoldPid = (await memberHold.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
      purchaseRun = settle(confirmActual(created));
      executorWaiters = await waitingOn(barrier.pid);
      erasureRun = settle(erase());
      if (executorWaiters[0]) erasureWaiters = await waitingOn(executorWaiters[0]);
      await barrier.release();
      // Erasure reaches the member lock only once the executor's household SHARE
      // lock is gone, i.e. after the purchase transaction committed.
      holdWaiters = await waitingOn(memberHoldPid);
      await purchaseRun;
      await releaseMemberHold();
      purgeWaiters = await waitingOn(erasureBarrier.pid);
    } finally {
      try { await Promise.all([barrier.release(), releaseMemberHold(), ...(erasureBarrier ? [erasureBarrier.release()] : [])]); }
      finally { try { await Promise.all([...(purchaseRun ? [purchaseRun] : []), ...(erasureRun ? [erasureRun] : [])]); }
        finally { memberHold.release(true); try { await barrier.drop(); } finally { if (erasureBarrier) await erasureBarrier.drop(); } } }
    }
    expect(executorWaiters.length).toBeGreaterThanOrEqual(1); expect(erasureWaiters.length).toBeGreaterThanOrEqual(1);
    expect(holdWaiters.length).toBeGreaterThanOrEqual(1); expect(purgeWaiters.length).toBeGreaterThanOrEqual(1);
    expect(await purchaseRun!).toMatchObject({ status: "fulfilled" });
    expect(await erasureRun!).toMatchObject({ status: "fulfilled", value: { householdDeleted: false } });
    const after = await snapshot(); assertActorPurge(before, after); assertProof(created, after);
    expect(after.proofs).toHaveLength(1); expect(after.purchases).toHaveLength(1); expect(after.lots).toHaveLength(1);
    expect(after.plans[0]).toMatchObject({ currentAuthorizationId: null, authorizationRevision: 1, isActive: false });
    expect(after.plans[0].nextExecutionDate).toBe(before.plans[0].nextExecutionDate);
    expect(after.confirmations).toEqual([]); expect(after.occurrences).toEqual([]); expect(after.fills).toEqual([]);
    expect(after.fences).toEqual([{ planId: created.plan.id, originalDueDate: created.input.nextExecutionDate, terminal: true }]);
    await assertClosedDetails(created);
    const stable = financial(after); expect(await processDueInvestments()).toMatchObject({ success: 0, failed: 0 });
    expect(financial(await snapshot())).toEqual(stable);
  }, 30_000);

  it("makes a stale due scan wait for actual erasure, then produces no purchase, proof or schedule advance", async () => {
    await create(); const before = await snapshot();
    const barrier = await gate("household_members", "DELETE", `OLD.user_id='${actorIds.subject}'::uuid`);
    const erasureRun = settle(erase());
    let purchaseRun: Promise<PromiseSettledResult<Awaited<ReturnType<typeof processDueInvestments>>>> | undefined;
    let erasureWaiters: number[] = [], executorWaiters: number[] = [];
    try {
      erasureWaiters = await waitingOn(barrier.pid);
      purchaseRun = settle(processDueInvestments());
      if (erasureWaiters[0]) executorWaiters = await waitingOn(erasureWaiters[0]);
    } finally {
      try { await barrier.release(); }
      finally { try { await Promise.all([erasureRun, ...(purchaseRun ? [purchaseRun] : [])]); } finally { await barrier.drop(); } }
    }
    expect(erasureWaiters.length).toBeGreaterThanOrEqual(1); expect(executorWaiters.length).toBeGreaterThanOrEqual(1);
    expect(await erasureRun).toMatchObject({ status: "fulfilled", value: { householdDeleted: false } });
    expect(await purchaseRun!).toMatchObject({ status: "fulfilled", value: { success: 0, failed: 0, skipped: 1 } });
    const after = await snapshot(); assertActorPurge(before, after); assertStopped(before, after);
    expect(financial(after)).toEqual(financial(before)); expect(after.proofs).toEqual([]);
  }, 30_000);

  it("makes an admitted signed actual-fill writer wait for erasure and then refuse without closing the occurrence", async () => {
    const created = await create(); await materialize(created); const before = await snapshot();
    const command: ActualCommand = { operationId: randomUUID(), expectedRevision: 0, finalStatement: true, outcome: "filled",
      brokerReference: `synthetic-erasure-loser-${randomUUID()}`,
      fills: [{ executionDate: created.input.nextExecutionDate, quantity: "5.00000000", price: "2.0000", fees: "0.00" }] };
    Object.freeze(command.fills[0]); Object.freeze(command.fills); Object.freeze(command);
    const submit = async () => signed("subject", "post",
      `${endpoint}/${created.plan.id}/occurrences/${created.input.nextExecutionDate}/confirm`).send(command);
    const barrier = await gate("household_members", "DELETE", `OLD.user_id='${actorIds.subject}'::uuid`);
    const erasureRun = settle(erase());
    let confirmationRun: Promise<PromiseSettledResult<Awaited<ReturnType<typeof submit>>>> | undefined;
    let erasureWaiters: number[] = [], writerWaiters: number[] = [];
    let admitted: Array<{ household_share: boolean }> = [];
    try {
      erasureWaiters = await waitingOn(barrier.pid);
      confirmationRun = settle(submit());
      if (erasureWaiters[0]) {
        writerWaiters = await waitingOn(erasureWaiters[0]);
        // The real writer locks household SHARE before re-reading membership
        // SHARE. A stale-cookie 401 cannot reach this blocked SQL statement.
        admitted = (await pool.query<{ household_share: boolean }>(`select
          query like '%"households"%' and query ~* 'for[[:space:]]+share' as household_share
          from pg_stat_activity where datname=current_database() and pid=any($1::int[])
            and $2::int=any(pg_blocking_pids(pid))`, [writerWaiters, erasureWaiters[0]])).rows;
      }
    } finally {
      try { await barrier.release(); }
      finally { try { await Promise.all([erasureRun, ...(confirmationRun ? [confirmationRun] : [])]); }
        finally { await barrier.drop(); } }
    }
    expect(erasureWaiters.length).toBeGreaterThanOrEqual(1); expect(writerWaiters.length).toBeGreaterThanOrEqual(1);
    expect(admitted).toEqual([{ household_share: true }]);
    expect(await erasureRun).toMatchObject({ status: "fulfilled", value: { householdDeleted: false } });
    const refused = await confirmationRun!;
    expect(refused).toMatchObject({ status: "fulfilled", value: { status: 403,
      body: { success: false, error: { code: "FORBIDDEN" } } } });
    if (refused.status === "fulfilled") expect(refused.value.body).not.toHaveProperty("data");
    const after = await snapshot(); assertActorPurge(before, after); assertStopped(before, after);
    expect(financial(after)).toEqual(financial(before));
    expect(after.confirmations).toEqual(before.confirmations); expect(after.fills).toEqual(before.fills);
    expect(after.occurrences).toEqual(before.occurrences); expect(after.fences).toEqual(before.fences);
    expect(after.plans[0].nextExecutionDate).toBe(before.plans[0].nextExecutionDate);
    expect(after.audits.filter(row => row.entityType !== "user_account"))
      .toEqual(before.audits.filter(row => row.entityType !== "user_account" && !(row.userId === actorIds.subject && operational(row))));
    expect(after.proofs).toEqual([]); expect(after.purchases).toEqual([]); expect(after.lots).toEqual([]);
    expect(JSON.stringify(after)).not.toContain(command.brokerReference);
  }, 30_000);

  it("serializes two actual erasures with crossed historical grants on the same ordered household anchors", async () => {
    await moveMembership("subject", "former"); const subjectHistory = await create("subject", "former"); await execute(subjectHistory);
    await moveMembership("subject", "current");
    await moveMembership("former", "current"); const formerHistory = await create("former"); await execute(formerHistory);
    await moveMembership("former", "former");
    await create(); await create("former", "former"); const before = await snapshot();
    expect(before.members.filter(row => row.userId === actorIds.subject)).toHaveLength(1);
    expect(before.members.filter(row => row.userId === actorIds.former)).toHaveLength(1);
    const control = await pool.connect(), firstHousehold = [...householdsInFixture()].sort()[0];
    const firstActor = firstHousehold === householdIds.current ? "subject" : "former";
    const firstContext = firstActor === "subject" ? "current" : "former";
    const secondActor = firstActor === "subject" ? "former" : "subject";
    const secondContext = secondActor === "subject" ? "current" : "former";
    let firstRun: Promise<PromiseSettledResult<Awaited<ReturnType<typeof erase>>>> | undefined;
    let secondRun: Promise<PromiseSettledResult<Awaited<ReturnType<typeof erase>>>> | undefined;
    let firstWaiters: number[] = [], waiters: number[] = [];
    try {
      await control.query("BEGIN"); await control.query("select id from households where id=$1 for update", [firstHousehold]);
      const pid = (await control.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
      // Put the actor whose CURRENT household is the first sorted anchor at
      // the front of that anchor's wait queue before starting the other actor.
      // A context-first implementation then cannot escape a reversed ordering
      // simply by draining the other transaction before the first is queued.
      firstRun = settle(erase(firstActor, firstContext)); firstWaiters = await waitingOn(pid);
      if (firstWaiters.length) {
        secondRun = settle(erase(secondActor, secondContext)); waiters = await waitingOn(pid, 2);
      }
    } finally {
      try { await control.query("ROLLBACK"); }
      finally { control.release(); await Promise.all([...(firstRun ? [firstRun] : []), ...(secondRun ? [secondRun] : [])]); }
    }
    expect(firstWaiters.length).toBeGreaterThanOrEqual(1); expect(waiters.length).toBeGreaterThanOrEqual(2);
    for (const result of [await firstRun!, await secondRun!]) expect(result).toMatchObject({ status: "fulfilled", value: { householdDeleted: false } });
    const after = await snapshot(); assertActorPurge(before, after); assertActorPurge(before, after, "former");
    assertStopped(before, after, ["subject", "former"]); expect(financial(after)).toEqual(financial(before));
    assertProof(subjectHistory, after); assertProof(formerHistory, after);
  }, 30_000);

  it.each(["operation", "reservation", "grant", "grant event audit", "recurring event audit"] as const)(
    "rolls back identity, sessions, counters, private finance and all operational families when actual %s purge fails, then permits retry", async fault => {
      const completed = await create("subject", "current", privateAccounts.current), peer = await create("peer");
      if (fault === "reservation") { await executeLegacy(completed); await execute(peer); }
      else await execute(completed, peer);
      const unused = await create("subject", "current", sharedAccounts.current, "2099-01-01");
      await reconfirm(unused, "subject").expect(200);
      await signed("subject", "delete", `${endpoint}/${unused.plan.id}`).expect(200); await pending();
      const before = await snapshot(), name = `sip_erase_fault_${randomUUID().replaceAll("-", "")}`;
      expect(before.grants.filter(row => row.authorUserId === actorIds.subject)).toHaveLength(3);
      expect(before.reservations.filter(row => row.authorizationId === completed.grant.id)).toHaveLength(fault === "reservation" ? 1 : 0);
      expect(before.operations.filter(row => row.actorUserId === actorIds.subject)).toHaveLength(4);
      expect(before.audits.filter(row => row.userId === actorIds.subject && operational(row)).map(row =>
        (row.details as { authorizationEvent: string }).authorizationEvent))
        .toEqual(expect.arrayContaining(["sip_grant_v1", "pending_plan_v1", "plan_deactivated_v1"]));
      const table = fault === "operation" ? "investment_plan_operations" : fault === "reservation" ? "investment_sip_purchase_reservations"
        : fault === "grant" ? "investment_plan_authorizations" : "audit_logs";
      const subjectGrants = before.grants.filter(row => row.authorUserId === actorIds.subject).map(row => `'${row.id}'::uuid`).join(",");
      const predicate = fault === "operation" ? `OLD.actor_user_id='${actorIds.subject}'::uuid`
        : fault === "reservation" ? `OLD.authorization_id IN (${subjectGrants})`
        : fault === "grant" ? `OLD.author_user_id='${actorIds.subject}'::uuid`
        : `OLD.user_id='${actorIds.subject}'::uuid AND OLD.household_id IS NULL AND ` + (fault === "grant event audit"
          ? "OLD.entity_type='investment_plan_authorization' AND OLD.details->>'authorizationEvent'='sip_grant_v1'"
          : "OLD.entity_type='recurring_investment' AND OLD.details->>'authorizationEvent' IN ('pending_plan_v1','plan_deactivated_v1')");
      const witness = `${name}_seen`;
      try {
        // Sequence advancement survives rollback, proving this exact DELETE
        // stage ran instead of accepting an unrelated earlier guard refusal.
        await pool.query(`CREATE SEQUENCE public."${witness}"`);
        await pool.query(`CREATE FUNCTION public."${name}"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
          BEGIN PERFORM nextval('public."${witness}"'::regclass);
            RAISE EXCEPTION 'Synthetic SIP actor purge failure' USING ERRCODE='23514'; END $body$`);
        await pool.query(`CREATE TRIGGER "${name}" BEFORE DELETE ON public.${table} FOR EACH ROW
          WHEN (${predicate}) EXECUTE FUNCTION public."${name}"()`);
        const result = await settle(erase());
        expect.soft(result.status).toBe("rejected");
        const causes: unknown[] = [];
        let error: unknown = result.status === "rejected" ? result.reason : undefined;
        // Drizzle may wrap the PostgreSQL error; require the intended SQL
        // code/message in its bounded cause chain without assuming a wrapper.
        for (let depth = 0; depth < 5 && error && typeof error === "object"; depth++) {
          causes.push(error); error = (error as { cause?: unknown }).cause;
        }
        expect.soft(causes).toContainEqual(expect.objectContaining({ code: "23514", message: "Synthetic SIP actor purge failure" }));
        expect((await pool.query(`SELECT last_value::text,is_called FROM public."${witness}"`)).rows)
          .toEqual([{ last_value: "1", is_called: true }]);
        expect(await snapshot()).toEqual(before);
        await signed("subject", "get").expect(200);
      } finally {
        await pool.query(`DROP TRIGGER IF EXISTS "${name}" ON public.${table}`);
        await pool.query(`DROP FUNCTION IF EXISTS public."${name}"()`);
        await pool.query(`DROP SEQUENCE IF EXISTS public."${witness}"`);
      }
      const beforeRetry = await snapshot(); expect(await erase()).toEqual({ householdDeleted: false }); const after = await snapshot();
      assertActorPurge(beforeRetry, after); assertStopped(beforeRetry, after);
      expect(financial(after)).toEqual(financial(beforeRetry));
      if (fault === "reservation") assertLegacyProof(completed, after); else assertProof(completed, after);
      assertProof(peer, after);
      expect(after.grants).toEqual(beforeRetry.grants.filter(row => row.authorUserId === actorIds.peer));
      expect(after.operations).toEqual(beforeRetry.operations.filter(row => row.actorUserId === actorIds.peer));
      await signed("subject", "get").expect(401);
    });

  it("retains a genuine legacy-v1 purchase and its seven-field proof after actual actor erasure", async () => {
    const completed = await create("subject", "current", privateAccounts.current);
    const before = await executeLegacy(completed);
    expect(before.reservations.filter(row => row.authorizationId === completed.grant.id)).toHaveLength(1);
    expect(before.confirmations).toEqual([]); expect(before.occurrences).toEqual([]); expect(before.fences).toEqual([]);
    await signedErase(); const after = await snapshot();
    assertActorPurge(before, after); assertStopped(before, after); assertLegacyProof(completed, after);
    expect(financial(after)).toEqual(financial(before));
    expect(after.reservations).toEqual([]);
    expect(after.accounts.find(row => row.id === privateAccounts.current)).toMatchObject({ isPrivate: true, ownerUserId: actorIds.subject });
    const stable = financial(after);
    expect(await processDueInvestments()).toMatchObject({ success: 0, held: 0, failed: 0 });
    expect(financial(await snapshot())).toEqual(stable);
  });
});
