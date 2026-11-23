/**
 * NEW-23 (R13.3): GRZ bond and T-bill acquisition records refuse impossible
 * values over real HTTP and write nothing: face value and price must be
 * positive two-decimal amounts, maturity must follow purchase, a bill cannot be
 * priced above face and its tenor must be positive. A bill bought at face
 * (zero interest) stays valid.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import { accounts, auditLogs, grzBondPayments, grzBonds, grzTBills, investmentTransactions, transactions } from "@shared/schema";
import { db } from "../../db";
import { processTBillMaturities } from "../../services/investment/processTBillMaturities";
import { a, b, actors, app, ids, reset, start, stop } from "../../modules/tags/__tests__/completion-r04.tags.fixture";

const post = (path: string) => request(app).post(path).set("Cookie", actors.get("owner")!.cookie)
  .set("X-Capital-Subject", actors.get("owner")!.id).set("X-Capital-Household", a);
const bond = (overrides: Record<string, unknown> = {}) => ({ accountId: ids.sharedAccount, isin: "ZM0000000001", bondName: "R13_CREATE_BOND",
  tenorYears: 2, faceValue: "1000.00", purchasePrice: "950.00", couponRate: "0.0800", couponFrequency: 2,
  purchaseDate: "2025-06-30", firstCouponDate: "2025-12-31", maturityDate: "2027-12-31", ...overrides });
const bill = (overrides: Record<string, unknown> = {}) => ({ accountId: ids.sharedAccount, isin: "ZM0000000002", tbillName: "R13_CREATE_BILL",
  tenorDays: 91, faceValue: "1000.00", purchasePrice: "970.00", purchaseDate: "2026-07-01", maturityDate: "2026-09-30", ...overrides });

async function clean() {
  const owned = await db.select({ id: grzBonds.id }).from(grzBonds).where(inArray(grzBonds.householdId, [a, b]));
  if (owned.length) await db.delete(grzBondPayments).where(inArray(grzBondPayments.bondId, owned.map(row => row.id)));
  await db.delete(grzBonds).where(inArray(grzBonds.householdId, [a, b]));
  await db.delete(grzTBills).where(inArray(grzTBills.householdId, [a, b]));
  // A-42's maturity case books a payout and its interest income.
  await db.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b]));
  await db.delete(transactions).where(and(inArray(transactions.householdId, [a, b]), like(transactions.name, "T-Bill Interest:%")));
}
const written = async () => ({ bonds: await db.select().from(grzBonds).where(inArray(grzBonds.householdId, [a, b])),
  bills: await db.select().from(grzTBills).where(inArray(grzTBills.householdId, [a, b])),
  // Only this file's actors: another file's system maturity run may audit its own bills.
  // A private holding's audit has no household but still names the acting user.
  audit: await db.select().from(auditLogs).where(and(inArray(auditLogs.entityType, ["grz_bond", "grz_tbill"]),
    inArray(auditLogs.userId, [...actors.values()].map(actor => actor.id)))) });

describe("R13.3 GRZ acquisition records refuse impossible values", () => {
  beforeAll(async () => { await start(); }, 30_000);
  beforeEach(async () => { await clean(); await reset(); });
  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  it.each([
    ["zero face value", { faceValue: "0.00" }],
    ["negative face value", { faceValue: "-1000.00" }],
    ["malformed face value", { faceValue: "1e3" }],
    ["zero purchase price", { purchasePrice: "0.00" }],
    ["negative purchase price", { purchasePrice: "-950.00" }],
    ["three-decimal price", { purchasePrice: "950.001" }],
    ["maturity before purchase", { purchaseDate: "2028-01-01" }],
    ["zero tenor", { tenorYears: 0 }],
  ])("refuses a bond with %s", async (_label, overrides) => {
    await post("/api/grz/bonds").send(bond(overrides)).expect(400);
    expect(await written()).toEqual({ bonds: [], bills: [], audit: [] });
  });

  it.each([
    ["zero face value", { faceValue: "0.00", purchasePrice: "0.00" }],
    ["negative face value", { faceValue: "-1000.00" }],
    ["malformed price", { purchasePrice: "abc" }],
    ["zero price", { purchasePrice: "0.00" }],
    ["price above face", { purchasePrice: "1000.01" }],
    ["maturity before purchase", { maturityDate: "2026-06-30" }],
    ["maturity on purchase", { maturityDate: "2026-07-01" }],
    ["zero tenor", { tenorDays: 0 }],
    ["negative tenor", { tenorDays: -91 }],
    // A-42: the maturity job cannot settle a bill that names no account.
    ["no settlement account", { accountId: undefined }],
    ["a null settlement account", { accountId: null }],
  ])("refuses a T-bill with %s", async (_label, overrides) => {
    await post("/api/grz/tbills").send(bill(overrides)).expect(400);
    expect(await written()).toEqual({ bonds: [], bills: [], audit: [] });
  });

  it.each([
    ["a non-ZMW account", { currency: "USD" }],
    ["a ZMW liability account", { type: "credit", isAsset: false }],
    ["an archived ZMW asset account", { isArchived: true }],
  ] as const)("A-42: refuses a T-bill settling into %s", async (_label, overrides) => {
    const [settlement] = await db.insert(accounts).values({
      householdId: a,
      ownerUserId: actors.get("owner")!.id,
      name: "Synthetic settlement account",
      type: "checking",
      currency: "ZMW",
      isAsset: true,
      isArchived: false,
      isPrivate: false,
      initialBalance: "0.00",
      balance: "0.00",
      ...overrides,
    }).returning({ id: accounts.id });

    const response = await post("/api/grz/tbills").send(bill({ accountId: settlement.id })).expect(400);
    expect(response.body.error).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await written()).toEqual({ bonds: [], bills: [], audit: [] });
  });

  it("A-42: a T-bill recorded with its settlement account matures into that account", async () => {
    // Due 2026-09-30, already past: the next maturity run makes it due, and the
    // confirmed receipt (A-36) pays into the recorded account.
    const created = await post("/api/grz/tbills").send(bill()).expect(201);
    const run = await processTBillMaturities();
    expect(run.errors).not.toContainEqual(expect.objectContaining({ billId: created.body.data.id }));
    await post(`/api/grz/tbills/${created.body.data.id}/confirm-receipt`).send({ operationId: randomUUID(),
      accountId: ids.sharedAccount, date: "2026-10-01", receiptConfirmed: true, receivedAmount: { amount: "995.50", currency: "ZMW" } }).expect(200);
    const [matured] = await db.select().from(grzTBills).where(eq(grzTBills.id, created.body.data.id));
    expect(matured).toMatchObject({ status: "matured", accountId: ids.sharedAccount });
    const [income] = await db.select().from(transactions).where(eq(transactions.id, matured.maturityIncomeTxId!));
    expect(income).toMatchObject({ accountId: ids.sharedAccount, amount: "25.50", type: "income" });
  });

  it("accepts a valid bond and a zero-interest T-bill bought at face", async () => {
    await post("/api/grz/bonds").send(bond()).expect(201);
    const atFace = await post("/api/grz/tbills").send(bill({ purchasePrice: "1000.00" })).expect(201);
    expect(atFace.body.data).toMatchObject({ faceValue: { amount: "1000.00", currency: "ZMW" }, purchasePrice: { amount: "1000.00", currency: "ZMW" }, discountAmount: { amount: "0.00", currency: "ZMW" } });
    const after = await written();
    expect([after.bonds.length, after.bills.length]).toEqual([1, 1]);
  });

  it("NEW-35: answers every GRZ amount as ZMW MoneyDto and labels its conventions as policy defaults pending OI-03", async () => {
    const zmw = (amount: string) => ({ amount, currency: "ZMW" });
    const createdBond = await post("/api/grz/bonds").send(bond()).expect(201);
    expect(createdBond.body.data).toMatchObject({ faceValue: zmw("1000.00"), purchasePrice: zmw("950.00"),
      couponRate: "0.0800", soldPrice: null, saleFees: null, saleCostBasis: null, saleRealizedGain: null });
    const createdBill = await post("/api/grz/tbills").send(bill()).expect(201);
    expect(createdBill.body.data).toMatchObject({ faceValue: zmw("1000.00"), purchasePrice: zmw("970.00"), discountAmount: zmw("30.00") });

    const get = (path: string) => request(app).get(path).set("Cookie", actors.get("owner")!.cookie)
      .set("X-Capital-Subject", actors.get("owner")!.id).set("X-Capital-Household", a);
    const bonds = (await get("/api/grz/bonds").expect(200)).body;
    const listed = bonds.data.find((row: { id: string }) => row.id === createdBond.body.data.id);
    expect(listed).toMatchObject({ faceValue: zmw("1000.00"), purchasePrice: zmw("950.00") });
    // Semi-annual 8% from 2025-12-31 to 2027-12-31: five 40.00 coupons withheld at the 15% policy default, then the principal.
    expect(listed.payments.map((row: { paymentType: string; grossAmount: unknown; withholdingTax: unknown; netAmount: unknown }) =>
      [row.paymentType, row.grossAmount, row.withholdingTax, row.netAmount])).toEqual([
      ...Array.from({ length: 5 }, () => ["coupon", zmw("40.00"), zmw("6.00"), zmw("34.00")]),
      ["principal", zmw("1000.00"), zmw("0.00"), zmw("1000.00")],
    ]);
    const bills = (await get("/api/grz/tbills").expect(200)).body;
    expect(bills.data.find((row: { id: string }) => row.id === createdBill.body.data.id))
      .toMatchObject({ faceValue: zmw("1000.00"), purchasePrice: zmw("970.00"), discountAmount: zmw("30.00") });

    for (const body of [bonds, bills]) {
      expect(body.meta.policy).toMatchObject({ status: "policy_default_pending_OI-03", label: "Policy default, pending OI-03",
        couponWithholding: { value: "0.15" }, tbillDiscountWithholding: { value: "0.15" }, principalWithholding: { value: "0" },
        bondSaleWithholding: { value: "0" }, tbillYieldDayBasis: { value: "ACT/365" }, auctionYieldDayBasis: { value: "ACT/360" },
        accruedInterestDayCount: { value: "ACT/365" } });
    }
  });
});
