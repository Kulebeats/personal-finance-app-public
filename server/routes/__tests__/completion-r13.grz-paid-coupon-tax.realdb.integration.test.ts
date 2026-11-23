import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { accounts, auditLogs, grzBondPayments, grzBonds, holdings, investmentTransactions, securities, transactions } from "@shared/schema";
import { db, pool } from "../../db";
import { Money } from "../../core/money";
import { grzCouponPaymentKey } from "../../services/grz/couponPaymentKey";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";

const custodyId = randomUUID(), bondName = "R13_REAL_PAID_COUPON";
const securityId = randomUUID(), holdingId = randomUUID();
let date: string, year: number;
const get = (path: string, role: Role = "owner") => request(app).get(path).set("Cookie", actors.get(role)!.cookie)
  .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);
const post = (path: string) => request(app).post(path).set("Cookie", actors.get("owner")!.cookie)
  .set("X-Capital-Subject", actors.get("owner")!.id).set("X-Capital-Household", a);
const summaryPath = () => `/api/investments/tax/summary?year=${year}`;
const exportPath = (format = "json") => `/api/investments/tax/zra-export?year=${year}&format=${format}`;
async function clean() {
  const owned = await db.select({ id: grzBonds.id }).from(grzBonds).where(inArray(grzBonds.householdId, [a, b]));
  if (owned.length) await db.delete(grzBondPayments).where(inArray(grzBondPayments.bondId, owned.map(row => row.id)));
  await db.delete(grzBonds).where(inArray(grzBonds.householdId, [a, b]));
  await db.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b]));
  await db.delete(holdings).where(eq(holdings.id, holdingId));
  await db.delete(securities).where(eq(securities.id, securityId));
}

describe("R13.3 real GRZ coupon cash and original proof feed tax readers without a synthetic investment row", () => {
  beforeAll(async () => {
    await start();
    date = (await db.execute<{ date: string }>(sql`select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD') as date`)).rows[0].date;
    year = Number(date.slice(0, 4));
  }, 30_000);
  beforeEach(async () => { await clean(); await reset(); });
  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  it.each(["shared", "private custody", "private cash", "private destination", "no custody"])("reports actual booked gross40/withheld6/net34 once, preserving %s ownership", async privacy => {
    const owner = actors.get("owner")!.id;
    await db.insert(accounts).values({ id: custodyId, householdId: a, name: "Synthetic coupon custody", type: "investment",
      balance: "0.00", currency: "ZMW", isAsset: true, isPrivate: privacy === "private custody", ownerUserId: owner });
    const created = await post("/api/grz/bonds").send({ accountId: privacy === "no custody" ? undefined : custodyId, isin: "ZM0000000001", bondName, tenorYears: 1,
      faceValue: "1000.00", purchasePrice: "950.00", couponRate: "0.0800", couponFrequency: 2,
      purchaseDate: "2025-06-30", firstCouponDate: date, maturityDate: date }).expect(201);
    const bondId = created.body.data.id;
    const [coupon] = await db.select().from(grzBondPayments).where(and(eq(grzBondPayments.bondId, bondId), eq(grzBondPayments.paymentType, "coupon")));
    expect(coupon).toMatchObject({ grossAmount: "40.00", withholdingTax: "6.00", netAmount: "34.00", status: "scheduled" });
    const [before] = await db.select().from(accounts).where(eq(accounts.id, ids.sharedAccount));
    if (privacy === "private destination") await db.update(accounts).set({ isPrivate: true, ownerUserId: owner }).where(eq(accounts.id, ids.sharedAccount));
    await post(`/api/grz/payments/${coupon.id}/pay`).send({ accountId: ids.sharedAccount, date }).expect(200);
    const [paid] = await db.select().from(grzBondPayments).where(eq(grzBondPayments.id, coupon.id));
    expect(paid).toMatchObject({ status: "paid", actualPaymentDate: date, grossAmount: "40.00", withholdingTax: "6.00", netAmount: "34.00", investmentTransactionId: null });
    const [cash] = await db.select().from(transactions).where(eq(transactions.id, paid.incomeTransactionId!));
    expect(cash).toMatchObject({ type: "income", amount: "34.00", currency: "ZMW", accountId: ids.sharedAccount, date, postingMode: "posted" });
    expect((await db.select().from(accounts).where(eq(accounts.id, ids.sharedAccount)))[0].balance)
      .toBe(new Money(before.balance, "ZMW").add("34.00").toString());
    const proof = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "transaction"), eq(auditLogs.entityId, cash.id), eq(auditLogs.action, "CREATE")));
    expect(proof).toHaveLength(1);
    expect(proof[0].details).toMatchObject({ newValue: { amount: "34.00", currency: "ZMW", date, type: "income" },
      grzCoupon: { version: 1, paymentId: coupon.id, bondId, dueDate: date, paymentType: "coupon", grossAmount: "40.00", withholdingTax: "6.00", netAmount: "34.00", currency: "ZMW" } });
    // Only the privacy flag changes here; the actual cash/posting, amounts and
    // original proof came through the signed production workflow above.
    if (privacy === "private cash") await db.update(transactions).set({ isPrivate: true, ownerUserId: owner }).where(eq(transactions.id, cash.id));
    expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a))).toEqual([]);

    const ownerSummary = await get(summaryPath()).expect(200);
    expect.soft(ownerSummary.body).toMatchObject({ interestIncome: "40.00", grossIncome: "40.00", totalWht: "6.00", netIncome: "34.00", currency: "ZMW" });
    const ownerJson = await get(exportPath()).expect(200), ownerCsv = await get(exportPath("csv")).expect(200);
    expect.soft(ownerJson.body).toEqual([expect.objectContaining({ date, type: "coupon", security: bondName, grossAmount: "40.00", whtPaid: "6.00", netAmount: "34.00" })]);
    expect.soft(ownerCsv.text).toContain(bondName); expect.soft(ownerCsv.text).toContain('"40.00","6.00","34.00"');
    for (const role of ["admin", "member", "view_only", "professional"] as const) {
      const peer = await get(summaryPath(), role).expect(200);
      expect.soft(peer.body).toMatchObject({ interestIncome: privacy === "shared" ? "40.00" : "0.00",
        grossIncome: privacy === "shared" ? "40.00" : "0.00", totalWht: privacy === "shared" ? "6.00" : "0.00",
        netIncome: privacy === "shared" ? "34.00" : "0.00" });
    }
    const peerJson = await get(exportPath(), "member").expect(200), peerCsv = await get(exportPath("csv"), "member").expect(200);
    if (privacy === "shared") expect.soft(peerJson.body).toEqual(ownerJson.body);
    else { expect.soft(peerJson.body).toEqual([]); expect.soft(peerCsv.text).not.toContain(bondName); }

    const [after] = await db.select().from(accounts).where(eq(accounts.id, ids.sharedAccount));
    await post(`/api/grz/payments/${coupon.id}/pay`).send({ accountId: ids.sharedAccount, date }).expect(409);
    expect((await db.select().from(accounts).where(eq(accounts.id, ids.sharedAccount)))[0].balance).toBe(after.balance);
    const replaySummary = await get(summaryPath()).expect(200), replayJson = await get(exportPath()).expect(200);
    expect.soft(replaySummary.body).toMatchObject({ grossIncome: "40.00", totalWht: "6.00", netIncome: "34.00" });
    expect.soft(replayJson.body).toEqual(ownerJson.body);
    expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a))).toEqual([]);
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "transaction"), eq(auditLogs.entityId, cash.id), eq(auditLogs.action, "CREATE")))).toHaveLength(1);
  });

  it.each(["explicit linked duplicate", "disjoint manual income", "same bare id without linkage", "private origin with public linked row"])(
    "reconciles source identities without a second tax contribution: %s", async mode => {
      await db.insert(accounts).values({ id: custodyId, householdId: a, name: "Synthetic identity custody", type: "investment", balance: "0.00", currency: "ZMW",
        isAsset: true, isPrivate: mode === "private origin with public linked row", ownerUserId: actors.get("owner")!.id });
      const created = await post("/api/grz/bonds").send({ accountId: custodyId, isin: "ZM0000000001", bondName, tenorYears: 1,
        faceValue: "1000.00", purchasePrice: "950.00", couponRate: "0.0800", couponFrequency: 2,
        purchaseDate: "2025-06-30", firstCouponDate: date, maturityDate: date }).expect(201);
      const [coupon] = await db.select().from(grzBondPayments).where(and(eq(grzBondPayments.bondId, created.body.data.id), eq(grzBondPayments.paymentType, "coupon")));
      await post(`/api/grz/payments/${coupon.id}/pay`).send({ accountId: ids.sharedAccount, date }).expect(200);
      const [paid] = await db.select().from(grzBondPayments).where(eq(grzBondPayments.id, coupon.id));
      expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a))).toEqual([]);
      const linked = mode === "explicit linked duplicate" || mode === "private origin with public linked row";
      if (mode === "disjoint manual income") {
        await db.insert(securities).values({ id: securityId, symbol: "R13_TAX_DISJOINT", name: "Independent manual income source", type: "stock", currency: "ZMW" });
        await db.insert(holdings).values({ id: holdingId, householdId: a, accountId: ids.sharedAccount, securityId, quantity: "1", costBasis: "1", acquiredDate: date });
        await post("/api/investments/transactions").send({ accountId: ids.sharedAccount, holdingId, securityId, type: "interest", amount: "34.00",
          withholdingTax: "6.00", currency: "ZMW", transactionDate: date }).expect(201);
      } else {
        // This is an explicitly labelled legacy representation added AFTER the
        // real payment. It never stands in for that workflow's source proof.
        await db.insert(investmentTransactions).values({ id: mode === "same bare id without linkage" ? paid.incomeTransactionId! : randomUUID(),
          householdId: a, accountId: ids.sharedAccount, type: "coupon", amount: "34.00", withholdingTax: "6.00", currency: "ZMW", transactionDate: date,
          linkedTransactionId: linked ? paid.incomeTransactionId : null });
      }
      const expected = linked ? { grossIncome: "40.00", totalWht: "6.00", netIncome: "34.00" }
        : { grossIncome: "80.00", totalWht: "12.00", netIncome: "68.00" };
      expect.soft((await get(summaryPath()).expect(200)).body).toMatchObject(expected);
      expect.soft((await get(exportPath()).expect(200)).body).toHaveLength(linked ? 1 : 2);
      if (mode === "private origin with public linked row") {
        expect.soft((await get(summaryPath(), "member").expect(200)).body).toMatchObject({ grossIncome: "0.00", totalWht: "0.00", netIncome: "0.00" });
        expect.soft((await get(exportPath(), "member").expect(200)).body).toEqual([]);
      }
    });

  it.each(["status commit fails", "schedule later changes", "missing original breakdown", "duplicate original proof", "wrong parent after status failure", "wrong payment after finalization", "wrong payment after status failure"])(
    "uses the actual booked receipt and original proof: %s", async mode => {
      await db.insert(accounts).values({ id: custodyId, householdId: a, name: "Synthetic original-proof custody", type: "investment", balance: "0.00", currency: "ZMW", isAsset: true,
        isPrivate: mode.startsWith("wrong "), ownerUserId: actors.get("owner")!.id });
      const created = await post("/api/grz/bonds").send({ accountId: custodyId, isin: "ZM0000000001", bondName, tenorYears: 1,
        faceValue: "1000.00", purchasePrice: "950.00", couponRate: "0.0800", couponFrequency: 2,
        purchaseDate: "2025-06-30", firstCouponDate: date, maturityDate: date }).expect(201);
      const [coupon] = await db.select().from(grzBondPayments).where(and(eq(grzBondPayments.bondId, created.body.data.id), eq(grzBondPayments.paymentType, "coupon")));
      const hook = "r13_tax_coupon_" + coupon.id.replace(/-/g, "");
      if (mode === "status commit fails" || mode.endsWith("after status failure")) {
        await pool.query(`CREATE FUNCTION ${hook}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic coupon status failure'; END $$`);
        try {
          await pool.query(`CREATE TRIGGER ${hook} BEFORE UPDATE ON grz_bond_payments FOR EACH ROW WHEN (NEW.id='${coupon.id}'::uuid) EXECUTE FUNCTION ${hook}()`);
          await post(`/api/grz/payments/${coupon.id}/pay`).send({ accountId: ids.sharedAccount, date }).expect(500);
        } finally { await pool.query(`DROP FUNCTION ${hook}() CASCADE`); }
      } else await post(`/api/grz/payments/${coupon.id}/pay`).send({ accountId: ids.sharedAccount, date }).expect(200);
      const [cash] = await db.select().from(transactions).where(eq(transactions.idempotencyKey, grzCouponPaymentKey(coupon.id)));
      expect(cash).toMatchObject({ type: "income", amount: "34.00", currency: "ZMW", date });
      if (mode === "status commit fails") expect((await db.select().from(grzBondPayments).where(eq(grzBondPayments.id, coupon.id)))[0]).toMatchObject({ status: "scheduled", incomeTransactionId: null });
      if (mode === "schedule later changes") await db.update(grzBondPayments).set({ grossAmount: "45.00", withholdingTax: "11.00" }).where(eq(grzBondPayments.id, coupon.id));
      if (mode === "missing original breakdown") await pool.query("UPDATE audit_logs SET details=details-'grzCoupon' WHERE entity_type='transaction' AND action='CREATE' AND entity_id=$1", [cash.id]);
      if (mode === "duplicate original proof") await pool.query("INSERT INTO audit_logs(household_id,user_id,entity_type,entity_id,action,details) SELECT household_id,user_id,entity_type,entity_id,action,details FROM audit_logs WHERE entity_type='transaction' AND action='CREATE' AND entity_id=$1", [cash.id]);
      if (mode.startsWith("wrong ")) {
        const shared = await post("/api/grz/bonds").send({ accountId: ids.sharedAccount, isin: "ZM0000000002", bondName: "Unrelated shared bond", tenorYears: 1,
          faceValue: "1000.00", purchasePrice: "950.00", couponRate: "0.0800", couponFrequency: 2,
          purchaseDate: "2025-06-30", firstCouponDate: date, maturityDate: date }).expect(201);
        const [sharedCoupon] = await db.select().from(grzBondPayments).where(and(eq(grzBondPayments.bondId, shared.body.data.id), eq(grzBondPayments.paymentType, "coupon")));
        const field = mode.startsWith("wrong payment") ? "paymentId" : "bondId", replacement = field === "paymentId" ? sharedCoupon.id : shared.body.data.id;
        await pool.query("UPDATE audit_logs SET details=jsonb_set(details,ARRAY['grzCoupon',$3::text],to_jsonb($2::text)) WHERE entity_type='transaction' AND action='CREATE' AND entity_id=$1", [cash.id, replacement, field]);
        expect.soft((await get(summaryPath(), "member").expect(200)).body).toMatchObject({ grossIncome: "0.00", totalWht: "0.00", netIncome: "0.00" });
        expect.soft((await get(exportPath(), "member").expect(200)).body).toEqual([]);
      }
      const unavailable = mode === "missing original breakdown" || mode === "duplicate original proof" || mode.startsWith("wrong ");
      const summary = await get(summaryPath()), json = await get(exportPath()), csv = await get(exportPath("csv"));
      if (unavailable) for (const response of [summary, json, csv]) {
        expect.soft(response.status).toBe(422); expect.soft(response.body.error?.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
      } else {
        expect.soft(summary.status).toBe(200); expect.soft(summary.body).toMatchObject({ grossIncome: "40.00", totalWht: "6.00", netIncome: "34.00" });
        expect.soft(json.status).toBe(200); expect.soft(json.body).toEqual([expect.objectContaining({ date, grossAmount: "40.00", whtPaid: "6.00", netAmount: "34.00" })]);
        expect.soft(csv.status).toBe(200); expect.soft(csv.text).toContain('"40.00","6.00","34.00"');
      }
      expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a))).toEqual([]);
    });

  it("reports a genuinely delayed prior-year coupon in the actual cash receipt year only", async () => {
    const dueDate = `${year - 1}-12-31`;
    // The receipt may fall between coupons; the contractual maturity remains
    // on the first coupon's semiannual grid, independently of today's cash.
    const maturityDate = `${year}-12-31`;
    await db.insert(accounts).values({ id: custodyId, householdId: a, name: "Synthetic tax-year custody", type: "investment", balance: "0.00", currency: "ZMW", isAsset: true });
    const created = await post("/api/grz/bonds").send({ accountId: custodyId, isin: "ZM0000000001", bondName, tenorYears: 1,
      faceValue: "1000.00", purchasePrice: "950.00", couponRate: "0.0800", couponFrequency: 2,
      purchaseDate: `${year - 1}-06-30`, firstCouponDate: dueDate, maturityDate }).expect(201);
    const [coupon] = await db.select().from(grzBondPayments).where(and(eq(grzBondPayments.bondId, created.body.data.id),
      eq(grzBondPayments.paymentType, "coupon"), eq(grzBondPayments.paymentDate, dueDate)));
    await post(`/api/grz/payments/${coupon.id}/pay`).send({ accountId: ids.sharedAccount, date }).expect(200);
    expect.soft((await get(summaryPath()).expect(200)).body).toMatchObject({ grossIncome: "40.00", totalWht: "6.00", netIncome: "34.00" });
    expect.soft((await get(exportPath()).expect(200)).body).toEqual([expect.objectContaining({ date, grossAmount: "40.00", whtPaid: "6.00", netAmount: "34.00" })]);
    expect.soft((await get(`/api/investments/tax/summary?year=${year - 1}`).expect(200)).body).toMatchObject({ grossIncome: "0.00", totalWht: "0.00", netIncome: "0.00" });
    expect.soft((await get(`/api/investments/tax/zra-export?year=${year - 1}&format=json`).expect(200)).body).toEqual([]);
  });

  it.each(["shared custody", "private custody"])("withholds unsupported finalized pre-intent tax amounts for entitled viewers: %s", async privacy => {
    const owner = actors.get("owner")!.id;
    await db.insert(accounts).values({ id: custodyId, householdId: a, name: "Synthetic historical coupon custody", type: "investment", balance: "0.00", currency: "ZMW",
      isAsset: true, isPrivate: privacy === "private custody", ownerUserId: owner });
    const created = await post("/api/grz/bonds").send({ accountId: custodyId, isin: "ZM0000000001", bondName, tenorYears: 1,
      faceValue: "1000.00", purchasePrice: "950.00", couponRate: "0.0800", couponFrequency: 2,
      purchaseDate: "2025-06-30", firstCouponDate: date, maturityDate: date }).expect(201);
    const [coupon] = await db.select().from(grzBondPayments).where(and(eq(grzBondPayments.bondId, created.body.data.id), eq(grzBondPayments.paymentType, "coupon")));
    // Populated historical data predates 0022: a real posted cash leg and direct
    // finalization link exist, but that migration deliberately never backfills
    // sealed original intents or an unsupported historic withholding figure.
    const [cash] = await db.insert(transactions).values({ householdId: a, accountId: ids.sharedAccount, ownerUserId: owner, name: "Historical GRZ coupon cash",
      type: "income", amount: "34.00", currency: "ZMW", date, idempotencyKey: grzCouponPaymentKey(coupon.id),
      postingMode: "posted", postedBalanceDelta: "34.00", postedAccountIsAsset: true }).returning();
    await db.update(accounts).set({ balance: sql`${accounts.balance}+34.00` }).where(eq(accounts.id, ids.sharedAccount));
    await db.update(grzBondPayments).set({ status: "paid", actualPaymentDate: date, incomeTransactionId: cash.id }).where(eq(grzBondPayments.id, coupon.id));
    await db.insert(auditLogs).values({ userId: owner, householdId: privacy === "shared custody" ? a : null, entityType: "transaction", entityId: cash.id, action: "CREATE",
      details: { newValue: { accountId: ids.sharedAccount, type: "income", amount: "34.00", currency: "ZMW", date } } });
    await db.insert(investmentTransactions).values({ householdId: a, accountId: ids.sharedAccount, type: "coupon", amount: "34.00", withholdingTax: "6.00",
      currency: "ZMW", transactionDate: date, linkedTransactionId: cash.id });
    expect((await pool.query("SELECT 1 FROM transaction_create_owner_intents WHERE transaction_id=$1", [cash.id])).rows).toEqual([]);
    for (const path of [summaryPath(), exportPath(), exportPath("csv")]) {
      const response = await get(path); expect.soft(response.status).toBe(422); expect.soft(response.body.error?.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
    }
    const peerSummary = await get(summaryPath(), "member"), peerExport = await get(exportPath(), "member");
    if (privacy === "shared custody") {
      expect.soft(peerSummary.status).toBe(422); expect.soft(peerExport.status).toBe(422);
    } else {
      expect.soft(peerSummary.status).toBe(200); expect.soft(peerSummary.body).toMatchObject({ grossIncome: "0.00", totalWht: "0.00", netIncome: "0.00" });
      expect.soft(peerExport.status).toBe(200); expect.soft(peerExport.body).toEqual([]);
    }
  });
});
