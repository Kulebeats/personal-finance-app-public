/** Signed summary filters must use R04's projected coupon metadata. Shared cash
 * remains reportable even when the source custody and its descriptive fields
 * are private. All financial postings below use the real HTTP writers. */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  accounts, auditLogs, grzBondPayments, grzBonds, householdMembers, households,
  merchants, outboxEvents, securityAuditLogs, session, transactions, users,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";

const householdId = randomUUID(), cashAccountId = randomUUID(), custodyId = randomUUID();
const couponMerchantId = randomUUID(), ordinaryMerchantId = randomUUID();
const privateMarker = `R04 Secret X${randomUUID().slice(0, 8).toUpperCase()}`;
const ordinaryMarker = `R04 Visible ${randomUUID().slice(0, 8)}`;
const couponMerchantName = `Coupon merchant ${randomUUID()}`;
const ordinaryMerchantName = `Ordinary merchant ${ordinaryMarker}`;
const password = "SyntheticSummaryR04!123";
type Role = "owner" | "member";
const actors: Record<Role, { id: string; cookie: string }> = {
  owner: { id: randomUUID(), cookie: "" }, member: { id: randomUUID(), cookie: "" },
};
let app: Awaited<ReturnType<typeof getTestApp>>;
let date: string, privacyDate: string, purchaseDate: string;
let couponCashId: string, ordinaryIncomeId: string, ordinaryExpenseId: string;
const headers = (role: Role) => ({ Cookie: actors[role].cookie,
  "X-Capital-Subject": actors[role].id, "X-Capital-Household": householdId });
const money = (amount: string) => ({ amount, currency: "ZMW" });
const summary = (role: Role, filter: Partial<Record<"search" | "merchantId", string>> = {}, id: string = cashAccountId, onDate = date) => request(app)
  .get("/api/transactions/summary").set(headers(role)).query({ accountId: id, startDate: onDate, endDate: onDate, ...filter });
const postOrdinary = (id: string, onDate: string, type: "income" | "expense", amount: string, merchantId?: string) => request(app)
  .post("/api/transactions").set(headers("owner")).send({ accountId: id, date: onDate, type,
    name: merchantId ? ordinaryMerchantName : "Visible ordinary cash expense", merchantId,
    amount: money(amount), idempotencyKey: randomUUID() });

function expectAmounts(data: unknown, count: number, income: string, expense: string, net: string) {
  expect(data).toMatchObject({ currency: "ZMW", transactionCount: count,
    totalIncome: money(income), totalExpenses: money(expense), netFlow: money(net) });
}

describe("R04 signed summary composes projected coupon metadata with ordinary cash", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const clock = (await pool.query<{ date: string; privacy_date: string; purchase_date: string }>(
      "SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD') AS date, to_char((transaction_timestamp() AT TIME ZONE 'UTC')::date-1,'YYYY-MM-DD') AS privacy_date, to_char((transaction_timestamp() AT TIME ZONE 'UTC')::date-interval '1 year','YYYY-MM-DD') AS purchase_date",
    )).rows[0];
    date = clock.date; privacyDate = clock.privacy_date; purchaseDate = clock.purchase_date;
    await db.insert(households).values({ id: householdId, name: "Synthetic R04 summary composition", currency: "ZMW" });
    const passwordHash = await hashPassword(password);
    for (const role of ["owner", "member"] as const) {
      const id = actors[role].id, email = `r04-summary-${id}@example.invalid`;
      await db.insert(users).values({ id, email, username: `r04-summary-${id}`, passwordHash,
        emailVerified: true, mfaEnabled: false, timezone: "Africa/Lusaka" });
      await db.insert(householdMembers).values({ householdId, userId: id, role });
      const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
      actors[role].cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
    }
    await db.insert(accounts).values([
      { id: cashAccountId, householdId, ownerUserId: actors.owner.id, name: "Public coupon destination", type: "checking",
        currency: "ZMW", isAsset: true, isPrivate: false, initialBalance: "1000.00", balance: "1000.00" },
      { id: custodyId, householdId, ownerUserId: actors.owner.id, name: "Coupon custody", type: "investment",
        currency: "ZMW", isAsset: true, isPrivate: false, initialBalance: "0.00", balance: "0.00" },
    ]);
    await db.insert(merchants).values([
      { id: couponMerchantId, householdId, name: couponMerchantName },
      { id: ordinaryMerchantId, householdId, name: ordinaryMerchantName },
    ]);
    const bond = await request(app).post("/api/grz/bonds").set(headers("owner")).send({ accountId: custodyId,
      bondName: privateMarker, tenorYears: 1, faceValue: "1000.00", purchasePrice: "950.00",
      couponRate: "0.0800", couponFrequency: 2, purchaseDate, firstCouponDate: date, maturityDate: date }).expect(201);
    const coupons = await db.select().from(grzBondPayments).where(and(
      eq(grzBondPayments.bondId, bond.body.data.id), eq(grzBondPayments.paymentType, "coupon"),
    ));
    expect(coupons).toHaveLength(1);
    expect(coupons[0]).toMatchObject({ grossAmount: "40.00", withholdingTax: "6.00", netAmount: "34.00", status: "scheduled" });
    await request(app).post(`/api/grz/payments/${coupons[0].id}/pay`).set(headers("owner"))
      .send({ accountId: cashAccountId, date }).expect(200);
    const [paid] = await db.select().from(grzBondPayments).where(eq(grzBondPayments.id, coupons[0].id));
    expect(paid).toMatchObject({ status: "paid", actualPaymentDate: date });
    expect(paid.incomeTransactionId).toBeTruthy();
    couponCashId = paid.incomeTransactionId!;
    // The public pay route has no merchant field. Add only its descriptive
    // metadata after the genuine ledger posting; never manufacture source proof.
    await db.update(transactions).set({ merchantId: couponMerchantId }).where(eq(transactions.id, couponCashId));
    const [cash] = await db.select().from(transactions).where(eq(transactions.id, couponCashId));
    expect(cash).toMatchObject({ accountId: cashAccountId, ownerUserId: actors.owner.id, type: "income", amount: "34.00",
      currency: "ZMW", isPrivate: false, merchantId: couponMerchantId, postingMode: "posted", postedBalanceDelta: "34.00" });
    expect(cash.name).toContain(privateMarker);
    const proof = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, couponCashId),
      eq(auditLogs.entityType, "transaction"), eq(auditLogs.action, "CREATE")));
    expect(proof).toHaveLength(1);
    expect(proof[0].details).toMatchObject({ grzCoupon: { paymentId: paid.id, bondId: bond.body.data.id,
      grossAmount: "40.00", withholdingTax: "6.00", netAmount: "34.00", currency: "ZMW" } });
    // A genuinely shared origin leaves rich historical fields on the receipt.
    // Once custody is private, the shared cash projection hides those fields
    // even for its owner. The stored receipt and its original audit survive.
    for (const filter of [{ search: privateMarker }, { search: couponMerchantName }, { merchantId: couponMerchantId }]) {
      const publicProbe = await summary("member", filter).expect(200);
      expectAmounts(publicProbe.body.data, 1, "34.00", "0.00", "34.00");
    }
    await request(app).put(`/api/accounts/${custodyId}`).set(headers("owner")).send({ isPrivate: true }).expect(200);
    const [withdrawn] = await db.select({ private: accounts.isPrivate }).from(accounts).where(eq(accounts.id, custodyId));
    expect(withdrawn.private).toBe(true);
    ordinaryIncomeId = (await postOrdinary(cashAccountId, date, "income", "7.25", ordinaryMerchantId).expect(201)).body.data.id;
    ordinaryExpenseId = (await postOrdinary(cashAccountId, date, "expense", "2.00").expect(201)).body.data.id;
    expect((await pool.query("SELECT balance, currency, is_private FROM accounts WHERE id=$1", [cashAccountId])).rows)
      .toEqual([{ balance: "1039.25", currency: "ZMW", is_private: false }]);
  }, 30_000);

  afterAll(async () => {
    const userIds = Object.values(actors).map(actor => actor.id);
    // All scopes below are generated by this fixture, including actor-only
    // audits and sessions. Teardown failures reject the suite.
    await db.transaction(async tx => {
      const bondIds = await tx.select({ id: grzBonds.id }).from(grzBonds).where(eq(grzBonds.householdId, householdId));
      if (bondIds.length) await tx.delete(grzBondPayments).where(inArray(grzBondPayments.bondId, bondIds.map(row => row.id)));
      await tx.delete(grzBonds).where(eq(grzBonds.householdId, householdId));
      await tx.delete(session).where(or(inArray(sql<string>`${session.sess}->>'userId'`, userIds),
        inArray(sql<string>`${session.sess}->>'mfaPendingUserId'`, userIds)));
      await tx.delete(securityAuditLogs).where(or(inArray(securityAuditLogs.userId, userIds), inArray(securityAuditLogs.targetUserId, userIds)));
      await tx.delete(auditLogs).where(or(eq(auditLogs.householdId, householdId), inArray(auditLogs.userId, userIds)));
      await tx.delete(outboxEvents).where(or(eq(outboxEvents.householdId, householdId), inArray(sql<string>`${outboxEvents.payload}->>'userId'`, userIds)));
      await tx.delete(transactions).where(eq(transactions.householdId, householdId));
      await tx.delete(merchants).where(eq(merchants.householdId, householdId));
      await tx.delete(accounts).where(eq(accounts.householdId, householdId));
      await tx.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
      await tx.delete(users).where(inArray(users.id, userIds));
      await tx.delete(households).where(eq(households.id, householdId));
    });
  });

  it.each([
    { label: "private coupon text", filter: { search: privateMarker } },
    { label: "private coupon merchant text", filter: { search: couponMerchantName } },
    { label: "private coupon merchant ID", filter: { merchantId: couponMerchantId } },
  ])("does not expose private-origin metadata through signed $label summary filters", async ({ filter }) => {
    const owner = await summary("owner", filter).expect(200);
    expectAmounts(owner.body.data, 0, "0.00", "0.00", "0.00");
    const peer = await summary("member", filter).expect(200);
    expectAmounts(peer.body.data, 0, "0.00", "0.00", "0.00");
    expect(peer.body.data).toMatchObject({ largestIncome: money("0.00"), largestExpense: money("0.00"), firstTransactionDate: null, lastTransactionDate: null });
    for (const hidden of [privateMarker, couponMerchantName, couponMerchantId, couponCashId]) expect(JSON.stringify(peer.body)).not.toContain(hidden);
  });

  it.each([
    { label: "search", filter: { search: ordinaryMarker } },
    { label: "merchant", filter: { merchantId: ordinaryMerchantId } },
  ])("retains a real visible ordinary positive match for the signed $label filter", async ({ filter }) => {
    const listed = await request(app).get("/api/transactions").set(headers("member"))
      .query({ accountId: cashAccountId, startDate: date, endDate: date, ...filter }).expect(200);
    expect(listed.body.data.map((row: { id: string }) => row.id)).toEqual([ordinaryIncomeId]);
    const result = await summary("member", filter).expect(200);
    expectAmounts(result.body.data, 1, "7.25", "0.00", "7.25");
    expect(result.body.data).toMatchObject({ largestIncome: money("7.25"), largestExpense: money("0.00"), firstTransactionDate: date, lastTransactionDate: date });
  });

  it("retains anonymous shared coupon cash in the meaningful unfiltered owner and member totals", async () => {
    const stored = (await pool.query("SELECT id, amount, currency, type FROM transactions WHERE account_id=$1 ORDER BY id", [cashAccountId])).rows;
    expect(stored).toHaveLength(3);
    expect(stored).toEqual(expect.arrayContaining([
      { id: couponCashId, amount: "34.00", currency: "ZMW", type: "income" },
      { id: ordinaryIncomeId, amount: "7.25", currency: "ZMW", type: "income" },
      { id: ordinaryExpenseId, amount: "2.00", currency: "ZMW", type: "expense" },
    ]));
    for (const role of ["owner", "member"] as const) {
      const result = await summary(role).expect(200);
      expectAmounts(result.body.data, 3, "41.25", "2.00", "39.25");
      expect(result.body.data).toMatchObject({ largestIncome: money("34.00"), largestExpense: money("2.00"), firstTransactionDate: date, lastTransactionDate: date });
    }
  });

  it("re-reads a signed ordinary account privacy change instead of retaining the member's prior 23.00 summary", async () => {
    const createdAccount = await request(app).post("/api/accounts").set(headers("owner")).send({ name: "Distinct R04 ordinary privacy account",
      type: "checking", currency: "ZMW", initialBalance: "0.00", isPrivate: false, ownerUserId: actors.owner.id }).expect(201);
    const id = createdAccount.body.data.id as string;
    const empty = await summary("member", {}, id, privacyDate).expect(200);
    expectAmounts(empty.body.data, 0, "0.00", "0.00", "0.00");
    const posting = await postOrdinary(id, privacyDate, "income", "23.00").expect(201);
    const visible = await summary("member", {}, id, privacyDate).expect(200);
    expectAmounts(visible.body.data, 1, "23.00", "0.00", "23.00");
    await request(app).put(`/api/accounts/${id}`).set(headers("owner")).send({ isPrivate: true }).expect(200);
    expect((await pool.query("SELECT balance, currency, is_private, owner_user_id FROM accounts WHERE id=$1", [id])).rows)
      .toEqual([{ balance: "23.00", currency: "ZMW", is_private: true, owner_user_id: actors.owner.id }]);
    expect((await pool.query("SELECT account_id, amount, currency, type FROM transactions WHERE id=$1", [posting.body.data.id])).rows)
      .toEqual([{ account_id: id, amount: "23.00", currency: "ZMW", type: "income" }]);
    const hidden = await summary("member", {}, id, privacyDate).expect(200);
    expectAmounts(hidden.body.data, 0, "0.00", "0.00", "0.00");
    expect(hidden.body.data).toMatchObject({ firstTransactionDate: null, lastTransactionDate: null });
    const owner = await summary("owner", {}, id, privacyDate).expect(200);
    expectAmounts(owner.body.data, 1, "23.00", "0.00", "23.00");
  });
});
