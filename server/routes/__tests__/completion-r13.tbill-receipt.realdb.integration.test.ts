/**
 * A-36: a T-bill's principal returns to cash only when the member confirms the
 * bank credit. Real Postgres, the real maturity scheduler and the signed HTTP
 * confirm route.
 *
 * - At maturity the scheduler books the withholding once (A-41) and moves the
 *   bill to awaiting_receipt. It posts nothing, and the bill stays in net worth
 *   at face less withholding.
 * - Confirmation moves exactly that amount to the settlement account, as the
 *   principal (asset_settlement) plus net interest (income), once. A retry posts
 *   nothing and a second confirmation is refused.
 * - Net worth is unchanged by the confirmation. Across maturity it moves only by
 *   the withholding, because an active bill is carried at face.
 * Amounts are synthetic fixtures, not tax claims (OI-03).
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { accounts, auditLogs, grzTBills, investmentTransactions, transactions } from "@shared/schema";
import { db, pool } from "../../db";
import { processTBillMaturities } from "../../services/investment/processTBillMaturities";
import { tbillMaturityIncomeKey } from "../../services/investment/investmentCronKeys";
import { isPostgresError } from "../../utils/postgresError";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";

const year = new Date().getUTCFullYear() - 1;
const maturity = `${year}-12-31`, receiptDate = `${year + 1}-01-05`;
const name = "R13_TBILL_RECEIPT";
const headers = (req: request.Test, role: Role) => req.set("Cookie", actors.get(role)!.cookie)
  .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);
const get = (path: string, role: Role = "owner") => headers(request(app).get(path), role);
const confirm = (billId: string, body: Record<string, unknown>, role: Role = "owner") =>
  headers(request(app).post(`/api/grz/tbills/${billId}/confirm-receipt`), role).send(body);
const receipt = (amount: string, overrides: Record<string, unknown> = {}) => ({ operationId: randomUUID(), accountId: ids.sharedAccount,
  date: receiptDate, receiptConfirmed: true, receivedAmount: { amount, currency: "ZMW" }, ...overrides });

async function clean() {
  await db.delete(grzTBills).where(inArray(grzTBills.householdId, [a, b]));
  await db.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b]));
}
async function bill(faceValue: string, purchasePrice: string, accountId: string | null = ids.sharedAccount) {
  const id = randomUUID();
  await db.insert(grzTBills).values({ id, householdId: a, accountId, tbillName: name, tenorDays: 364, faceValue, purchasePrice,
    purchaseDate: `${year - 1}-12-31`, maturityDate: maturity, status: "active" });
  return id;
}
const row = async (id: string) => (await db.select().from(grzTBills).where(eq(grzTBills.id, id)))[0];
const balance = async (id = ids.sharedAccount) => (await db.select().from(accounts).where(eq(accounts.id, id)))[0].balance;
const ledger = () => db.select().from(transactions).where(eq(transactions.householdId, a)).orderBy(transactions.id);
/** What a T-bill confirmation posts; the fixture itself holds only expenses. */
const posted = async () => (await ledger()).filter(entry => entry.type === "asset_settlement" || entry.type === "income");
const refused = (query: PromiseLike<unknown>) => expect((async () => { await query; })()).rejects.toThrow();
const payouts = () => db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a));
const netWorth = async (): Promise<number> => (await get("/api/accounts/summary").expect(200)).body.data.netWorth;
const tbillsValue = async () => (await get("/api/investments/portfolio/summary?currency=ZMW").expect(200)).body.data.tbillsValue;
const taxSummary = async () => (await get(`/api/investments/tax/summary?year=${year}`).expect(200)).body;

describe("A-36 T-bill principal returns to cash on confirmed receipt", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clean(); await reset();
    await db.update(accounts).set({ type: "investment" }).where(eq(accounts.id, ids.sharedAccount));
  });
  afterAll(async () => { await clean(); await stop(); });

  it("holds a due discount bill at face less withholding, then moves exactly that to cash once", async () => {
    const id = await bill("10000.00", "8000.00");
    const before = await netWorth();
    expect(await tbillsValue()).toEqual({ amount: "10000.00", currency: "ZMW" });

    // Maturity: withholding 15% of 2000.00 = 300.00, booked once. Nothing is credited.
    expect((await processTBillMaturities()).errors.filter(failure => failure.billId === id)).toEqual([]);
    expect(await row(id)).toMatchObject({ status: "awaiting_receipt", maturedDate: maturity,
      maturityWithholdingTax: "300.00", maturityNetProceeds: "9700.00", settlementCashTransactionId: null });
    expect(await posted()).toEqual([]);
    expect(await payouts()).toEqual([]);
    expect(await balance()).toBe("988.89");
    expect(await tbillsValue()).toEqual({ amount: "9700.00", currency: "ZMW" });
    const due = await netWorth();
    expect(due).toBeCloseTo(before - 300, 2);
    // The tax year already reports the booked interest, in the maturity year.
    expect(await taxSummary()).toMatchObject({ interestIncome: "2000.00", totalWht: "300.00", netIncome: "1700.00" });

    const body = receipt("9700.00");
    const confirmed = await confirm(id, body).expect(200);
    expect(confirmed.body.data).toMatchObject({ id, status: "matured", settlementReceiptDate: receiptDate,
      maturityNetProceeds: { amount: "9700.00", currency: "ZMW" } });
    const settled = await row(id);
    const [cash] = await db.select().from(transactions).where(eq(transactions.id, settled.settlementCashTransactionId!));
    expect(cash).toMatchObject({ type: "asset_settlement", amount: "8000.00", accountId: ids.sharedAccount, date: receiptDate, currency: "ZMW" });
    const [income] = await db.select().from(transactions).where(eq(transactions.id, settled.maturityIncomeTxId!));
    expect(income).toMatchObject({ type: "income", amount: "1700.00", accountId: ids.sharedAccount, date: receiptDate });
    const [payout] = await db.select().from(investmentTransactions).where(eq(investmentTransactions.id, settled.maturityInvestmentTxId!));
    expect(payout).toMatchObject({ type: "maturity", amount: "9700.00", withholdingTax: "300.00", linkedTransactionId: cash.id,
      transactionDate: maturity });
    // Principal + net interest = face - withholding, credited once.
    expect(await balance()).toBe("10688.89");
    expect(await tbillsValue()).toEqual({ amount: "0.00", currency: "ZMW" });
    expect(await netWorth()).toBeCloseTo(due, 2);
    expect(await taxSummary()).toMatchObject({ interestIncome: "2000.00", totalWht: "300.00", netIncome: "1700.00" });
    const audit = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "grz_tbill"), eq(auditLogs.entityId, id),
      eq(auditLogs.action, "PROCESS")));
    expect(audit.map(entry => entry.userId)).toEqual(expect.arrayContaining([null, actors.get("owner")!.id]));
    expect((await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "transaction"), eq(auditLogs.entityId, cash.id))))).toHaveLength(1);

    // A retry of the same confirmation posts nothing; anything else is refused.
    const settledLedger = await ledger();
    await confirm(id, body).expect(200);
    await confirm(id, receipt("9700.00")).expect(409);
    await confirm(id, { ...body, date: `${year + 1}-01-06` }).expect(409);
    expect(await ledger()).toEqual(settledLedger);
    expect(await payouts()).toHaveLength(1);
    expect(await balance()).toBe("10688.89");
  });

  it("credits a bill bought at face as principal only, with no interest row, conserving net worth", async () => {
    const id = await bill("5000.00", "5000.00");
    const before = await netWorth();
    await processTBillMaturities();
    expect(await row(id)).toMatchObject({ status: "awaiting_receipt", maturityWithholdingTax: "0.00", maturityNetProceeds: "5000.00" });
    expect(await netWorth()).toBeCloseTo(before, 2);
    await confirm(id, receipt("5000.00")).expect(200);
    const settled = await row(id);
    expect(settled).toMatchObject({ status: "matured", maturityIncomeTxId: null });
    const [cash] = await db.select().from(transactions).where(eq(transactions.id, settled.settlementCashTransactionId!));
    expect(cash).toMatchObject({ type: "asset_settlement", amount: "5000.00" });
    expect((await posted()).map(entry => entry.type)).toEqual(["asset_settlement"]);
    expect(await balance()).toBe("5988.89");
    expect(await netWorth()).toBeCloseTo(before, 2);
  });

  it("A-41: confirms a half-cent withholding as 99.90 principal and 0.08 interest, accepted by the tax summary", async () => {
    const id = await bill("100.00", "99.90");
    await processTBillMaturities();
    expect(await row(id)).toMatchObject({ maturityWithholdingTax: "0.02", maturityNetProceeds: "99.98" });
    await confirm(id, receipt("99.98")).expect(200);
    const settled = await row(id);
    const [cash] = await db.select().from(transactions).where(eq(transactions.id, settled.settlementCashTransactionId!));
    const [income] = await db.select().from(transactions).where(eq(transactions.id, settled.maturityIncomeTxId!));
    expect([cash.amount, income.amount]).toEqual(["99.90", "0.08"]);
    expect(await taxSummary()).toMatchObject({ interestIncome: "0.10", totalWht: "0.02", netIncome: "0.08" });
  });

  it("refuses a receipt that differs from face less withholding, and posts nothing", async () => {
    const id = await bill("10000.00", "8000.00");
    await processTBillMaturities();
    await confirm(id, receipt("9699.99")).expect(400);
    await confirm(id, receipt("9700.00", { receiptConfirmed: false })).expect(400);
    await confirm(id, receipt("9700.00", { date: `${year}-12-30` })).expect(400);
    expect(await row(id)).toMatchObject({ status: "awaiting_receipt", settlementOperationId: null });
    expect(await posted()).toEqual([]);
    expect(await balance()).toBe("988.89");
  });

  // R1-07: only an operation-id replay is reported as a confirmation conflict.
  // Another row holding the interest key is a different clash, and nothing posts.
  it("R1-07: names a clash on the interest key instead of claiming the receipt is already confirmed", async () => {
    const id = await bill("10000.00", "8000.00");
    await processTBillMaturities();
    const squatter = randomUUID();
    await db.insert(transactions).values({ id: squatter, householdId: a, accountId: ids.sharedAccount, name: "R13_TBILL_KEY_CLASH",
      type: "expense", amount: "1.00", currency: "ZMW", date: receiptDate, idempotencyKey: tbillMaturityIncomeKey(id) });
    try {
      const response = await confirm(id, receipt("9700.00")).expect(409);
      expect(response.body.error.message).not.toBe("This T-bill's receipt is already confirmed");
      expect(response.body.error.message).toBe("This T-bill's interest is already recorded by another transaction. Nothing was posted.");
      expect(await row(id)).toMatchObject({ status: "awaiting_receipt", settlementOperationId: null });
      expect(await posted()).toEqual([]);
      expect(await balance()).toBe("988.89");
    } finally {
      await db.delete(transactions).where(eq(transactions.id, squatter));
    }
  });

  it("refuses to confirm a bill that is not yet due", async () => {
    const id = await bill("10000.00", "8000.00");
    await confirm(id, receipt("9700.00")).expect(409);
    expect(await row(id)).toMatchObject({ status: "active" });
    expect(await posted()).toEqual([]);
  });

  it("settles a bill recorded before A-42 with no account into the account the confirmation names", async () => {
    const id = await bill("10000.00", "8000.00", null);
    await processTBillMaturities();
    expect(await row(id)).toMatchObject({ status: "awaiting_receipt", accountId: null });
    await confirm(id, receipt("9700.00")).expect(200);
    const settled = await row(id);
    const [cash] = await db.select().from(transactions).where(eq(transactions.id, settled.settlementCashTransactionId!));
    expect(cash).toMatchObject({ accountId: ids.sharedAccount, amount: "8000.00" });
    expect(await balance()).toBe("10688.89");
  });

  it("keeps another member's privately held bill unconfirmable and unnamed to peers", async () => {
    const id = await bill("10000.00", "8000.00", ids.privateAccount);
    await processTBillMaturities();
    await confirm(id, receipt("9700.00"), "member").expect(404);
    await confirm(id, receipt("9700.00"), "view_only").expect(403);
    expect(await row(id)).toMatchObject({ status: "awaiting_receipt" });
    // The holder settles into a shared account; the shared rows do not name the bill.
    await confirm(id, receipt("9700.00")).expect(200);
    const activity = (await get("/api/investments/transactions", "member").expect(200)).text;
    expect(activity).not.toContain(name);
    expect((await ledger()).filter(entry => entry.name.includes(name))).toEqual([]);
  });

  it("serialises concurrent confirmations of one operation into a single posting", async () => {
    const id = await bill("10000.00", "8000.00");
    await processTBillMaturities();
    const body = receipt("9700.00");
    const results = await Promise.all(Array.from({ length: 5 }, () => confirm(id, body)));
    expect(results.map(result => result.status)).toEqual([200, 200, 200, 200, 200]);
    expect((await posted()).filter(entry => entry.type === "asset_settlement")).toHaveLength(1);
    expect(await payouts()).toHaveLength(1);
    expect(await balance()).toBe("10688.89");
  });

  it("binds T-bill settlement cash at the database: unbound cash and edits to settled cash are refused", async () => {
    await refused(db.insert(transactions).values({ householdId: a, accountId: ids.sharedAccount, name: "Forged settlement",
      type: "asset_settlement", amount: "8000.00", currency: "ZMW", date: receiptDate }));
    const id = await bill("10000.00", "8000.00");
    await processTBillMaturities();
    await confirm(id, receipt("9700.00")).expect(200);
    const cashId = (await row(id)).settlementCashTransactionId!;
    await refused(db.update(transactions).set({ amount: "9000.00" }).where(eq(transactions.id, cashId)));
    await refused(db.delete(transactions).where(eq(transactions.id, cashId)));
    expect((await db.select().from(transactions).where(eq(transactions.id, cashId)))[0].amount).toBe("8000.00");
  });

  it("keeps confirmed interest cash, receipt replay and balances intact after signed mutations", async () => {
    const id = await bill("10000.00", "8000.00");
    await processTBillMaturities();
    const body = receipt("9700.00");
    const initialReceipt = (await confirm(id, body).expect(200)).body.data;
    const settledBill = await row(id);
    const interestId = settledBill.maturityIncomeTxId!;
    const path = `/api/transactions/${interestId}`;
    const original = { ledger: await ledger(), payouts: await payouts(), balance: await balance(), tax: await taxSummary() };

    for (const change of [{ amount: { amount: "1800.00", currency: "ZMW" } }, { date: `${year + 1}-01-06` }, { type: "expense" }]) {
      const edit = await headers(request(app).put(path), "owner").send(change).expect(409);
      expect(edit.body.error.message).toBe("Confirmed T-bill interest is locked");
    }
    await headers(request(app).delete(path), "owner").expect(409);

    for (const change of [
      db.update(transactions).set({ amount: "1800.00" }).where(eq(transactions.id, interestId)),
      db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, interestId)),
      db.delete(transactions).where(eq(transactions.id, interestId)),
    ]) {
      const error: unknown = await Promise.resolve(change).then(() => null, failure => failure);
      expect(isPostgresError(error, "23514", "grz_tbill_interest_immutable")).toBe(true);
    }

    const role = `r13_interest_writer_${randomUUID().replace(/-/g, "")}`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE ROLE "${role}" NOLOGIN NOINHERIT`);
      await client.query(`GRANT "${role}" TO CURRENT_USER`);
      await client.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
      await client.query(`GRANT SELECT, UPDATE(amount) ON public.transactions TO "${role}"`);
      await client.query(`GRANT SELECT ON public.transaction_create_owner_intents TO "${role}"`);
      await client.query(`SET LOCAL ROLE "${role}"`);
      const rights = await client.query(`select current_user as role,
        has_any_column_privilege(current_user,'public.grz_tbills','SELECT') as can_read_tbills,
        has_function_privilege(current_user,'public.guard_grz_tbill_interest_mutation()','EXECUTE') as can_execute_interest,
        has_function_privilege(current_user,'public.guard_grz_principal_cash_mutation()','EXECUTE') as can_execute_principal,
        has_function_privilege(current_user,'public.check_grz_principal_settlement_binding()','EXECUTE') as can_execute_binding`);
      expect(rights.rows).toEqual([{ role, can_read_tbills: false, can_execute_interest: false,
        can_execute_principal: false, can_execute_binding: false }]);
      await expect(client.query("update public.transactions set amount=1800 where id=$1", [interestId]))
        .rejects.toMatchObject({ code: "23514", constraint: "grz_tbill_interest_immutable" });
    } finally {
      try { await client.query("ROLLBACK"); } finally { client.release(); }
    }

    expect((await confirm(id, body).expect(200)).body.data).toEqual(initialReceipt);
    expect(await row(id)).toEqual(settledBill);
    expect({ ledger: await ledger(), payouts: await payouts(), balance: await balance(), tax: await taxSummary() }).toEqual(original);
  });

  it("allows an ordinary income edit when the transaction is linked only by a legacy bill", async () => {
    const income = (await headers(request(app).post("/api/transactions"), "owner").send({
      name: "Legacy interest", type: "income", accountId: ids.sharedAccount, date: receiptDate,
      amount: { amount: "100.00", currency: "ZMW" },
    }).expect(201)).body.data;
    const id = await bill("1000.00", "900.00");
    await db.update(grzTBills).set({ status: "matured", maturityIncomeTxId: income.id }).where(eq(grzTBills.id, id));

    await headers(request(app).put(`/api/transactions/${income.id}`), "owner")
      .send({ amount: { amount: "125.00", currency: "ZMW" } }).expect(200);
    expect((await db.select().from(transactions).where(eq(transactions.id, income.id)))[0].amount).toBe("125.00");
  });
});
