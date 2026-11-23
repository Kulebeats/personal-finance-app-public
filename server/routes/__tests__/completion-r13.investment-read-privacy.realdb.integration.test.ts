import { randomUUID } from "node:crypto";
import { Client } from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { accounts, auditLogs, grzBondPayments, grzBonds, grzTBills, holdings, householdMembers, householdPreferences, households, investmentTransactions, outboxEvents, securities, tags, transactions } from "@shared/schema";
import { db } from "../../db";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";

const securityId = randomUUID(), bondId = randomUUID(), privateBondId = randomUUID();
const couponBondId = randomUUID();
const finalCouponId = randomUUID();
const visibleId = randomUUID(), otherVisibleId = randomUUID();
const principalId = randomUUID(), couponId = randomUUID(), scheduledId = randomUUID();
const holdingId = randomUUID();
let cashId: string, maturityId: string, date: string;
const privateMarker = "R13_PRIVATE_MATURITY_SOURCE";
const get = (path: string, role: Role | "outsider" = "member") => request(app).get(path).set("Cookie", actors.get(role)!.cookie);
const activity = (role: Role | "outsider" = "member", suffix = "") => get(`/api/investments/transactions${suffix}`, role);
const bonds = (role: Role | "outsider" = "member") => get("/api/grz/bonds", role);
async function clean(recreate = true) {
  // Exercise lawful household erasure. Immutable quote/basis/settlement records
  // are removed with their ORIGINAL household in one commit, never bypassed.
  await db.transaction(async tx => {
    await tx.execute(sql`delete from grz_principal_settlements where household_id in (${a}::uuid,${b}::uuid)`);
    await tx.execute(sql`delete from grz_bond_principal_basis where household_id in (${a}::uuid,${b}::uuid)`);
    await tx.execute(sql`delete from grz_bond_valuations where household_id in (${a}::uuid,${b}::uuid)`);
    const owned = await tx.select({ id: grzBonds.id }).from(grzBonds).where(inArray(grzBonds.householdId, [a, b]));
    if (owned.length) await tx.delete(grzBondPayments).where(inArray(grzBondPayments.bondId, owned.map(row => row.id)));
    await tx.delete(grzTBills).where(inArray(grzTBills.householdId, [a, b]));
    await tx.delete(grzBonds).where(inArray(grzBonds.householdId, [a, b]));
    await tx.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b]));
    await tx.delete(holdings).where(inArray(holdings.householdId, [a, b]));
    await tx.delete(transactions).where(inArray(transactions.householdId, [a, b]));
    await tx.delete(accounts).where(inArray(accounts.householdId, [a, b]));
    await tx.delete(tags).where(inArray(tags.householdId, [a, b]));
    await tx.delete(outboxEvents).where(inArray(outboxEvents.householdId, [a, b]));
    await tx.delete(auditLogs).where(inArray(auditLogs.userId, Array.from(actors.values(), actor => actor.id)));
    await tx.delete(householdMembers).where(inArray(householdMembers.householdId, [a, b]));
    await tx.delete(householdPreferences).where(inArray(householdPreferences.householdId, [a, b]));
    await tx.delete(households).where(inArray(households.id, [a, b]));
  });
  await db.delete(securities).where(eq(securities.id, securityId));
  if (recreate) {
    await db.insert(households).values([{ id: a, name: "Synthetic read A", currency: "ZMW" }, { id: b, name: "Synthetic read B", currency: "ZMW" }]);
    await db.insert(householdMembers).values(Array.from(actors, ([role, actor]) => ({ householdId: role === "outsider" ? b : a,
      userId: actor.id, role: role === "outsider" ? "owner" as const : role })));
  }
}
const signed = (test: request.Test) => test.set("Cookie", actors.get("owner")!.cookie)
  .set("X-Capital-Subject", actors.get("owner")!.id).set("X-Capital-Household", a);
async function seed() {
  await db.insert(securities).values({ id: securityId, symbol: `R13-${securityId.slice(0, 8)}`, name: "Synthetic shared security", type: "bond", currency: "ZMW" });
  await db.insert(holdings).values({ id: holdingId, householdId: a, accountId: ids.sharedAccount, securityId, quantity: "1", costBasis: "950" });
  await db.insert(investmentTransactions).values([
    { id: visibleId, householdId: a, accountId: ids.sharedAccount, type: "coupon", amount: "20", currency: "ZMW", transactionDate: "2026-10-20", linkedTransactionId: ids.sharedTx },
    { id: otherVisibleId, householdId: a, accountId: ids.sharedAccount, type: "interest", amount: "10", currency: "ZMW", transactionDate: "2026-10-10" },
  ]);
  await db.insert(grzBonds).values([
    { id: bondId, householdId: a, accountId: ids.sharedAccount, isin: "ZM0000000001", bondName: "Shared face and status", tenorYears: 5,
      faceValue: "1000", purchasePrice: "950", purchaseDate: "2025-01-01", maturityDate: date,
      firstCouponDate: date, couponFrequency: 2, couponRate: "0.08", status: "active" },
    { id: couponBondId, householdId: a, accountId: ids.sharedAccount, bondName: "Visible coupon activity", tenorYears: 5,
      faceValue: "200", purchasePrice: "200", purchaseDate: "2025-01-01", maturityDate: "2030-01-01", couponRate: "0.20" },
    { id: privateBondId, householdId: a, accountId: ids.privateAccount, bondName: privateMarker, tenorYears: 5,
      faceValue: "1000", purchasePrice: "950", purchaseDate: "2025-01-01", maturityDate: "2030-01-01", couponRate: "0.20" },
  ]);
  await db.insert(grzBondPayments).values([
    { id: principalId, bondId, paymentDate: date, paymentType: "principal", grossAmount: "1000", netAmount: "1000", status: "scheduled" },
    { id: finalCouponId, bondId, paymentDate: date, paymentType: "coupon", grossAmount: "40", withholdingTax: "6", netAmount: "34", status: "scheduled" },
    { id: couponId, bondId: couponBondId, paymentDate: "2026-10-20", paymentType: "coupon", grossAmount: "20", withholdingTax: "3", netAmount: "17", status: "scheduled" },
    { id: scheduledId, bondId: couponBondId, paymentDate: "2027-04-20", paymentType: "coupon", grossAmount: "20", withholdingTax: "3", netAmount: "17", status: "scheduled" },
  ]);
  await signed(request(app).post(`/api/grz/payments/${couponId}/pay`)).send({ accountId: ids.sharedAccount, date: "2026-10-20" }).expect(200);
  await signed(request(app).post(`/api/grz/payments/${finalCouponId}/pay`)).send({ accountId: ids.sharedAccount, date }).expect(200);
  await signed(request(app).post(`/api/grz/bonds/${bondId}/principal-basis`)).send({ operationId: randomUUID(), acquisitionDate: "2025-01-01",
    sourceDate: date, isin: "ZM0000000001", currency: "ZMW", purchaseCashAmount: "950.00", principalCost: "950.00", purchasedInterest: "0.00", acquisitionFees: "0.00",
    sourceKind: "custodian_statement", sourceReference: "Synthetic private read acquisition" }).expect(201);
  await signed(request(app).post(`/api/grz/bonds/${bondId}/valuations`)).send({ operationId: randomUUID(), valuationDate: date, sourceDate: date,
    nominalAmount: "1000.00", isin: "ZM0000000001", currency: "ZMW", sourceKind: "custodian_statement", sourceReference: "Synthetic private read principal mark",
    quoteBasis: "clean", quoteUnits: "holding_amount", quotedAmount: "1000.00", accruedInterest: "0.00" }).expect(201);
  const receipt = await signed(request(app).post("/api/transactions")).send({ accountId: ids.sharedAccount, date, name: privateMarker,
    type: "income", amount: { amount: "1000.00", currency: "ZMW" }, idempotencyKey: randomUUID() }).expect(201);
  cashId = receipt.body.data.id;
  // The ordinary create DTO does not expose the legacy privacy flag. Seed only
  // that flag before matching; cash/posting and confirmed binding use real APIs.
  await db.update(transactions).set({ isPrivate: true, ownerUserId: actors.get("owner")!.id }).where(eq(transactions.id, cashId));
  const settlement = await signed(request(app).post(`/api/grz/payments/${principalId}/pay`)).send({ accountId: ids.sharedAccount, date,
    operationId: randomUUID(), receiptConfirmed: true, receiptTransactionId: cashId, receivedAmount: { amount: "1000.00", currency: "ZMW" }, fees: { amount: "0.00", currency: "ZMW" } }).expect(200);
  maturityId = settlement.body.data.investmentTransactionId;
  expect(settlement.body.data.settlement.status).toBe("confirmed");
  const [cash] = await db.select().from(transactions).where(eq(transactions.id, cashId));
  expect(cash).toMatchObject({ isPrivate: true, ownerUserId: actors.get("owner")!.id, type: "asset_settlement", postingMode: "posted" });
}
function beforeInvestmentRead(change: () => Promise<unknown>) {
  const actual = Client.prototype.query; let changed = false;
  const gate = vi.fn(change);
  vi.spyOn(Client.prototype, "query").mockImplementation(function(this: Client, ...args: unknown[]) {
    const input = args[0], text = typeof input === "string" ? input : input && typeof input === "object" && "text" in input ? String(input.text) : "";
    if (!changed && /^\s*select\b/i.test(text) && text.includes('from "investment_transactions"')) {
      changed = true; return gate().then(() => Reflect.apply(actual, this, args));
    }
    return Reflect.apply(actual, this, args);
  } as typeof Client.prototype.query);
  return gate;
}

describe("R13 signed investment activity and nested principal receipt privacy", () => {
  beforeAll(async () => { await start(); date = (await db.execute<{ date: string }>(sql`select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD') as date`)).rows[0].date; }, 20_000);
  beforeEach(async () => { await clean(); await reset(); await seed(); });
  afterEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => { await clean(false); await stop(); });

  it.each(["admin", "member", "view_only", "professional"] as const)("withholds another member's linked private cash from %s activity", async role => {
    const response = await activity(role).expect(200);
    expect(response.body.data.map((row: { id: string }) => row.id).sort()).toEqual([visibleId, otherVisibleId].sort());
    expect(response.text).not.toContain(cashId); expect(response.text).not.toContain(privateMarker); expect(response.text).not.toContain(maturityId);
  });
  it("retains the private cash owner's complete activity and visible principal receipt", async () => {
    const response = await activity("owner").expect(200);
    expect(response.body.data).toHaveLength(3);
    expect(response.body.data.find((row: { id: string }) => row.id === maturityId)).toMatchObject({ linkedTransactionId: cashId, amount: "1000.00" });
    const shared = (await bonds("owner").expect(200)).body.data.find((row: { id: string }) => row.id === bondId);
    expect(shared.payments.map((row: { id: string }) => row.id)).toContain(principalId);
  });
  it("keeps shared bond face/status and visible coupons while withholding the nested private principal payment", async () => {
    const response = await bonds().expect(200);
    expect(response.body.data).toHaveLength(2);
    const matured = response.body.data.find((row: { id: string }) => row.id === bondId);
    expect(matured).toMatchObject({ faceValue: { amount: "1000.00", currency: "ZMW" }, status: "matured",
      payments: [{ id: finalCouponId, status: "paid", paymentType: "coupon" }] });
    const visibleCoupons = response.body.data.find((row: { id: string }) => row.id === couponBondId);
    expect(visibleCoupons.payments.map((row: { id: string }) => row.id).sort()).toEqual([couponId, scheduledId].sort());
    for (const secret of [cashId, maturityId, principalId, privateBondId, privateMarker]) expect(response.text).not.toContain(secret);
  });
  it("applies the existing bill receipt policy to the investment's linked cash too", async () => {
    const hiddenBill = randomUUID(), visibleBill = randomUUID();
    const common = { householdId: a, accountId: ids.sharedAccount, tenorDays: 182, faceValue: "1000", purchasePrice: "950", purchaseDate: "2026-01-01", maturityDate: "2026-07-02", status: "matured" as const };
    await db.insert(grzTBills).values([
      { ...common, id: hiddenBill, tbillName: privateMarker, maturityInvestmentTxId: maturityId },
      { ...common, id: visibleBill, tbillName: "Shared bill", maturityInvestmentTxId: visibleId },
    ]);
    const response = await get("/api/grz/tbills").expect(200);
    expect(response.body.data.map((row: { id: string }) => row.id)).toEqual([visibleBill]);
    for (const secret of [hiddenBill, cashId, maturityId, privateMarker]) expect(response.text).not.toContain(secret);
    expect((await get("/api/grz/tbills", "owner").expect(200)).body.data).toHaveLength(2);
  });
  it("filters hidden activity in SQL before applying an existing caller's page limit", async () => {
    const response = await activity("member", "?limit=2").expect(200);
    expect(response.body.data.map((row: { id: string }) => row.id)).toEqual([visibleId, otherVisibleId]);
  });
  it.each(["investment account", "investment household", "holding account", "holding household", "linked cash account", "linked cash household", "deleted cash", "deleted cash account"] as const)("composes %s privacy for shared activity and GRZ receipt", async mismatch => {
    // Independent legacy links may be malformed. Never mutate the real
    // principal's immutable event or forge a paid installment to model them.
    const candidate = randomUUID(), legacyCash = randomUUID();
    await db.insert(transactions).values({ id: legacyCash, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id,
      date, name: "Synthetic legacy linked income", type: "income", amount: "20.00", currency: "ZMW", status: "cleared", isPrivate: false });
    await db.insert(investmentTransactions).values({ id: candidate, householdId: a, accountId: ids.sharedAccount, type: "coupon",
      amount: "20.00", currency: "ZMW", transactionDate: date, linkedTransactionId: legacyCash });
    await db.update(grzBondPayments).set({ investmentTransactionId: candidate }).where(eq(grzBondPayments.id, couponId));
    if (mismatch === "investment account") await db.update(investmentTransactions).set({ accountId: ids.privateAccount }).where(eq(investmentTransactions.id, candidate));
    if (mismatch === "investment household") await db.update(investmentTransactions).set({ householdId: b }).where(eq(investmentTransactions.id, candidate));
    if (mismatch.startsWith("holding")) {
      await db.update(investmentTransactions).set({ holdingId }).where(eq(investmentTransactions.id, candidate));
      await db.update(holdings).set(mismatch === "holding account" ? { accountId: ids.privateAccount } : { householdId: b }).where(eq(holdings.id, holdingId));
    }
    if (mismatch === "linked cash account") await db.update(transactions).set({ accountId: ids.privateAccount }).where(eq(transactions.id, legacyCash));
    if (mismatch === "linked cash household") await db.update(transactions).set({ householdId: b }).where(eq(transactions.id, legacyCash));
    if (mismatch === "deleted cash") await db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, legacyCash));
    if (mismatch === "deleted cash account") {
      await db.update(transactions).set({ accountId: ids.privateAccount }).where(eq(transactions.id, legacyCash));
      await db.update(accounts).set({ isPrivate: false, deletedAt: new Date() }).where(eq(accounts.id, ids.privateAccount));
    }
    const response = await activity().expect(200); expect(response.text).not.toContain(candidate); expect(response.text).not.toContain(legacyCash);
    const shared = (await bonds().expect(200)).body.data.find((row: { id: string }) => row.id === couponBondId);
    expect(shared.payments.map((row: { id: string }) => row.id)).toEqual([scheduledId]);
  });
  it("permits the signer-visible private receipt, a visible holding and unrelated unlinked shared activity", async () => {
    const ownedCash = randomUUID(), ownedActivity = randomUUID();
    await db.insert(transactions).values({ id: ownedCash, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("member")!.id,
      date, name: "Synthetic signer private income", type: "income", amount: "20.00", currency: "ZMW", status: "cleared", isPrivate: true });
    await db.insert(investmentTransactions).values({ id: ownedActivity, householdId: a, accountId: ids.sharedAccount, holdingId, type: "coupon",
      amount: "20.00", currency: "ZMW", transactionDate: date, linkedTransactionId: ownedCash });
    await db.update(grzBondPayments).set({ investmentTransactionId: ownedActivity }).where(eq(grzBondPayments.id, couponId));
    expect((await activity().expect(200)).body.data).toHaveLength(3);
    const shared = (await bonds().expect(200)).body.data.find((row: { id: string }) => row.id === couponBondId);
    expect(shared.payments.map((row: { id: string }) => row.id)).toContain(couponId);
  });
  it("does not disclose another household's activity or holdings to an authenticated outsider", async () => {
    expect((await activity("outsider").expect(200)).body.data).toEqual([]);
    expect((await bonds("outsider").expect(200)).body.data).toEqual([]);
  });
  it("requires authentication on both existing read endpoints", async () => {
    await request(app).get("/api/investments/transactions").expect(401);
    await request(app).get("/api/grz/bonds").expect(401);
  });
  it("checks live membership in the activity query after the route admitted the actor", async () => {
    const gate = beforeInvestmentRead(() => db.delete(householdMembers).where(eq(householdMembers.userId, actors.get("member")!.id)));
    const response = await activity().expect(200); expect(gate).toHaveBeenCalledOnce(); expect(response.body.data).toEqual([]);
  });
});
