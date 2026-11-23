/**
 * R1-05 follow-up: the text on GRZ cash rows reaches a reader only while the
 * instrument's custody account is shared. Real HTTP, real Postgres.
 *
 * - T-bill interest notes carry the bill's terms ("Face …, purchase …, WHT …",
 *   tbillSettlement.ts). Read through the ledger rule like coupon notes: withheld
 *   unless custody is shared. Written neutral when custody is private at receipt.
 * - Thandi's recent-transactions and search tools return the ledger's name, and
 *   search matches that name, so a guessed instrument name finds nothing.
 * - The personal data export (A-27 archive) carries the ledger's name and notes.
 * Peer = member; the owner holds every private account here. The ledger rule is
 * custody-based, so the private custody's owner reads the withheld form too.
 * Amounts are synthetic fixtures, not tax claims (OI-03).
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { accounts, dataExports, grzTBills, investmentTransactions, transactions } from "@shared/schema";
import { AIAnalyticsService } from "../../modules/ai/ai.analytics.service";
import { db } from "../../db";
import { processTBillMaturities } from "../../services/investment/processTBillMaturities";
import { a, b, actors, app, ids, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";
import { eraseSaleHouseholds, freshSaleHouseholds } from "./grz-sale-household.fixture";
import { PERSONAL_EXPORT_JSON_ENTRY } from "@shared/personal-data-export";
import { readStoredZip } from "../../modules/settings/__tests__/personal-export-archive-reader";

const year = new Date().getUTCFullYear() - 1;
const maturity = `${year}-12-31`, receiptDate = `${year + 1}-01-05`;
const BILL = "R13_CASH_TEXT_BILL";
/** Face 10000.00, bought at 8000.00: withholding 300.00, interest 1700.00. */
const TERMS = "Face 10000.00";
const custody = randomUUID();
const send = (method: "get" | "post", path: string, role: Role = "owner") => request(app)[method](path)
  .set("Cookie", actors.get(role)!.cookie).set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);
const makePrivate = (accountId: string) => db.update(accounts).set({ isPrivate: true, ownerUserId: actors.get("owner")!.id })
  .where(eq(accounts.id, accountId));

/** The interest row's notes as the ledger list and the account CSV export return them. */
async function interestNotes(role: Role) {
  const list = await send("get", "/api/transactions?limit=100", role).expect(200);
  const rows = list.body.data as Array<{ type: string; notes: string | null }>;
  const exported = await send("get", `/api/accounts/${ids.sharedAccount}/transactions/export`, role).expect(200);
  return { list: rows.filter(row => row.type === "income").map(row => row.notes ?? ""), exported: exported.text };
}

async function fresh() {
  await db.delete(grzTBills).where(inArray(grzTBills.householdId, [a, b]));
  await freshSaleHouseholds();
  await db.insert(accounts).values({ id: custody, householdId: a, name: "R13 TEXT CUSTODY", type: "savings", currency: "ZMW",
    initialBalance: "0.00", balance: "0.00", isPrivate: false, ownerUserId: actors.get("owner")!.id });
}

async function confirmedBill(custodyAccount: string) {
  const id = randomUUID();
  await db.insert(grzTBills).values({ id, householdId: a, accountId: custodyAccount, tbillName: BILL, tenorDays: 364,
    faceValue: "10000.00", purchasePrice: "8000.00", purchaseDate: `${year - 1}-12-31`, maturityDate: maturity, status: "active" });
  await processTBillMaturities();
  await send("post", `/api/grz/tbills/${id}/confirm-receipt`).send({ operationId: randomUUID(), accountId: ids.sharedAccount,
    date: receiptDate, receiptConfirmed: true, receivedAmount: { amount: "9700.00", currency: "ZMW" } }).expect(200);
  return id;
}

/** A bill matured before A-36: its interest row carries the name whatever the custody. */
async function legacyMaturedBill(custodyAccount: string) {
  const incomeId = randomUUID();
  await db.insert(transactions).values({ id: incomeId, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id,
    name: `T-Bill Interest: ${BILL}`, type: "income", amount: "1700.00", currency: "ZMW", date: maturity });
  const [payout] = await db.insert(investmentTransactions).values({ householdId: a, accountId: ids.sharedAccount, type: "maturity",
    quantity: "1", price: "10000.00", amount: "9700.00", currency: "ZMW", withholdingTax: "300.00", transactionDate: maturity,
    notes: `Maturity Payout: ${BILL}` }).returning();
  await db.insert(grzTBills).values({ householdId: a, accountId: custodyAccount, tbillName: BILL, tenorDays: 364,
    faceValue: "10000.00", purchasePrice: "8000.00", purchaseDate: `${year - 1}-12-31`, maturityDate: maturity, status: "matured",
    maturedDate: maturity, maturityInvestmentTxId: payout.id, maturityIncomeTxId: incomeId });
}

const thandi = new AIAnalyticsService();
function thandiContext(role: Role) {
  const userId = actors.get(role)!.id;
  return { userId, householdId: a, currency: "ZMW", actor: { householdId: a, userId, role } };
}
/** What Thandi's recent and search tools hand the model, and whether a guessed name finds the row. */
async function thandiSees(role: Role) {
  const recent = await thandi.getRecentTransactions(thandiContext(role), 20);
  const guessed = await thandi.searchTransactions(thandiContext(role), { text: BILL });
  const generic = await thandi.searchTransactions(thandiContext(role), { text: "T-Bill interest" });
  return { recent: JSON.stringify(recent), guessed: guessed.length, generic: JSON.stringify(generic) };
}

/** The requester's personal export: the whole archive as text (stored ZIP) and its transactions section. */
async function personalExport(role: Role) {
  await send("post", "/api/settings/security/step-up", role).send({ password: "SyntheticR04Tags123!" }).expect(200);
  const created = await send("post", "/api/settings/privacy/export", role).send({}).expect(201);
  const file = await send("get", `/api/settings/privacy/exports/${created.body.data.id}/download`, role).buffer(true)
    .parse((res, done) => { const chunks: Buffer[] = []; res.on("data", (c: Buffer) => chunks.push(c)); res.on("end", () => done(null, Buffer.concat(chunks))); })
    .expect(200);
  const bytes = file.body as Buffer;
  const document = JSON.parse(readStoredZip(bytes).get(PERSONAL_EXPORT_JSON_ENTRY)!.data.toString("utf8"));
  return { archive: bytes.toString("utf8"), transactions: JSON.stringify(document.transactions) };
}

const storedInterest = async () => (await db.select().from(transactions)
  .where(and(eq(transactions.householdId, a), eq(transactions.type, "income"))));

describe("R1-05 follow-up: GRZ cash-row text follows custody", () => {
  beforeAll(start, 30_000);
  beforeEach(fresh);
  afterAll(async () => {
    await db.delete(dataExports).where(inArray(dataExports.userId, [...actors.values()].map(actor => actor.id)));
    await db.delete(grzTBills).where(inArray(grzTBills.householdId, [a, b])); await eraseSaleHouseholds(); await stop(); });

  it("withholds a T-bill's terms from the interest notes once its custody becomes private", async () => {
    await confirmedBill(custody);
    // Shared custody: every reader sees the terms (the rule does not over-hide).
    const shared = await interestNotes("member");
    expect.soft(shared.list.join("|")).toContain(TERMS);
    expect.soft(shared.exported).toContain(TERMS);

    await makePrivate(custody);
    for (const role of ["member", "owner"] as const) {
      const seen = await interestNotes(role);
      expect.soft(seen.list, `${role} list`).toHaveLength(1);
      expect.soft(seen.list.join("|"), `${role} list`).not.toContain(TERMS);
      expect.soft(seen.exported, `${role} export`).not.toContain(TERMS);
    }
    // Nothing stored is rewritten.
    expect((await storedInterest())[0].notes).toContain(TERMS);
  });

  it("Thandi's recent and search tools withhold a privately held bill's name and do not match on it", async () => {
    await legacyMaturedBill(ids.privateAccount);
    for (const role of ["member", "owner"] as const) {
      const seen = await thandiSees(role);
      expect.soft(seen.recent, `${role} recent`).toContain("T-Bill interest");
      expect.soft(seen.recent, `${role} recent`).not.toContain(BILL);
      expect.soft(seen.guessed, `${role} search by the hidden name`).toBe(0);
      expect.soft(seen.generic, `${role} search by the generic name`).toContain("1700");
    }
  });

  it("the personal export withholds a privately held bill's name and terms", async () => {
    await legacyMaturedBill(ids.privateAccount);
    await db.update(transactions).set({ notes: `T-bill maturity interest. ${TERMS}, purchase 8000.00, WHT 300.00` })
      .where(and(eq(transactions.householdId, a), eq(transactions.type, "income")));
    // The ledger section follows custody for every reader. The owner's archive also lists the
    // bill itself in its GRZ holdings (the owner may see it), so only the member's whole archive is checked.
    for (const role of ["member", "owner"] as const) {
      const exported = await personalExport(role);
      expect.soft(exported.transactions, `${role} transactions`).toContain("T-Bill interest");
      expect.soft(exported.transactions, `${role} transactions`).not.toContain(BILL);
      expect.soft(exported.transactions, `${role} transactions`).not.toContain(TERMS);
      if (role === "member") {
        expect.soft(exported.archive, "member archive").not.toContain(BILL);
        expect.soft(exported.archive, "member archive").not.toContain(TERMS);
      }
    }
  });

  it("Thandi still names a bill whose custody is shared", async () => {
    await legacyMaturedBill(custody);
    const seen = await thandiSees("member");
    expect.soft(seen.recent).toContain(`T-Bill Interest: ${BILL}`);
    expect.soft(seen.guessed).toBe(1);
  });

  it("writes neutral interest notes when the bill's custody is private at receipt", async () => {
    await confirmedBill(ids.privateAccount);
    const [stored] = await storedInterest();
    expect(stored.notes ?? "").not.toContain(TERMS);
    expect(stored.notes ?? "").not.toContain("purchase 8000.00");
  });
});
