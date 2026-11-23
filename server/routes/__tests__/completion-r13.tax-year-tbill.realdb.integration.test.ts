import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { accounts, grzBondPayments, grzBonds, grzTBills, households, investmentTransactions, transactions } from "@shared/schema";
import { db } from "../../db";
import { processTBillMaturities } from "../../services/investment/processTBillMaturities";
import { calendarClock } from "../../services/householdCalendarToday";
import { runTBillMaturities } from "../../core/scheduling/jobRunners";
import { logger } from "../../utils/logger";
import { businessAuditService } from "../../services/BusinessAuditService";
import { investmentAutomationService } from "../../services/InvestmentAutomationService";
import { tbillMaturityIncomeKey } from "../../services/investment/investmentCronKeys";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";
import { postCronDoor } from "../../__tests__/cron-door-fixture";

// NEW-22: GRZ interest and withholding come from the real coupon and T-bill
// postings, the ZRA export carries them, and the tax year follows the
// household's own calendar so each event falls in exactly one year.
// Dates are in the past relative to the real clock so the cron and the
// ledger see them as already due; only the household calendar instant is pinned.
const year = new Date().getUTCFullYear() - 1;
const tbillName = "R13_TBILL_TAX", bondName = "R13_TZ_COUPON";
const headers = (req: request.Test, role: Role) => req.set("Cookie", actors.get(role)!.cookie)
  .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);
const get = (path: string, role: Role = "owner") => headers(request(app).get(path), role);
const post = (path: string) => headers(request(app).post(path), "owner");
const summary = (taxYear?: number, role: Role = "owner") =>
  get(`/api/investments/tax/summary${taxYear === undefined ? "" : `?year=${taxYear}`}`, role);
const zra = (taxYear: number, role: Role = "owner") => get(`/api/investments/tax/zra-export?year=${taxYear}&format=json`, role);

async function clean() {
  const bonds = await db.select({ id: grzBonds.id }).from(grzBonds).where(inArray(grzBonds.householdId, [a, b]));
  if (bonds.length) await db.delete(grzBondPayments).where(inArray(grzBondPayments.bondId, bonds.map(row => row.id)));
  await db.delete(grzBonds).where(inArray(grzBonds.householdId, [a, b]));
  await db.delete(grzTBills).where(inArray(grzTBills.householdId, [a, b]));
  await db.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b]));
  await db.update(households).set({ timeZone: null }).where(eq(households.id, a));
}
async function tbill(accountId: string, faceValue: string, purchasePrice: string, maturityDate: string) {
  await db.insert(grzTBills).values({ id: randomUUID(), householdId: a, accountId, tbillName, tenorDays: 364, faceValue, purchasePrice,
    purchaseDate: `${year - 1}-12-31`, maturityDate, status: "active" });
}
/** A-36: the member confirms the bank credit of a due bill into the shared account. */
async function confirmReceipt(billId: string, amount: string) {
  await post(`/api/grz/tbills/${billId}/confirm-receipt`).send({ operationId: randomUUID(), accountId: ids.sharedAccount,
    date: `${year + 1}-01-05`, receiptConfirmed: true, receivedAmount: { amount, currency: "ZMW" } }).expect(200);
}
async function couponDueOn(dueDate: string) {
  const created = await post("/api/grz/bonds").send({ accountId: ids.sharedAccount, isin: "ZM0000000002", bondName, tenorYears: 1,
    faceValue: "1000.00", purchasePrice: "950.00", couponRate: "0.0800", couponFrequency: 2,
    purchaseDate: `${year - 1}-06-30`, firstCouponDate: dueDate, maturityDate: dueDate }).expect(201);
  const [coupon] = await db.select().from(grzBondPayments)
    .where(and(eq(grzBondPayments.bondId, created.body.data.id), eq(grzBondPayments.paymentType, "coupon")));
  return coupon.id;
}
async function pinCalendar(timeZone: string, instant: string) {
  await db.update(households).set({ timeZone }).where(eq(households.id, a));
  vi.spyOn(calendarClock, "now").mockReturnValue(new Date(instant));
}

describe("R13.3 NEW-22 GRZ tax sources and the household tax-year calendar", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clean(); await reset();
    await db.update(accounts).set({ type: "investment" }).where(eq(accounts.id, ids.sharedAccount));
  });
  afterEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => { await clean(); await stop(); });

  it("reports matured T-bill discount as interest with its withholding, once, in the maturity year", async () => {
    await tbill(ids.sharedAccount, "10000.00", "8000.00", `${year}-12-31`);
    await tbill(ids.sharedAccount, "5000.00", "4500.00", `${year + 1}-01-01`);
    expect((await processTBillMaturities()).matured).toBeGreaterThanOrEqual(2);
    expect((await summary(year).expect(200)).body).toMatchObject({
      interestIncome: "2000.00", totalWht: "300.00", grossIncome: "2000.00", netIncome: "1700.00", currency: "ZMW" });
    expect((await zra(year).expect(200)).body).toEqual([expect.objectContaining({
      date: `${year}-12-31`, type: "interest", security: tbillName, grossAmount: "2000.00", whtPaid: "300.00", netAmount: "1700.00" })]);
    expect((await summary(year + 1).expect(200)).body).toMatchObject({ interestIncome: "500.00", totalWht: "75.00", netIncome: "425.00" });
    expect((await zra(year + 1).expect(200)).body).toEqual([expect.objectContaining({
      date: `${year + 1}-01-01`, grossAmount: "500.00", whtPaid: "75.00", netAmount: "425.00" })]);
  });

  // NEW-23: zero is not positive. A bill bought at face earns no discount, so
  // its confirmed receipt has no interest income row, never a K0.00 one (A-36).
  it("matures a T-bill bought at face with no interest income row, reporting zero interest", async () => {
    await tbill(ids.sharedAccount, "5000.00", "5000.00", `${year}-12-31`);
    await processTBillMaturities();
    const [due] = await db.select().from(grzTBills).where(eq(grzTBills.householdId, a));
    expect(due).toMatchObject({ status: "awaiting_receipt", maturityWithholdingTax: "0.00", maturityNetProceeds: "5000.00" });
    expect((await summary(year).expect(200)).body).toMatchObject({
      interestIncome: "0.00", totalWht: "0.00", grossIncome: "0.00", netIncome: "0.00", currency: "ZMW" });
    await confirmReceipt(due.id, "5000.00");
    const [bill] = await db.select().from(grzTBills).where(eq(grzTBills.householdId, a));
    expect(bill).toMatchObject({ status: "matured", maturityIncomeTxId: null });
    const [payout] = await db.select().from(investmentTransactions).where(eq(investmentTransactions.id, bill.maturityInvestmentTxId!));
    expect(payout).toMatchObject({ type: "maturity", amount: "5000.00", withholdingTax: "0.00" });
    expect(await db.select().from(transactions).where(eq(transactions.idempotencyKey, tbillMaturityIncomeKey(bill.id)))).toEqual([]);
    expect((await summary(year).expect(200)).body).toMatchObject({
      interestIncome: "0.00", totalWht: "0.00", grossIncome: "0.00", netIncome: "0.00", currency: "ZMW" });
  });

  // A-41: interest 0.10 gives withholding 0.015. Rounding it, the net interest
  // and the proceeds separately stored 0.02 / 0.09 / 99.99 (above face), so the
  // tax reader refused the row. One rounding: 0.02, then 0.08 and 99.98.
  it("books a half-cent withholding once, so proceeds are face less the booked withholding and the tax summary accepts it", async () => {
    await tbill(ids.sharedAccount, "100.00", "99.90", `${year}-12-31`);
    expect((await processTBillMaturities()).matured).toBe(1);
    const [due] = await db.select().from(grzTBills).where(eq(grzTBills.householdId, a));
    expect(due).toMatchObject({ status: "awaiting_receipt", maturityWithholdingTax: "0.02", maturityNetProceeds: "99.98" });
    await confirmReceipt(due.id, "99.98");
    const [bill] = await db.select().from(grzTBills).where(eq(grzTBills.householdId, a));
    const [payout] = await db.select().from(investmentTransactions).where(eq(investmentTransactions.id, bill.maturityInvestmentTxId!));
    expect(payout).toMatchObject({ type: "maturity", amount: "99.98", withholdingTax: "0.02" });
    const [income] = await db.select().from(transactions).where(eq(transactions.id, bill.maturityIncomeTxId!));
    expect(income).toMatchObject({ amount: "0.08", type: "income" });
    expect((await summary(year).expect(200)).body).toMatchObject({
      interestIncome: "0.10", totalWht: "0.02", grossIncome: "0.10", netIncome: "0.08", currency: "ZMW" });
    expect((await zra(year).expect(200)).body).toEqual([expect.objectContaining({
      security: tbillName, grossAmount: "0.10", whtPaid: "0.02", netAmount: "0.08" })]);
  });

  it("keeps a manual maturity row with no T-bill out of interest, counting only its withholding as before", async () => {
    await tbill(ids.sharedAccount, "10000.00", "8000.00", `${year}-12-31`);
    await processTBillMaturities();
    // A user-entered maturity (no grz_tbills row) is not T-bill interest.
    await db.insert(investmentTransactions).values({ householdId: a, accountId: ids.sharedAccount, type: "maturity",
      amount: "1000.00", withholdingTax: "25.00", currency: "ZMW", transactionDate: `${year}-06-30` });
    expect((await summary(year).expect(200)).body).toMatchObject({
      interestIncome: "2000.00", totalWht: "325.00", grossIncome: "2000.00", netIncome: "1675.00", currency: "ZMW" });
    expect((await zra(year).expect(200)).body).toEqual([expect.objectContaining({ security: tbillName, grossAmount: "2000.00" })]);
  });

  it("keeps a T-bill held in another member's private account out of a peer's summary and export", async () => {
    await tbill(ids.privateAccount, "10000.00", "8000.00", `${year}-12-31`);
    await processTBillMaturities();
    expect((await summary(year).expect(200)).body).toMatchObject({ interestIncome: "2000.00", totalWht: "300.00" });
    for (const role of ["admin", "member", "view_only", "professional"] as const) {
      expect((await summary(year, role).expect(200)).body).toMatchObject({ interestIncome: "0.00", totalWht: "0.00" });
    }
    expect((await zra(year, "member").expect(200)).body).toEqual([]);
  });

  it("on 31 Dec 23:30 in New York, counts that day's coupon in its own year and refuses 1 Jan as future", async () => {
    const couponId = await couponDueOn(`${year}-12-31`);
    await pinCalendar("America/New_York", `${year + 1}-01-01T04:30:00Z`);
    expect((await post(`/api/grz/payments/${couponId}/pay`).send({ accountId: ids.sharedAccount, date: `${year + 1}-01-01` })).status).toBe(400);
    await post(`/api/grz/payments/${couponId}/pay`).send({ accountId: ids.sharedAccount, date: `${year}-12-31` }).expect(200);
    expect((await summary(year).expect(200)).body).toMatchObject({ interestIncome: "40.00", totalWht: "6.00", netIncome: "34.00" });
    expect((await summary(year + 1).expect(200)).body.interestIncome).toBe("0.00");
    expect((await summary().expect(200)).body.year).toBe(year);
  });

  it("on 1 Jan 00:30 in Lusaka, accepts that day's coupon and counts it only in the new year", async () => {
    const couponId = await couponDueOn(`${year + 1}-01-01`);
    await pinCalendar("Africa/Lusaka", `${year}-12-31T22:30:00Z`);
    await post(`/api/grz/payments/${couponId}/pay`).send({ accountId: ids.sharedAccount, date: `${year + 1}-01-01` }).expect(200);
    expect((await summary(year + 1).expect(200)).body).toMatchObject({ interestIncome: "40.00", totalWht: "6.00" });
    expect((await summary(year).expect(200)).body.interestIncome).toBe("0.00");
    expect((await zra(year + 1).expect(200)).body).toEqual([expect.objectContaining({ date: `${year + 1}-01-01`, type: "coupon", grossAmount: "40.00" })]);
    expect((await summary().expect(200)).body.year).toBe(year + 1);
  });

  // NEW-22 residuals: the T-bill cron and the tax report's default year use the
  // household's calendar date. 22:30 UTC on 31 Dec is 00:30 on 1 Jan in Lusaka
  // and 17:30 on 31 Dec in New York.
  describe("maturity and the report year follow the household calendar", () => {
    const instant = `${year}-12-31T22:30:00Z`;
    const status = async () => (await db.select({ status: grzTBills.status }).from(grzTBills).where(eq(grzTBills.householdId, a)))[0]?.status;

    it("matures a T-bill due 1 January at 00:30 in Lusaka", async () => {
      await tbill(ids.sharedAccount, "5000.00", "4500.00", `${year + 1}-01-01`);
      await pinCalendar("Africa/Lusaka", instant);
      await processTBillMaturities();
      expect(await status()).toBe("awaiting_receipt");
    });

    it("leaves a T-bill due 1 January active, and uncounted, at 17:30 on 31 December in New York", async () => {
      await tbill(ids.sharedAccount, "5000.00", "4500.00", `${year + 1}-01-01`);
      await pinCalendar("America/New_York", instant);
      const info = vi.spyOn(logger, "info");
      const result = await processTBillMaturities();
      // #254 review: a bill not yet due in its household's calendar is counted and logged, not skipped.
      expect(result).toMatchObject({ matured: 0, skipped: 0, notDue: 1, failed: 0 });
      expect(info).toHaveBeenCalledWith("T-Bill maturity run", expect.objectContaining({ notDue: 1 }));
      expect(await runTBillMaturities()).toMatchObject({ matured: 0, notDue: 1 });
      expect(await status()).toBe("active");
      expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a))).toEqual([]);
    });

    it("gives the report's current year from the household calendar, for any member", async () => {
      await pinCalendar("Africa/Lusaka", instant);
      expect((await get("/api/investments/tax/year", "member").expect(200)).body).toEqual({ year: year + 1 });
      await pinCalendar("America/New_York", instant);
      expect((await get("/api/investments/tax/year").expect(200)).body).toEqual({ year });
    });
  });

  // NEW-23: a bill the cron cannot mature comes back as its id and a stable code.
  // The error text (which may carry SQL, hosts or values) stays in the server log.
  describe("a failed maturity reports a code and the bill id, never the error text", () => {
    const SECRET = "SYNTHETIC_SECRET_DETAIL host=10.9.8.7";
    const billIdOf = async () => (await db.select({ id: grzTBills.id }).from(grzTBills).where(eq(grzTBills.householdId, a)))[0].id;
    const status = async () => (await db.select({ status: grzTBills.status }).from(grzTBills).where(eq(grzTBills.householdId, a)))[0].status;

    it("returns the typed code of a known refusal", async () => {
      await tbill(ids.sharedAccount, "5000.00", "4500.00", `${year}-06-30`);
      await db.update(households).set({ timeZone: "Not/AZone" }).where(eq(households.id, a));
      const billId = await billIdOf();

      const result = await processTBillMaturities();

      expect(result.errors.filter(failure => failure.billId === billId)).toEqual([{ billId, code: "HOUSEHOLD_CALENDAR_UNAVAILABLE" }]);
      expect(await status()).toBe("active");
    });

    it("returns TBILL_MATURITY_FAILED for anything else, logs the detail with context, and the cron route answers a bounded failure", async () => {
      await tbill(ids.sharedAccount, "5000.00", "4500.00", `${year}-06-30`);
      const billId = await billIdOf();
      const failure = new Error(SECRET);
      vi.spyOn(businessAuditService, "log").mockRejectedValue(failure);
      const logged = vi.spyOn(logger, "error");

      const result = await processTBillMaturities();

      expect(result.errors.filter(entry => entry.billId === billId)).toEqual([{ billId, code: "TBILL_MATURITY_FAILED" }]);
      expect(JSON.stringify(result)).not.toContain("SYNTHETIC_SECRET");
      expect(logged).toHaveBeenCalledWith("Failed to mature T-Bill",
        expect.objectContaining({ billId, householdId: a, code: "TBILL_MATURITY_FAILED" }), failure);
      expect(await status()).toBe("active");

      vi.stubEnv("CRON_SECRET", "synthetic-cron-secret-not-real-use");
      vi.spyOn(investmentAutomationService, "processDueInvestments").mockResolvedValue({ success: 0, skipped: 0, held: 0, failed: 0, errors: [] });
      const cron = await postCronDoor(app, "investment-automation", "synthetic-cron-secret-not-real-use");
      // The door journals the maturity run as a partial failure and answers its bounded code only.
      expect(cron.status).toBe(500);
      expect(JSON.stringify(cron.body)).not.toContain("SYNTHETIC_SECRET");
      expect(cron.body.jobs).toEqual([
        expect.objectContaining({ name: "investments.tbill-maturity", status: "failed", errorCode: "PARTIAL_FAILURE",
          summary: expect.objectContaining({ failed: expect.any(Number) }) }),
        expect.objectContaining({ name: "investments.recurring-purchase", status: "completed" }),
      ]);
      vi.unstubAllEnvs();
    });
  });
});
