import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { accounts, auditLogs, holdings, householdMembers, households, investmentOpeningOperationReceipts,
  investmentSipConfirmations, investmentSipConfirmedFills, investmentSipOccurrenceFences, investmentSipOccurrences,
  investmentTransactions, recurringExecutionLog, recurringInvestments, securities, taxLotDisposals,
  taxLots, transactions, users } from "@shared/schema";
import { db, pool } from "../../db";
import { hashPassword } from "../../auth";
import { getTestApp } from "../../__tests__/fixtures";
import { processDueInvestments } from "../../services/investment/processDueInvestments";
import { digestSipFillProofTerms } from "../../services/investment/sipFillProofContract";

// Maintained extension of the five frozen 39f caller oracles. The immutable
// fd84aa1d/40e baseline has 33 cases (17 PASS/16 FAIL); candidate additions below
// remain unexecuted until the coordinator's protected serial window.
// Every plan/grant/receipt comes from its actual actor's authenticated POST;
// no mandate actor, authorization or SID is directly inserted by this suite.
// Actual-fill adaptations are SOURCE ONLY / UNRUN, requiring corrected0029,
// shared mapping/router composition and Main's protected serial window.
const householdId = randomUUID(), securityId = randomUUID();
const privateAccountId = randomUUID(), sharedAccountId = randomUUID(), missingId = randomUUID();
const actorIds = { owner: randomUUID(), peer: randomUUID() };
type Actor = keyof typeof actorIds;
type RetainedProof = {
  purchase_id: string; author_user_id: string; authorized_at: string; authorization_contract_version: number;
  authorized_frequency: string; authorized_initial_date: string; authorized_terms_digest: string;
};
const cookies: Record<Actor, string> = { owner: "", peer: "" };
const actorList = [actorIds.owner, actorIds.peer];
const endpoint = "/api/investments/recurring";
let app: Awaited<ReturnType<typeof getTestApp>>;

function signed(actor: Actor, method: "get" | "post" | "put" | "delete", path = endpoint) {
  return request(app)[method](path).set("Cookie", cookies[actor])
    .set("X-Capital-Subject", actorIds[actor]).set("X-Capital-Household", householdId);
}
function declaration(accountId: string, amount = "10.00") {
  return { accountId, securityId, type: "sip", frequency: "monthly" as const, amount,
    currency: "ZMW", nextExecutionDate: new Date().toISOString().slice(0, 10) };
}
function authorizeDeclaration(input: ReturnType<typeof declaration>, expectedRevision: number, operationId = randomUUID()) {
  const { nextExecutionDate, ...terms } = input;
  return { ...terms, initialExecutionDate: nextExecutionDate, expectedRevision, operationId };
}
function reconfirmIntentOracle(planId: string, input: ReturnType<typeof authorizeDeclaration>) {
  // Independent wire-intent oracle; inputs here are already literal canonical
  // terms, never product normalization or the retained terms digest.
  return createHash("sha256").update(JSON.stringify([1, "reconfirm", planId, input.expectedRevision, "sip",
    input.accountId, input.securityId, input.amount, input.currency, input.frequency, input.initialExecutionDate]), "utf8").digest("hex");
}
async function simulateOperationalActorPurge(planId: string, actor: Actor) {
  // Storage/API ABA simulation ONLY, not eraseAccount acceptance. Every grant
  // originated from real signed HTTP. Keep temporary erasure and restoration
  // inside ONE transaction; failure rolls back the entire bounded fixture.
  await db.transaction(async tx => {
    const [author] = await tx.select().from(users).where(eq(users.id, actorIds[actor])).for("update");
    expect(author.erasedAt).toBeNull();
    await tx.update(users).set({ erasedAt: new Date() }).where(eq(users.id, author.id));
    await tx.update(recurringInvestments).set({ currentAuthorizationId: null }).where(and(
      eq(recurringInvestments.id, planId), eq(recurringInvestments.householdId, householdId)));
    await tx.execute(sql`delete from investment_plan_operations where household_id=${householdId}
      and plan_id=${planId} and actor_user_id=${author.id}`);
    await tx.execute(sql`delete from investment_plan_authorizations where household_id=${householdId}
      and plan_id=${planId} and author_user_id=${author.id}`);
    await tx.update(users).set({ erasedAt: author.erasedAt }).where(eq(users.id, author.id));
  });
}
async function createPlan(actor: Actor, accountId: string, amount = "10.00", operationId = randomUUID()) {
  const input = declaration(accountId, amount);
  const response = await signed(actor, "post").send({ ...input, operationId }).expect(200);
  expect(response.body).toMatchObject({ success: true, data: { ...input, householdId, isActive: true } });
  expect(response.body.data.id).toEqual(expect.any(String));
  const id = response.body.data.id as string;
  expect((await db.select().from(recurringInvestments).where(eq(recurringInvestments.id, id)))[0])
    .toMatchObject({ id, ...input, householdId, isActive: true });
  return id;
}
async function ownedEntityIds() {
  const rows = await db.select({ id: investmentTransactions.id }).from(investmentTransactions)
    .where(eq(investmentTransactions.householdId, householdId));
  const positions = await db.select({ id: holdings.id }).from(holdings).where(eq(holdings.householdId, householdId));
  const plans = await db.select({ id: recurringInvestments.id }).from(recurringInvestments)
    .where(eq(recurringInvestments.householdId, householdId));
  return [householdId, securityId, privateAccountId, sharedAccountId, ...actorList,
    ...rows.map(row => row.id), ...positions.map(row => row.id), ...plans.map(row => row.id)];
}
async function snapshot() {
  const entityIds = await ownedEntityIds();
  return {
    accounts: await db.select().from(accounts).where(eq(accounts.householdId, householdId)).orderBy(accounts.id),
    holdings: await db.select().from(holdings).where(eq(holdings.householdId, householdId)).orderBy(holdings.id),
    purchases: await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, householdId))
      .orderBy(investmentTransactions.id),
    lots: await db.select().from(taxLots).where(eq(taxLots.householdId, householdId)).orderBy(taxLots.id),
    disposals: await db.select().from(taxLotDisposals).where(eq(taxLotDisposals.householdId, householdId)).orderBy(taxLotDisposals.id),
    cash: await db.select().from(transactions).where(eq(transactions.householdId, householdId)).orderBy(transactions.id),
    plans: await db.select().from(recurringInvestments).where(eq(recurringInvestments.householdId, householdId))
      .orderBy(recurringInvestments.id),
    logs: (await pool.query(`select l.* from recurring_execution_log l
      join recurring_investments p on p.id=l.recurring_investment_id where p.household_id=$1 order by l.id`, [householdId])).rows,
    openings: await db.select().from(investmentOpeningOperationReceipts)
      .where(eq(investmentOpeningOperationReceipts.householdId, householdId)).orderBy(investmentOpeningOperationReceipts.operationId),
    authorizations: (await pool.query(`select a.*,a.initial_execution_date::text as initial_execution_date
      from investment_plan_authorizations a where a.household_id=$1 order by a.id`, [householdId])).rows,
    operations: (await pool.query(`select * from investment_plan_operations
      where household_id=$1 order by actor_user_id,operation_id`, [householdId])).rows,
    reservations: (await pool.query(`select r.* from investment_sip_purchase_reservations r
      join investment_plan_authorizations a on a.id=r.authorization_id
      where a.household_id=$1 order by r.purchase_id`, [householdId])).rows,
    proofs: (await pool.query<RetainedProof>(`select p.*,p.authorized_at::text as authorized_at,
      p.authorized_initial_date::text as authorized_initial_date from investment_purchase_authorization_proofs p
      join investment_transactions t on t.id=p.purchase_id where t.household_id=$1 order by p.purchase_id`, [householdId])).rows,
    fences: await db.select().from(investmentSipOccurrenceFences).where(inArray(investmentSipOccurrenceFences.planId,
      db.select({ id: recurringInvestments.id }).from(recurringInvestments).where(eq(recurringInvestments.householdId, householdId)),
    )).orderBy(investmentSipOccurrenceFences.planId, investmentSipOccurrenceFences.originalDueDate),
    occurrences: await db.select().from(investmentSipOccurrences).where(eq(investmentSipOccurrences.householdId, householdId))
      .orderBy(investmentSipOccurrences.planId, investmentSipOccurrences.originalDueDate),
    confirmations: await db.select().from(investmentSipConfirmations).where(eq(investmentSipConfirmations.householdId, householdId))
      .orderBy(investmentSipConfirmations.id),
    fills: await db.select().from(investmentSipConfirmedFills).where(inArray(investmentSipConfirmedFills.confirmationId,
      db.select({ id: investmentSipConfirmations.id }).from(investmentSipConfirmations)
        .where(eq(investmentSipConfirmations.householdId, householdId)),
    )).orderBy(investmentSipConfirmedFills.confirmationId, investmentSipConfirmedFills.fillIndex),
    audits: await db.select().from(auditLogs).where(or(eq(auditLogs.householdId, householdId),
      inArray(auditLogs.userId, actorList), inArray(auditLogs.entityId, entityIds))).orderBy(auditLogs.id),
  };
}
async function cleanEffects() {
  // Select actual generated entity IDs before deleting their financial rows so
  // a private actor audit can be cleaned without guessing its audience.
  const entityIds = await ownedEntityIds();
  await db.delete(auditLogs).where(or(eq(auditLogs.householdId, householdId),
    inArray(auditLogs.userId, actorList), inArray(auditLogs.entityId, entityIds)));
  // Plan removal releases its immutable0028/0029 operational children through
  // guarded cascades; purchase deletion removes proofs before holding cleanup.
  // Never forge erased actors or disable triggers to delete live grants.
  await db.delete(recurringInvestments).where(eq(recurringInvestments.householdId, householdId));
  await db.delete(taxLotDisposals).where(eq(taxLotDisposals.householdId, householdId));
  await db.delete(taxLots).where(eq(taxLots.householdId, householdId));
  await db.delete(investmentTransactions).where(eq(investmentTransactions.householdId, householdId));
  await db.delete(holdings).where(eq(holdings.householdId, householdId));
}
function expectOpaque404(hidden: request.Response, absent: request.Response, planId?: string) {
  expect.soft(hidden.status).toBe(404);
  expect.soft(absent.status).toBe(404);
  expect.soft(hidden.body.success).toBe(false);
  expect.soft(hidden.body).not.toHaveProperty("data");
  // Compare only the error description; per-request timestamps need not match.
  expect.soft(hidden.body.error?.message ?? hidden.body.message)
    .toBe(absent.body.error?.message ?? absent.body.message);
  for (const id of [privateAccountId, ...(planId ? [planId] : [])]) expect.soft(hidden.text).not.toContain(id);
}
function expectUnchangedFinancial(before: Awaited<ReturnType<typeof snapshot>>, after: Awaited<ReturnType<typeof snapshot>>) {
  // Failed-access security logging is separate from these financial/grant
  // effects. Capture scoped audits, but do not forbid such logging.
  for (const key of ["accounts", "holdings", "purchases", "lots", "disposals", "cash", "plans", "logs", "openings",
    "authorizations", "operations", "reservations", "proofs", "fences", "occurrences", "confirmations", "fills"] as const) {
    expect.soft(after[key]).toEqual(before[key]);
  }
}
function creationAudits(frame: Awaited<ReturnType<typeof snapshot>>) {
  const ids = [...frame.plans.map(row => row.id), ...frame.authorizations.map(row => row.id)];
  return frame.audits.filter(row => row.action === "CREATE" && row.entityId !== null && ids.includes(row.entityId));
}
function expectNoBookedEffects(before: Awaited<ReturnType<typeof snapshot>>, after: Awaited<ReturnType<typeof snapshot>>) {
  for (const key of ["accounts", "holdings", "purchases", "lots", "disposals", "cash", "logs", "openings", "reservations", "proofs",
    "fences", "occurrences", "confirmations", "fills"] as const) {
    expect(after[key]).toEqual(before[key]);
  }
}
async function committedCreate() {
  const operationId = randomUUID(), input = declaration(sharedAccountId), before = await snapshot();
  const response = await signed("owner", "post").send({ ...input, operationId }).expect(200);
  expect(response.body).toMatchObject({ success: true, data: { id: expect.any(String), ...input } });
  const planId = response.body.data.id as string, after = await snapshot();
  expect(after.plans).toHaveLength(1);
  expect(after.authorizations).toEqual([expect.objectContaining({ id: expect.any(String), plan_id: planId,
    household_id: householdId, author_user_id: actorIds.owner, revision: 1,
    authorization_contract_version: 1, authorization_kind: "record_only_sip", account_id: sharedAccountId,
    security_id: securityId, amount: "10.00", currency: "ZMW", frequency: "monthly",
    initial_execution_date: input.nextExecutionDate, authorized_terms_digest: expect.stringMatching(/^[0-9a-f]{64}$/) })]);
  const authorizationId = after.authorizations[0].id as string;
  expect(after.plans[0]).toMatchObject({ id: planId, currentAuthorizationId: authorizationId });
  expect(after.operations).toEqual([expect.objectContaining({ household_id: householdId, actor_user_id: actorIds.owner,
    operation_id: operationId, action: "create", request_version: 1, expected_revision: 0,
    request_digest: expect.stringMatching(/^[0-9a-f]{64}$/), plan_id: planId, authorization_id: authorizationId })]);
  expect(creationAudits(after)).toEqual([expect.objectContaining({ userId: actorIds.owner, action: "CREATE" })]);
  expectNoBookedEffects(before, after);
  return { operationId, input, planId, after };
}
async function pendingConfirmation(planId: string) {
  const before = await snapshot();
  const plan = before.plans.find(row => row.id === planId)!;
  const scheduledDate = plan.nextExecutionDate;
  expect(await processDueInvestments()).toMatchObject({ success: 0, held: 1, failed: 0, skipped: 0, errors: [] });
  const held = await snapshot();
  for (const key of ["accounts", "holdings", "purchases", "lots", "disposals", "cash", "logs", "openings",
    "authorizations", "operations", "reservations", "proofs", "audits", "confirmations", "fills"] as const) {
    expect(held[key], `Held materialization changed ${key}`).toEqual(before[key]);
  }
  expect(held.fences).toEqual([expect.objectContaining({ planId, originalDueDate: scheduledDate, terminal: false })]);
  expect(held.occurrences).toEqual([expect.objectContaining({ planId, originalDueDate: scheduledDate,
    householdId, accountId: plan.accountId, securityId, occurrenceRevision: 0, state: "pending" })]);
  expect(held.plans[0].nextExecutionDate > scheduledDate).toBe(true);
  // Actual declared execution facts are independent of the reference quote.
  const input = { operationId: randomUUID(), expectedRevision: 0, finalStatement: true, outcome: "filled",
    fills: [{ executionDate: scheduledDate, quantity: "5.00000000", price: "2.0000", fees: "0.00" }] };
  return { planId, scheduledDate, input, held };
}
type PendingConfirmation = Awaited<ReturnType<typeof pendingConfirmation>>;
function confirmation(actor: Actor, pending: PendingConfirmation) {
  return signed(actor, "post", `${endpoint}/${pending.planId}/occurrences/${pending.scheduledDate}/confirm`).send(pending.input);
}
async function expectConfirmedPurchase(actor: Actor, accountId: string, pending: PendingConfirmation) {
  const { planId, scheduledDate, input, held: before } = pending;
  const response = await confirmation(actor, pending).expect(200);
  const result = response.body.data.occurrence.result;
  expect(result).toMatchObject({ outcome: "filled", fills: [{ fillIndex: 0, ...input.fills[0], amount: "10.00" }],
    totals: { grossAmount: "10.00", fees: "0.00", amount: "10.00" } });
  expect(result.fills).toHaveLength(1);
  const purchaseId: string = result.fills[0].purchaseId;
  const after = await snapshot();
  for (const key of ["accounts", "cash", "disposals", "openings", "plans", "logs", "authorizations", "operations", "reservations"] as const) {
    expect(after[key]).toEqual(before[key]);
  }
  expect(after.holdings).toEqual([expect.objectContaining({ householdId, accountId, securityId,
    quantity: "5.00000000", costBasis: "10.00", acquiredDate: scheduledDate })]);
  expect(after.purchases).toEqual([expect.objectContaining({ id: purchaseId, householdId, accountId, securityId,
    type: "buy", quantity: "5.00000000", price: "2.0000", fees: "0.00", amount: "10.00", currency: "ZMW",
    transactionDate: scheduledDate, amountZmw: null, fxRate: null, linkedTransactionId: null })]);
  const purchase = after.purchases[0], holding = after.holdings[0];
  expect(after.lots).toEqual([expect.objectContaining({ householdId, holdingId: holding.id,
    transactionId: purchaseId, quantity: "5.00000000", remainingQuantity: "5.00000000", costBasis: "10.00",
    acquiredDate: scheduledDate })]);
  const audits = after.audits.filter(row => row.entityType === "investment_transaction" && row.entityId === purchaseId);
  expect(audits).toEqual([expect.objectContaining({ userId: actorIds[actor], action: "CREATE",
    householdId: accountId === privateAccountId ? null : householdId,
    details: { newValue: { accountId, holdingId: holding.id, securityId, type: "buy", quantity: "5.00000000",
      price: "2.0000", fees: "0.00", feesDeclared: true, amount: "10.00", currency: "ZMW", transactionDate: scheduledDate } } })]);
  expect(after.proofs).toEqual([expect.objectContaining({ purchase_id: purchaseId, author_user_id: actorIds[actor],
    authorization_contract_version: 2, authorized_frequency: "monthly", authorized_initial_date: scheduledDate })]);
  const proof = after.proofs[0];
  expect(Object.keys(proof).sort()).toEqual(["purchase_id", "author_user_id", "authorized_at", "authorization_contract_version",
    "authorized_frequency", "authorized_initial_date", "authorized_terms_digest"].sort());
  expect(proof.authorized_terms_digest).toBe(digestSipFillProofTerms({
    contractVersion: 2, contractType: "record_only_sip_actual_fill", accountId, securityId,
    quantity: purchase.quantity, price: purchase.price, fees: purchase.fees, amount: purchase.amount, currency: purchase.currency,
    executionDate: purchase.transactionDate, authorizedFrequency: proof.authorized_frequency,
    authorizedInitialDate: proof.authorized_initial_date, fxRate: purchase.fxRate, amountZmw: purchase.amountZmw,
  }));
  expect(after.confirmations).toEqual([expect.objectContaining({ planId, originalDueDate: scheduledDate,
    householdId, actorUserId: actorIds[actor], operationId: input.operationId, outcome: "filled", fillCount: 1 })]);
  const receipt = after.confirmations[0];
  expect((await pool.query<{ same_instant: boolean }>(`
    select p.authorized_at = c.authorized_at as same_instant
    from investment_purchase_authorization_proofs p
    join investment_sip_confirmed_fills f on f.purchase_id=p.purchase_id
    join investment_sip_confirmations c on c.id=f.confirmation_id
    where p.purchase_id=$1 and c.id=$2 and c.plan_id=$3 and c.original_due_date=$4
      and c.household_id=$5 and c.actor_user_id=$6 and p.author_user_id=$6`,
  [purchaseId, receipt.id, planId, scheduledDate, householdId, actorIds[actor]])).rows).toEqual([{ same_instant: true }]);
  expect(after.fills).toEqual([expect.objectContaining({ confirmationId: receipt.id, purchaseId,
    fillIndex: 0, postingConfirmed: true, ...input.fills[0], amount: "10.00" })]);
  expect(after.fences).toEqual([expect.objectContaining({ planId, originalDueDate: scheduledDate, terminal: true })]);
  expect(after.occurrences).toEqual([expect.objectContaining({ planId, originalDueDate: scheduledDate,
    state: "closed", occurrenceRevision: 1 })]);
  expect(after.audits.filter(row => row.entityId === receipt.id)).toEqual([expect.objectContaining({
    userId: actorIds[actor], householdId: null, action: "CREATE", entityType: "investment_sip_confirmation",
    details: { authorizationEvent: "sip_final_confirmation_v1", requestVersion: 1 },
  })]);
  expect(after.audits).toHaveLength(before.audits.length + 2);
  for (const audit of before.audits) expect(after.audits.find(row => row.id === audit.id)).toEqual(audit);
  const replay = await confirmation(actor, pending).expect(200);
  expect(replay.body).toEqual(response.body);
  expect(await snapshot()).toEqual(after);
  expect(await processDueInvestments()).toMatchObject({ success: 0, held: 0, failed: 0, errors: [] });
  expect(await snapshot()).toEqual(after);
}
async function expectRecordOnlyPurchase(actor: Actor, accountId: string) {
  const planId = await createPlan(actor, accountId);
  await expectConfirmedPurchase(actor, accountId, await pendingConfirmation(planId));
}

describe("UNVERIFIED R13 signed private SIP owner and same-household peer callers", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const password = "SyntheticSipPrivate123!", passwordHash = await hashPassword(password);
    await db.insert(households).values({ id: householdId, name: "Synthetic private SIP caller", currency: "ZMW" });
    for (const actor of ["owner", "peer"] as const) {
      const id = actorIds[actor], email = `sip-private-${id}@example.invalid`;
      await db.insert(users).values({ id, email, username: `sip-private-${id}`, passwordHash, emailVerified: true, timezone: "Africa/Lusaka" });
      await db.insert(householdMembers).values({ householdId, userId: id, role: actor === "owner" ? "owner" : "member" });
      const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
      cookies[actor] = (login.headers["set-cookie"] as unknown as string[]).join("; ");
    }
    await signed("owner", "put", "/api/investments/calendar").send({ timeZone: "UTC" }).expect(200);
    await db.insert(accounts).values([
      { id: privateAccountId, householdId, name: "Synthetic owner-only SIP custody", type: "savings", currency: "ZMW",
        initialBalance: "100.00", balance: "100.00", isPrivate: true, ownerUserId: actorIds.owner },
      { id: sharedAccountId, householdId, name: "Synthetic shared SIP custody", type: "savings", currency: "ZMW",
        initialBalance: "100.00", balance: "100.00", isPrivate: false, ownerUserId: actorIds.owner },
    ]);
    await db.insert(securities).values({ id: securityId, symbol: "SIPPRIVATE" + securityId.slice(0, 8),
      name: "Synthetic private SIP stock", type: "stock", currency: "ZMW", currentPrice: "7.1234" });
  }, 30_000);
  afterEach(cleanEffects);
  afterAll(async () => {
    await cleanEffects();
    await pool.query(`delete from "session" where sess->>'userId'=any($1::text[])
      or sess->>'mfaPendingUserId'=any($1::text[])`, [actorList]);
    await db.delete(households).where(eq(households.id, householdId));
    await db.delete(securities).where(eq(securities.id, securityId));
    await db.delete(users).where(inArray(users.id, actorList));
  });

  it("supports the actual shared-account signed caller as the positive fixture control", async () => {
    await expectRecordOnlyPurchase("owner", sharedAccountId);
  });
  it("records the private owner's actual signed final fill with one persisted record-only BUY and lot", async () => {
    await expectRecordOnlyPurchase("owner", privateAccountId);
  });
  it("keeps private actual-fill confirmation owner-only with an opaque peer refusal and a positive owner retry", async () => {
    const pending = await pendingConfirmation(await createPlan("owner", privateAccountId));
    const before = await snapshot();
    const hidden = await confirmation("peer", pending);
    const absent = await signed("peer", "post", `${endpoint}/${missingId}/occurrences/${pending.scheduledDate}/confirm`)
      .send({ ...pending.input, operationId: randomUUID() });
    expectOpaque404(hidden, absent, pending.planId);
    expect(await snapshot()).toEqual(before);
    await expectConfirmedPurchase("owner", privateAccountId, pending);
  });
  it("refuses an actual signed fill after instrument denomination changes without recording any partial purchase", async () => {
    const pending = await pendingConfirmation(await createPlan("owner", sharedAccountId));
    try {
      await db.update(securities).set({ currency: "USD" }).where(eq(securities.id, securityId));
      const before = await snapshot();
      const source = await db.select().from(securities).where(eq(securities.id, securityId));
      const refused = await confirmation("peer", pending).expect(409);
      expect(refused.body).toMatchObject({ success: false, error: { code: "CONFLICT", details: { reason: "SOURCE_CHANGED" } } });
      expect(refused.body).not.toHaveProperty("data");
      expect(await snapshot()).toEqual(before);
      expect(await db.select().from(securities).where(eq(securities.id, securityId))).toEqual(source);
    } finally {
      await db.update(securities).set({ currency: "ZMW" }).where(eq(securities.id, securityId));
    }
    await expectConfirmedPurchase("peer", sharedAccountId, pending);
  });
  it("refuses a same-household peer's private-custody plan POST without changing any financial or plan state", async () => {
    const before = await snapshot();
    const hidden = await signed("peer", "post").send({ ...declaration(privateAccountId), operationId: randomUUID() });
    const absent = await signed("peer", "post").send({ ...declaration(missingId), operationId: randomUUID() });
    const after = await snapshot();
    expectOpaque404(hidden, absent);
    expectUnchangedFinancial(before, after);
  });
  it("omits the owner's private plan from the peer's real list while preserving the peer's shared positive control", async () => {
    const privatePlan = await createPlan("owner", privateAccountId);
    const sharedPlan = await createPlan("peer", sharedAccountId, "4.00");
    const before = await snapshot();
    const response = await signed("peer", "get").expect(200);
    const after = await snapshot();
    expect.soft(response.body).toMatchObject({ success: true });
    expect.soft(response.body.data).toEqual([expect.objectContaining({ id: sharedPlan, accountId: sharedAccountId, amount: "4.00" })]);
    expect.soft(response.text).not.toContain(privatePlan);
    expect.soft(response.text).not.toContain(privateAccountId);
    expectUnchangedFinancial(before, after);
  });
  it("refuses peer deactivation of the owner's private plan with the same opaque404 and unchanged persisted state", async () => {
    const planId = await createPlan("owner", privateAccountId);
    const before = await snapshot();
    const hidden = await signed("peer", "delete", `${endpoint}/${planId}`);
    const absent = await signed("peer", "delete", `${endpoint}/${missingId}`);
    const after = await snapshot();
    expectOpaque404(hidden, absent, planId);
    expectUnchangedFinancial(before, after);
  });

  it("requires an explicit valid client-issued operationId without persisting plan or authorization effects", async () => {
    const input = declaration(sharedAccountId), before = await snapshot();
    for (const operationId of [undefined, null, "", "not-a-uuid", 7]) {
      const body = operationId === undefined ? input : { ...input, operationId };
      await signed("owner", "post").send(body).expect(400);
      const after = await snapshot();
      expectUnchangedFinancial(before, after);
      expect(creationAudits(after)).toEqual(creationAudits(before));
    }
  });
  it("replays equivalent signed intent with the original plan and one persisted grant, receipt and creation audit", async () => {
    const created = await committedCreate();
    const response = await signed("owner", "post").send({ ...created.input, operationId: created.operationId,
      accountId: sharedAccountId.toUpperCase(), securityId: securityId.toUpperCase(), amount: "10", currency: "zmw" }).expect(200);
    expect(response.body).toMatchObject({ success: true, data: { id: created.planId } });
    expect(await snapshot()).toEqual(created.after);
  });
  it("rejects the same valid operation key with changed intent without adding any persisted effect", async () => {
    const created = await committedCreate();
    const response = await signed("owner", "post")
      .send({ ...created.input, operationId: created.operationId, amount: "10.01" }).expect(409);
    expect(response.body.success).toBe(false);
    expect(response.body).not.toHaveProperty("data");
    const after = await snapshot();
    expectUnchangedFinancial(created.after, after);
    expect(creationAudits(after)).toEqual(creationAudits(created.after));
  });
  it("serializes concurrent signed retries into one plan, grant, receipt and grant audit", async () => {
    const operationId = randomUUID(), input = declaration(sharedAccountId), before = await snapshot();
    const responses = await Promise.all([0, 1].map(() => signed("owner", "post").send({ ...input, operationId })));
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(responses[0].body.data.id).toBe(responses[1].body.data.id);
    const after = await snapshot();
    expect(after.plans).toHaveLength(1); expect(after.authorizations).toHaveLength(1); expect(after.operations).toHaveLength(1);
    expect(after.operations[0]).toMatchObject({ operation_id: operationId, plan_id: after.plans[0].id,
      authorization_id: after.authorizations[0].id, actor_user_id: actorIds.owner });
    expect(creationAudits(after)).toHaveLength(1); expectNoBookedEffects(before, after);
  });
  it("rolls back plan, grant, pointer and receipt when the actual grant audit INSERT fails", async () => {
    const operationId = randomUUID(), input = declaration(sharedAccountId), before = await snapshot();
    const suffix = randomUUID().replace(/-/g, ""), guard = `sip_api_audit_${suffix}`;
    try {
      await pool.query(`create function public.${guard}() returns trigger language plpgsql as $guard$
        begin if NEW.user_id='${actorIds.owner}'::uuid and NEW.action='CREATE' then
          raise exception 'Synthetic SIP API audit refusal' using errcode='23514'; end if; return NEW; end $guard$`);
      await pool.query(`create trigger ${guard} before insert on audit_logs for each row execute function public.${guard}()`);
      await signed("owner", "post").send({ ...input, operationId }).expect(500);
      expect(await snapshot()).toEqual(before);
    } finally {
      await pool.query(`drop trigger if exists ${guard} on audit_logs`);
      await pool.query(`drop function if exists public.${guard}()`);
    }
    await signed("owner", "post").send({ ...input, operationId }).expect(200);
    const after = await snapshot();
    expect(after.plans).toHaveLength(1); expect(after.authorizations).toHaveLength(1); expect(after.operations).toHaveLength(1);
    expect(creationAudits(after)).toHaveLength(1); expectNoBookedEffects(before, after);
  });
  it.each(["view_only", "professional"] as const)("keeps %s read access separate from financial write authority", async role => {
    const planId = await createPlan("owner", sharedAccountId);
    const pending = await pendingConfirmation(planId), before = await snapshot();
    try {
      await db.update(householdMembers).set({ role }).where(and(eq(householdMembers.householdId, householdId),
        eq(householdMembers.userId, actorIds.peer)));
      const listed = await signed("peer", "get").expect(200);
      expect(listed.body.data).toEqual([expect.objectContaining({ id: planId })]);
      await signed("peer", "post").send({ ...declaration(sharedAccountId), operationId: randomUUID() }).expect(403);
      await signed("peer", "delete", `${endpoint}/${planId}`).expect(403);
      await confirmation("peer", pending).expect(403);
      const after = await snapshot();
      expectUnchangedFinancial(before, after);
      expect(after).toEqual(before);
    } finally {
      await db.update(householdMembers).set({ role: "member" }).where(and(eq(householdMembers.householdId, householdId),
        eq(householdMembers.userId, actorIds.peer)));
    }
    await expectConfirmedPurchase("peer", sharedAccountId, pending);
  });
  it("reauthorizes original custody before disclosing a changed replay intent", async () => {
    const created = await committedCreate();
    try {
      await db.update(accounts).set({ isPrivate: true, ownerUserId: actorIds.peer }).where(eq(accounts.id, sharedAccountId));
      const before = await snapshot();
      const hidden = await signed("owner", "post").send({ ...created.input, operationId: created.operationId, amount: "10.01" });
      const absent = await signed("owner", "post").send({ ...declaration(missingId), operationId: randomUUID() });
      expectOpaque404(hidden, absent);
      expect(hidden.text).not.toContain(sharedAccountId);
      expectUnchangedFinancial(before, await snapshot());
    } finally {
      await db.update(accounts).set({ isPrivate: false, ownerUserId: actorIds.owner }).where(eq(accounts.id, sharedAccountId));
    }
  });
  it("keeps a signed legacy rollover declaration visible and manageable without creating SIP authority", async () => {
    const input = { ...declaration(sharedAccountId), type: "rollover" }, before = await snapshot();
    const response = await signed("owner", "post").send(input).expect(200);
    const id = response.body.data.id as string, created = await snapshot();
    expect(created.plans).toEqual([expect.objectContaining({ id, type: "rollover", currentAuthorizationId: null })]);
    expect(created.authorizations).toEqual([]); expect(created.operations).toEqual([]); expectNoBookedEffects(before, created);
    expect(created.audits.filter(row => row.entityId === id)).toEqual([expect.objectContaining({ userId: actorIds.owner,
      householdId: null, action: "CREATE", entityType: "recurring_investment", details: { authorizationEvent: "pending_plan_v1" } })]);
    expect(response.body.data).toMatchObject({ authorizationStatus: "pending_reconciliation", authorizationRevision: 0 });
    const listed = await signed("owner", "get").expect(200);
    expect(listed.body.data).toEqual([expect.objectContaining({ id, type: "rollover" })]);
    await signed("owner", "delete", `${endpoint}/${id}`).expect(200);
    const deactivated = await snapshot();
    expect(deactivated.plans[0]).toMatchObject({ id, isActive: false, currentAuthorizationId: null });
    expect(deactivated.audits.filter(row => row.entityId === id && row.action === "UPDATE"))
      .toEqual([expect.objectContaining({ userId: actorIds.owner, householdId: null, entityType: "recurring_investment",
        details: { authorizationEvent: "plan_deactivated_v1" } })]);
    await signed("owner", "delete", `${endpoint}/${id}`).expect(200);
    expect(await snapshot()).toEqual(deactivated);
  });
  it("binds a supplied rollover operation key to one pending declaration without manufacturing a SIP grant", async () => {
    const operationId = randomUUID(), input = { ...declaration(sharedAccountId), type: "rollover", operationId };
    const response = await signed("owner", "post").send(input).expect(200), id = response.body.data.id as string;
    const created = await snapshot();
    expect(created.plans).toHaveLength(1); expect(created.authorizations).toEqual([]);
    expect(created.operations).toEqual([expect.objectContaining({ household_id: householdId, actor_user_id: actorIds.owner,
      operation_id: operationId, action: "create", plan_id: id, authorization_id: null, expected_revision: 0 })]);
    expect(created.audits.filter(row => row.entityId === id)).toEqual([expect.objectContaining({ userId: actorIds.owner,
      householdId: null, action: "CREATE", entityType: "recurring_investment", details: { authorizationEvent: "pending_plan_v1" } })]);
    const replay = await signed("owner", "post").send({ ...input, amount: "10", currency: "zmw" }).expect(200);
    expect(replay.body.data).toMatchObject({ id, authorizationStatus: "pending_reconciliation" });
    expect(await snapshot()).toEqual(created);
    await signed("owner", "post").send({ ...input, amount: "10.01" }).expect(409);
    expectUnchangedFinancial(created, await snapshot());
  });
  it("preserves only the legacy rollover omitted-currency ZMW fallback while requiring explicit SIP currency", async () => {
    const { currency: _currency, ...declarationWithoutCurrency } = declaration(sharedAccountId);
    const before = await snapshot();
    await signed("owner", "post").send({ ...declarationWithoutCurrency, operationId: randomUUID() }).expect(400);
    expect(await snapshot()).toEqual(before);
    const pending = { ...declarationWithoutCurrency, type: "rollover" };
    for (const currency of [null, "", "ZZ", "Z1W"]) {
      await signed("owner", "post").send({ ...pending, currency }).expect(400);
      expect(await snapshot()).toEqual(before);
    }
    await signed("owner", "post").send({ ...pending, currency: "USD" }).expect(409);
    expect(await snapshot()).toEqual(before);
    const response = await signed("owner", "post").send(pending).expect(200), id = response.body.data.id as string;
    expect(response.body.data).toMatchObject({ id, type: "rollover", currency: "ZMW", authorizationStatus: "pending_reconciliation" });
    const after = await snapshot();
    expect(after.plans).toEqual([expect.objectContaining({ id, currency: "ZMW", currentAuthorizationId: null })]);
    expect(after.authorizations).toEqual([]); expect(after.operations).toEqual([]); expectNoBookedEffects(before, after);
    expect(after.audits.filter(row => row.entityId === id)).toEqual([expect.objectContaining({ userId: actorIds.owner,
      householdId: null, action: "CREATE", entityType: "recurring_investment", details: { authorizationEvent: "pending_plan_v1" } })]);
    const listed = await signed("owner", "get").expect(200);
    expect(listed.body.data).toEqual([expect.objectContaining({ id, type: "rollover", currency: "ZMW" })]);
    await signed("owner", "delete", `${endpoint}/${id}`).expect(200);
    expect((await snapshot()).plans[0]).toMatchObject({ id, isActive: false, currency: "ZMW", currentAuthorizationId: null });
  });
  it.each(["missing", "null"] as const)("requires an explicit investment instrument for new SIP creation: %s", async kind => {
    const { securityId: _instrument, ...withoutInstrument } = declaration(sharedAccountId);
    const input = { ...withoutInstrument, operationId: randomUUID(), ...(kind === "null" ? { securityId: null } : {}) };
    const before = await snapshot();
    const response = await signed("owner", "post").send(input).expect(400);
    expect(response.body.success).toBe(false); expect(response.body).not.toHaveProperty("data");
    expect(await snapshot()).toEqual(before);
  });

  // Reconfirmation additions are an unexecuted source candidate requiring the
  // independently reviewed durable plan counter mapping/DDL before runtime.
  // All positive grants come from real signed HTTP; legacy setup has NO grant.
  it("requires an explicit reconfirm operation key and exact nonnegative integer revision", async () => {
    const created = await committedCreate(), input = authorizeDeclaration(created.input, 1), before = await snapshot();
    for (const operationId of [undefined, null, "", "not-a-uuid", 7]) {
      await signed("owner", "post", `${endpoint}/${created.planId}/authorize`).send({ ...input, operationId }).expect(400);
      expect(await snapshot()).toEqual(before);
    }
    for (const expectedRevision of [undefined, null, -1, 1.5, "1"]) {
      await signed("owner", "post", `${endpoint}/${created.planId}/authorize`).send({ ...input, expectedRevision }).expect(400);
      expect(await snapshot()).toEqual(before);
    }
    for (const field of ["type", "accountId", "securityId", "amount", "currency", "frequency", "initialExecutionDate"]) {
      const missing: Record<string, unknown> = { ...input }; delete missing[field];
      await signed("owner", "post", `${endpoint}/${created.planId}/authorize`).send(missing).expect(400);
      expect(await snapshot()).toEqual(before);
    }
  });
  it("records the actual shared signer and original initial date without resetting an advanced schedule", async () => {
    // SHA256 independently computed with .NET over this exact literal JSON:
    // [1,"reconfirm","11111111-1111-4111-8111-111111111111",7,"sip","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333","10.00","ZMW","monthly","2026-11-03"]
    expect(reconfirmIntentOracle("11111111-1111-4111-8111-111111111111", {
      ...authorizeDeclaration(declaration("22222222-2222-4222-8222-222222222222"), 7),
      securityId: "33333333-3333-4333-8333-333333333333", initialExecutionDate: "2026-11-03",
    })).toBe("772efc8ba4166b9675f7e3ab8c19bf5fdbb46550bed7599a9b97c612a96f9d6f");
    const created = await committedCreate(), operationId = randomUUID(), advancedDate = "2099-11-17";
    // Simulate schedule advancement only; do not fabricate a purchase or proof.
    await db.update(recurringInvestments).set({ nextExecutionDate: advancedDate }).where(eq(recurringInvestments.id, created.planId));
    const before = await snapshot(), input = authorizeDeclaration(created.input, 1, operationId);
    const response = await signed("peer", "post", `${endpoint}/${created.planId}/authorize`)
      .send({ ...input, accountId: sharedAccountId.toUpperCase(), securityId: securityId.toUpperCase(), amount: "10", currency: "zmw" }).expect(200);
    expect(response.body.data).toMatchObject({ id: created.planId, nextExecutionDate: advancedDate,
      authorizationStatus: "authorization_recorded", authorizationRevision: 2,
      authorizationInitialExecutionDate: created.input.nextExecutionDate });
    expect(response.body.data).not.toHaveProperty("canExecute");
    const after = await snapshot(), grant = after.authorizations.find(row => row.revision === 2);
    expect(after.authorizations).toHaveLength(2);
    expect(after.authorizations).toContainEqual(before.authorizations[0]);
    expect(grant).toMatchObject({ plan_id: created.planId, household_id: householdId, author_user_id: actorIds.peer,
      revision: 2, security_generation: 0, initial_execution_date: created.input.nextExecutionDate,
      authorized_terms_digest: before.authorizations[0].authorized_terms_digest });
    expect(after.plans[0]).toEqual({ ...before.plans[0], currentAuthorizationId: grant.id, authorizationRevision: 2,
      updatedAt: after.plans[0].updatedAt });
    expect(after.operations.filter(row => row.action === "reconfirm")).toEqual([expect.objectContaining({
      actor_user_id: actorIds.peer, operation_id: operationId, expected_revision: 1, plan_id: created.planId,
      authorization_id: grant.id, request_version: 1, request_digest: reconfirmIntentOracle(created.planId, input) })]);
    expect(after.operations.find(row => row.action === "reconfirm").request_digest).not.toBe(grant.authorized_terms_digest);
    expect(after.audits.filter(row => row.entityId === grant.id)).toEqual([expect.objectContaining({ userId: actorIds.peer,
      householdId: null, action: "CREATE", entityType: "investment_plan_authorization",
      details: { authorizationEvent: "sip_grant_v1", contractVersion: 1 } })]);
    expectNoBookedEffects(before, after);
    await db.update(recurringInvestments).set({ nextExecutionDate: "2099-11-18" }).where(eq(recurringInvestments.id, created.planId));
    const advanced = await snapshot();
    const advancedReplay = await signed("peer", "post", `${endpoint}/${created.planId}/authorize`).send(input).expect(200);
    expect(advancedReplay.body.data).toMatchObject({ nextExecutionDate: "2099-11-18", authorizationRevision: 2 });
    expect(await snapshot()).toEqual(advanced);
    // A later signed revision supersedes this receipt's outcome. Retrying the
    // old exact request acknowledges it without restoring its former pointer.
    await signed("owner", "post", `${endpoint}/${created.planId}/authorize`)
      .send(authorizeDeclaration(created.input, 2)).expect(200);
    await db.update(recurringInvestments).set({ nextExecutionDate: "2099-12-17" }).where(eq(recurringInvestments.id, created.planId));
    const superseded = await snapshot();
    const replay = await signed("peer", "post", `${endpoint}/${created.planId}/authorize`).send(input).expect(200);
    expect(replay.body.data).toMatchObject({ id: created.planId, nextExecutionDate: "2099-12-17", authorizationRevision: 3,
      authorizationInitialExecutionDate: created.input.nextExecutionDate });
    expect(await snapshot()).toEqual(superseded);
    for (const changed of [{ expectedRevision: 2 }, { amount: "10.01" }]) {
      await signed("peer", "post", `${endpoint}/${created.planId}/authorize`).send({ ...input, ...changed }).expect(409);
      expect(await snapshot()).toEqual(superseded);
    }
    await signed("peer", "post", `${endpoint}/${missingId}/authorize`).send(input).expect(409);
    expect(await snapshot()).toEqual(superseded);
  });
  it("refuses stale revisions or changed current terms without treating reconfirmation as a plan editor", async () => {
    const created = await committedCreate(), before = await snapshot();
    await signed("owner", "post", `${endpoint}/${created.planId}/authorize`)
      .send(authorizeDeclaration(created.input, 1, created.operationId)).expect(409);
    expect(await snapshot()).toEqual(before);
    for (const changed of [{ expectedRevision: 0 }, { expectedRevision: 2 }, { amount: "10.01" },
      { currency: "USD" }, { frequency: "weekly" }, { accountId: privateAccountId },
      { securityId: missingId }, { initialExecutionDate: "2040-02-29" }]) {
      await signed("owner", "post", `${endpoint}/${created.planId}/authorize`)
        .send({ ...authorizeDeclaration(created.input, 1), ...changed }).expect(409);
      expect(await snapshot()).toEqual(before);
    }
  });
  it("requires an explicit legacy displayed date and records no inferred historical author or start", async () => {
    const input = { ...declaration(sharedAccountId), nextExecutionDate: "2040-02-29" };
    const [legacy] = await db.insert(recurringInvestments).values({ ...input, householdId, currentAuthorizationId: null }).returning();
    const before = await snapshot();
    expect(before.authorizations).toEqual([]); expect(before.operations).toEqual([]);
    const listed = await signed("peer", "get").expect(200);
    expect(listed.body.data).toEqual([expect.objectContaining({ id: legacy.id, authorizationRevision: 0,
      authorizationStatus: "authorization_required", authorizationInitialExecutionDate: null,
      permittedActions: ["authorize", "deactivate"] })]);
    await signed("peer", "post", `${endpoint}/${legacy.id}/authorize`)
      .send({ ...authorizeDeclaration(input, 0), initialExecutionDate: "2040-02-28" }).expect(409);
    expect(await snapshot()).toEqual(before);
    await signed("peer", "post", `${endpoint}/${legacy.id}/authorize`).send(authorizeDeclaration(input, 0)).expect(200);
    const after = await snapshot();
    expect(after.authorizations).toEqual([expect.objectContaining({ plan_id: legacy.id, author_user_id: actorIds.peer,
      revision: 1, initial_execution_date: "2040-02-29" })]);
    expect(after.plans[0]).toEqual({ ...before.plans[0], currentAuthorizationId: after.authorizations[0].id,
      authorizationRevision: 1, updatedAt: after.plans[0].updatedAt });
    expect(after.operations).toEqual([expect.objectContaining({ action: "reconfirm", expected_revision: 0,
      actor_user_id: actorIds.peer, plan_id: legacy.id, authorization_id: after.authorizations[0].id })]);
    expect(creationAudits(after)).toHaveLength(1); expectNoBookedEffects(before, after);
  });
  it("rejects stale legacy revision zero after grant purge and uses the displayed date for the next explicit grant", async () => {
    const input = { ...declaration(sharedAccountId), nextExecutionDate: "2040-02-29" };
    const [legacy] = await db.insert(recurringInvestments).values({ ...input, householdId, currentAuthorizationId: null }).returning();
    const stale = authorizeDeclaration(input, 0), initial = await snapshot();
    expect(initial.plans[0]).toMatchObject({ currentAuthorizationId: null, authorizationRevision: 0 });
    await signed("owner", "post", `${endpoint}/${legacy.id}/authorize`).send(authorizeDeclaration(input, 0)).expect(200);
    const granted = await snapshot();
    expect(granted.plans[0]).toMatchObject({ authorizationRevision: 1, currentAuthorizationId: granted.authorizations[0].id });
    await simulateOperationalActorPurge(legacy.id, "owner");
    const purged = await snapshot();
    expect(purged.plans[0]).toMatchObject({ currentAuthorizationId: null, authorizationRevision: 1 });
    expect(purged.authorizations).toEqual([]); expect(purged.operations).toEqual([]);
    expect(purged.audits).toEqual(granted.audits); expectNoBookedEffects(granted, purged);
    const listed = await signed("peer", "get").expect(200);
    expect(listed.body.data).toEqual([expect.objectContaining({ id: legacy.id, authorizationRevision: 1,
      authorizationStatus: "authorization_required", authorizationInitialExecutionDate: null })]);
    await signed("peer", "post", `${endpoint}/${legacy.id}/authorize`).send(stale).expect(409);
    expect(await snapshot()).toEqual(purged);
    await db.update(recurringInvestments).set({ nextExecutionDate: "2040-03-31" }).where(eq(recurringInvestments.id, legacy.id));
    const advanced = await snapshot();
    await signed("peer", "post", `${endpoint}/${legacy.id}/authorize`).send(authorizeDeclaration(input, 1)).expect(409);
    expect(await snapshot()).toEqual(advanced);
    await signed("peer", "post", `${endpoint}/${legacy.id}/authorize`)
      .send(authorizeDeclaration({ ...input, nextExecutionDate: "2040-03-31" }, 1)).expect(200);
    const after = await snapshot();
    expect(after.authorizations).toEqual([expect.objectContaining({ revision: 2, author_user_id: actorIds.peer,
      initial_execution_date: "2040-03-31" })]);
    expect(after.authorizations[0].id).not.toBe(granted.authorizations[0].id);
    expect(after.plans[0]).toMatchObject({ authorizationRevision: 2, currentAuthorizationId: after.authorizations[0].id,
      nextExecutionDate: "2040-03-31" });
    expectNoBookedEffects(initial, after);
  });
  it("never reuses a purged grant revision to accept an earlier revision against a replacement grant", async () => {
    const created = await committedCreate(), oldGrantId = created.after.authorizations[0].id;
    await simulateOperationalActorPurge(created.planId, "owner");
    const purged = await snapshot();
    expect(purged.plans[0]).toMatchObject({ currentAuthorizationId: null, authorizationRevision: 1 });
    expect(purged.authorizations).toEqual([]); expect(purged.operations).toEqual([]);
    await signed("peer", "post", `${endpoint}/${created.planId}/authorize`).send(authorizeDeclaration(created.input, 1)).expect(200);
    const replacement = await snapshot();
    expect(replacement.authorizations).toEqual([expect.objectContaining({ revision: 2, author_user_id: actorIds.peer })]);
    expect(replacement.authorizations[0].id).not.toBe(oldGrantId);
    expect(replacement.plans[0]).toMatchObject({ currentAuthorizationId: replacement.authorizations[0].id, authorizationRevision: 2 });
    await signed("owner", "post", `${endpoint}/${created.planId}/authorize`).send(authorizeDeclaration(created.input, 1)).expect(409);
    expect(await snapshot()).toEqual(replacement);
    await signed("owner", "post", `${endpoint}/${created.planId}/authorize`).send(authorizeDeclaration(created.input, 2)).expect(200);
    const after = await snapshot();
    expect(after.authorizations.map(row => row.revision).sort()).toEqual([2, 3]);
    expect(after.plans[0]).toMatchObject({ authorizationRevision: 3,
      currentAuthorizationId: after.authorizations.find(row => row.revision === 3).id });
    expectNoBookedEffects(created.after, after);
  });
  it("keeps inactive reconfirmation inactive and unsupported legacy plans pending without fabricated grants", async () => {
    const created = await committedCreate();
    await signed("owner", "delete", `${endpoint}/${created.planId}`).expect(200);
    const inactive = await snapshot();
    const response = await signed("peer", "post", `${endpoint}/${created.planId}/authorize`)
      .send(authorizeDeclaration(created.input, 1)).expect(200);
    expect(response.body.data).toMatchObject({ id: created.planId, isActive: false, authorizationRevision: 2, authorizationStatus: "inactive" });
    const confirmed = await snapshot();
    expect(confirmed.plans[0]).toMatchObject({ isActive: false, nextExecutionDate: inactive.plans[0].nextExecutionDate });
    expectNoBookedEffects(inactive, confirmed);
    const unsupported = await db.insert(recurringInvestments).values([
      { ...declaration(sharedAccountId), householdId, type: "rollover", securityId: null },
      { ...declaration(sharedAccountId), householdId, securityId: null },
    ]).returning();
    const before = await snapshot(), listed = await signed("peer", "get").expect(200);
    for (const plan of unsupported) {
      expect(listed.body.data).toContainEqual(expect.objectContaining({ id: plan.id, authorizationRevision: 0,
        authorizationStatus: "pending_reconciliation", authorizationInitialExecutionDate: null }));
      await signed("peer", "post", `${endpoint}/${plan.id}/authorize`)
        .send(authorizeDeclaration(declaration(sharedAccountId), 0)).expect(409);
      expect(await snapshot()).toEqual(before);
    }
  });
  it("reauthorizes the original reconfirm receipt before reporting a changed term or target", async () => {
    const created = await committedCreate(), input = authorizeDeclaration(created.input, 1);
    await signed("peer", "post", `${endpoint}/${created.planId}/authorize`).send(input).expect(200);
    try {
      await db.update(accounts).set({ isPrivate: true, ownerUserId: actorIds.owner }).where(eq(accounts.id, sharedAccountId));
      const before = await snapshot();
      const hidden = await signed("peer", "post", `${endpoint}/${created.planId}/authorize`).send({ ...input, amount: "10.01" });
      const changedTarget = await signed("peer", "post", `${endpoint}/${missingId}/authorize`).send({ ...input, expectedRevision: 2 });
      const absent = await signed("peer", "post", `${endpoint}/${missingId}/authorize`)
        .send(authorizeDeclaration(created.input, 1));
      expectOpaque404(hidden, absent, created.planId); expectOpaque404(changedTarget, absent, created.planId);
      expect(hidden.text).not.toContain(sharedAccountId); expect(changedTarget.text).not.toContain(sharedAccountId);
      expectUnchangedFinancial(before, await snapshot());
    } finally {
      await db.update(accounts).set({ isPrivate: false, ownerUserId: actorIds.owner }).where(eq(accounts.id, sharedAccountId));
    }
  });
  it("keeps a SIP paired with a T-Bill visible as pending and refuses SIP reconfirm authority", async () => {
    const instrumentId = randomUUID();
    await db.insert(securities).values({ id: instrumentId, symbol: `SIPPAIR${instrumentId.slice(0, 8)}`,
      name: "Synthetic unsupported SIP instrument", type: "tbill", currency: "ZMW" });
    try {
      const input = { ...declaration(sharedAccountId), securityId: instrumentId }, operationId = randomUUID();
      const created = await signed("owner", "post").send({ ...input, operationId }).expect(200);
      const id = created.body.data.id as string, before = await snapshot();
      expect(before.authorizations).toEqual([]);
      expect(created.body.data).toMatchObject({ authorizationStatus: "pending_reconciliation", authorizationRevision: 0 });
      const listed = await signed("peer", "get").expect(200);
      expect(listed.body.data).toEqual([expect.objectContaining({ id, authorizationInitialExecutionDate: null,
        authorizationStatus: "pending_reconciliation", permittedActions: ["deactivate"] })]);
      await signed("peer", "post", `${endpoint}/${id}/authorize`).send(authorizeDeclaration(input, 0)).expect(409);
      expect(await snapshot()).toEqual(before);
    } finally {
      await db.delete(securities).where(eq(securities.id, instrumentId));
    }
  });
  it("keeps private reconfirm owner-only and a peer's denial indistinguishable from an absent plan", async () => {
    const planId = await createPlan("owner", privateAccountId), before = await snapshot();
    const input = authorizeDeclaration(declaration(privateAccountId), 1);
    const hidden = await signed("peer", "post", `${endpoint}/${planId}/authorize`).send(input);
    const absent = await signed("peer", "post", `${endpoint}/${missingId}/authorize`)
      .send({ ...input, operationId: randomUUID() });
    expectOpaque404(hidden, absent, planId); expectUnchangedFinancial(before, await snapshot());
    // Current private-source ownership permits the actual owner to reconfirm;
    // a passing peer refusal alone must not certify blanket private denial.
    const confirmed = await signed("owner", "post", `${endpoint}/${planId}/authorize`).send(input).expect(200);
    expect(confirmed.body.data).toMatchObject({ id: planId, authorizationRevision: 2,
      authorizationStatus: "authorization_recorded", nextExecutionDate: input.initialExecutionDate,
      authorizationInitialExecutionDate: input.initialExecutionDate, permittedActions: ["authorize", "deactivate"] });
    expect(confirmed.body.data).not.toHaveProperty("currentAuthorizationId");
    const after = await snapshot(), grant = after.authorizations.find(row => row.revision === 2);
    expect(after.authorizations).toHaveLength(2);
    expect(grant).toMatchObject({ plan_id: planId, author_user_id: actorIds.owner, account_id: privateAccountId,
      authorized_terms_digest: before.authorizations[0].authorized_terms_digest });
    expect(after.plans[0]).toEqual({ ...before.plans[0], currentAuthorizationId: grant.id,
      authorizationRevision: 2, updatedAt: after.plans[0].updatedAt });
    expect(after.operations).toHaveLength(2);
    expect(after.operations).toContainEqual(expect.objectContaining({ actor_user_id: actorIds.owner,
      operation_id: input.operationId, action: "reconfirm", authorization_id: grant.id,
      request_digest: reconfirmIntentOracle(planId, input) }));
    expect(after.audits.filter(row => row.entityId === grant.id)).toEqual([expect.objectContaining({
      userId: actorIds.owner, householdId: null, entityType: "investment_plan_authorization",
      action: "CREATE", details: { authorizationEvent: "sip_grant_v1", contractVersion: 1 } })]);
    expectNoBookedEffects(before, after);
  });
  it.each(["view_only", "professional"] as const)("does not offer or admit reconfirmation for a current %s reader", async role => {
    const created = await committedCreate(), before = await snapshot();
    try {
      await db.update(householdMembers).set({ role }).where(and(eq(householdMembers.householdId, householdId),
        eq(householdMembers.userId, actorIds.peer)));
      const listed = await signed("peer", "get").expect(200);
      expect(listed.body.data).toEqual([expect.objectContaining({ id: created.planId, authorizationRevision: 1, permittedActions: [] })]);
      await signed("peer", "post", `${endpoint}/${created.planId}/authorize`)
        .send(authorizeDeclaration(created.input, 1)).expect(403);
      expectUnchangedFinancial(before, await snapshot());
    } finally {
      await db.update(householdMembers).set({ role: "member" }).where(and(eq(householdMembers.householdId, householdId),
        eq(householdMembers.userId, actorIds.peer)));
    }
  });
  it("refuses a logged-out original SID even when the same user signs in again", async () => {
    const created = await committedCreate(), input = authorizeDeclaration(created.input, 1), oldCookie = cookies.peer;
    await signed("peer", "post", "/api/auth/logout").expect(200);
    try {
      const login = await request(app).post("/api/auth/login").send({
        email: `sip-private-${actorIds.peer}@example.invalid`, password: "SyntheticSipPrivate123!" }).expect(200);
      cookies.peer = (login.headers["set-cookie"] as unknown as string[]).join("; ");
      const before = await snapshot();
      await request(app).post(`${endpoint}/${created.planId}/authorize`).set("Cookie", oldCookie)
        .set("X-Capital-Subject", actorIds.peer).set("X-Capital-Household", householdId).send(input).expect(401);
      expectUnchangedFinancial(before, await snapshot());
      await signed("peer", "post", `${endpoint}/${created.planId}/authorize`).send(input).expect(200);
      const after = await snapshot();
      expect(after.authorizations).toHaveLength(2); expect(after.operations).toHaveLength(2);
      expect(creationAudits(after)).toHaveLength(2); expectNoBookedEffects(before, after);
    } finally {
      // A failed assertion must not leave later cases holding the ended SID.
      const login = await request(app).post("/api/auth/login").send({
        email: `sip-private-${actorIds.peer}@example.invalid`, password: "SyntheticSipPrivate123!" }).expect(200);
      cookies.peer = (login.headers["set-cookie"] as unknown as string[]).join("; ");
    }
  });
  it("serializes identical reconfirm retries and competing fresh keys against the locked revision", async () => {
    const created = await committedCreate(), input = authorizeDeclaration(created.input, 1), before = await snapshot();
    const responses = await Promise.all([0, 1].map(() => signed("peer", "post", `${endpoint}/${created.planId}/authorize`).send(input)));
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const retried = await snapshot();
    expect(retried.authorizations).toHaveLength(2); expect(retried.operations).toHaveLength(2);
    expect(creationAudits(retried)).toHaveLength(2); expectNoBookedEffects(before, retried);
    const competing = await Promise.all((["owner", "peer"] as const).map(actor => signed(actor, "post", `${endpoint}/${created.planId}/authorize`)
      .send(authorizeDeclaration(created.input, 2))));
    expect(competing.map(response => response.status).sort()).toEqual([200, 409]);
    const after = await snapshot();
    expect(after.authorizations.map(row => row.revision).sort()).toEqual([1, 2, 3]);
    expect(after.operations).toHaveLength(3); expect(creationAudits(after)).toHaveLength(3);
    expect(after.plans[0].currentAuthorizationId).toBe(after.authorizations.find(row => row.revision === 3).id);
    expectNoBookedEffects(before, after);
  });
  it("rolls back a reconfirm grant, pointer, receipt and audit together and permits one retry", async () => {
    const created = await committedCreate(), input = authorizeDeclaration(created.input, 1), before = await snapshot();
    const guard = `sip_reconfirm_audit_${randomUUID().replace(/-/g, "")}`;
    try {
      await pool.query(`create function public.${guard}() returns trigger language plpgsql as $guard$
        begin if NEW.user_id='${actorIds.peer}'::uuid and NEW.entity_type='investment_plan_authorization' then
          raise exception 'Synthetic SIP reconfirm audit refusal' using errcode='23514'; end if; return NEW; end $guard$`);
      await pool.query(`create trigger ${guard} before insert on audit_logs for each row execute function public.${guard}()`);
      await signed("peer", "post", `${endpoint}/${created.planId}/authorize`).send(input).expect(500);
      expect(await snapshot()).toEqual(before);
    } finally {
      await pool.query(`drop trigger if exists ${guard} on audit_logs`);
      await pool.query(`drop function if exists public.${guard}()`);
    }
    await signed("peer", "post", `${endpoint}/${created.planId}/authorize`).send(input).expect(200);
    const after = await snapshot();
    expect(after.authorizations).toHaveLength(2); expect(after.operations).toHaveLength(2);
    expect(creationAudits(after)).toHaveLength(2); expectNoBookedEffects(before, after);
  });
});
