/**
 * NEW-04 / GRZ-03 (R13.2): a confirmed GRZ bond sale is an asset-to-cash
 * settlement. Over real HTTP against real Postgres it must:
 *   - cancel every scheduled coupon and the principal dated after the sale,
 *   - post the net proceeds to the chosen ZMW asset account exactly once,
 *   - record fees, cost basis and the realised gain or loss on the holding,
 *   - refuse a second sale (409) without posting anything,
 *   - leave nothing payable for that bond afterwards, and
 *   - write the audit rows in the same transaction.
 * Amounts are synthetic fixtures, not legal or tax claims (OI-03).
 */
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { accounts, auditLogs, grzBondPayments, grzBonds, households, investmentTransactions, transactions } from "@shared/schema";
import { db, pool } from "../../db";
import { Money } from "../../core/money";
import { grzCouponPaymentKey } from "../../services/grz/couponPaymentKey";
import { calendarClock } from "../../services/householdCalendarToday";
import { a, actors, app, ids, start, stop } from "../../modules/tags/__tests__/completion-r04.tags.fixture";
import { eraseSaleHouseholds, freshSaleHouseholds } from "./grz-sale-household.fixture";

const bondName = "R13_REAL_BOND_SALE";
const owner = () => actors.get("owner")!;
const send = (method: "put" | "post", path: string) => request(app)[method](path).set("Cookie", owner().cookie)
  .set("X-Capital-Subject", owner().id).set("X-Capital-Household", a);

/** 1000 face, 8% semiannual: coupons 40.00 gross / 6.00 withheld / 34.00 net. */
async function createBond(purchaseDate = "2025-06-30", firstCouponDate = "2025-12-31", maturityDate = "2027-12-31") {
  const created = await send("post", "/api/grz/bonds").send({ accountId: ids.sharedAccount, isin: "ZM0000000001", bondName, tenorYears: 2,
    faceValue: "1000.00", purchasePrice: "950.00", couponRate: "0.0800", couponFrequency: 2, purchaseDate, firstCouponDate, maturityDate }).expect(201);
  return created.body.data.id as string;
}
const payments = (bondId: string) => db.select().from(grzBondPayments).where(eq(grzBondPayments.bondId, bondId)).orderBy(asc(grzBondPayments.paymentDate), asc(grzBondPayments.paymentType));
const balance = async () => (await db.select().from(accounts).where(eq(accounts.id, ids.sharedAccount)))[0].balance;
const settlements = () => db.select().from(transactions).where(and(eq(transactions.householdId, a), eq(transactions.type, "asset_settlement")));
const audits = (entityId: string) => db.select().from(auditLogs).where(eq(auditLogs.entityId, entityId));

describe("R13.2 a GRZ bond sale settles cash once and cancels later entitlements", () => {
  beforeAll(async () => { await start(); }, 30_000);
  beforeEach(freshSaleHouseholds);
  afterAll(async () => { await eraseSaleHouseholds(); await stop(); });

  it("cancels later coupons and principal, posts net proceeds once, and records the realised gain", async () => {
    const bondId = await createBond();
    const before = await balance();
    const sold = await send("put", `/api/grz/bonds/${bondId}/sell`)
      .send({ soldDate: "2026-08-15", soldPrice: "980.50", fees: "5.25", accountId: ids.sharedAccount }).expect(200);

    const [bond] = await db.select().from(grzBonds).where(eq(grzBonds.id, bondId));
    expect(bond).toMatchObject({ status: "sold", soldDate: "2026-08-15", soldPrice: "980.50", saleFees: "5.25",
      saleCostBasis: "950.00", saleRealizedGain: "25.25" });
    expect(sold.body.data.settlement).toMatchObject({ grossProceeds: { amount: "980.50", currency: "ZMW" },
      fees: { amount: "5.25", currency: "ZMW" }, cashReceived: { amount: "975.25", currency: "ZMW" },
      costBasis: { amount: "950.00", currency: "ZMW" }, realizedGain: { amount: "25.25", currency: "ZMW" }, withholdingTax: { amount: "0.00", currency: "ZMW" } });

    const rows = await payments(bondId);
    expect(rows.map(row => [row.paymentDate, row.paymentType, row.status])).toEqual([
      ["2025-12-31", "coupon", "scheduled"], ["2026-06-30", "coupon", "scheduled"],
      ["2026-12-31", "coupon", "cancelled"], ["2027-06-30", "coupon", "cancelled"],
      ["2027-12-31", "coupon", "cancelled"], ["2027-12-31", "principal", "cancelled"],
    ]);

    const cash = await settlements();
    expect(cash).toHaveLength(1);
    expect(cash[0]).toMatchObject({ id: bond.saleCashTransactionId, accountId: ids.sharedAccount, amount: "975.25", currency: "ZMW",
      date: "2026-08-15", postingMode: "posted", postedBalanceDelta: "975.25", postedAccountIsAsset: true });
    expect(await balance()).toBe(new Money(before, "ZMW").add(new Money("975.25", "ZMW")).toString());
    const sales = await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a));
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ type: "sell", amount: "980.50", fees: "5.25", withholdingTax: "0.00", currency: "ZMW",
      transactionDate: "2026-08-15", linkedTransactionId: cash[0].id, accountId: ids.sharedAccount });

    const bondAudit = (await audits(bondId)).filter(row => row.action === "UPDATE");
    expect(bondAudit).toHaveLength(1);
    expect(bondAudit[0].details).toMatchObject({ oldValue: { status: "active" }, newValue: { status: "sold", soldDate: "2026-08-15",
      soldPrice: "980.50", fees: "5.25", cashReceived: "975.25", costBasis: "950.00", realizedGain: "25.25",
      cancelledPaymentIds: rows.filter(row => row.status === "cancelled").map(row => row.id).sort() } });
    expect((await audits(cash[0].id)).filter(row => row.action === "CREATE")).toHaveLength(1);
  });

  it("refuses a repeat sale with 409 and posts nothing", async () => {
    const bondId = await createBond();
    await send("put", `/api/grz/bonds/${bondId}/sell`).send({ soldDate: "2026-08-15", soldPrice: "980.50", accountId: ids.sharedAccount }).expect(200);
    const after = await balance(), auditCount = (await db.select().from(auditLogs)).length;
    const again = await send("put", `/api/grz/bonds/${bondId}/sell`).send({ soldDate: "2026-08-16", soldPrice: "990.00", accountId: ids.sharedAccount }).expect(409);
    expect(again.body.error.message).toBe("Bond is already sold");
    expect(await settlements()).toHaveLength(1);
    expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a))).toHaveLength(1);
    expect(await balance()).toBe(after);
    expect((await db.select().from(auditLogs)).length).toBe(auditCount);
  });

  it("books nothing for any of the bond's payments after the sale", async () => {
    const bondId = await createBond();
    await send("put", `/api/grz/bonds/${bondId}/sell`).send({ soldDate: "2026-08-15", soldPrice: "980.50", accountId: ids.sharedAccount }).expect(200);
    const after = await balance();
    for (const payment of await payments(bondId)) {
      await send("post", `/api/grz/payments/${payment.id}/pay`).send({ accountId: ids.sharedAccount, date: "2026-11-01" }).expect(409);
      expect(await db.select().from(transactions).where(eq(transactions.idempotencyKey, grzCouponPaymentKey(payment.id)))).toEqual([]);
    }
    expect(await balance()).toBe(after);
    expect(await settlements()).toHaveLength(1);
    expect((await payments(bondId)).filter(row => row.status === "paid")).toEqual([]);
  });

  it("settles an early sale dated before the first coupon and records a realised loss", async () => {
    const bondId = await createBond();
    await send("put", `/api/grz/bonds/${bondId}/sell`).send({ soldDate: "2025-09-01", soldPrice: "900.00", accountId: ids.sharedAccount }).expect(200);
    expect((await payments(bondId)).every(row => row.status === "cancelled")).toBe(true);
    const [bond] = await db.select().from(grzBonds).where(eq(grzBonds.id, bondId));
    expect(bond).toMatchObject({ status: "sold", saleFees: "0.00", saleCostBasis: "950.00", saleRealizedGain: "-50.00" });
    const cash = await settlements();
    expect(cash.map(row => [row.amount, row.date])).toEqual([["900.00", "2025-09-01"]]);
  });

  it("refuses a sale dated before a later payment that was already received", async () => {
    const bondId = await createBond();
    const [coupon] = (await payments(bondId)).filter(row => row.paymentDate === "2026-06-30");
    await send("post", `/api/grz/payments/${coupon.id}/pay`).send({ accountId: ids.sharedAccount, date: "2026-07-01" }).expect(200);
    const after = await balance();
    await send("put", `/api/grz/bonds/${bondId}/sell`).send({ soldDate: "2026-05-01", soldPrice: "980.50", accountId: ids.sharedAccount }).expect(409);
    expect((await db.select().from(grzBonds).where(eq(grzBonds.id, bondId)))[0]).toMatchObject({ status: "active", soldDate: null, saleCashTransactionId: null });
    expect((await payments(bondId)).filter(row => row.status === "cancelled")).toEqual([]);
    expect(await settlements()).toEqual([]);
    expect(await balance()).toBe(after);
  });

  it.each([
    ["a number price", { soldPrice: 980.5 }],
    ["an exponent price", { soldPrice: "1e3" }],
    ["three decimal places", { soldPrice: "980.505" }],
    ["a negative price", { soldPrice: "-980.50" }],
    ["a zero price", { soldPrice: "0.00" }],
    ["fees that consume the price", { soldPrice: "980.50", fees: "980.50" }],
    ["negative fees", { soldPrice: "980.50", fees: "-1.00" }],
    ["an unknown field", { soldPrice: "980.50", proceeds: "1.00" }],
  ])("rejects %s with 400 and changes nothing", async (_label, body) => {
    const bondId = await createBond();
    const before = await balance();
    await send("put", `/api/grz/bonds/${bondId}/sell`).send({ soldDate: "2026-08-15", accountId: ids.sharedAccount, ...body }).expect(400);
    expect((await db.select().from(grzBonds).where(eq(grzBonds.id, bondId)))[0].status).toBe("active");
    expect((await payments(bondId)).some(row => row.status === "cancelled")).toBe(false);
    expect(await settlements()).toEqual([]);
    expect(await balance()).toBe(before);
  });

  it("requires a ZMW asset destination for the proceeds", async () => {
    const bondId = await createBond();
    const [card] = await db.insert(accounts).values({ householdId: a, name: "Synthetic card", type: "credit", currency: "ZMW",
      balance: "0.00", isAsset: false, ownerUserId: owner().id }).returning();
    await send("put", `/api/grz/bonds/${bondId}/sell`).send({ soldDate: "2026-08-15", soldPrice: "980.50", accountId: card.id }).expect(400);
    expect(await settlements()).toEqual([]);
    expect((await db.select().from(grzBonds).where(eq(grzBonds.id, bondId)))[0].status).toBe("active");
  });

  it("keeps the posted sale cash immutable at the database", async () => {
    const bondId = await createBond();
    await send("put", `/api/grz/bonds/${bondId}/sell`).send({ soldDate: "2026-08-15", soldPrice: "980.50", accountId: ids.sharedAccount }).expect(200);
    const [cash] = await settlements();
    await expect(pool.query("UPDATE transactions SET amount=1.00 WHERE id=$1", [cash.id])).rejects.toThrow(/adjustment/);
    await expect(pool.query("DELETE FROM transactions WHERE id=$1", [cash.id])).rejects.toThrow(/adjustment/);
  });

  // NEW-22 residual: the default sale date and the "not in the future" bound
  // are the household's calendar date. 22:30 UTC on 31 Dec 2025 is 00:30 on
  // 1 Jan in Lusaka and 17:30 on 31 Dec in New York.
  describe("the sale date follows the household calendar", () => {
    async function pinCalendar(timeZone: string) {
      await db.update(households).set({ timeZone }).where(eq(households.id, a));
      vi.spyOn(calendarClock, "now").mockReturnValue(new Date("2025-12-31T22:30:00Z"));
    }
    afterEach(async () => {
      vi.restoreAllMocks();
      await db.update(households).set({ timeZone: null }).where(eq(households.id, a));
    });

    it("dates a sale with no sale date on the household's 1 January in Lusaka", async () => {
      const bondId = await createBond();
      await pinCalendar("Africa/Lusaka");
      await send("put", `/api/grz/bonds/${bondId}/sell`).send({ soldPrice: "980.50", accountId: ids.sharedAccount }).expect(200);
      expect((await db.select().from(grzBonds).where(eq(grzBonds.id, bondId)))[0]).toMatchObject({ status: "sold", soldDate: "2026-01-01" });
    });

    it("refuses 1 January as a future sale date while it is still 31 December in New York", async () => {
      const bondId = await createBond();
      await pinCalendar("America/New_York");
      await send("put", `/api/grz/bonds/${bondId}/sell`).send({ soldDate: "2026-01-01", soldPrice: "980.50", accountId: ids.sharedAccount }).expect(400);
      expect((await db.select().from(grzBonds).where(eq(grzBonds.id, bondId)))[0]).toMatchObject({ status: "active", soldDate: null });
      expect(await settlements()).toEqual([]);
    });
  });
});
