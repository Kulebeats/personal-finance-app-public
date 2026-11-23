/**
 * Post-merge hardening of the GRZ bond sale (#189, Astra review). Real HTTP, real Postgres.
 *
 * 1. Coupon income posts in its own transaction before the payment is marked paid. A sale
 *    committed in that gap used to cancel the payment, and recovery then marked the
 *    cancelled payment paid on a sold bond. Now the sale refuses while any scheduled
 *    payment has committed coupon cash, and recovery refuses a cancelled payment or one due
 *    after a sale; a sold bond's pre-sale coupon still recovers.
 * 2. A shared bond sold into a private account no longer shows the sale's figures (price,
 *    fees, basis, gain, yield, cash id) to a member who cannot see that cash.
 * Amounts are synthetic fixtures, not legal or tax claims (OI-03).
 */
import request from "supertest";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { accounts, grzBondPayments, grzBonds, transactions } from "@shared/schema";
import { db, pool } from "../../db";
import { grzCouponPaymentKey } from "../../services/grz/couponPaymentKey";
import { a, actors, app, ids, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";
import { eraseSaleHouseholds, freshSaleHouseholds } from "./grz-sale-household.fixture";

const send = (method: "get" | "put" | "post", path: string, role: Role = "owner") => request(app)[method](path)
  .set("Cookie", actors.get(role)!.cookie).set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);

/** 1000 face, 8% semiannual: coupons 40.00 gross / 6.00 withheld / 34.00 net. */
async function createBond(tenorYears = 2, maturityDate = "2027-12-31", accountId = ids.sharedAccount) {
  const created = await send("post", "/api/grz/bonds").send({ accountId, isin: "ZM0000000002",
    bondName: "R13_SALE_HARDENING", tenorYears, faceValue: "1000.00", purchasePrice: "950.00", couponRate: "0.0800",
    couponFrequency: 2, purchaseDate: "2025-06-30", firstCouponDate: "2025-12-31", maturityDate }).expect(201);
  return created.body.data.id as string;
}
const payments = (bondId: string) => db.select().from(grzBondPayments).where(eq(grzBondPayments.bondId, bondId))
  .orderBy(asc(grzBondPayments.paymentDate), asc(grzBondPayments.paymentType));
const couponDue = async (bondId: string, date: string) => (await payments(bondId)).find(row => row.paymentDate === date && row.paymentType === "coupon")!;
const pay = (paymentId: string) => send("post", `/api/grz/payments/${paymentId}/pay`).send({ accountId: ids.sharedAccount, date: "2026-07-01" });
const sell = (bondId: string, soldDate: string, accountId = ids.sharedAccount) =>
  send("put", `/api/grz/bonds/${bondId}/sell`).send({ soldDate, soldPrice: "980.50", fees: "5.25", accountId });
const couponCash = (paymentId: string) => db.select().from(transactions).where(eq(transactions.idempotencyKey, grzCouponPaymentKey(paymentId)));
const settlements = () => db.select().from(transactions).where(and(eq(transactions.householdId, a), eq(transactions.type, "asset_settlement")));
const balance = async () => (await db.select().from(accounts).where(eq(accounts.id, ids.sharedAccount)))[0].balance;

/** Commit the coupon's income posting, then fail the "paid" update: step 1 only. */
async function postIncomeOnly(paymentId: string) {
  const actual = Client.prototype.query; let rejected = false;
  const fault = vi.spyOn(Client.prototype, "query").mockImplementation(function(this: Client, ...args: unknown[]) {
    const input = args[0], text = typeof input === "string" ? input : input && typeof input === "object" && "text" in input ? String(input.text) : "";
    if (!rejected && /^\s*update\s+"grz_bond_payments"/i.test(text)) {
      rejected = true; throw new Error("Synthetic failure after coupon cash commit");
    }
    return Reflect.apply(actual, this, args);
  } as typeof Client.prototype.query);
  try { await pay(paymentId).expect(500); } finally { fault.mockRestore(); }
  expect(rejected).toBe(true);
  expect(await couponCash(paymentId)).toHaveLength(1);
  expect((await db.select().from(grzBondPayments).where(eq(grzBondPayments.id, paymentId)))[0].status).toBe("scheduled");
}

describe("R13.2 hardening: coupon/sale race and private sale figures", () => {
  beforeAll(async () => { await start(); }, 30_000);
  beforeEach(freshSaleHouseholds);
  afterEach(() => { vi.restoreAllMocks(); });
  afterAll(async () => { await eraseSaleHouseholds(); await stop(); });

  it("refuses a sale dated before a coupon whose income already committed, and the coupon still recovers", async () => {
    const bondId = await createBond();
    const coupon = await couponDue(bondId, "2026-06-30");
    await postIncomeOnly(coupon.id);
    const after = await balance();

    const refused = await sell(bondId, "2026-05-01").expect(409);
    expect(refused.body.error.message).toMatch(/already received; reconcile it before recording the sale/);
    expect((await db.select().from(grzBonds).where(eq(grzBonds.id, bondId)))[0]).toMatchObject({ status: "active", saleCashTransactionId: null });
    expect((await payments(bondId)).filter(row => row.status === "cancelled")).toEqual([]);
    expect(await settlements()).toEqual([]);
    expect(await balance()).toBe(after);

    await pay(coupon.id).expect(200);
    expect((await db.select().from(grzBondPayments).where(eq(grzBondPayments.id, coupon.id)))[0].status).toBe("paid");
    expect(await couponCash(coupon.id)).toHaveLength(1);
  });

  it("refuses a sale dated after a coupon whose income committed but is not yet marked paid", async () => {
    const bondId = await createBond();
    const coupon = await couponDue(bondId, "2026-06-30");
    await postIncomeOnly(coupon.id);
    await sell(bondId, "2026-08-15").expect(409);
    expect((await db.select().from(grzBonds).where(eq(grzBonds.id, bondId)))[0].status).toBe("active");
    expect(await settlements()).toEqual([]);
  });

  it("refuses to recover committed coupon income onto a payment that was cancelled", async () => {
    const bondId = await createBond();
    const coupon = await couponDue(bondId, "2026-06-30");
    await postIncomeOnly(coupon.id);
    // The state the race left before this fix: the sale cancelled the payment after its cash committed.
    await pool.query("UPDATE grz_bond_payments SET status='cancelled' WHERE id=$1", [coupon.id]);

    const refused = await pay(coupon.id).expect(409);
    expect(refused.body.error.message).toBe("This bond payment is no longer payable");
    const [payment] = await db.select().from(grzBondPayments).where(eq(grzBondPayments.id, coupon.id));
    expect(payment).toMatchObject({ status: "cancelled", incomeTransactionId: null, actualPaymentDate: null });
    expect(await couponCash(coupon.id)).toHaveLength(1);
  });

  it("recovers a final coupon whose income committed before principal settled the bond as matured", async () => {
    const bondId = await createBond(1, "2026-06-30");
    const coupon = await couponDue(bondId, "2026-06-30");
    await postIncomeOnly(coupon.id);
    // Principal settles between the coupon's two steps; maturity does not cancel the coupon.
    await pool.query("UPDATE grz_bonds SET status='matured' WHERE id=$1", [bondId]);

    await pay(coupon.id).expect(200);
    const [payment] = await db.select().from(grzBondPayments).where(eq(grzBondPayments.id, coupon.id));
    const [cash] = await couponCash(coupon.id);
    expect(payment).toMatchObject({ status: "paid", incomeTransactionId: cash.id, actualPaymentDate: "2026-07-01" });
    expect(await couponCash(coupon.id)).toHaveLength(1);
  });

  it.each([
    ["recovers a coupon due before the sale date", "'2026-08-15'", 200],
    ["recovers a coupon due on the sale date", "'2026-06-30'", 200],
    ["refuses a coupon due after the sale date", "'2026-05-01'", 409],
    ["refuses when the sale has no date", "NULL", 409],
  ] as const)("on a legacy sold bond whose coupon income committed, %s", async (_label, soldDate, status) => {
    const bondId = await createBond();
    const coupon = await couponDue(bondId, "2026-06-30");
    await postIncomeOnly(coupon.id);
    // A legacy sold row (no sale settlement fields) with the coupon still scheduled.
    await pool.query(`UPDATE grz_bonds SET status='sold', sold_date=${soldDate}, sold_price=980.50 WHERE id=$1`, [bondId]);

    const reply = await pay(coupon.id).expect(status);
    const [cash] = await couponCash(coupon.id);
    const [payment] = await db.select().from(grzBondPayments).where(eq(grzBondPayments.id, coupon.id));
    if (status === 200) {
      expect(payment).toMatchObject({ status: "paid", incomeTransactionId: cash.id, actualPaymentDate: "2026-07-01" });
    } else {
      expect(reply.body.error.message).toBe("This bond payment is no longer payable");
      expect(payment).toMatchObject({ status: "scheduled", incomeTransactionId: null });
    }
    expect(await couponCash(coupon.id)).toHaveLength(1);
  });

  it("still refuses a second pay of a paid coupon with the existing 409", async () => {
    const bondId = await createBond();
    const coupon = await couponDue(bondId, "2026-06-30");
    await pay(coupon.id).expect(200);
    const again = await pay(coupon.id).expect(409);
    expect(again.body.error.message).toBe("Payment is already marked as paid");
  });

  // Item 2: a bond sold into a private account keeps its figures private.
  const saleFields = ["soldPrice", "soldYield", "saleCashTransactionId", "saleFees", "saleCostBasis", "saleRealizedGain"] as const;
  const listed = async (role: Role, bondId: string) =>
    ((await send("get", "/api/grz/bonds", role).expect(200)).body.data as Array<Record<string, unknown>>).find(row => row.id === bondId);

  it("shows another member the bond as sold with the sale figures hidden, and the seller sees them", async () => {
    const bondId = await createBond();
    await send("put", `/api/grz/bonds/${bondId}/sell`)
      .send({ soldDate: "2026-08-15", soldPrice: "980.50", fees: "5.25", soldYield: 0.081, accountId: ids.privateAccount }).expect(200);

    const seen = await listed("owner", bondId);
    expect(seen).toMatchObject({ status: "sold", soldDate: "2026-08-15", soldPrice: { amount: "980.50", currency: "ZMW" }, saleFees: { amount: "5.25", currency: "ZMW" },
      saleCostBasis: { amount: "950.00", currency: "ZMW" }, saleRealizedGain: { amount: "25.25", currency: "ZMW" }, soldYield: "0.0810" });
    expect(seen?.saleCashTransactionId).toEqual(expect.any(String));

    const other = await listed("member", bondId);
    expect(other).toMatchObject({ status: "sold", soldDate: "2026-08-15" });
    for (const field of saleFields) expect(other?.[field]).toBeNull();
    expect(JSON.stringify(other)).not.toContain(String(seen?.saleCashTransactionId));
  });

  // A-03: the sale's investment row sits on the destination account. A bond held in a
  // private custody account must not be named to members who see only that destination.
  const activity = async (role: Role) => (await send("get", "/api/investments/transactions", role).expect(200)).text;
  it("keeps a privately held bond's name and ISIN out of the shared destination's investment activity", async () => {
    const bondId = await createBond(2, "2027-12-31", ids.privateAccount);
    await sell(bondId, "2026-08-15").expect(200);
    const seen = await activity("member");
    expect(seen).toContain("GRZ Bond Sale");
    for (const identity of ["R13_SALE_HARDENING", "ZM0000000002", bondId]) expect(seen).not.toContain(identity);
    expect(await listed("member", bondId)).toBeUndefined();
    // The holder still sees the bond itself, with its name, in the bond list.
    expect(await listed("owner", bondId)).toMatchObject({ bondName: "R13_SALE_HARDENING", status: "sold" });
  });

  it("names a shared bond in the sale's investment activity", async () => {
    await sell(await createBond(), "2026-08-15").expect(200);
    expect(await activity("member")).toContain("GRZ Bond Sale: R13_SALE_HARDENING (ZM0000000002)");
  });

  it("shows every member the sale figures when the cash went to a shared account", async () => {
    const bondId = await createBond();
    await sell(bondId, "2026-08-15").expect(200);
    expect(await listed("member", bondId)).toMatchObject({ status: "sold", soldPrice: { amount: "980.50", currency: "ZMW" }, saleFees: { amount: "5.25", currency: "ZMW" }, saleRealizedGain: { amount: "25.25", currency: "ZMW" } });
  });
});
