import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { accounts, auditLogs, holdings, households, investmentPlanAuthorizations, investmentPlanOperations,
  investmentSipConfirmations, investmentSipConfirmedFills, investmentSipOccurrenceFences, investmentSipOccurrences,
  investmentSipPurchaseReservations, investmentTransactions, recurringExecutionLog, recurringInvestments, securities,
  taxLotDisposals, taxLots, transactions } from "@shared/schema";
import { db, pool } from "../../db";
import { a, b, actors, app, ids, reset, start, stop } from "../../modules/tags/__tests__/completion-r04.tags.fixture";
import { calculateNextDate, processDueInvestments, type SipExecutionResults } from "../../services/investment/processDueInvestments";
import { sipExecutionKey } from "../../services/investment/investmentCronKeys";
import { lockSipExecutionAuthorization, SIP_EXECUTION_REFUSAL } from "../../services/investment/sipExecutionAuthorization";
import { recordSipPurchase } from "../../services/investment/recordSipPurchase";
import { withTransaction } from "../../utils/withTransaction";

// SOURCE ONLY / UNRUN. Corrected0029, Main's retention contract and protected
// serial composition remain prerequisites. Legacy controls use real signed
// mandates and the retained old writer; no authority, proof or SID is seeded.
type Writer = "member" | "owner";
type Facts = { quantity: string; price: string; fees: string; amount: string };
type Command = { operationId: string; expectedRevision: 0; finalStatement: true; outcome: "filled"; brokerReference: string;
  fills: [{ executionDate: string; quantity: string; price: string; fees: string }] };
type Proof = { purchase_id: string; author_user_id: string; authorized_at: string; authorization_contract_version: number;
  authorized_frequency: string; authorized_initial_date: string; authorized_terms_digest: string };
const ownedSecurities = new Set<string>(), ownedPlans = new Set<string>(), knownEntities = new Set<string>([a]);
const today = () => new Date().toISOString().slice(0, 10);
function signed(writer: Writer, method: "post" | "put", path: string) {
  const actor = actors.get(writer)!;
  return request(app)[method](path).set("Cookie", actor.cookie)
    .set("X-Capital-Subject", actor.id).set("X-Capital-Household", a);
}
async function instrument(price = "0.3333") {
  const id = randomUUID();
  ownedSecurities.add(id); knownEntities.add(id);
  await db.insert(securities).values({ id, symbol: "SIP" + id.slice(0, 8), name: "Synthetic SIP", type: "stock", currency: "ZMW", currentPrice: price });
  return id;
}
async function plan(securityId: string, amount = "1.00", currency = "ZMW", frequency: "monthly" | "custom" = "monthly") {
  const member = actors.get("member")!;
  const response = await signed("member", "post", "/api/investments/recurring")
    .send({ operationId: randomUUID(), accountId: ids.sharedAccount, securityId, type: "sip", frequency,
      amount, currency, nextExecutionDate: today() }).expect(200);
  const [created] = await db.select().from(recurringInvestments).where(eq(recurringInvestments.id, response.body.data.id));
  ownedPlans.add(created.id); knownEntities.add(created.id);
  expect(created).toMatchObject({ householdId: a, accountId: ids.sharedAccount, securityId, type: "sip", frequency,
    amount, currency, nextExecutionDate: today(), isActive: true, authorizationRevision: 1,
    currentAuthorizationId: expect.any(String) });
  const [grant] = await db.select().from(investmentPlanAuthorizations).where(eq(investmentPlanAuthorizations.id, created.currentAuthorizationId!));
  expect(grant).toMatchObject({ planId: created.id, authorUserId: member.id, revision: 1, authorizationContractVersion: 1 });
  knownEntities.add(grant.id);
  return created;
}
type Created = Awaited<ReturnType<typeof plan>>;
async function legacyPlan(securityId: string, accountId: string) {
  // Explicitly legacy rows have no signed authority. These private/foreign
  // controls prove no effect, not reachability of a financial admission guard.
  const id = randomUUID();
  ownedPlans.add(id); knownEntities.add(id);
  await db.insert(recurringInvestments).values({ id, householdId: a, accountId, securityId, type: "sip", frequency: "monthly",
    amount: "0.01", currency: "ZMW", nextExecutionDate: today(), isActive: true });
  return id;
}
async function snapshot() {
  const securityIds = [...ownedSecurities], planIds = [...ownedPlans];
  const purchases = await db.select().from(investmentTransactions).where(inArray(investmentTransactions.securityId, securityIds)).orderBy(investmentTransactions.id);
  const positions = await db.select().from(holdings).where(inArray(holdings.securityId, securityIds)).orderBy(holdings.id);
  const grants = await db.select().from(investmentPlanAuthorizations).where(inArray(investmentPlanAuthorizations.planId, planIds)).orderBy(investmentPlanAuthorizations.id);
  const confirmations = await db.select().from(investmentSipConfirmations).where(inArray(investmentSipConfirmations.planId, planIds)).orderBy(investmentSipConfirmations.id);
  for (const row of [...purchases, ...positions, ...grants, ...confirmations]) knownEntities.add(row.id);
  return {
    purchases, holdings: positions, grants, confirmations,
    plans: await db.select().from(recurringInvestments).where(inArray(recurringInvestments.id, planIds)).orderBy(recurringInvestments.id),
    lots: await db.select().from(taxLots).where(inArray(taxLots.holdingId, positions.map(row => row.id))).orderBy(taxLots.id),
    disposals: await db.select().from(taxLotDisposals).where(inArray(taxLotDisposals.holdingId, positions.map(row => row.id))).orderBy(taxLotDisposals.id),
    accounts: await db.select().from(accounts).where(inArray(accounts.householdId, [a, b])).orderBy(accounts.id),
    cash: await db.select().from(transactions).where(inArray(transactions.householdId, [a, b])).orderBy(transactions.id),
    instruments: await db.select().from(securities).where(inArray(securities.id, securityIds)).orderBy(securities.id),
    operations: await db.select().from(investmentPlanOperations).where(inArray(investmentPlanOperations.planId, planIds))
      .orderBy(investmentPlanOperations.actorUserId, investmentPlanOperations.operationId),
    reservations: await db.select().from(investmentSipPurchaseReservations).where(inArray(investmentSipPurchaseReservations.authorizationId, grants.map(row => row.id)))
      .orderBy(investmentSipPurchaseReservations.purchaseId),
    occurrences: await db.select().from(investmentSipOccurrences).where(inArray(investmentSipOccurrences.planId, planIds))
      .orderBy(investmentSipOccurrences.planId, investmentSipOccurrences.originalDueDate),
    fences: await db.select().from(investmentSipOccurrenceFences).where(inArray(investmentSipOccurrenceFences.planId, planIds))
      .orderBy(investmentSipOccurrenceFences.planId, investmentSipOccurrenceFences.originalDueDate),
    fills: await db.select().from(investmentSipConfirmedFills).where(inArray(investmentSipConfirmedFills.confirmationId, confirmations.map(row => row.id)))
      .orderBy(investmentSipConfirmedFills.confirmationId, investmentSipConfirmedFills.fillIndex),
    proofs: (await pool.query<Proof>(`select p.*,p.authorized_at::text as authorized_at,
      p.authorized_initial_date::text as authorized_initial_date from investment_purchase_authorization_proofs p
      where p.purchase_id=any($1::uuid[]) order by p.purchase_id`, [purchases.map(row => row.id)])).rows,
    logs: await db.select().from(recurringExecutionLog).where(inArray(recurringExecutionLog.recurringInvestmentId, planIds)).orderBy(recurringExecutionLog.id),
    audits: await db.select().from(auditLogs).where(inArray(auditLogs.entityId, [...knownEntities])).orderBy(auditLogs.id),
  };
}
type Frame = Awaited<ReturnType<typeof snapshot>>;
async function clean() {
  const before = await snapshot();
  await db.transaction(async tx => {
    await tx.delete(auditLogs).where(inArray(auditLogs.id, before.audits.map(row => row.id)));
    // Release operational children, then remove actual purchases/proofs before
    // deleting custody can SET NULL on immutable proven purchase bindings.
    await tx.delete(recurringInvestments).where(inArray(recurringInvestments.id, [...ownedPlans]));
    await tx.delete(taxLotDisposals).where(inArray(taxLotDisposals.id, before.disposals.map(row => row.id)));
    await tx.delete(taxLots).where(inArray(taxLots.id, before.lots.map(row => row.id)));
    await tx.delete(investmentTransactions).where(inArray(investmentTransactions.securityId, [...ownedSecurities]));
    await tx.delete(holdings).where(inArray(holdings.securityId, [...ownedSecurities]));
    await tx.delete(securities).where(inArray(securities.id, [...ownedSecurities]));
  });
  ownedPlans.clear(); ownedSecurities.clear(); knownEntities.clear(); knownEntities.add(a);
}
function noPosting(before: Frame, after: Frame, allowFailureLogs = false) {
  for (const key of Object.keys(before) as Array<keyof Frame>) {
    if (key !== "logs") expect(after[key], key).toEqual(before[key]);
  }
  if (allowFailureLogs) expect(after.logs.filter(row => row.status === "success")).toEqual(before.logs.filter(row => row.status === "success"));
  else expect(after.logs).toEqual(before.logs);
}
async function materialize(created: Created[], execute = async () => [await processDueInvestments()]) {
  const before = await snapshot(), results = await execute(), after = await snapshot();
  expect(results.reduce((sum, result) => sum + result.held, 0)).toBe(created.length);
  expect(results.every(result => result.success === 0 && result.failed === 0 && result.errors.length === 0)).toBe(true);
  for (const key of ["holdings", "purchases", "lots", "disposals", "accounts", "cash", "instruments", "grants", "operations",
    "reservations", "confirmations", "fills", "proofs", "logs", "audits"] as const) expect(after[key], key).toEqual(before[key]);
  for (const source of created) {
    const current = after.plans.find(row => row.id === source.id)!, prior = before.plans.find(row => row.id === source.id)!;
    expect(current.nextExecutionDate > prior.nextExecutionDate).toBe(true);
    expect(current).toEqual({ ...prior, nextExecutionDate: current.nextExecutionDate, updatedAt: current.updatedAt });
    expect(after.fences.filter(row => row.planId === source.id)).toEqual([{ planId: source.id, originalDueDate: source.nextExecutionDate, terminal: false }]);
    expect(after.occurrences.filter(row => row.planId === source.id)).toEqual([expect.objectContaining({
      originalDueDate: source.nextExecutionDate, householdId: a, accountId: source.accountId, securityId: source.securityId,
      plannedAmount: source.amount, currency: source.currency, authorizedFrequency: source.frequency,
      authorizedInitialDate: source.nextExecutionDate, occurrenceRevision: 0, state: "pending",
    })]);
  }
  return after;
}
function command(created: Created, facts: Facts): Command {
  const value: Command = { operationId: randomUUID(), expectedRevision: 0, finalStatement: true, outcome: "filled",
    brokerReference: `synthetic-sale-statement-${randomUUID()}`,
    fills: [{ executionDate: created.nextExecutionDate, quantity: facts.quantity, price: facts.price, fees: facts.fees }] };
  Object.freeze(value.fills[0]); Object.freeze(value.fills); return Object.freeze(value);
}
async function postActual(created: Created, value: Command, writer: Writer = "member") {
  return signed(writer, "post", `/api/investments/recurring/${created.id}/occurrences/${created.nextExecutionDate}/confirm`).send(value);
}
async function verifyActual(created: Created, facts: Facts, value: Command, writer: Writer, response: Awaited<ReturnType<typeof postActual>>) {
  // Every original sale vector declares zero fees; gross and net share this
  // explicit expected native amount, independent of the standing plan budget.
  expect(facts.fees).toBe("0.00");
  expect(response.status).toBe(200);
  expect(response.body.data).toMatchObject({ requestVersion: 1, operationId: value.operationId, occurrence: {
    planId: created.id, scheduledDate: created.nextExecutionDate, state: "closed", occurrenceRevision: 1,
    result: { outcome: "filled", fills: [{ fillIndex: 0, ...value.fills[0], amount: facts.amount }],
      totals: { grossAmount: facts.amount, fees: facts.fees, amount: facts.amount } },
  } });
  expect(response.body.data.occurrence.result.fills).toHaveLength(1);
  const purchaseId: string = response.body.data.occurrence.result.fills[0].purchaseId, frame = await snapshot();
  const purchase = frame.purchases.find(row => row.id === purchaseId)!;
  expect(purchase).toMatchObject({ householdId: a, accountId: ids.sharedAccount, securityId: created.securityId, type: "buy",
    ...facts, transactionDate: created.nextExecutionDate, notes: null, linkedTransactionId: null, fxRate: null, amountZmw: null });
  expect(frame.lots.filter(row => row.transactionId === purchaseId)).toEqual([expect.objectContaining({ householdId: a,
    holdingId: purchase.holdingId, quantity: facts.quantity, remainingQuantity: facts.quantity, costBasis: facts.amount,
    acquiredDate: created.nextExecutionDate })]);
  const receipt = frame.confirmations.find(row => row.operationId === value.operationId)!;
  expect(receipt).toMatchObject({ actorUserId: actors.get(writer)!.id, householdId: a, planId: created.id,
    originalDueDate: created.nextExecutionDate, brokerReference: value.brokerReference, outcome: "filled", fillCount: 1 });
  expect(frame.fills.filter(row => row.confirmationId === receipt.id)).toEqual([expect.objectContaining({
    purchaseId, fillIndex: 0, postingConfirmed: true, ...value.fills[0], amount: facts.amount })]);
  const proof = frame.proofs.filter(row => row.purchase_id === purchaseId);
  expect(proof).toHaveLength(1);
  expect(Object.keys(proof[0]).sort()).toEqual(["purchase_id", "author_user_id", "authorized_at", "authorization_contract_version",
    "authorized_frequency", "authorized_initial_date", "authorized_terms_digest"].sort());
  const digest = createHash("sha256").update(JSON.stringify([2, "record_only_sip_actual_fill", purchase.accountId, purchase.securityId,
    purchase.quantity, purchase.price, purchase.fees, purchase.amount, purchase.currency, purchase.transactionDate,
    created.frequency, created.nextExecutionDate, null, null]), "utf8").digest("hex");
  expect(proof[0]).toMatchObject({ author_user_id: actors.get(writer)!.id, authorization_contract_version: 2,
    authorized_frequency: created.frequency, authorized_terms_digest: digest });
  expect((await pool.query<{ same_instant: boolean; initial_date: string }>(`select p.authorized_at=c.authorized_at as same_instant,
    p.authorized_initial_date::text as initial_date from investment_purchase_authorization_proofs p
    join investment_sip_confirmed_fills f on f.purchase_id=p.purchase_id join investment_sip_confirmations c on c.id=f.confirmation_id
    where p.purchase_id=$1 and c.id=$2 and c.plan_id=$3 and c.original_due_date=$4 and c.household_id=$5
      and c.actor_user_id=$6 and p.author_user_id=$6`,
  [purchaseId, receipt.id, created.id, created.nextExecutionDate, a, actors.get(writer)!.id])).rows)
    .toEqual([{ same_instant: true, initial_date: created.nextExecutionDate }]);
  const audit = frame.audits.filter(row => row.entityId === purchaseId);
  expect(audit).toEqual([expect.objectContaining({ userId: actors.get(writer)!.id, householdId: a, action: "CREATE",
    entityType: "investment_transaction", details: { newValue: { accountId: purchase.accountId, holdingId: purchase.holdingId,
      securityId: purchase.securityId, type: "buy", quantity: facts.quantity, price: facts.price, fees: facts.fees,
      feesDeclared: true, amount: facts.amount, currency: created.currency, transactionDate: created.nextExecutionDate } } })]);
  expect(frame.audits.filter(row => row.entityId === receipt.id)).toEqual([expect.objectContaining({ userId: actors.get(writer)!.id,
    householdId: null, entityType: "investment_sip_confirmation", action: "CREATE",
    details: { authorizationEvent: "sip_final_confirmation_v1", requestVersion: 1 } })]);
  const retained = JSON.stringify({ purchase, proof, audit });
  for (const secret of [value.operationId, String(created.currentAuthorizationId), value.brokerReference,
    createHash("sha256").update(value.brokerReference, "utf8").digest("hex")]) expect(retained).not.toContain(secret);
  expect(JSON.stringify(response.body)).not.toContain(value.brokerReference);
  expect(frame.fences.filter(row => row.planId === created.id)).toEqual([{ planId: created.id, originalDueDate: created.nextExecutionDate, terminal: true }]);
  const replay = await postActual(created, value, writer); expect(replay.status).toBe(200); expect(replay.body).toEqual(response.body);
  expect(await snapshot()).toEqual(frame);
  return { purchaseId, frame };
}
async function recordActual(created: Created, facts: Facts, value = command(created, facts)) {
  const before = await snapshot(), response = await postActual(created, value), recorded = await verifyActual(created, facts, value, "member", response);
  expect(recorded.frame.purchases).toHaveLength(before.purchases.length + 1);
  for (const original of before.purchases) expect(recorded.frame.purchases.find(row => row.id === original.id)).toEqual(original);
  for (const original of before.lots) expect(recorded.frame.lots.find(row => row.id === original.id)).toEqual(original);
  for (const original of before.proofs) expect(recorded.frame.proofs.find(row => row.purchase_id === original.purchase_id)).toEqual(original);
  for (const original of before.audits) expect(recorded.frame.audits.find(row => row.id === original.id)).toEqual(original);
  for (const key of ["accounts", "cash", "instruments", "plans", "grants", "operations", "reservations", "logs", "disposals"] as const)
    expect(recorded.frame[key], key).toEqual(before[key]);
  return recorded;
}
async function legacyTick(created: Created): Promise<SipExecutionResults> {
  const result: SipExecutionResults = { success: 0, held: 0, failed: 0, skipped: 0, errors: [] };
  try {
    const posted = await withTransaction(async tx => {
      const authority = await lockSipExecutionAuthorization(tx, created, today());
      if (!authority) return false;
      const nextExecutionDate = calculateNextDate(new Date(authority.plan.nextExecutionDate), authority.plan.frequency,
        authority.terms.initialDate).toISOString().slice(0, 10);
      if (nextExecutionDate <= created.nextExecutionDate) throw new Error("Legacy control cannot advance");
      const purchaseId = await recordSipPurchase(tx, authority, today(), sipExecutionKey(created.id, today()));
      await tx.update(recurringInvestments).set({ nextExecutionDate, updatedAt: new Date() }).where(eq(recurringInvestments.id, created.id));
      await tx.insert(recurringExecutionLog).values({ recurringInvestmentId: created.id, status: "success", amount: authority.plan.amount,
        resultEntityId: purchaseId, executionDate: new Date() });
      return true;
    });
    if (posted) result.success++; else result.skipped++;
  } catch {
    result.failed++; result.errors.push(`Plan ${created.id}: ${SIP_EXECUTION_REFUSAL}`);
    await withTransaction(async tx => {
      const [household] = await tx.select({ id: households.id }).from(households).where(eq(households.id, created.householdId)).for("share");
      if (!household) return;
      const [remaining] = await tx.select({ id: recurringInvestments.id }).from(recurringInvestments).where(eq(recurringInvestments.id, created.id)).for("share");
      if (remaining) await tx.insert(recurringExecutionLog).values({ recurringInvestmentId: created.id, status: "failed",
        amount: created.amount, errorMessage: SIP_EXECUTION_REFUSAL, executionDate: new Date() });
    });
  }
  return result;
}
async function legacyRefusal(created: Created) {
  const before = await snapshot(), result = await legacyTick(created), after = await snapshot();
  expect(result).toMatchObject({ success: 0, held: 0, failed: 1 }); noPosting(before, after, true);
  expect(after.logs).toHaveLength(before.logs.length + 1);
  expect(after.logs.filter(row => !before.logs.some(prior => prior.id === row.id))).toEqual([expect.objectContaining({
    recurringInvestmentId: created.id, status: "failed", resultEntityId: null, errorMessage: SIP_EXECUTION_REFUSAL,
  })]);
  expect(after.plans.find(row => row.id === created.id)!.nextExecutionDate).toBe(created.nextExecutionDate);
  return after;
}
async function actualRefusal(created: Created, value: Command, status: number) {
  const before = await snapshot(), response = await postActual(created, value), after = await snapshot();
  expect(response.status).toBe(status); expect(response.body).not.toHaveProperty("data");
  expect(JSON.stringify(response.body)).not.toContain(value.brokerReference);
  if (status === 500) expect(response.body).toEqual({ success: false, error: { code: "INTERNAL_ERROR",
    message: "Occurrence confirmation is unavailable; retry with the original operation.", timestamp: expect.any(String) } });
  if (status === 409) expect(response.body.error).toMatchObject({ code: "CONFLICT", details: { reason: "SOURCE_CHANGED" } });
  noPosting(before, after); return after;
}
async function drainOperations<T>(operations: Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(operations), values: T[] = [];
  for (const result of settled) { if (result.status === "rejected") throw result.reason; values.push(result.value); }
  return values;
}
async function settle<T>(operation: Promise<T>): Promise<PromiseSettledResult<T>> {
  try { return { status: "fulfilled", value: await operation }; } catch (reason) { return { status: "rejected", reason }; }
}
async function waitingOn(blocker: number) {
  let reached: number[] = [];
  const deadline = performance.now() + 5_000;
  for (let attempt = 0; attempt < 250 && performance.now() < deadline; attempt++) {
    reached = (await pool.query<{ pid: number }>(`select pid from pg_stat_activity where datname=current_database()
      and pid<>pg_backend_pid() and $1::int=any(pg_blocking_pids(pid)) order by pid`, [blocker])).rows.map(row => row.pid);
    if (reached.length) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return reached;
}
async function firstHoldingGate(securityId: string) {
  const name = `sip_sale_gate_${randomUUID().replaceAll("-", "")}`, key = BigInt("0x" + randomUUID().replaceAll("-", "").slice(0, 15)).toString();
  const control = await pool.connect(); let released: Promise<void> | undefined;
  const release = () => released ??= (async () => {
    let discard = false;
    try { await control.query("ROLLBACK"); } catch (error) { discard = true; throw error; } finally { control.release(discard); }
  })();
  try {
    await pool.query(`create function public.${name}() returns trigger language plpgsql set search_path=pg_catalog as $gate$
      begin perform set_config('lock_timeout','15s',true); perform pg_advisory_xact_lock(${key}::bigint); return NEW; end $gate$`);
    await pool.query(`create trigger ${name} before insert on public.holdings for each row
      when (NEW.security_id='${securityId}'::uuid and NEW.account_id='${ids.sharedAccount}'::uuid) execute function public.${name}()`);
    await control.query("BEGIN"); await control.query(`select pg_advisory_xact_lock(${key}::bigint)`);
    const pid = (await control.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
    return { pid, release, drop: async () => {
      await pool.query(`drop trigger if exists ${name} on public.holdings`); await pool.query(`drop function if exists public.${name}()`);
    } };
  } catch (error) {
    await release(); await pool.query(`drop trigger if exists ${name} on public.holdings`);
    await pool.query(`drop function if exists public.${name}()`); throw error;
  }
}

describe("FIN-11 recurring stock purchase and ordinary signed sale", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clean(); await reset();
    await signed("owner", "put", "/api/investments/calendar").send({ timeZone: "UTC" }).expect(200);
  });
  afterEach(clean);
  afterAll(async () => {
    const failures: unknown[] = [];
    try {
      await clean();
    } catch (error) {
      failures.push(error);
    }
    try {
      await stop();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length) throw new AggregateError(failures, "SIP sale fixture cleanup failed");
  });

  it("records one exact lot per due plan for new and existing holdings, then sells through the ordinary route", async () => {
    const securityId = await instrument("7.0000"), baseline = await snapshot(), purchases: string[] = [];
    // Synthetic final-statement facts stay explicit and differ from reference7.
    const facts = { quantity: "3.00030003", price: "0.3333", fees: "0.00", amount: "1.00" };
    for (let i = 0; i < 2; i++) {
      const created = await plan(securityId); await materialize([created]);
      purchases.push((await recordActual(created, facts)).purchaseId);
    }
    const closed = await snapshot();
    expect(await processDueInvestments()).toMatchObject({ success: 0, held: 0, failed: 0 });
    expect(await snapshot()).toEqual(closed);
    const [holding] = await db.select().from(holdings).where(eq(holdings.securityId, securityId));
    expect(holding).toMatchObject({ quantity: "6.00060006", costBasis: "2.00" });
    const member = actors.get("member")!;
    const result = await signed("member", "post", "/api/investments/transactions")
      .send({ accountId: ids.sharedAccount, securityId, holdingId: holding.id, type: "sell", quantity: "3.00030003",
        price: "1", amount: "3.00", fees: "0", transactionDate: today() });
    expect(result.status).toBe(201);
    const lots = await pool.query(`select b.price, b.quantity, l.cost_basis, l.remaining_quantity,
      (b.amount=l.cost_basis and b.transaction_date=l.acquired_date and b.quantity=l.quantity) as reconciled
      from tax_lots l join investment_transactions b on l.transaction_id=b.id where l.holding_id=$1 order by l.created_at,l.id`, [holding.id]);
    expect(lots.rows).toEqual(["0.00000000", "3.00030003"].map(remaining_quantity => ({ price: "0.3333", quantity: "3.00030003",
      cost_basis: "1.00", remaining_quantity, reconciled: true })));
    const gain = await pool.query("select proceeds, cost_basis, realized_gain from tax_lot_disposals where transaction_id=$1", [result.body.data.id]);
    expect(gain.rows).toEqual([{ proceeds: "3.00", cost_basis: "1.00", realized_gain: "2.00" }]);
    const audits = await pool.query(`select user_id, household_id, details->'newValue' as source, details as metadata
      from audit_logs where entity_type='investment_transaction' and household_id=$1 and user_id=$2
        and entity_id=any($3::uuid[]) order by created_at,id`, [a, member.id, purchases]);
    expect(audits.rows).toHaveLength(2);
    for (const audit of audits.rows) {
      expect(audit).toMatchObject({ user_id: member.id, household_id: a, source: { holdingId: holding.id, accountId: ids.sharedAccount,
        securityId, type: "buy", amount: "1.00", price: "0.3333", quantity: "3.00030003", currency: "ZMW" },
        metadata: { newValue: { fees: "0.00", feesDeclared: true } } });
    }
    expect((await db.select().from(accounts).where(eq(accounts.id, ids.sharedAccount)))[0].balance).toBe("988.89");
    const after = await snapshot(); expect(after.accounts).toEqual(baseline.accounts); expect(after.cash).toEqual(baseline.cash);
  });

  it("serializes overlapping first purchases without creating duplicate holdings or lots", async () => {
    const securityId = await instrument("7.0000"), first = await plan(securityId), second = await plan(securityId);
    const held = await materialize([first, second], () => drainOperations([processDueInvestments(), processDueInvestments(), processDueInvestments()]));
    const facts = { quantity: "1.00000000", price: "1.0000", fees: "0.00", amount: "1.00" };
    const firstCommand = command(first, facts), secondCommand = command(second, facts), barrier = await firstHoldingGate(securityId);
    const firstRun = settle(postActual(first, firstCommand, "member"));
    let secondRun: Promise<PromiseSettledResult<Awaited<ReturnType<typeof postActual>>>> | undefined;
    let firstWaiters: number[] = [], secondWaiters: number[] = [], observed: Array<{ account_update: boolean }> = [];
    try {
      firstWaiters = await waitingOn(barrier.pid);
      // Distinct real users avoid serializing on one credential row before
      // the no-holding custody path. The member's INSERT still holds account UPDATE.
      secondRun = settle(postActual(second, secondCommand, "owner"));
      if (firstWaiters[0]) {
        secondWaiters = await waitingOn(firstWaiters[0]);
        observed = (await pool.query<{ account_update: boolean }>(`select
          query like '%"accounts"%' and query ~* 'for[[:space:]]+update' as account_update
          from pg_stat_activity where datname=current_database() and pid=any($1::int[])
            and $2::int=any(pg_blocking_pids(pid))`, [secondWaiters, firstWaiters[0]])).rows;
      }
    } finally {
      try { await barrier.release(); }
      finally { try { await Promise.allSettled([firstRun, ...(secondRun ? [secondRun] : [])]); } finally { await barrier.drop(); } }
    }
    expect(firstWaiters.length).toBeGreaterThanOrEqual(1); expect(secondWaiters.length).toBeGreaterThanOrEqual(1);
    expect(observed).toEqual([{ account_update: true }]);
    const one = await firstRun, two = await secondRun!;
    expect(one.status).toBe("fulfilled"); expect(two.status).toBe("fulfilled");
    if (one.status !== "fulfilled" || two.status !== "fulfilled") throw new Error("Actual first-purchase work did not return responses");
    await verifyActual(first, facts, firstCommand, "member", one.value);
    await verifyActual(second, facts, secondCommand, "owner", two.value);
    const positions = await db.select().from(holdings).where(eq(holdings.securityId, securityId));
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({ quantity: "2.00000000", costBasis: "2.00" });
    const counts = await pool.query("select count(*)::int as lots, count(distinct transaction_id)::int as buys from tax_lots where holding_id=$1", [positions[0].id]);
    expect(counts.rows).toEqual([{ lots: 2, buys: 2 }]);
    const after = await snapshot();
    expect(after.purchases).toHaveLength(2); expect(after.proofs).toHaveLength(2); expect(after.confirmations).toHaveLength(2);
    expect(after.fills).toHaveLength(2);
    for (const key of ["accounts", "cash", "plans", "grants", "operations", "reservations", "logs", "instruments"] as const)
      expect(after[key], key).toEqual(held[key]);
    expect(await processDueInvestments()).toMatchObject({ success: 0, held: 0, failed: 0 });
    expect(await snapshot()).toEqual(after);
  }, 30_000);

  it("rolls back custom schedules that cannot advance instead of repeating a purchase", async () => {
    const securityId = await instrument("1.00");
    // Declare the actual custom cadence through signed create so a stale
    // plan/grant mismatch cannot mask the nonadvancing-schedule assertion.
    const created = await plan(securityId, "1.00", "ZMW", "custom"), id = created.id, before = await snapshot();
    expect(await processDueInvestments()).toMatchObject({ success: 0, failed: 1 });
    expect(await processDueInvestments()).toMatchObject({ success: 0, failed: 1 });
    expect(await db.select().from(holdings).where(eq(holdings.securityId, securityId))).toEqual([]);
    expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.securityId, securityId))).toEqual([]);
    const successes = await pool.query("select id from recurring_execution_log where recurring_investment_id=$1 and status='success'", [id]);
    expect(successes.rows).toEqual([]);
    expect((await db.select().from(recurringInvestments).where(eq(recurringInvestments.id, id)))[0].nextExecutionDate).toBe(today());
    const after = await snapshot(); noPosting(before, after, true);
    expect(after.occurrences).toEqual([]); expect(after.fences).toEqual([]); expect(after.proofs).toEqual([]);
  });

  it("retains unknown opening basis when adding a purchase with known cost", async () => {
    const securityId = await instrument("9.0000");
    await db.insert(holdings).values({ householdId: a, accountId: ids.sharedAccount, securityId, quantity: "1", costBasis: null });
    const created = await plan(securityId); await materialize([created]);
    await recordActual(created, { quantity: "1.00000000", price: "1.0000", fees: "0.00", amount: "1.00" });
    expect((await db.select().from(holdings).where(eq(holdings.securityId, securityId)))[0])
      .toMatchObject({ quantity: "2.00000000", costBasis: null });
  });

  it("makes a stale scheduler scan wait at the household anchor before concurrent SQL plan deletion", async () => {
    const securityId = await instrument("1.00"), created = await plan(securityId), id = created.id;
    const editor = await pool.connect();
    let run: Promise<PromiseSettledResult<SipExecutionResults>> | undefined, waiting = false;
    try {
      await editor.query("BEGIN");
      await editor.query("SET LOCAL lock_timeout='2s'");
      const { rows: [backend] } = await editor.query("SELECT pg_backend_pid() AS pid");
      await editor.query("SELECT id FROM households WHERE id=$1 FOR UPDATE", [a]);
      run = settle(processDueInvestments());
      for (let i = 0; i < 100 && !waiting; i++) {
        const result = await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting", [backend.pid]);
        waiting = result.rows[0].waiting;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
      }
      await editor.query("DELETE FROM recurring_investments WHERE id=$1", [id]);
      await editor.query("COMMIT");
    } finally {
      try { await editor.query("ROLLBACK"); } finally { editor.release(); if (run) await run; }
    }
    expect(waiting).toBe(true);
    expect(await run!).toMatchObject({ status: "fulfilled", value: { success: 0, held: 0, failed: 0, skipped: 1 } });
    expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.securityId, securityId))).toEqual([]);
    const after = await snapshot(); expect(after.occurrences).toEqual([]); expect(after.fences).toEqual([]); expect(after.proofs).toEqual([]);
  }, 30_000);

  it("makes an admitted signed posting wait at the household anchor and refuse after SQL plan deletion", async () => {
    const securityId = await instrument("7.0000"), created = await plan(securityId); await materialize([created]);
    const facts = { quantity: "1.00000000", price: "1.0000", fees: "0.00", amount: "1.00" }, value = command(created, facts);
    const before = await snapshot(), editor = await pool.connect();
    let run: Promise<PromiseSettledResult<Awaited<ReturnType<typeof postActual>>>> | undefined;
    let waiters: number[] = [], observed: Array<{ household_share: boolean }> = [];
    try {
      await editor.query("BEGIN"); await editor.query("SET LOCAL lock_timeout='2s'");
      const pid = (await editor.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
      await editor.query("SELECT id FROM households WHERE id=$1 FOR UPDATE", [a]);
      run = settle(postActual(created, value)); waiters = await waitingOn(pid);
      observed = (await pool.query<{ household_share: boolean }>(`select
        query like '%"households"%' and query ~* 'for[[:space:]]+share' as household_share
        from pg_stat_activity where datname=current_database() and pid=any($1::int[])
          and $2::int=any(pg_blocking_pids(pid))`, [waiters, pid])).rows;
      await editor.query("DELETE FROM recurring_investments WHERE id=$1", [created.id]); await editor.query("COMMIT");
    } finally {
      try { await editor.query("ROLLBACK"); } finally { editor.release(); if (run) await run; }
    }
    expect(waiters.length).toBeGreaterThanOrEqual(1); expect(observed).toEqual([{ household_share: true }]);
    const refused = await run!;
    expect(refused).toMatchObject({ status: "fulfilled", value: { status: 404, body: { success: false, error: { code: "NOT_FOUND" } } } });
    if (refused.status === "fulfilled") expect(refused.value.body).not.toHaveProperty("data");
    const after = await snapshot();
    for (const key of ["accounts", "cash", "instruments", "holdings", "purchases", "lots", "disposals", "proofs", "logs", "audits"] as const)
      expect(after[key], key).toEqual(before[key]);
    for (const key of ["plans", "grants", "operations", "occurrences", "fences", "confirmations", "fills", "reservations"] as const)
      expect(after[key], key).toEqual([]);
    expect(JSON.stringify(after)).not.toContain(value.brokerReference);
  }, 30_000);

  it("rolls back purchase, lot and schedule when its financial audit insert fails", async () => {
    const securityId = await instrument("1.00"), created = await plan(securityId), id = created.id;
    const hook = "sip_audit_" + randomUUID().replaceAll("-", "");
    const witness = `${hook}_seen`, facts = { quantity: "1.00000000", price: "1.0000", fees: "0.00", amount: "1.00" };
    const value = command(created, facts);
    try {
      await pool.query(`CREATE SEQUENCE ${witness}`);
      await pool.query(`CREATE FUNCTION ${hook}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
        BEGIN PERFORM nextval('public.${witness}'::regclass);
          RAISE EXCEPTION 'synthetic SIP audit failure' USING ERRCODE='23514'; END $$`);
      await pool.query(`CREATE TRIGGER ${hook} BEFORE INSERT ON audit_logs FOR EACH ROW
        WHEN (NEW.household_id='${a}'::uuid AND NEW.entity_type='investment_transaction') EXECUTE FUNCTION ${hook}()`);
      // Preserve the old atomic schedule/purchase/lot rollback through its real
      // legacy writer before exercising the separately held current lifecycle.
      await legacyRefusal(created);
      expect(await db.select().from(holdings).where(eq(holdings.securityId, securityId))).toEqual([]);
      expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.securityId, securityId))).toEqual([]);
      expect((await db.select().from(recurringInvestments).where(eq(recurringInvestments.id, id)))[0].nextExecutionDate).toBe(today());
      expect((await pool.query(`SELECT last_value::text,is_called FROM ${witness}`)).rows).toEqual([{ last_value: "1", is_called: true }]);
      await materialize([created]);
      await actualRefusal(created, value, 500);
      expect((await pool.query(`SELECT last_value::text,is_called FROM ${witness}`)).rows).toEqual([{ last_value: "2", is_called: true }]);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${hook} ON audit_logs`);
      await pool.query(`DROP FUNCTION IF EXISTS ${hook}()`); await pool.query(`DROP SEQUENCE IF EXISTS ${witness}`);
    }
    await recordActual(created, facts, value);
  });

  it.each(["mismatched denomination", "unrepresentable quantity", "rounding mismatch", "foreign account", "private custody",
    "malformed currency", "negative opening basis", "nonfinite opening basis"])("preserves the legacy refusal and current actual-fact boundary for %s", async reason => {
    const price = reason === "unrepresentable quantity" ? "99999999999.0000" : reason === "rounding mismatch" ? "1600000" : "1.00";
    const securityId = await instrument(price);
    const unattributed = reason === "foreign account" || reason === "private custody";
    const created = unattributed ? undefined : await plan(securityId, "0.01");
    const id = created?.id ?? await legacyPlan(securityId, reason === "foreign account" ? ids.foreignAccount : ids.privateAccount);
    if (reason === "mismatched denomination" || reason === "malformed currency") {
      // Synthetic post-authorization instrument-source change: the genuine
      // signed ZMW plan/grant stay unchanged. This tests current source
      // denomination/format refusal, not malformed signed-plan admission.
      await db.update(securities).set({ currency: reason === "mismatched denomination" ? "USD" : "usd" })
        .where(eq(securities.id, securityId));
    }
    if (reason === "negative opening basis" || reason === "nonfinite opening basis") {
      await db.insert(holdings).values({ householdId: a, accountId: ids.sharedAccount, securityId, quantity: "1",
        costBasis: reason === "negative opening basis" ? "-1.00" : "NaN" });
    }
    const priorHoldings = await db.select().from(holdings).where(eq(holdings.securityId, securityId));
    if (created) await legacyRefusal(created);
    else {
      const before = await snapshot(); expect(await processDueInvestments()).toMatchObject({ success: 0, held: 0, failed: 1 });
      const after = await snapshot(); noPosting(before, after, true);
      expect(after.grants).toEqual([]); expect(after.operations).toEqual([]); expect(after.proofs).toEqual([]);
    }
    expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.securityId, securityId))).toEqual([]);
    expect(await db.select().from(holdings).where(eq(holdings.securityId, securityId))).toEqual(priorHoldings);
    expect((await db.select().from(recurringInvestments).where(eq(recurringInvestments.id, id)))[0].nextExecutionDate).toBe(today());
    if (!created) return; // Completed negative legacy control; no authority is invented.
    if (reason === "mismatched denomination" || reason === "malformed currency") {
      const before = await snapshot(); expect(await processDueInvestments()).toMatchObject({ success: 0, held: 0, failed: 1 });
      noPosting(before, await snapshot(), true);
    } else {
      await materialize([created]);
      const facts = reason === "rounding mismatch"
        ? { quantity: "0.00000001", price: "1600000.0000", fees: "0.00", amount: "0.02" }
        : { quantity: "1.00000000", price: "1.0000", fees: "0.00", amount: "1.00" };
      if (reason === "negative opening basis" || reason === "nonfinite opening basis") {
        await actualRefusal(created, command(created, facts), 409);
        expect(await db.select().from(holdings).where(eq(holdings.securityId, securityId))).toEqual(priorHoldings);
      } else {
        // Explicit actual economics need not equal the standing budget or its
        // reference-quote quotient. The old unrepresentable/rounding refusal stays v1.
        await recordActual(created, facts);
      }
    }
  });
});
