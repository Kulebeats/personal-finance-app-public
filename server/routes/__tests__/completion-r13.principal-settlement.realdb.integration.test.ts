import { randomUUID } from "node:crypto";
import request from "supertest";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, or, sql } from "drizzle-orm";
import { accounts, auditLogs, grzBondPayments, grzBonds, householdMembers, households, investmentTransactions, outboxEvents, transactions, users } from "@shared/schema";
import { grzBondValuations } from "@shared/grz-bond-valuation-schema";
import { shiftCalendarDate } from "@shared/household-calendar";
import { grzTBills } from "@shared/schema";
import { db, pool } from "../../db";
import { getPostgresError } from "../../utils/postgresError";
import { getTestApp } from "../../__tests__/fixtures";
import { hashPassword } from "../../auth";
import { generateBondSchedule } from "../../services/grz-service";
import { businessAuditService } from "../../services/BusinessAuditService";
import { grzCouponPaymentKey } from "../../services/grz/couponPaymentKey";

const bondId = randomUUID(), principalId = randomUUID(), custodyId = randomUUID(), debtId = randomUUID();
const date = new Date().toISOString().slice(0, 10), currency = "ZMW", isin = "ZM0000000001";
let valuationId: string;
let basisId: string;
let a: string, userId: string, cookie: string, passwordHash: string;
let app: Awaited<ReturnType<typeof getTestApp>>;
const ids = { sharedAccount: randomUUID() }, password = "SyntheticPrincipalSettlement123!";
const extraUserIds: string[] = [];
function signed(test: request.Test) {
  return test.set("Cookie", cookie).set("X-Capital-Subject", userId).set("X-Capital-Household", a);
}
function pay(operationId: string, confirmed = true, overrides: Record<string, unknown> = {}) {
  return signed(request(app).post(`/api/grz/payments/${principalId}/pay`)).send({
    accountId: ids.sharedAccount, date, operationId, receiptConfirmed: confirmed,
    receivedAmount: { amount: "1000.00", currency }, fees: { amount: "0.00", currency },
    ...overrides,
  });
}
function basisRequest(overrides: Record<string, unknown> = {}) {
  return signed(request(app).post(`/api/grz/bonds/${bondId}/principal-basis`)).send({ operationId: randomUUID(),
    acquisitionDate: "2025-06-30", sourceDate: date, isin, currency, purchaseCashAmount: "950.00",
    purchasedInterest: "0.00", acquisitionFees: "0.00", principalCost: "950.00", sourceKind: "custodian_statement",
    sourceReference: "Synthetic acquisition cash breakdown statement", ...overrides });
}
async function recordBasis(principalCost = "950.00", purchasedInterest = "0.00", acquisitionFees = "0.00") {
  const result = await basisRequest({ principalCost, purchasedInterest, acquisitionFees }).expect(201);
  basisId = result.body.data.id;
}
async function recordMaturityMark(markDate = date, accruedInterest = "0.00", quotedAmount?: string) {
  const [bond] = await db.select({ face: grzBonds.faceValue }).from(grzBonds).where(eq(grzBonds.id, bondId));
  const mark = await signed(request(app).post(`/api/grz/bonds/${bondId}/valuations`)).send({ operationId: randomUUID(),
    valuationDate: markDate, sourceDate: markDate, nominalAmount: bond.face, isin, currency, sourceKind: "custodian_statement",
    sourceReference: "Synthetic contractual maturity principal and coupon statement", quoteBasis: "clean", quoteUnits: "holding_amount",
    quotedAmount: quotedAmount ?? bond.face, accruedInterest }).expect(201);
  valuationId = mark.body.data.id;
}
async function finalCoupon(overrides: Partial<typeof grzBondPayments.$inferInsert> = {}) {
  const id = randomUUID();
  await db.update(grzBonds).set({ couponRate: "0.0800", couponFrequency: 2, firstCouponDate: date }).where(eq(grzBonds.id, bondId));
  await db.insert(grzBondPayments).values({ id, bondId, paymentDate: date, paymentType: "coupon", grossAmount: "40.00",
    withholdingTax: "6.00", netAmount: "34.00", status: "scheduled", ...overrides });
  return id;
}
function payCoupon(id: string) {
  return signed(request(app).post(`/api/grz/payments/${id}/pay`)).send({ accountId: ids.sharedAccount, date });
}
/** Always rolled back, including the vulnerable pre-fix admission. The writer
 * has ordinary DML rights and cannot disable or bypass the binding triggers. */
async function probeSettlementDestination(destinationId: string, denomination: string, isAsset: boolean,
  options: { receiptId?: string; cashPrivateOwner?: string; destinationPrivateOwner?: string; destinationDeleted?: boolean; mismatchedRequestedReceipt?: boolean; couponProof?: unknown; receiptDate?: string } = {}) {
  const role = `r13_settlement_writer_${randomUUID().replace(/-/g, "")}`;
  const cashId = options.receiptId ?? randomUUID(), investmentId = randomUUID(), operationId = randomUUID(), delta = isAsset ? "1000.00" : "-1000.00";
  const receiptDate = options.receiptDate ?? date;
  const requestedReceiptId = options.mismatchedRequestedReceipt ? randomUUID() : options.receiptId ?? null;
  const client = await pool.connect();
  let created = false;
  try {
    await client.query(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`); created = true;
    await client.query(`GRANT "${role}" TO CURRENT_USER`);
    await client.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await client.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON public.accounts,public.transactions,public.investment_transactions,
      public.grz_bonds,public.grz_bond_payments,public.grz_principal_settlements TO "${role}"`);
    await client.query(`GRANT SELECT ON public.grz_bond_valuations,public.grz_bond_principal_basis TO "${role}"`);
    await client.query(`GRANT SELECT ON public.households,public.household_members,public.users,public.audit_logs TO "${role}"`);
    // Coupon reconciliation holds an evidence row share lock; PostgreSQL
    // requires a column UPDATE grant for that lock, while immutability remains.
    await client.query(`GRANT UPDATE(id) ON public.grz_bond_valuations TO "${role}"`);
    await client.query(`GRANT UPDATE(id) ON public.households,public.household_members,public.users TO "${role}"`);
    // The existing transfer reservation trigger checks every transaction
    // insert against its immutable owner intents, including non-transfer rows.
    await client.query(`GRANT SELECT ON public.transaction_create_owner_intents TO "${role}"`);
    // 0022 also attempts this seal UPDATE after every transaction INSERT, even
    // when no owner-intent row exists. Grant that column, not economic fields.
    await client.query(`GRANT UPDATE(posting_confirmed) ON public.transaction_create_owner_intents TO "${role}"`);
    await client.query("BEGIN"); await client.query(`SET LOCAL ROLE "${role}"`);
    const proof = await client.query<{ actor: string; superuser: boolean; owns: boolean }>(`select current_user as actor,r.rolsuper as superuser,
      pg_has_role(current_user,c.relowner,'MEMBER') as owns from pg_roles r cross join pg_class c
      where r.rolname=current_user and c.oid='public.grz_principal_settlements'::regclass`);
    expect(proof.rows).toEqual([{ actor: role, superuser: false, owns: false }]);
    const rights = await client.query<{ seal: boolean; table_update: boolean; digest_update: boolean; can_read_tbills: boolean }>(`select
      has_column_privilege(current_user,'public.transaction_create_owner_intents','posting_confirmed','UPDATE') as seal,
      has_table_privilege(current_user,'public.transaction_create_owner_intents','UPDATE') as table_update,
      has_column_privilege(current_user,'public.transaction_create_owner_intents','request_digest','UPDATE') as digest_update,
      has_any_column_privilege(current_user,'public.grz_tbills','SELECT') as can_read_tbills`);
    expect(rights.rows).toEqual([{ seal: true, table_update: false, digest_update: false, can_read_tbills: false }]);
    await client.query("update accounts set currency=$2,is_asset=$3,balance=balance+$4::numeric where id=$1", [destinationId, denomination, isAsset, options.receiptId ? "0.00" : delta]);
    if (options.destinationPrivateOwner) await client.query("update accounts set is_private=true,owner_user_id=$2 where id=$1", [destinationId, options.destinationPrivateOwner]);
    if (options.destinationDeleted) await client.query("update accounts set deleted_at=clock_timestamp() where id=$1", [destinationId]);
    if (options.receiptId) await client.query("update transactions set type='asset_settlement' where id=$1", [cashId]);
    else await client.query(`insert into transactions(id,household_id,account_id,owner_user_id,name,type,amount,currency,date,source,is_private,
      posted_balance_delta,posted_account_is_asset,posting_mode) values($1,$2,$3,$4,'Synthetic principal consistency probe',
      'asset_settlement',1000,'ZMW',$5,'manual',$8,$6,$7,'posted')`, [cashId, a, destinationId, options.cashPrivateOwner ?? userId, receiptDate, delta, isAsset, !!options.cashPrivateOwner]);
    if (options.mismatchedRequestedReceipt) await client.query(`insert into transactions(id,household_id,account_id,owner_user_id,name,type,amount,currency,date,source,posting_mode,posted_account_is_asset,posted_balance_delta)
      values($1,$2,$3,$4,'Synthetic different history-only claim','income',1000,'ZMW',$5,'manual','history_only',$6,0)`, [requestedReceiptId, a, destinationId, userId, receiptDate, isAsset]);
    await client.query(`insert into investment_transactions(id,household_id,account_id,type,amount,currency,fees,withholding_tax,linked_transaction_id,transaction_date)
      values($1,$2,$3,'maturity',1000,'ZMW',0,0,$4,$5)`, [investmentId, a, destinationId, cashId, receiptDate]);
    await client.query("update grz_bond_payments set status='paid',actual_payment_date=$2,income_transaction_id=null,investment_transaction_id=$3 where id=$1",
      [principalId, receiptDate, investmentId]);
    await client.query("update grz_bonds set status='matured' where id=$1", [bondId]);
    await client.query(`insert into grz_principal_settlements(operation_id,household_id,actor_user_id,bond_id,payment_id,destination_account_id,
      cash_transaction_id,investment_transaction_id,receipt_date,request_digest,status,currency,principal_amount,received_amount,cost_basis,
      realized_basis_difference,purchased_interest,acquisition_fees,basis_id,basis_evidence,fees,valuation_id,valuation,confirmed_at,requested_receipt_id)
      select $1,$2,$3,$4,$5,$6,$7,$8,$9,repeat('0',64),'confirmed','ZMW',1000,1000,b.principal_cost,1000-b.principal_cost,
        b.purchased_interest,b.acquisition_fees,b.id,jsonb_build_object('sourceId',b.id::text,'sourceKind',b.source_kind,'sourceDate',b.source_date::text,
          'acquisitionDate',b.acquisition_date::text,'purchaseCashAmount',b.purchase_cash_amount::text,'policyVersion',b.policy_version),0,v.id,
        jsonb_build_object('amount',v.clean_value::text,'currency','ZMW','asOfDate',v.valuation_date::text,'sourceKind',v.source_kind,'sourceId',v.id::text,
          'policyVersion',v.policy_version,'component','ex_coupon_principal','includedCouponAmount',v.accrued_value::text,
          'settlementValueDifference',(1000-v.clean_value)::text,
          'couponReconciliation',coalesce($13::jsonb,jsonb_build_object('policyVersion','grz_principal_coupon_reconciled_v1','payments','[]'::jsonb))),clock_timestamp(),$12
      from grz_bond_principal_basis b cross join grz_bond_valuations v where b.id=$10 and v.id=$11`,
      [operationId, a, userId, bondId, principalId, destinationId, cashId, investmentId, receiptDate, basisId, valuationId, requestedReceiptId, options.couponProof ? JSON.stringify(options.couponProof) : null]);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    return null;
  } catch (error) {
    const failure = getPostgresError(error);
    if (!failure) throw error;
    return failure;
  } finally {
    await client.query("ROLLBACK");
    if (created) { await client.query(`DROP OWNED BY "${role}"`); await client.query(`DROP ROLE "${role}"`); }
    client.release();
  }
}
async function otherCoupon() {
  const response = await signed(request(app).post("/api/grz/bonds")).send({ accountId: custodyId, isin,
    bondName: "Synthetic other bond actual coupon", tenorYears: 1, faceValue: "11764.70", purchasePrice: "11000.00",
    couponRate: "0.2000", couponFrequency: 2, firstCouponDate: date, purchaseDate: "2025-06-30", maturityDate: date }).expect(201);
  return (await db.select().from(grzBondPayments).where(sql`${grzBondPayments.bondId}=${response.body.data.id}::uuid and ${grzBondPayments.paymentType}='coupon'`))[0];
}
async function probePaymentLink(paymentId: string, cashId: string, insert = false, ready?: (pid: number) => void, legacyPermissions = false) {
  const role = `r13_payment_writer_${randomUUID().replace(/-/g, "")}`, client = await pool.connect();
  let created = false;
  try {
    await client.query(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`); created = true;
    await client.query(`GRANT "${role}" TO CURRENT_USER`); await client.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await client.query(`GRANT SELECT,INSERT,UPDATE ON public.grz_bond_payments TO "${role}"`);
    await client.query(`GRANT SELECT ON public.transactions TO "${role}"`);
    if (!legacyPermissions) await client.query(`GRANT SELECT ON public.grz_principal_settlements TO "${role}"`);
    await client.query(`GRANT UPDATE(id) ON public.transactions TO "${role}"`);
    await client.query("BEGIN"); await client.query(`SET LOCAL ROLE "${role}"`);
    const proof = await client.query<{ actor: string; superuser: boolean; owns: boolean }>(`select current_user as actor,r.rolsuper as superuser,
      pg_has_role(current_user,c.relowner,'MEMBER') as owns from pg_roles r cross join pg_class c
      where r.rolname=current_user and c.oid='public.grz_bond_payments'::regclass`);
    expect(proof.rows).toEqual([{ actor: role, superuser: false, owns: false }]);
    if (legacyPermissions) expect((await client.query<{ can_read: boolean }>(
      "select has_table_privilege(current_user,'public.grz_principal_settlements','SELECT') as can_read")).rows).toEqual([{ can_read: false }]);
    if (ready) ready((await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid);
    if (insert) await client.query(`insert into grz_bond_payments(bond_id,payment_date,payment_type,gross_amount,withholding_tax,net_amount,status,actual_payment_date,income_transaction_id)
      select bond_id,payment_date,'coupon',gross_amount,withholding_tax,net_amount,'paid',$3,$2 from grz_bond_payments where id=$1`, [paymentId, cashId, date]);
    else await client.query("update grz_bond_payments set income_transaction_id=$2,status='paid',actual_payment_date=$3 where id=$1", [paymentId, cashId, date]);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE"); return null;
  } catch (error) { const failure = getPostgresError(error); if (!failure) throw error; return failure; }
  finally {
    await client.query("ROLLBACK");
    if (created) { await client.query(`DROP OWNED BY "${role}"`); await client.query(`DROP ROLE "${role}"`); }
    client.release();
  }
}
async function clean() {
  if (!a) return;
  // Retention is not disabled for fixtures. The original household AND all
  // linked cash disappear in this same committed whole-household erasure.
  await db.transaction(async tx => {
    const present = await tx.execute<{ table: string | null }>(sql`select to_regclass('public.grz_principal_settlements')::text as "table"`);
    if (present.rows[0]?.table) await tx.execute(sql`delete from grz_principal_settlements where household_id=${a}::uuid`);
    const basis = await tx.execute<{ table: string | null }>(sql`select to_regclass('public.grz_bond_principal_basis')::text as "table"`);
    if (basis.rows[0]?.table) await tx.execute(sql`delete from grz_bond_principal_basis where household_id=${a}::uuid`);
    await tx.delete(grzBondValuations).where(eq(grzBondValuations.householdId, a));
    await tx.delete(grzBondPayments).where(inArray(grzBondPayments.bondId, tx.select({ id: grzBonds.id }).from(grzBonds).where(eq(grzBonds.householdId, a))));
    await tx.delete(grzBonds).where(eq(grzBonds.householdId, a));
    await tx.delete(grzTBills).where(eq(grzTBills.householdId, a));
    await tx.delete(investmentTransactions).where(eq(investmentTransactions.householdId, a));
    await tx.delete(outboxEvents).where(eq(outboxEvents.householdId, a));
    await tx.delete(transactions).where(eq(transactions.householdId, a));
    await tx.delete(accounts).where(eq(accounts.householdId, a));
    await tx.delete(auditLogs).where(or(eq(auditLogs.householdId, a), inArray(auditLogs.userId, [userId, ...extraUserIds])));
    await tx.delete(householdMembers).where(eq(householdMembers.householdId, a));
    await tx.delete(households).where(eq(households.id, a));
    for (const id of [userId, ...extraUserIds]) {
      await tx.execute(sql`delete from "session" where sess->>'userId'=${id}`);
      await tx.delete(users).where(eq(users.id, id));
    }
  });
}
async function committedState() {
  return {
    cash: await db.select({ id: accounts.id, balance: accounts.balance }).from(accounts)
      .where(inArray(accounts.id, [ids.sharedAccount, custodyId, debtId])).orderBy(accounts.id),
    ledger: await db.select().from(transactions).where(eq(transactions.householdId, a)).orderBy(transactions.id),
    investments: await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a)).orderBy(investmentTransactions.id),
    bond: await db.select().from(grzBonds).where(eq(grzBonds.id, bondId)),
    payment: await db.select().from(grzBondPayments).where(eq(grzBondPayments.id, principalId)),
    audits: await db.select().from(auditLogs).where(eq(auditLogs.householdId, a)).orderBy(auditLogs.id),
    settlements: (await db.execute<{ data: unknown }>(sql`select to_jsonb(s) as data from grz_principal_settlements s where household_id=${a}::uuid order by operation_id`)).rows,
  };
}

describe("R13 signed principal maturity is a confirmed asset-to-cash settlement", () => {
  beforeAll(async () => { app = await getTestApp(); passwordHash = await hashPassword(password); }, 30_000);
  beforeEach(async () => {
    extraUserIds.length = 0;
    a = randomUUID(); userId = randomUUID();
    const email = `r13-principal-${userId}@example.invalid`;
    await db.insert(households).values({ id: a, name: "Synthetic principal settlement", currency });
    await db.insert(users).values({ id: userId, email, username: `r13-principal-${userId}`, passwordHash, emailVerified: true });
    await db.insert(householdMembers).values({ householdId: a, userId, role: "member" });
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
    await db.insert(accounts).values([
      { id: ids.sharedAccount, householdId: a, name: "Synthetic principal cash", type: "checking", currency, balance: "50.00", initialBalance: "50.00", isAsset: true },
      { id: custodyId, householdId: a, name: "Synthetic principal custody", type: "investment", currency, balance: "0.00", initialBalance: "0.00", isAsset: true },
      { id: debtId, householdId: a, name: "Synthetic unchanged card debt", type: "credit", currency, balance: "200.00", initialBalance: "200.00", isAsset: false },
    ]);
    await db.insert(grzBonds).values({ id: bondId, householdId: a, accountId: custodyId, isin, bondName: "Synthetic principal 950 to 1000",
      faceValue: "1000.00", purchasePrice: "950.00", couponRate: "0.0000", purchaseDate: "2025-06-30", maturityDate: date, tenorYears: 1, status: "active" });
    await db.insert(grzBondPayments).values({ id: principalId, bondId, paymentDate: date, paymentType: "principal",
      grossAmount: "1000.00", withholdingTax: "0.00", netAmount: "1000.00", status: "scheduled" });
    // Synthetic values enter through the real signed member-recorded evidence
    // path; production never accepts a synthetic sourceKind or a request mark.
    const recorded = await signed(request(app).post(`/api/grz/bonds/${bondId}/valuations`)).send({ operationId: randomUUID(),
      valuationDate: date, sourceDate: date, nominalAmount: "1000.00", isin, currency, sourceKind: "custodian_statement", sourceReference: "Synthetic fixture statement: principal component 1000",
      quoteBasis: "clean", quoteUnits: "holding_amount", quotedAmount: "1000.00", accruedInterest: "0.00" }).expect(201);
    valuationId = recorded.body.data.id;
  });
  afterEach(clean);
  afterAll(clean);

  it("commits dated acquisition, valuation and principal proof on the owner's day across UTC rollover", async () => {
    await db.update(householdMembers).set({ role: "owner" }).where(eq(householdMembers.userId, userId));
    const setCalendar = (timeZone: string) => signed(request(app).put("/api/investments/calendar")).send({ timeZone });
    await setCalendar("US/Eastern").expect(200);
    expect((await db.select({ zone: households.timeZone }).from(households).where(eq(households.id, a)))[0].zone)
      .toBe("America/New_York");

    // +14 and -11 cover opposite sides of the UTC day. Pick the differing
    // civil date from one PostgreSQL instant, without changing either clock.
    const { rows: [calendar] } = await pool.query<{ time_zone: string; local_date: string; utc_date: string }>(`
      with stamp as materialized (select transaction_timestamp() as instant)
      select zone as time_zone, (instant at time zone zone)::date::text as local_date,
        (instant at time zone 'UTC')::date::text as utc_date
      from stamp cross join (values ('Pacific/Kiritimati'), ('Pacific/Pago_Pago')) zones(zone)
      where (instant at time zone zone)::date <> (instant at time zone 'UTC')::date
      order by local_date desc
      limit 1`);
    expect(calendar.local_date).not.toBe(calendar.utc_date);
    const householdDate = calendar.local_date;
    const tomorrow = shiftCalendarDate(householdDate, 1);
    await setCalendar(calendar.time_zone).expect(200);

    const futureBasis = await basisRequest({ sourceDate: tomorrow }).expect(400);
    expect(futureBasis.body.error.code).toBe("VALIDATION_ERROR");
    const basis = await basisRequest({ sourceDate: householdDate }).expect(201);
    expect(basis.body.data.sourceDate).toBe(householdDate);
    basisId = basis.body.data.id;

    await db.update(grzBonds).set({ maturityDate: tomorrow }).where(eq(grzBonds.id, bondId));
    await signed(request(app).post(`/api/grz/bonds/${bondId}/valuations`)).send({ operationId: randomUUID(),
      valuationDate: tomorrow, sourceDate: tomorrow, nominalAmount: "1000.00", isin, currency, sourceKind: "custodian_statement",
      sourceReference: "Synthetic future value", quoteBasis: "clean", quoteUnits: "holding_amount", quotedAmount: "1000.00",
      accruedInterest: "0.00" }).expect(400);
    await db.update(grzBonds).set({ maturityDate: householdDate, couponRate: "0.0800", couponFrequency: 2,
      firstCouponDate: householdDate }).where(eq(grzBonds.id, bondId));
    await db.update(grzBondPayments).set({ paymentDate: householdDate }).where(eq(grzBondPayments.id, principalId));
    const coupon = randomUUID();
    await db.insert(grzBondPayments).values({ id: coupon, bondId, paymentDate: householdDate, paymentType: "coupon",
      grossAmount: "40.00", withholdingTax: "6.00", netAmount: "34.00", status: "scheduled" });
    await recordMaturityMark(householdDate, "40.00");
    await signed(request(app).post(`/api/grz/payments/${coupon}/pay`))
      .send({ accountId: ids.sharedAccount, date: householdDate }).expect(200);

    const readProof = async (receiptDate: string) => (await pool.query<{ proof: unknown }>(
      "select public.grz_principal_coupon_proof($1,$2,$3,$4) as proof", [bondId, valuationId, receiptDate, userId],
    )).rows[0].proof;
    const proof = await readProof(householdDate);
    expect(proof).toMatchObject({ payments: [expect.objectContaining({ paymentId: coupon, actualPaymentDate: householdDate })] });
    expect(await readProof(tomorrow)).toBeNull();
    const before = await committedState();
    expect(await probeSettlementDestination(ids.sharedAccount, currency, true, { receiptDate: householdDate, couponProof: proof })).toBeNull();
    expect(await probeSettlementDestination(ids.sharedAccount, currency, true, { receiptDate: tomorrow, couponProof: proof }))
      .toMatchObject({ code: "23514" });
    await pay(randomUUID(), true, { date: tomorrow }).expect(400);
    expect(await committedState()).toEqual(before);

    const operationId = randomUUID();
    await pay(operationId, true, { date: householdDate }).expect(200);
    const committed = await committedState();
    expect(committed.payment[0]).toMatchObject({ status: "paid", actualPaymentDate: householdDate });
    expect(committed.ledger).toHaveLength(2);
    expect(committed.ledger).toEqual(expect.arrayContaining([
      expect.objectContaining({ amount: "34.00", type: "income", date: householdDate }),
      expect.objectContaining({ amount: "1000.00", type: "asset_settlement", date: householdDate }),
    ]));
    expect(committed.cash.find(row => row.id === ids.sharedAccount)?.balance).toBe("1084.00");
    await pay(operationId, true, { date: householdDate }).expect(200);
    expect(await committedState()).toEqual(committed);
  });

  it("moves confirmed principal once, retires the holding, preserves debt and records basis separately from ordinary income", async () => {
    await recordBasis();
    const operationId = randomUUID();
    const beforeWorth = await signed(request(app).get("/api/accounts/summary")).expect(200);
    expect(beforeWorth.body.data).toMatchObject({ totalAssets: 1050, totalLiabilities: 200, netWorth: 850, currency });
    const first = await pay(operationId).expect(200);
    const saved = await committedState();
    expect.soft(saved.cash.find(row => row.id === ids.sharedAccount)?.balance).toBe("1050.00");
    expect.soft(saved.cash.find(row => row.id === custodyId)?.balance).toBe("0.00");
    expect.soft(saved.cash.find(row => row.id === debtId)?.balance).toBe("200.00");
    expect.soft(saved.bond[0].status).toBe("matured");
    expect.soft(saved.payment[0]).toMatchObject({ status: "paid", actualPaymentDate: date, incomeTransactionId: null });
    expect.soft(saved.ledger).toHaveLength(1);
    expect.soft(saved.ledger[0]).toMatchObject({ accountId: ids.sharedAccount, amount: "1000.00", currency, date, type: "asset_settlement" });
    expect.soft(saved.investments).toHaveLength(1);
    expect.soft(saved.investments[0]).toMatchObject({ type: "maturity", amount: "1000.00", fees: "0.00", currency, linkedTransactionId: saved.ledger[0]?.id });
    const process = saved.audits.filter(row => row.entityType === "grz_bond_payment" && row.entityId === principalId && row.action === "PROCESS");
    expect.soft(process).toHaveLength(1);
    expect.soft(process[0]?.details).toMatchObject({ settlement: { kind: "principal", principalAmount: "1000.00", costBasis: "950.00",
      realizedBasisDifference: "50.00", fees: "0.00", purchasedInterest: "0.00", acquisitionFees: "0.00", currency,
      basisEvidence: { sourceId: basisId, sourceKind: "custodian_statement", acquisitionDate: "2025-06-30", sourceDate: date },
      carryingValuation: { amount: "1000.00", currency, asOfDate: date, sourceKind: "custodian_statement", sourceId: valuationId,
        policyVersion: "grz_member_recorded_market_v1", component: "ex_coupon_principal", settlementValueDifference: "0.00" } } });
    const flows = await signed(request(app).get(`/api/transactions/summary?startDate=${date}&endDate=${date}`)).expect(200);
    expect.soft(flows.body.data).toMatchObject({ totalIncome: { amount: "0.00", currency }, totalExpenses: { amount: "0.00", currency }, netFlow: { amount: "0.00", currency } });
    const worth = await signed(request(app).get("/api/accounts/summary"));
    expect.soft(worth.status).toBe(200);
    expect.soft(worth.body.data).toMatchObject({ totalAssets: 1050, totalLiabilities: 200, netWorth: 850, currency });
    const replay = await pay(operationId);
    expect.soft(replay.status).toBe(200);
    expect.soft(replay.body.data.id).toBe(first.body.data.id);
    expect(await committedState()).toEqual(saved);
    const listed = await signed(request(app).get("/api/grz/bonds")).expect(200);
    expect(listed.body.data.find((row: { id: string }) => row.id === bondId)).toMatchObject({ status: "matured" });
  });

  it.each([
    ["edit ordinary cash notes", "update public.transactions set notes='updated' where id=$1"],
    ["edit an ordinary cash amount", "update public.transactions set amount=amount+1 where id=$1"],
    ["delete ordinary cash", "delete from public.transactions where id=$1"],
  ] as const)("allows a pre-settlement writer to %s without new table grants", async (_action, command) => {
    const created = await signed(request(app).post("/api/transactions")).send({
      accountId: ids.sharedAccount, date, name: "Ordinary receipt", type: "income", amount: { amount: "2.00", currency },
    }).expect(201);
    const role = `r13_old_cash_${randomUUID().replace(/-/g, "")}`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE ROLE "${role}" NOLOGIN NOINHERIT`);
      await client.query(`GRANT "${role}" TO CURRENT_USER`);
      await client.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
      await client.query(`GRANT SELECT, UPDATE, DELETE ON public.transactions TO "${role}"`);
      await client.query(`GRANT SELECT ON public.transaction_create_owner_intents TO "${role}"`);
      await client.query(`SET LOCAL ROLE "${role}"`);
      const rights = await client.query(`select current_user as role,
        has_any_column_privilege(current_user,'public.grz_principal_settlements','SELECT') as can_read_principal,
        has_any_column_privilege(current_user,'public.grz_tbills','SELECT') as can_read_tbills`);
      expect(rights.rows).toEqual([{ role, can_read_principal: false, can_read_tbills: false }]);
      const result = await client.query(command, [created.body.data.id]);
      expect(result.rowCount).toBe(1);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    } finally {
      try { await client.query("ROLLBACK"); } finally { client.release(); }
    }
  });

  it("keeps an unconfirmed receipt pending without fabricating cash, ordinary income, disposal or financial audit", async () => {
    const before = await committedState();
    const result = await pay(randomUUID(), false);
    expect.soft(result.status).toBe(202);
    expect.soft(result.body.data).toMatchObject({ status: "scheduled" });
    const after = await committedState();
    const { audits: beforeAudit, settlements: _beforeClaims, ...beforeFinancials } = before;
    const { audits: afterAudit, settlements: _afterClaims, ...afterFinancials } = after;
    expect(afterFinancials).toEqual(beforeFinancials);
    expect(afterAudit.filter(row => row.action === "PROCESS")).toEqual(beforeAudit.filter(row => row.action === "PROCESS"));
  });

  it("links an already-posted matching receipt once without another cash delta and removes principal from ordinary income", async () => {
    await recordBasis();
    const created = await signed(request(app).post("/api/transactions")).send({ accountId: ids.sharedAccount, date,
      name: "Synthetic imported actual principal receipt", type: "income", amount: { amount: "1000.00", currency }, idempotencyKey: randomUUID() }).expect(201);
    const receiptId: string = created.body.data.id;
    const before = await committedState(); expect(before.cash.find(row => row.id === ids.sharedAccount)?.balance).toBe("1050.00");
    const operationId = randomUUID();
    await pay(operationId, true, { receiptTransactionId: receiptId }).expect(200);
    const after = await committedState();
    expect.soft(after.cash).toEqual(before.cash);
    expect.soft(after.ledger).toHaveLength(1);
    expect.soft(after.ledger[0]).toMatchObject({ id: receiptId, amount: "1000.00", type: "asset_settlement", postedBalanceDelta: "1000.00" });
    expect.soft(after.investments).toHaveLength(1);
    expect.soft(after.investments[0]).toMatchObject({ type: "maturity", linkedTransactionId: receiptId });
    const flows = await signed(request(app).get(`/api/transactions/summary?startDate=${date}&endDate=${date}`)).expect(200);
    expect.soft(flows.body.data.totalIncome).toEqual({ amount: "0.00", currency });
    await pay(operationId, true, { receiptTransactionId: receiptId }).expect(200);
    expect(await committedState()).toEqual(after);
  });

  it("reconciles a confirmed net receipt plus explicit fee to principal without a second gain cash leg", async () => {
    await recordBasis();
    await pay(randomUUID(), true, { receivedAmount: { amount: "990.00", currency }, fees: { amount: "10.00", currency } }).expect(200);
    const saved = await committedState();
    expect.soft(saved.cash.find(row => row.id === ids.sharedAccount)?.balance).toBe("1040.00");
    expect.soft(saved.ledger).toHaveLength(1);
    expect.soft(saved.ledger[0]).toMatchObject({ amount: "990.00", type: "asset_settlement" });
    expect.soft(saved.investments[0]).toMatchObject({ amount: "1000.00", fees: "10.00", linkedTransactionId: saved.ledger[0]?.id });
    const process = saved.audits.find(row => row.entityId === principalId && row.action === "PROCESS");
    expect.soft(process?.details).toMatchObject({ settlement: { principalAmount: "1000.00", costBasis: "950.00", realizedBasisDifference: "50.00", fees: "10.00", currency } });
    const worth = await signed(request(app).get("/api/accounts/summary")); expect.soft(worth.status).toBe(200);
    expect.soft(worth.body.data).toMatchObject({ totalAssets: 1040, totalLiabilities: 200, netWorth: 840, currency });
  });

  it("rejects receipt and fee terms that do not reconcile before any financial mutation", async () => {
    const before = await committedState();
    await pay(randomUUID(), true, { receivedAmount: { amount: "1000.00", currency }, fees: { amount: "10.00", currency } }).expect(400);
    expect(await committedState()).toEqual(before);
  });

  it("retains a confirmed receipt claim pending when the latest dirty valuation cannot separate the final coupon", async () => {
    await recordBasis();
    await signed(request(app).post(`/api/grz/bonds/${bondId}/valuations`)).send({ operationId: randomUUID(), valuationDate: date,
      sourceDate: date, nominalAmount: "1000.00", isin, currency, sourceKind: "custodian_statement", sourceReference: "Synthetic dirty-only fixture mark",
      quoteBasis: "dirty", quoteUnits: "holding_amount", quotedAmount: "1080.00", accruedInterest: null }).expect(201);
    const before = await committedState();
    await pay(randomUUID()).expect(202);
    const after = await committedState();
    expect(after.cash).toEqual(before.cash); expect(after.ledger).toEqual(before.ledger); expect(after.investments).toEqual(before.investments);
    expect(after.bond).toEqual(before.bond); expect(after.payment).toEqual(before.payment);
    expect(after.audits.filter(row => row.action === "PROCESS")).toHaveLength(0);
  });

  it("protects settled principal cash from ordinary edits and deletion after retiring the holding", async () => {
    await recordBasis();
    await pay(randomUUID()).expect(200);
    const before = await committedState(), id = before.ledger[0].id;
    await signed(request(app).put(`/api/transactions/${id}`)).send({ amount: { amount: "1200.00", currency }, updatedAt: before.ledger[0].updatedAt.toISOString() }).expect(409);
    await signed(request(app).delete(`/api/transactions/${id}`)).expect(409);
    expect(await committedState()).toEqual(before);
  });

  it("does not discard a known included coupon asset when the confirmed receipt covers principal only", async () => {
    await recordBasis();
    await signed(request(app).post(`/api/grz/bonds/${bondId}/valuations`)).send({ operationId: randomUUID(), valuationDate: date,
      sourceDate: date, nominalAmount: "1000.00", isin, currency, sourceKind: "custodian_statement", sourceReference: "Synthetic clean plus final coupon fixture",
      quoteBasis: "clean", quoteUnits: "holding_amount", quotedAmount: "970.00", accruedInterest: "25.10" }).expect(201);
    const before = await committedState();
    const prior = await signed(request(app).get("/api/accounts/summary")).expect(200);
    expect(prior.body.data.netWorth).toBe(845.1);
    await pay(randomUUID()).expect(202);
    const after = await committedState();
    expect(after.cash).toEqual(before.cash); expect(after.ledger).toEqual(before.ledger); expect(after.investments).toEqual(before.investments);
    expect(after.bond).toEqual(before.bond); expect(after.payment).toEqual(before.payment);
    expect(after.audits.filter(row => row.action === "PROCESS")).toHaveLength(0);
    expect((await signed(request(app).get("/api/accounts/summary")).expect(200)).body.data.netWorth).toBe(845.1);
  });

  it("settles delayed zero-coupon cash against the exact contractual maturity mark without carrying it into daily publication", async () => {
    const maturity = new Date(`${date}T00:00:00Z`); maturity.setUTCDate(maturity.getUTCDate() - 2);
    const maturityDate = maturity.toISOString().slice(0, 10);
    await db.update(grzBonds).set({ maturityDate }).where(eq(grzBonds.id, bondId));
    await db.update(grzBondPayments).set({ paymentDate: maturityDate }).where(eq(grzBondPayments.id, principalId));
    await recordBasis(); await recordMaturityMark(maturityDate);
    const gap = await signed(request(app).get("/api/accounts/summary")).expect(422);
    expect(gap.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
    const operationId = randomUUID(); await pay(operationId).expect(200);
    const saved = await committedState();
    expect(saved.payment[0]).toMatchObject({ status: "paid", paymentDate: maturityDate, actualPaymentDate: date });
    expect(saved.ledger).toHaveLength(1); expect(saved.ledger[0]).toMatchObject({ date, amount: "1000.00", type: "asset_settlement" });
    expect(saved.investments[0]).toMatchObject({ transactionDate: date, amount: "1000.00", fees: "0.00" });
    expect(saved.audits.find(row => row.entityId === principalId && row.action === "PROCESS")?.details).toMatchObject({
      settlement: { carryingValuation: { asOfDate: maturityDate, sourceId: valuationId, amount: "1000.00" } } });
    await pay(operationId).expect(200); expect(await committedState()).toEqual(saved);
    const summary = await signed(request(app).get("/api/accounts/summary")).expect(200);
    expect(summary.body.data).toMatchObject({ totalAssets: 1050, totalLiabilities: 200, netWorth: 850 });
  });

  it("does not substitute a prior trading-day quote when the contractual maturity mark is missing", async () => {
    const maturity = new Date(`${date}T00:00:00Z`); maturity.setUTCDate(maturity.getUTCDate() - 2);
    const maturityDate = maturity.toISOString().slice(0, 10); maturity.setUTCDate(maturity.getUTCDate() - 1);
    await db.update(grzBonds).set({ maturityDate }).where(eq(grzBonds.id, bondId));
    await db.update(grzBondPayments).set({ paymentDate: maturityDate }).where(eq(grzBondPayments.id, principalId));
    await recordBasis(); await recordMaturityMark(maturity.toISOString().slice(0, 10));
    const before = await committedState(), result = await pay(randomUUID()).expect(202), after = await committedState();
    expect(result.body.data.settlement.pendingReason).toBe("valuation_unavailable");
    expect(after.cash).toEqual(before.cash); expect(after.ledger).toEqual(before.ledger); expect(after.bond).toEqual(before.bond);
  });

  it.each(["outstanding coupon", "missing schedule", "unsupported paid flag", "unknown withholding"])(
    "keeps principal pending for %s even when the maturity mark explicitly excludes accrued interest", async problem => {
      await recordBasis();
      if (problem === "missing schedule") {
        await db.update(grzBonds).set({ couponRate: "0.0800", couponFrequency: 2, firstCouponDate: date }).where(eq(grzBonds.id, bondId));
      } else await finalCoupon(problem === "unsupported paid flag" ? { status: "paid", actualPaymentDate: date }
        : problem === "unknown withholding" ? { withholdingTax: null } : {});
      await recordMaturityMark();
      const before = await committedState(), result = await pay(randomUUID()).expect(202), after = await committedState();
      expect(result.body.data.settlement.pendingReason).toBe("coupon_component_unresolved");
      expect(after.cash).toEqual(before.cash); expect(after.ledger).toEqual(before.ledger); expect(after.investments).toEqual(before.investments);
      expect(after.payment).toEqual(before.payment); expect(after.bond).toEqual(before.bond);
    });

  it("reconciles an included final coupon through its separate signed cash receipt before retiring principal", async () => {
    await recordBasis(); const couponId = await finalCoupon(); await recordMaturityMark(date, "40.00");
    const pendingOperation = randomUUID(); const pending = await pay(pendingOperation).expect(202);
    expect(pending.body.data.settlement.pendingReason).toBe("coupon_component_unresolved");
    await payCoupon(couponId).expect(200);
    const couponBefore = (await db.select().from(grzBondPayments).where(eq(grzBondPayments.id, couponId)))[0];
    const couponCash = (await db.select().from(transactions).where(eq(transactions.id, couponBefore.incomeTransactionId!)))[0];
    expect(couponCash).toMatchObject({ amount: "34.00", type: "income", postingMode: "posted" });
    await pay(pendingOperation).expect(200);
    const saved = await committedState();
    expect(saved.cash.find(row => row.id === ids.sharedAccount)?.balance).toBe("1084.00");
    expect(saved.ledger).toHaveLength(2); expect(saved.ledger.filter(row => row.type === "income")).toEqual([couponCash]);
    expect(saved.investments).toHaveLength(1); expect(saved.investments[0]).toMatchObject({ amount: "1000.00", fees: "0.00" });
    expect((await db.select().from(grzBondPayments).where(eq(grzBondPayments.id, couponId)))[0]).toEqual(couponBefore);
    const flows = await signed(request(app).get(`/api/transactions/summary?startDate=${date}&endDate=${date}`)).expect(200);
    expect(flows.body.data.totalIncome).toEqual({ amount: "34.00", currency });
    await pay(pendingOperation).expect(200); expect(await committedState()).toEqual(saved);
  });

  it("verifies the actor's private coupon CREATE proof and scopes both coupon and principal PROCESS audits to that actor", async () => {
    await recordBasis(); const couponId = await finalCoupon(); await recordMaturityMark(date, "40.00");
    await db.update(accounts).set({ isPrivate: true, ownerUserId: userId }).where(eq(accounts.id, ids.sharedAccount));
    await payCoupon(couponId).expect(200); await pay(randomUUID()).expect(200);
    const audit = await db.execute<{ household_id: string | null; user_id: string }>(sql`select household_id,user_id from audit_logs
      where action='PROCESS' and entity_type='grz_bond_payment' and entity_id in (${couponId}::uuid,${principalId}::uuid)`);
    expect(audit.rows).toHaveLength(2); expect(audit.rows.every(row => row.household_id === null && row.user_id === userId)).toBe(true);
    const saved = await committedState(); expect(saved.cash.find(row => row.id === ids.sharedAccount)?.balance).toBe("1084.00");
    expect(saved.ledger.filter(row => row.type === "income").map(row => row.amount)).toEqual(["34.00"]);
  });

  it.each(["replacement identity", "changed terms", "orphan cash"])("withholds retirement after a captured coupon changes: %s", async problem => {
    await recordBasis(); let couponId = await finalCoupon(); await recordMaturityMark();
    if (problem === "replacement identity") {
      await db.delete(grzBondPayments).where(eq(grzBondPayments.id, couponId)); couponId = await finalCoupon();
    } else if (problem === "changed terms") await db.update(grzBondPayments).set({ grossAmount: "42.00", withholdingTax: "6.30", netAmount: "35.70" })
      .where(eq(grzBondPayments.id, couponId));
    await payCoupon(couponId).expect(200);
    if (problem === "orphan cash") await db.update(grzBondPayments).set({ status: "scheduled", actualPaymentDate: null, incomeTransactionId: null })
      .where(eq(grzBondPayments.id, couponId));
    const before = await committedState(), result = await pay(randomUUID()).expect(202), after = await committedState();
    expect(result.body.data.settlement.pendingReason).toBe("coupon_component_unresolved");
    expect(after.cash).toEqual(before.cash); expect(after.ledger).toEqual(before.ledger); expect(after.investments).toEqual(before.investments);
    expect(after.payment).toEqual(before.payment); expect(after.bond).toEqual(before.bond);
  });

  it("rejects a restricted SQL principal retirement while the captured positive final coupon is outstanding", async () => {
    await recordBasis(); await finalCoupon(); await recordMaturityMark();
    const before = await committedState();
    expect(await probeSettlementDestination(ids.sharedAccount, "ZMW", true)).toMatchObject({ code: "23514" });
    expect(await committedState()).toEqual(before);
  });

  it.each(["0.00", "14.00"])("withholds principal when a signed coupon copied unsupported app-policy withholding %s", async withheld => {
    const id = await finalCoupon({ grossAmount: "100.00", withholdingTax: withheld, netAmount: withheld === "0.00" ? "100.00" : "86.00" });
    await db.update(grzBonds).set({ couponRate: "0.2000" }).where(eq(grzBonds.id, bondId));
    await recordBasis(); await payCoupon(id).expect(200); await recordMaturityMark();
    const before = await committedState(), response = await pay(randomUUID()).expect(202), after = await committedState();
    expect(response.body.data.settlement.pendingReason).toBe("coupon_component_unresolved");
    expect(after.cash).toEqual(before.cash); expect(after.ledger).toEqual(before.ledger); expect(after.investments).toEqual(before.investments);
    expect(after.payment).toEqual(before.payment); expect(after.bond).toEqual(before.bond);
  });

  it("uses the declared app schedule tax on unrounded period value before rounded gross display", async () => {
    const actual = generateBondSchedule(new Date("2025-06-30"), new Date(`${date}T00:00:00Z`), "6730.00", "0.0010", { firstCouponDate: new Date(`${date}T00:00:00Z`), couponFrequency: 2 });
    expect(actual[0]).toMatchObject({ amount: "3.37", withholdingTax: "0.50" });
    await db.update(grzBonds).set({ faceValue: "6730.00" }).where(eq(grzBonds.id, bondId));
    await db.update(grzBondPayments).set({ grossAmount: "6730.00", netAmount: "6730.00" }).where(eq(grzBondPayments.id, principalId));
    const couponId = await finalCoupon({ grossAmount: "3.37", withholdingTax: "0.50", netAmount: "2.87" });
    await db.update(grzBonds).set({ couponRate: "0.0010" }).where(eq(grzBonds.id, bondId));
    await recordBasis(); await recordMaturityMark(); await payCoupon(couponId).expect(200);
    await pay(randomUUID(), true, { receivedAmount: { amount: "6730.00", currency } }).expect(200);
    const saved = await committedState();
    expect(saved.cash.find(row => row.id === ids.sharedAccount)?.balance).toBe("6782.87");
    expect(saved.ledger.filter(row => row.type === "income").map(row => row.amount)).toEqual(["2.87"]);
  });

  it("retires legitimate rounded-zero positive-rate coupons without a cash posting", async () => {
    await db.update(grzBonds).set({ faceValue: "50.00", purchasePrice: "47.50" }).where(eq(grzBonds.id, bondId));
    await db.update(grzBondPayments).set({ grossAmount: "50.00", netAmount: "50.00" }).where(eq(grzBondPayments.id, principalId));
    const couponId = await finalCoupon({ grossAmount: "0.00", withholdingTax: "0.00", netAmount: "0.00" });
    await db.update(grzBonds).set({ couponRate: "0.0001" }).where(eq(grzBonds.id, bondId));
    const actual = generateBondSchedule(new Date("2025-06-30"), new Date(`${date}T00:00:00Z`), "50.00", "0.0001", { firstCouponDate: new Date(`${date}T00:00:00Z`), couponFrequency: 2 });
    expect(actual[0]).toMatchObject({ amount: "0.00", withholdingTax: "0.00" });
    const basis = await basisRequest({ purchaseCashAmount: "47.50", principalCost: "47.50" }).expect(201); basisId = basis.body.data.id;
    await recordMaturityMark(); await payCoupon(couponId).expect(400);
    await pay(randomUUID(), true, { receivedAmount: { amount: "50.00", currency } }).expect(200);
    const saved = await committedState(); expect(saved.ledger).toHaveLength(1); expect(saved.ledger[0].type).toBe("asset_settlement");
    expect(saved.cash.find(row => row.id === ids.sharedAccount)?.balance).toBe("100.00");
  });

  it.each([false, true])("refuses positive orphan coupon cash beside a zero-cash schedule (positive rate=%s)", async positiveRate => {
    const couponId = await finalCoupon(); await payCoupon(couponId).expect(200);
    const face = positiveRate ? "50.00" : "1000.00";
    await db.update(grzBonds).set({ couponRate: positiveRate ? "0.0001" : "0.0000", faceValue: face }).where(eq(grzBonds.id, bondId));
    await db.update(grzBondPayments).set({ grossAmount: face, netAmount: face }).where(eq(grzBondPayments.id, principalId));
    await db.update(grzBondPayments).set({ grossAmount: "0.00", withholdingTax: "0.00", netAmount: "0.00", status: "scheduled",
      actualPaymentDate: null, incomeTransactionId: null }).where(eq(grzBondPayments.id, couponId));
    await recordBasis();
    // A direct historical source writer can supply an intrinsically consistent
    // mark; that cannot erase independent already-posted coupon provenance.
    const [original] = await db.select().from(grzBondValuations).where(eq(grzBondValuations.id, valuationId));
    const id = randomUUID();
    await db.insert(grzBondValuations).values({ ...original, id, sequence: undefined, operationId: randomUUID(), nominalAmount: face,
      quotedAmount: face, cleanValue: face, dirtyValue: face, couponState: [{ id: couponId, paymentDate: date, gross: "0.00", withheld: "0.00", net: "0.00",
        status: "scheduled", actualDate: null, incomeId: null, investmentId: null, postingKey: grzCouponPaymentKey(couponId) }] });
    valuationId = id;
    const before = await committedState();
    const response = await pay(randomUUID(), true, { receivedAmount: { amount: face, currency } }).expect(202);
    expect(response.body.data.settlement.pendingReason).toBe("coupon_component_unresolved");
    const after = await committedState(); expect(after.cash).toEqual(before.cash); expect(after.ledger).toEqual(before.ledger);
    expect(after.investments).toEqual(before.investments); expect(after.payment).toEqual(before.payment); expect(after.bond).toEqual(before.bond);
  });

  it.each([false, true])("refuses a superseded maturity revision in a restricted settlement (latest inadmissible=%s)", async inadmissible => {
    await recordBasis(); const old = valuationId;
    await recordMaturityMark(date, "0.00", "900.00");
    if (inadmissible) {
      const [latest] = await db.select().from(grzBondValuations).where(eq(grzBondValuations.id, valuationId));
      await db.insert(grzBondValuations).values({ ...latest, id: randomUUID(), operationId: randomUUID(), sequence: undefined, policyVersion: "unsupported_fixture_rule" });
      await pay(randomUUID()).expect(202);
    }
    valuationId = old;
    const before = await committedState();
    expect(await probeSettlementDestination(ids.sharedAccount, "ZMW", true)).toMatchObject({ code: "23514" });
    expect(await committedState()).toEqual(before);
  });

  it.each(["holding_amount", "per_100_nominal"])("recomputes internally footing quote components before restricted principal binding: %s", async units => {
    await recordBasis();
    const [original] = await db.select().from(grzBondValuations).where(eq(grzBondValuations.id, valuationId));
    const id = randomUUID();
    await db.insert(grzBondValuations).values({ ...original, id, operationId: randomUUID(), sequence: undefined, quoteBasis: "dirty", quoteUnits: units,
      quotedAmount: units === "holding_amount" ? "900.00000000" : "90.00000000", accruedQuote: "0.00000000", cleanValue: "999.00", dirtyValue: "999.00", accruedValue: "0.00" });
    valuationId = id;
    await pay(randomUUID()).expect(202);
    const before = await committedState();
    expect(await probeSettlementDestination(ids.sharedAccount, "ZMW", true)).toMatchObject({ code: "23514" });
    expect(await committedState()).toEqual(before);
  });

  it.each(["signed finalized", "signed interrupted", "restricted finalized", "restricted interrupted"])(
    "refuses another bond's actual coupon as selected principal cash: %s", async mode => {
      await recordBasis();
      const coupon = await otherCoupon();
      expect(coupon).toMatchObject({ grossAmount: "1176.47", withholdingTax: "176.47", netAmount: "1000.00" });
      if (mode.endsWith("interrupted")) {
        const original = businessAuditService.log.bind(businessAuditService);
        const spy = vi.spyOn(businessAuditService, "log").mockImplementation(async entry => {
          if (entry.action === "PROCESS" && entry.entityId === coupon.id) throw new Error("Synthetic coupon finalization interruption");
          return original(entry);
        });
        try { await payCoupon(coupon.id).expect(500); } finally { spy.mockRestore(); }
      } else await payCoupon(coupon.id).expect(200);
      const [cash] = await db.select().from(transactions).where(eq(transactions.householdId, a));
      expect(cash).toMatchObject({ amount: "1000.00", type: "income", postingMode: "posted" });
      const origin = await db.execute<{ operation: string; posting_confirmed: boolean }>(sql`select operation,posting_confirmed
        from transaction_create_owner_intents where transaction_id=${cash.id}::uuid`);
      expect(origin.rows).toEqual([{ operation: "grz_coupon", posting_confirmed: true }]);
      const before = await committedState();
      if (mode.startsWith("signed")) await pay(randomUUID(), true, { receiptTransactionId: cash.id }).expect(409);
      else expect(await probeSettlementDestination(ids.sharedAccount, "ZMW", true, { receiptId: cash.id })).toMatchObject({ code: "23514" });
      expect(await committedState()).toEqual(before);
    });

  it.each(["signed", "restricted"])("preserves another payment's legacy linked cash without a grz_coupon owner intent: %s", async mode => {
    await recordBasis();
    const otherBond = randomUUID(), otherCoupon = randomUUID();
    await db.insert(grzBonds).values({ id: otherBond, householdId: a, accountId: custodyId, isin, bondName: "Synthetic legacy linked coupon",
      tenorYears: 1, faceValue: "10000.00", purchasePrice: "9500.00", couponRate: "0.2000", purchaseDate: "2025-06-30", maturityDate: date });
    const receipt = await signed(request(app).post("/api/transactions")).send({ accountId: ids.sharedAccount, date,
      name: "Synthetic actual legacy coupon cash", type: "income", amount: { amount: "1000.00", currency }, idempotencyKey: randomUUID() }).expect(201);
    await db.insert(grzBondPayments).values({ id: otherCoupon, bondId: otherBond, paymentDate: date, paymentType: "coupon",
      grossAmount: "1000.00", withholdingTax: "0.00", netAmount: "1000.00", status: "paid", actualPaymentDate: date, incomeTransactionId: receipt.body.data.id });
    const before = await committedState();
    if (mode === "signed") await pay(randomUUID(), true, { receiptTransactionId: receipt.body.data.id }).expect(409);
    else expect(await probeSettlementDestination(ids.sharedAccount, "ZMW", true, { receiptId: receipt.body.data.id })).toMatchObject({ code: "23514" });
    expect(await committedState()).toEqual(before);
  });

  it.each([false, true])("rejects a subsequent payment-side attachment of settled principal cash (insert=%s)", async insert => {
    await recordBasis(); const coupon = await otherCoupon(); await pay(randomUUID()).expect(200);
    const before = await committedState();
    expect(await probePaymentLink(coupon.id, before.ledger[0].id, insert)).toMatchObject({ code: "23514" });
    expect(await committedState()).toEqual(before);
  });

  it("preserves a legacy restricted payment writer's ordinary income link without granting access to principal events", async () => {
    const coupon = await otherCoupon();
    const receipt = await signed(request(app).post("/api/transactions")).send({ accountId: ids.sharedAccount, date,
      name: "Synthetic legacy-role ordinary coupon receipt", type: "income", amount: { amount: "1000.00", currency }, idempotencyKey: randomUUID() }).expect(201);
    const before = await committedState();
    expect(await probePaymentLink(coupon.id, receipt.body.data.id, false, undefined, true)).toBeNull();
    expect(await committedState()).toEqual(before);
  });

  it("rechecks a payment link after waiting for the actual overlapping principal reclassification", async () => {
    await recordBasis(); const coupon = await otherCoupon();
    const receipt = await signed(request(app).post("/api/transactions")).send({ accountId: ids.sharedAccount, date,
      name: "Synthetic overlapping ordinary receipt", type: "income", amount: { amount: "1000.00", currency }, idempotencyKey: randomUUID() }).expect(201);
    expect(await probePaymentLink(coupon.id, receipt.body.data.id)).toBeNull();
    const original = Client.prototype.query;
    let entered!: (pid: number) => void, release!: () => void, stopped = false;
    const started = new Promise<number>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const spy = vi.spyOn(Client.prototype, "query").mockImplementation(function(this: Client, ...args: unknown[]) {
      const command = args[0], text = typeof command === "string" ? command : command && typeof command === "object" && "text" in command ? String(command.text) : "";
      if (!stopped && /update\s+"transactions"\s+set\s+type='asset_settlement'/i.test(text)) {
        stopped = true; entered((this as Client & { processID: number }).processID);
        return gate.then(() => Reflect.apply(original, this, args));
      }
      return Reflect.apply(original, this, args);
    } as typeof Client.prototype.query);
    const timer = setTimeout(release, 5000);
    const principal = pay(randomUUID(), true, { receiptTransactionId: receipt.body.data.id }).then(value => value);
    let link: ReturnType<typeof probePaymentLink> | undefined;
    try {
      const principalPid = await started; expect(principalPid).toBeGreaterThan(0);
      let announce!: (pid: number) => void; const lateStarted = new Promise<number>(resolve => { announce = resolve; });
      link = probePaymentLink(coupon.id, receipt.body.data.id, false, announce); const latePid = await lateStarted;
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const result = await pool.query<{ pids: number[] }>("select pg_blocking_pids($1) as pids", [latePid]);
        if (result.rows[0].pids.includes(principalPid)) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true); release(); expect((await principal).status).toBe(200);
      expect(await link).toMatchObject({ code: "23514" });
      expect((await committedState()).ledger).toEqual([expect.objectContaining({ id: receipt.body.data.id, type: "asset_settlement" })]);
    } finally { clearTimeout(timer); release(); spy.mockRestore(); await principal; await link; }
  }, 15_000);

  it.each(["missing", "wrong"])("derives actual zero-coupon provenance independently of a %s captured posting key", async key => {
    const couponId = await finalCoupon(); await payCoupon(couponId).expect(200);
    await db.update(grzBonds).set({ couponRate: "0.0000" }).where(eq(grzBonds.id, bondId));
    await db.update(grzBondPayments).set({ grossAmount: "0.00", withholdingTax: "0.00", netAmount: "0.00", status: "scheduled",
      actualPaymentDate: null, incomeTransactionId: null }).where(eq(grzBondPayments.id, couponId));
    await recordBasis();
    const [original] = await db.select().from(grzBondValuations).where(eq(grzBondValuations.id, valuationId));
    const id = randomUUID();
    await db.insert(grzBondValuations).values({ ...original, id, sequence: undefined, operationId: randomUUID(), couponState: [{ id: couponId,
      paymentDate: date, gross: "0.00", withheld: "0.00", net: "0.00", status: "scheduled", actualDate: null, incomeId: null, investmentId: null,
      ...(key === "wrong" ? { postingKey: randomUUID() } : {}) }] }); valuationId = id;
    const couponProof = { policyVersion: "grz_principal_coupon_reconciled_v1", payments: [{ paymentId: couponId, dueDate: date,
      grossAmount: "0.00", withholdingTax: "0.00", netAmount: "0.00", actualPaymentDate: null, receiptTransactionId: null,
      schedulePolicyVersion: "grz_app_schedule_15pct_v1" }] };
    expect(await probeSettlementDestination(ids.sharedAccount, "ZMW", true, { couponProof })).toMatchObject({ code: "23514" });
  });

  it.each(["signed missing", "signed replaced", "restricted missing", "restricted replaced"])(
    "accounts for all actual coupon receipts after historical schedule withdrawal: %s", async mode => {
      const couponId = await finalCoupon(); await payCoupon(couponId).expect(200);
      await db.delete(grzBondPayments).where(eq(grzBondPayments.id, couponId));
      await db.update(grzBonds).set({ couponRate: "0.0000" }).where(eq(grzBonds.id, bondId));
      let replacement: string | undefined;
      if (mode.endsWith("replaced")) {
        replacement = randomUUID(); await db.insert(grzBondPayments).values({ id: replacement, bondId, paymentDate: date,
          paymentType: "coupon", grossAmount: "0.00", withholdingTax: "0.00", netAmount: "0.00", status: "scheduled" });
      }
      await recordBasis(); await recordMaturityMark(); const before = await committedState();
      if (mode.startsWith("signed")) {
        const result = await pay(randomUUID()).expect(202); expect(result.body.data.settlement.pendingReason).toBe("coupon_component_unresolved");
      } else {
        const couponProof = { policyVersion: "grz_principal_coupon_reconciled_v1", payments: replacement ? [{ paymentId: replacement, dueDate: date,
          grossAmount: "0.00", withholdingTax: "0.00", netAmount: "0.00", actualPaymentDate: null, receiptTransactionId: null,
          schedulePolicyVersion: "grz_app_schedule_15pct_v1" }] : [] };
        expect(await probeSettlementDestination(ids.sharedAccount, "ZMW", true, { couponProof })).toMatchObject({ code: "23514" });
      }
      const after = await committedState(); expect(after.cash).toEqual(before.cash); expect(after.ledger).toEqual(before.ledger);
      expect(after.investments).toEqual(before.investments); expect(after.payment).toEqual(before.payment); expect(after.bond).toEqual(before.bond);
    });

  it("reconciles a separately posted later coupon without changing the earlier actual principal receipt date", async () => {
    const prior = new Date(`${date}T00:00:00Z`); prior.setUTCDate(prior.getUTCDate() - 1); const receiptDate = prior.toISOString().slice(0, 10);
    const coupon = await finalCoupon({ paymentDate: receiptDate });
    await db.update(grzBonds).set({ maturityDate: receiptDate, firstCouponDate: receiptDate }).where(eq(grzBonds.id, bondId));
    await db.update(grzBondPayments).set({ paymentDate: receiptDate }).where(eq(grzBondPayments.id, principalId));
    await recordBasis(); await recordMaturityMark(receiptDate, "40.00");
    const cash = await signed(request(app).post("/api/transactions")).send({ accountId: ids.sharedAccount, date: receiptDate,
      name: "Synthetic earlier actual principal cash", type: "income", amount: { amount: "1000.00", currency }, idempotencyKey: randomUUID() }).expect(201);
    const operationId = randomUUID(), selection = { date: receiptDate, receiptTransactionId: cash.body.data.id };
    await pay(operationId, true, selection).expect(202); await payCoupon(coupon).expect(200);
    await pay(operationId, true, selection).expect(200);
    const saved = await committedState();
    expect(saved.payment[0].actualPaymentDate).toBe(receiptDate);
    expect(saved.ledger.find(row => row.id === cash.body.data.id)).toMatchObject({ date: receiptDate, type: "asset_settlement" });
    expect(saved.ledger.find(row => row.type === "income")).toMatchObject({ date, amount: "34.00" });
    expect(saved.cash.find(row => row.id === ids.sharedAccount)?.balance).toBe("1084.00");
    await pay(operationId, true, selection).expect(200); expect(await committedState()).toEqual(saved);
  });

  it.each(["private cash", "private destination", "deleted destination", "different requested receipt"])(
    "enforces signed actor receipt/account eligibility in restricted binding: %s", async problem => {
      await recordBasis();
      const other = randomUUID(); extraUserIds.push(other);
      await db.insert(users).values({ id: other, email: `r13-principal-other-${other}@example.invalid`, username: `r13-principal-other-${other}`, passwordHash, emailVerified: true });
      await db.insert(householdMembers).values({ householdId: a, userId: other, role: "member" });
      const before = await committedState();
      expect(await probeSettlementDestination(ids.sharedAccount, "ZMW", true, {
        cashPrivateOwner: problem === "private cash" ? other : undefined,
        destinationPrivateOwner: problem === "private destination" ? other : undefined,
        destinationDeleted: problem === "deleted destination", mismatchedRequestedReceipt: problem === "different requested receipt",
      })).toMatchObject({ code: "23514" });
      expect(await committedState()).toEqual(before);
    });

  it.each([["new cash", false], ["new cash", true], ["posted CSV", false], ["posted CSV", true]] as const)("retains confirmed %s settlement evidence (cascade=%s)", async (source, cascade) => {
    await recordBasis();
    let receiptTransactionId: string | undefined;
    if (source === "posted CSV") {
      const imported = await signed(request(app).post(`/api/accounts/${ids.sharedAccount}/transactions/import`)).send({ adjustBalance: true,
        transactions: [{ date, merchant: "Synthetic captured actual principal receipt", amount: "1000.00" }] }).expect(200);
      expect(imported.body.data.imported).toBe(1);
      const [receipt] = await db.select().from(transactions).where(eq(transactions.householdId, a));
      expect(receipt).toMatchObject({ source: "csv_import", postingMode: "posted", postedBalanceDelta: "1000.00" });
      receiptTransactionId = receipt.id;
    }
    const operationId = randomUUID(); await pay(operationId, true, { receiptTransactionId }).expect(200);
    const before = await committedState();
      let failure: unknown;
      try {
        await db.transaction(async tx => {
          if (cascade) await tx.delete(grzBondPayments).where(eq(grzBondPayments.id, principalId));
          else await tx.execute(sql`delete from grz_principal_settlements where operation_id=${operationId}::uuid`);
        });
      } catch (error) { failure = error; }
      let cause = failure, state: unknown;
      for (let depth = 0; depth < 4 && cause && typeof cause === "object"; depth++) {
        if ("code" in cause) state = cause.code;
        cause = "cause" in cause ? cause.cause : undefined;
      }
      expect.soft(state).toBe("23514");
      expect.soft(await committedState()).toEqual(before);
  });

  it("does not treat a history-only CSV capture as proof of received principal cash", async () => {
    await recordBasis();
    const imported = await signed(request(app).post(`/api/accounts/${ids.sharedAccount}/transactions/import`)).send({ adjustBalance: false,
      transactions: [{ date, merchant: "Synthetic history-only principal claim", amount: "1000.00" }] }).expect(200);
    expect(imported.body.data.imported).toBe(1);
    const [receipt] = await db.select().from(transactions).where(eq(transactions.householdId, a));
    expect(receipt).toMatchObject({ source: "csv_import", postingMode: "history_only", postedBalanceDelta: "0.00" });
    const before = await committedState();
    await pay(randomUUID(), true, { receiptTransactionId: receipt.id }).expect(409);
    expect(await committedState()).toEqual(before);
  });

  it("keeps a legacy purchase pending when dirty purchase cash has no attributable principal basis breakdown", async () => {
    const before = await committedState();
    const result = await pay(randomUUID()).expect(202);
    expect(result.body.data.settlement).toMatchObject({ status: "pending", pendingReason: "basis_unavailable" });
    const after = await committedState();
    expect(after.cash).toEqual(before.cash); expect(after.ledger).toEqual(before.ledger); expect(after.investments).toEqual(before.investments);
    expect(after.bond).toEqual(before.bond); expect(after.payment).toEqual(before.payment);
    expect(after.audits.filter(row => row.action === "PROCESS")).toHaveLength(0);
  });

  it.each(["sold", "matured", "rolled_over"] as const)("preserves the legacy inactive principal conflict for a visible %s bond", async status => {
    await db.update(grzBonds).set({ status }).where(eq(grzBonds.id, bondId));
    const before = await committedState();
    await signed(request(app).post(`/api/grz/payments/${principalId}/pay`)).send({ date, accountId: ids.sharedAccount }).expect(409);
    expect(await committedState()).toEqual(before);
  });

  it("withholds the inactive principal state when the custody account is inaccessible", async () => {
    await db.update(grzBonds).set({ status: "sold" }).where(eq(grzBonds.id, bondId));
    await db.update(accounts).set({ isPrivate: true, ownerUserId: null }).where(eq(accounts.id, custodyId));
    const before = await committedState();
    await signed(request(app).post(`/api/grz/payments/${principalId}/pay`)).send({ date, accountId: ids.sharedAccount }).expect(404);
    expect(await committedState()).toEqual(before);
  });

  it("separates dirty acquisition cash 950 into principal basis 900 and purchased interest 50", async () => {
    await recordBasis("900.00", "50.00");
    await pay(randomUUID()).expect(200);
    const saved = await committedState();
    expect(saved.cash.find(row => row.id === ids.sharedAccount)?.balance).toBe("1050.00");
    expect(saved.ledger).toHaveLength(1);
    const process = saved.audits.find(row => row.entityId === principalId && row.action === "PROCESS");
    expect(process?.details).toMatchObject({ settlement: { principalAmount: "1000.00", costBasis: "900.00",
      realizedBasisDifference: "100.00", purchasedInterest: "50.00", acquisitionFees: "0.00", fees: "0.00",
      basisEvidence: { sourceId: basisId, sourceKind: "custodian_statement" } } });
    const flows = await signed(request(app).get(`/api/transactions/summary?startDate=${date}&endDate=${date}`)).expect(200);
    expect(flows.body.data.totalIncome).toEqual({ amount: "0.00", currency });
  });

  it("durably binds the first available acquisition proof while a basis-less operation remains pending for valuation", async () => {
    await signed(request(app).post(`/api/grz/bonds/${bondId}/valuations`)).send({ operationId: randomUUID(), valuationDate: date,
      sourceDate: date, nominalAmount: "1000.00", isin, currency, sourceKind: "custodian_statement", sourceReference: "Synthetic unresolved dirty mark",
      quoteBasis: "dirty", quoteUnits: "holding_amount", quotedAmount: "1080.00", accruedInterest: null }).expect(201);
    const operationId = randomUUID(); await pay(operationId).expect(202);
    await recordBasis(); const firstBasisId = basisId;
    await pay(operationId).expect(202);
    const bound = await db.execute<{ basis_id: string; cost_basis: string }>(sql`select basis_id,cost_basis from grz_principal_settlements
      where operation_id=${operationId}::uuid`);
    expect.soft(bound.rows).toEqual([{ basis_id: firstBasisId, cost_basis: "950.00" }]);
    await recordBasis("900.00", "50.00");
    await pay(operationId).expect(409);
    const saved = await committedState();
    expect(saved.ledger).toHaveLength(0); expect(saved.investments).toHaveLength(0);
    expect(saved.bond[0].status).toBe("active"); expect(saved.payment[0].status).toBe("scheduled");
    expect(saved.cash.find(row => row.id === ids.sharedAccount)?.balance).toBe("50.00");
  });

  it("withholds private custody acquisition and settlement money from the household audit scope", async () => {
    await db.update(accounts).set({ isPrivate: true, ownerUserId: userId }).where(eq(accounts.id, custodyId));
    await recordBasis();
    const operationId = randomUUID(); await pay(operationId).expect(200);
    const audit = await db.execute<{ household_id: string | null; user_id: string }>(sql`select household_id,user_id from audit_logs
      where (entity_id=${principalId}::uuid and action='PROCESS')
        or (details->'newValue'->>'principalBasisId'=${basisId})`);
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows.every(row => row.household_id === null && row.user_id === userId)).toBe(true);
  });

  it("actor-scopes pending and confirmed audit data for an actor-private receipt on shared custody and cash accounts", async () => {
    const created = await signed(request(app).post("/api/transactions")).send({ accountId: ids.sharedAccount, date,
      name: "Synthetic actor-private principal receipt", type: "income", amount: { amount: "1000.00", currency }, idempotencyKey: randomUUID() }).expect(201);
    const receiptId: string = created.body.data.id;
    // The ordinary create endpoint accepts posting fields. Establish the legacy
    // row's privacy independently before exercising the signed settlement API.
    const [privateReceipt] = await db.update(transactions).set({ isPrivate: true, ownerUserId: userId })
      .where(eq(transactions.id, receiptId)).returning();
    expect(privateReceipt).toMatchObject({ isPrivate: true, ownerUserId: userId, accountId: ids.sharedAccount, postingMode: "posted" });
    await signed(request(app).post(`/api/grz/bonds/${bondId}/valuations`)).send({ operationId: randomUUID(), valuationDate: date,
      sourceDate: date, nominalAmount: "1000.00", isin, currency, sourceKind: "custodian_statement", sourceReference: "Synthetic unresolved private-receipt mark",
      quoteBasis: "dirty", quoteUnits: "holding_amount", quotedAmount: "1080.00", accruedInterest: null }).expect(201);
    const operationId = randomUUID(), link = { receiptTransactionId: receiptId };
    await pay(operationId, true, link).expect(202);
    await recordBasis(); await pay(operationId, true, link).expect(202);
    await signed(request(app).post(`/api/grz/bonds/${bondId}/valuations`)).send({ operationId: randomUUID(), valuationDate: date,
      sourceDate: date, nominalAmount: "1000.00", isin, currency, sourceKind: "custodian_statement", sourceReference: "Synthetic reconciled private-receipt mark",
      quoteBasis: "clean", quoteUnits: "holding_amount", quotedAmount: "1000.00", accruedInterest: "0.00" }).expect(201);
    await pay(operationId, true, link).expect(200);
    const audit = await db.execute<{ household_id: string | null; user_id: string; action: string; details: Record<string, unknown> }>(sql`select household_id,user_id,action,details from audit_logs
      where (entity_id=${principalId}::uuid and (action='PROCESS' or details->'newValue'->>'pendingOperationId'=${operationId}))
        or details->>'principalSettlementOperationId'=${operationId}`);
    expect(audit.rows).toHaveLength(4);
    expect(audit.rows.every(row => row.household_id === null && row.user_id === userId)).toBe(true);
    expect(audit.rows.find(row => row.action === "PROCESS")?.details).toMatchObject({ operationId, cashTransactionId: receiptId,
      settlement: { receivedAmount: "1000.00" } });
    const saved = await committedState();
    expect(saved.ledger).toHaveLength(1); expect(saved.ledger[0]).toMatchObject({ id: receiptId, isPrivate: true, type: "asset_settlement" });
    expect(saved.cash.find(row => row.id === ids.sharedAccount)?.balance).toBe("1050.00");
  });

  it("rejects a non-asset principal destination without consuming entitlement or inventing cash", async () => {
    await recordBasis();
    await db.update(accounts).set({ isAsset: false }).where(eq(accounts.id, ids.sharedAccount));
    const before = await committedState();
    await pay(randomUUID()).expect(400);
    expect(await committedState()).toEqual(before);
  });

  it.each(["ZMW asset", "ZMW liability", "USD asset"])("enforces principal destination denomination and class for a restricted writer: %s", async kind => {
    await recordBasis();
    const before = await committedState();
    const failure = await probeSettlementDestination(kind === "ZMW liability" ? debtId : ids.sharedAccount,
      kind === "USD asset" ? "USD" : "ZMW", kind !== "ZMW liability");
    if (kind === "ZMW asset") expect(failure).toBeNull();
    else expect(failure).toMatchObject({ code: "23514" });
    expect(await committedState()).toEqual(before);
  });

  it.each([false, true])("signed account erasure reconciles actual settled principal and surviving membership (survivor=%s)", async survivor => {
    await recordBasis();
    let survivorId: string | undefined, survivorEmail: string | undefined;
    if (survivor) {
      survivorId = randomUUID(); extraUserIds.push(survivorId);
      survivorEmail = `r13-survivor-${survivorId}@example.invalid`;
      await db.insert(users).values({ id: survivorId, email: survivorEmail, username: `r13-survivor-${survivorId}`, passwordHash, emailVerified: true });
      await db.insert(householdMembers).values({ householdId: a, userId: survivorId, role: "owner" });
    }
    const operationId = randomUUID();
    await pay(operationId).expect(200);
    const [maturity] = await db.insert(investmentTransactions).values({ householdId: a, accountId: ids.sharedAccount,
      type: "maturity", amount: "100.00", currency, transactionDate: date }).returning();
    const [bill] = await db.insert(grzTBills).values({ householdId: a, accountId: ids.sharedAccount, tbillName: "Matured bill",
      tenorDays: 91, faceValue: "100", purchasePrice: "98", purchaseDate: "2025-01-01", maturityDate: "2025-04-02",
      maturedDate: "2025-04-02", status: "matured", maturityInvestmentTxId: maturity.id }).returning();
    const step = await signed(request(app).post("/api/settings/security/step-up")).send({ password }).expect(200);
    if (step.headers["set-cookie"]) cookie = (step.headers["set-cookie"] as unknown as string[]).join("; ");
    const before = await committedState();
    expect(before.ledger).toHaveLength(1); expect(before.settlements).toHaveLength(1);
    const cashId = before.ledger[0].id;
    await signed(request(app).post("/api/settings/account/delete")).send({ password }).expect(200);
    const [subject] = await db.select().from(users).where(eq(users.id, userId));
    expect(subject.id).toBe(userId); expect(subject.email).toMatch(/^deleted_.*@deleted\.invalid$/);
    expect(subject.passwordHash).toMatch(/^!erased!/); expect(subject.erasedAt).not.toBeNull();
    expect(await db.select().from(householdMembers).where(eq(householdMembers.userId, userId))).toHaveLength(0);
    await signed(request(app).get("/api/grz/bonds")).expect(401);
    const bills = await db.select().from(grzTBills).where(eq(grzTBills.id, bill.id));
    expect(bills).toEqual(survivor ? [bill] : []);
    if (!survivor) {
      expect(await db.select().from(households).where(eq(households.id, a))).toHaveLength(0);
      const after = await committedState();
      for (const rows of Object.values(after)) expect(rows).toHaveLength(0);
      expect(await db.select().from(grzBondValuations).where(eq(grzBondValuations.householdId, a))).toHaveLength(0);
    } else {
      expect(await db.select().from(households).where(eq(households.id, a))).toHaveLength(1);
      expect(await committedState()).toEqual(before);
      const login = await request(app).post("/api/auth/login").send({ email: survivorEmail, password }).expect(200);
      const survivingCookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
      const retained = await request(app).get(`/api/transactions/${cashId}`).set("Cookie", survivingCookie)
        .set("X-Capital-Subject", survivorId!).set("X-Capital-Household", a).expect(200);
      expect(retained.body.data).toMatchObject({ id: cashId, type: "asset_settlement", amount: { amount: "1000.00", currency } });
    }
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, userId));
    const erasure = audit.filter(row => row.entityType === "user_account" && row.action === "DELETE");
    expect(erasure).toHaveLength(1); expect(erasure[0].householdId).toBeNull();
    expect(erasure[0].details).toMatchObject({ householdDeleted: !survivor });
  });

  it.each([{ principalCost: "NaN" }, { principalCost: "900.00", purchasedInterest: "50.00", acquisitionFees: "5.00" },
    { sourceKind: "synthetic_controlled_valuation" }, { sourceDate: "2099-01-01" }])("rejects unsupported acquisition evidence %j without writing financial facts", async invalid => {
    const before = await committedState();
    await basisRequest(invalid).expect(400);
    expect(await committedState()).toEqual(before);
    expect((await db.execute(sql`select id from grz_bond_principal_basis where household_id=${a}::uuid`)).rows).toHaveLength(0);
  });

  it("records one acquisition breakdown on identical replay and refuses changed principal allocation", async () => {
    const operationId = randomUUID();
    const first = await basisRequest({ operationId }).expect(201);
    const before = await committedState();
    const replay = await basisRequest({ operationId }).expect(200);
    expect(replay.body.data.id).toBe(first.body.data.id);
    await basisRequest({ operationId, principalCost: "900.00", purchasedInterest: "50.00" }).expect(409);
    expect(await committedState()).toEqual(before);
    const rows = await db.execute<{ principal_cost: string; purchased_interest: string }>(sql`select principal_cost,purchased_interest
      from grz_bond_principal_basis where household_id=${a}::uuid`);
    expect(rows.rows).toEqual([{ principal_cost: "950.00", purchased_interest: "0.00" }]);
  });
});
