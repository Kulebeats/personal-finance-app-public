/**
 * R1-05 and the tax-name leak: a GRZ instrument's name and ISIN reach a reader
 * only while that reader can see the instrument's custody account. Real HTTP,
 * real Postgres. The rule runs at read time; stored rows are never rewritten.
 *
 * - Tax (ZRA export, JSON and CSV): a T-bill's name was joined in with no custody
 *   check, so a peer who sees only the destination read the name of a bill held
 *   privately all along, on the A-36 path and on bills matured before A-36.
 *   A withheld name reads "GRZ T-Bill".
 * - Investment activity: the sale and maturity notes keep the name they were
 *   written with; a viewer who cannot see custody gets the generic label.
 * - Ledger: the T-bill interest name follows the coupon rule (custody shared),
 *   so the private custody's owner also sees the generic name there.
 * - Other cash-row readers (F1): the account CSV export, the tag page, the import
 *   preview's duplicate candidates and merchant activity apply the same ledger rule.
 * Peer = member; the owner holds every private account here.
 * Amounts are synthetic fixtures, not tax claims (OI-03).
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { accounts, grzTBills, investmentTransactions, merchants, transactions, transactionTags } from "@shared/schema";
import { db } from "../../db";
import { processTBillMaturities } from "../../services/investment/processTBillMaturities";
import { a, b, actors, app, ids, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";
import { eraseSaleHouseholds, freshSaleHouseholds } from "./grz-sale-household.fixture";

const year = new Date().getUTCFullYear() - 1;
const maturity = `${year}-12-31`, receiptDate = `${year + 1}-01-05`;
const BILL = "R13_IDENTITY_BILL", BOND = "R13_IDENTITY_BOND", ISIN = "ZM0000000077";
const custody = randomUUID();
const send = (method: "get" | "post" | "put", path: string, role: Role = "owner") => request(app)[method](path)
  .set("Cookie", actors.get(role)!.cookie).set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);

const activity = async (role: Role) => (await send("get", "/api/investments/transactions", role).expect(200)).text;
const ledger = async (role: Role) => (await send("get", "/api/transactions?limit=100", role).expect(200)).text;
const zra = async (role: Role) => (await send("get", `/api/investments/tax/zra-export?year=${year}&format=json`, role).expect(200))
  .body as { type: string; security: string; netAmount: string }[];
const zraCsv = async (role: Role) => (await send("get", `/api/investments/tax/zra-export?year=${year}`, role).expect(200)).text;
const interestRow = async (role: Role) => (await zra(role)).find(row => row.type === "interest");
const makePrivate = (accountId: string) => db.update(accounts).set({ isPrivate: true, ownerUserId: actors.get("owner")!.id })
  .where(eq(accounts.id, accountId));

async function fresh() {
  await db.delete(grzTBills).where(inArray(grzTBills.householdId, [a, b]));
  await freshSaleHouseholds();
  await db.insert(accounts).values({ id: custody, householdId: a, name: "R13 CUSTODY", type: "savings", currency: "ZMW",
    initialBalance: "0.00", balance: "0.00", isPrivate: false, ownerUserId: actors.get("owner")!.id });
}

/** Face 10000.00, bought at 8000.00: withholding 300.00, proceeds 9700.00, interest 1700.00. */
async function confirmedBill(custodyAccount: string) {
  const id = randomUUID();
  await db.insert(grzTBills).values({ id, householdId: a, accountId: custodyAccount, tbillName: BILL, tenorDays: 364,
    faceValue: "10000.00", purchasePrice: "8000.00", purchaseDate: `${year - 1}-12-31`, maturityDate: maturity, status: "active" });
  await processTBillMaturities();
  await send("post", `/api/grz/tbills/${id}/confirm-receipt`).send({ operationId: randomUUID(), accountId: ids.sharedAccount,
    date: receiptDate, receiptConfirmed: true, receivedAmount: { amount: "9700.00", currency: "ZMW" } }).expect(200);
  return id;
}

/** A bill matured before A-36: auto-posted income and payout rows that carry the name, no settlement cash. */
async function legacyMaturedBill(custodyAccount: string, merchantId: string | null = null) {
  const id = randomUUID(), incomeId = randomUUID();
  await db.insert(transactions).values({ id: incomeId, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id,
    name: `T-Bill: ${BILL} interest`, type: "income", amount: "1700.00", currency: "ZMW", date: maturity, merchantId });
  const [payout] = await db.insert(investmentTransactions).values({ householdId: a, accountId: ids.sharedAccount, type: "maturity",
    quantity: "1", price: "10000.00", amount: "9700.00", currency: "ZMW", withholdingTax: "300.00", transactionDate: maturity,
    notes: `Maturity Payout: T-Bill: ${BILL}` }).returning();
  await db.insert(grzTBills).values({ id, householdId: a, accountId: custodyAccount, tbillName: BILL, tenorDays: 364,
    faceValue: "10000.00", purchasePrice: "8000.00", purchaseDate: `${year - 1}-12-31`, maturityDate: maturity, status: "matured",
    maturedDate: maturity, maturityInvestmentTxId: payout.id, maturityIncomeTxId: incomeId });
  return { id, incomeId };
}

/** The interest row as four more readers return it: account CSV, tag page, import candidates, merchant activity. */
async function cashReaders(role: Role, merchantId: string) {
  const exported = await send("get", `/api/accounts/${ids.sharedAccount}/transactions/export`, role).expect(200);
  const tagged = await send("get", `/api/tags/${ids.tag}/transactions`, role).expect(200);
  const preview = await send("post", "/api/import/preview", role).send({ targetAccountId: ids.sharedAccount,
    strategy: "prioritize_coppercoin", mapping: { date: "Date", amount: "Amount", merchant: "Merchant" }, categoryMapping: {},
    dateFormat: "auto", rows: [{ Date: maturity, Amount: "1700.00", Merchant: "Synthetic statement credit" }] }).expect(200);
  const byMerchant = await send("get", `/api/merchants/${merchantId}/transactions?limit=100`, role).expect(200);
  return { exported: exported.text, tagged: tagged.text, preview: preview.text, byMerchant: byMerchant.text };
}

async function taggedLegacyInterest(custodyAccount: string) {
  const [merchant] = await db.insert(merchants).values({ householdId: a, name: "R13 GRZ MERCHANT" }).returning();
  const { incomeId } = await legacyMaturedBill(custodyAccount, merchant.id);
  await db.insert(transactionTags).values({ transactionId: incomeId, tagId: ids.tag });
  return merchant.id;
}

const zmw = (amount: string) => ({ amount, currency: "ZMW" });
function expectWithheld(text: string) { for (const identity of [BILL, BOND, ISIN]) expect(text).not.toContain(identity); }

describe("R1-05 GRZ instrument identity follows the viewer's view of custody, at read time", () => {
  beforeAll(start, 30_000);
  beforeEach(fresh);
  afterAll(async () => { await db.delete(grzTBills).where(inArray(grzTBills.householdId, [a, b])); await eraseSaleHouseholds(); await stop(); });

  it("withholds a privately held T-bill's name from a peer's tax export, and still shows it to the owner", async () => {
    await confirmedBill(ids.privateAccount);
    expect(await interestRow("member")).toMatchObject({ security: "GRZ T-Bill", netAmount: "1700.00" });
    const csv = await zraCsv("member");
    expect(csv).toContain("GRZ T-Bill"); expectWithheld(csv);
    expect(await interestRow("owner")).toMatchObject({ security: BILL, netAmount: "1700.00" });
    expect(await zraCsv("owner")).toContain(BILL);
    expectWithheld(await activity("member")); expectWithheld(await ledger("member"));
  });

  it("withholds the name of a privately held bill matured before A-36, in tax, activity and ledger", async () => {
    await legacyMaturedBill(ids.privateAccount);
    expect(await interestRow("member")).toMatchObject({ security: "GRZ T-Bill", netAmount: "1700.00" });
    expectWithheld(await zraCsv("member"));
    const seen = await activity("member");
    expect(seen).toContain("Maturity Payout: T-Bill"); expectWithheld(seen);
    const cash = await ledger("member");
    expect(cash).toContain("T-Bill interest"); expectWithheld(cash);
    // The owner sees custody: the name in tax and activity. The ledger follows the coupon rule.
    expect(await interestRow("owner")).toMatchObject({ security: BILL });
    expect(await activity("owner")).toContain(`Maturity Payout: T-Bill: ${BILL}`);
    expectWithheld(await ledger("owner"));
    // Nothing stored is rewritten.
    const [stored] = await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a));
    expect(stored.notes).toBe(`Maturity Payout: T-Bill: ${BILL}`);
  });

  it("names a shared bill to every reader, then withholds it from the peer once custody becomes private", async () => {
    await confirmedBill(custody);
    expect(await interestRow("member")).toMatchObject({ security: BILL });
    expect(await activity("member")).toContain(`Maturity Payout: T-Bill: ${BILL}`);
    expect(await ledger("member")).toContain(`T-Bill: ${BILL} interest`);

    await makePrivate(custody);
    expect(await interestRow("member")).toMatchObject({ security: "GRZ T-Bill" });
    expectWithheld(await activity("member")); expectWithheld(await ledger("member"));
    expect(await interestRow("owner")).toMatchObject({ security: BILL });
    expect(await activity("owner")).toContain(`Maturity Payout: T-Bill: ${BILL}`);
    expectWithheld(await ledger("owner"));
    const stored = await db.select().from(transactions).where(eq(transactions.householdId, a));
    expect(stored.map(row => row.name)).toContain(`T-Bill: ${BILL} interest`);
  });

  it("withholds a sold bond's name and ISIN from the peer once its custody becomes private", async () => {
    const created = await send("post", "/api/grz/bonds").send({ accountId: custody, isin: ISIN, bondName: BOND, tenorYears: 2,
      faceValue: "1000.00", purchasePrice: "950.00", couponRate: "0.0800", couponFrequency: 2, purchaseDate: "2025-06-30",
      firstCouponDate: "2025-12-31", maturityDate: "2027-12-31" }).expect(201);
    await send("put", `/api/grz/bonds/${created.body.data.id}/sell`).send({ soldDate: "2026-08-15", soldPrice: "980.50", fees: "5.25",
      accountId: ids.sharedAccount }).expect(200);
    expect(await activity("member")).toContain(`GRZ Bond Sale: ${BOND} (${ISIN})`);

    await makePrivate(custody);
    const seen = await activity("member");
    expect(seen).toContain("GRZ Bond Sale"); expectWithheld(seen);
    expect(await activity("owner")).toContain(`GRZ Bond Sale: ${BOND} (${ISIN})`);
  });

  it("F1: the account CSV, tag page, import candidates and merchant activity withhold a privately held bill's name", async () => {
    const merchantId = await taggedLegacyInterest(ids.privateAccount);
    // The ledger rule (custody shared) holds for the peer and for the custody's owner alike.
    for (const role of ["member", "owner"] as const) {
      const seen = await cashReaders(role, merchantId);
      for (const [reader, text] of Object.entries(seen)) {
        expect.soft(text, `${role} ${reader}`).toContain("T-Bill interest");
        expect.soft(text, `${role} ${reader}`).not.toContain(BILL);
      }
    }
  });

  it("F1: the same readers still name a bill whose custody is shared", async () => {
    const merchantId = await taggedLegacyInterest(custody);
    for (const [reader, text] of Object.entries(await cashReaders("member", merchantId))) {
      expect.soft(text, `member ${reader}`).toContain(`T-Bill: ${BILL} interest`);
    }
  });

  // NEW-33: the pay route checks its id like the guarded money routers.
  it("NEW-33: answers 400 for a malformed payment id and 404 for an unknown one", async () => {
    const malformed = await send("post", "/api/grz/payments/not-a-uuid/pay").send({ accountId: ids.sharedAccount });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toMatchObject({ code: "VALIDATION_ERROR" });
    await send("post", `/api/grz/payments/${randomUUID()}/pay`).send({ accountId: ids.sharedAccount }).expect(404);
  });

  // F4: the body's account id is checked before any lookup, and pension ids are checked like the others.
  it("NEW-33: answers 400 for a malformed account id in the pay body and for a malformed pension id", async () => {
    const body = await send("post", `/api/grz/payments/${randomUUID()}/pay`).send({ accountId: "not-a-uuid" });
    expect.soft(body.status).toBe(400);
    expect.soft(body.body.error).toMatchObject({ code: "VALIDATION_ERROR" });
    const history = await send("get", "/api/investments/pension/not-a-uuid/contributions");
    expect.soft(history.status).toBe(400);
    expect.soft(history.body.error).toMatchObject({ code: "VALIDATION_ERROR" });
    const contribute = await send("post", "/api/investments/pension/not-a-uuid/contributions").send({ date: "2026-11-01",
      employeeContribution: zmw("100.00"), employerContribution: zmw("50.00"), totalContribution: zmw("150.00") });
    expect.soft(contribute.status).toBe(400);
    expect.soft(contribute.body.error).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
