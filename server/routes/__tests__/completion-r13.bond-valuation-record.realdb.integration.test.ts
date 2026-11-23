import { randomUUID } from "node:crypto";
import { Client } from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { accounts, auditLogs, grzBondPayments, grzBonds, householdMembers, householdPreferences, households, outboxEvents, tags, transactions } from "@shared/schema";
import { db, pool } from "../../db";
import { grzCouponPaymentKey } from "../../services/grz/couponPaymentKey";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";

const bondId = randomUUID(), otherBond = randomUUID(), isin = "ZM0000000001";
let today: string, yesterday: string;
const path = (id = bondId) => `/api/grz/bonds/${id}/valuations`;
function intent(patch: Record<string, unknown> = {}) {
  return { operationId: randomUUID(), valuationDate: today, sourceDate: today, isin, currency: "ZMW", nominalAmount: "1000.00",
    sourceKind: "custodian_statement", sourceReference: "Synthetic signed custody statement", quoteBasis: "clean",
    quoteUnits: "holding_amount", quotedAmount: "970.00", accruedInterest: "25.10", ...patch };
}
function record(body = intent(), role: Role = "member", id = bondId) {
  return request(app).post(path(id)).set("Cookie", actors.get(role)!.cookie).send(body);
}
function summary(role: Role = "member") { return request(app).get("/api/accounts/summary").set("Cookie", actors.get(role)!.cookie); }
async function seed(id = bondId, accountId = ids.sharedAccount, householdId = a) {
  await db.insert(grzBonds).values({ id, householdId, accountId, isin, bondName: "Synthetic attributable issue", tenorYears: 5,
    faceValue: "1000.00", purchasePrice: "950.00", purchaseDate: "2025-01-01", maturityDate: "2030-01-01", couponRate: "0.20" });
}
async function evidence() {
  return (await db.execute<{ id: string; recorder: string; authority: string; clean: string | null; dirty: string; accrued: string | null }>(sql`
    select id::text,recorded_by::text as recorder,authority,clean_value::text as clean,dirty_value::text as dirty,
      accrued_value::text as accrued from grz_bond_valuations where household_id=${a}::uuid order by sequence`)).rows;
}
async function clean() {
  // Do not disable immutable storage for fixtures. Remove each actual fixture
  // household in the same committed transaction as its evidence. The skeleton
  // is recreated only AFTER that erasure commit for the existing actor cookies.
  await db.transaction(async tx => {
    const present = await tx.execute<{ exists: boolean }>(sql`select to_regclass('public.grz_bond_valuations') is not null as exists`);
    if (present.rows[0].exists) await tx.execute(sql`delete from grz_bond_valuations where household_id in (${a}::uuid,${b}::uuid)`);
    const bonds = await tx.select({ id: grzBonds.id }).from(grzBonds).where(inArray(grzBonds.householdId, [a, b]));
    if (bonds.length) await tx.delete(grzBondPayments).where(inArray(grzBondPayments.bondId, bonds.map(row => row.id)));
    await tx.delete(grzBonds).where(inArray(grzBonds.householdId, [a, b]));
    await tx.delete(transactions).where(inArray(transactions.householdId, [a, b]));
    await tx.delete(accounts).where(inArray(accounts.householdId, [a, b]));
    await tx.delete(tags).where(inArray(tags.householdId, [a, b]));
    await tx.delete(outboxEvents).where(inArray(outboxEvents.householdId, [a, b]));
    await tx.delete(auditLogs).where(inArray(auditLogs.householdId, [a, b]));
    await tx.delete(householdMembers).where(inArray(householdMembers.householdId, [a, b]));
    await tx.delete(householdPreferences).where(inArray(householdPreferences.householdId, [a, b]));
    await tx.delete(households).where(inArray(households.id, [a, b]));
  });
  await db.insert(households).values([{ id: a, name: "Synthetic A5 A", currency: "ZMW" }, { id: b, name: "Synthetic A5 B", currency: "ZMW" }]);
  await db.insert(householdMembers).values(Array.from(actors, ([role, actor]) => ({
    householdId: role === "outsider" ? b : a, userId: actor.id, role: role === "outsider" ? "owner" as const : role,
  })));
}
function beforePublication(change: () => Promise<unknown>) {
  const actual = Client.prototype.query; let changed = false;
  const gate = vi.fn(change);
  vi.spyOn(Client.prototype, "query").mockImplementation(function(this: Client, ...args: unknown[]) {
    const input = args[0], text = typeof input === "string" ? input : input && typeof input === "object" && "text" in input ? String(input.text) : "";
    if (!changed && /^\s*with\b/i.test(text) && text.includes('"household_members"') && text.includes('"provider_fx_quotes"')) {
      changed = true; return gate().then(() => Reflect.apply(actual, this, args));
    }
    return Reflect.apply(actual, this, args);
  } as typeof Client.prototype.query);
  return gate;
}

describe("R13 authenticated attributable GRZ market evidence and current wealth", () => {
  beforeAll(async () => {
    await start();
    today = (await db.execute<{ date: string }>(sql`select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD') as date`)).rows[0].date;
    const day = new Date(`${today}T12:00:00Z`); day.setUTCDate(day.getUTCDate() - 1); yesterday = day.toISOString().slice(0, 10);
  }, 20_000);
  beforeEach(async () => {
    await clean(); await reset();
    await db.delete(transactions).where(inArray(transactions.householdId, [a, b]));
    await db.update(accounts).set({ balance: "0.00", initialBalance: "0.00", currency: "ZMW" }).where(inArray(accounts.householdId, [a, b]));
    await db.update(households).set({ currency: "ZMW" }).where(eq(households.id, a));
    await seed();
  });
  afterEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => { await clean(); await stop(); });

  it("records a member-attributed clean970 plus accrued25.10 as dirty995.10, separately from cost950 and face1000", async () => {
    expect((await summary().expect(422)).body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
    const response = await record().expect(201);
    expect(response.body.data).toMatchObject({ bondId, valuationDate: today, authority: "member_recorded", sourceKind: "custodian_statement",
      cleanValue: { amount: "970.00", currency: "ZMW" }, accruedInterest: { amount: "25.10", currency: "ZMW" }, dirtyValue: { amount: "995.10", currency: "ZMW" } });
    expect(await evidence()).toEqual([expect.objectContaining({ recorder: actors.get("member")!.id, authority: "member_recorded", clean: "970.00", dirty: "995.10", accrued: "25.10" })]);
    expect((await summary().expect(200)).body.data).toMatchObject({ totalAssets: 995.1, netWorth: 995.1, complete: false, valuationDate: today });
    const [bond] = await db.select().from(grzBonds).where(eq(grzBonds.id, bondId)); expect(bond).toMatchObject({ purchasePrice: "950.00", faceValue: "1000.00", status: "active" });
    expect(await db.select().from(transactions).where(eq(transactions.householdId, a))).toEqual([]);
    expect((await db.select().from(accounts).where(eq(accounts.id, ids.sharedAccount)))[0].balance).toBe("0.00");
  });
  it("scales a matching dirty per100 quote once and does not add scheduled coupons as another asset", async () => {
    await db.insert(grzBondPayments).values({ bondId, paymentDate: "2030-01-01", paymentType: "coupon", grossAmount: "100", netAmount: "100" });
    await record().expect(201);
    await record(intent({ quoteBasis: "dirty", quoteUnits: "per_100_nominal", quotedAmount: "99.51", accruedInterest: "2.51" })).expect(201);
    expect((await evidence()).at(-1)).toMatchObject({ clean: "970.00", dirty: "995.10", accrued: "25.10" });
    expect((await summary().expect(200)).body.data.netWorth).toBe(995.1);
  });
  it("persists the nearest ngwee for a large nominal just below a half-ngwee boundary", async () => {
    const nominalAmount = "9999999999999.99";
    await db.update(grzBonds).set({ faceValue: nominalAmount }).where(eq(grzBonds.id, bondId));
    await record(intent({ nominalAmount, quoteUnits: "per_100_nominal", quotedAmount: "50.00000001", accruedInterest: "0" })).expect(201);
    expect(await evidence()).toEqual([expect.objectContaining({ clean: "5000000000999.99", dirty: "5000000000999.99", accrued: "0.00" })]);
  });

  it("retains unrounded per100 evidence and assigns a one-ngwee component residual to accrued", async () => {
    const response = await record(intent({ quoteUnits: "per_100_nominal", quotedAmount: "96.8755", accruedInterest: "2.51366" })).expect(201);
    expect(response.body.data).toMatchObject({ dirtyValue: { amount: "993.89", currency: "ZMW" }, cleanValue: { amount: "968.76", currency: "ZMW" },
      accruedInterest: { amount: "25.13", currency: "ZMW" }, roundingPolicy: "round_total_and_clean_residual_to_accrued" });
    const rows = await evidence(); expect(rows.at(-1)).toMatchObject({ clean: "968.76", dirty: "993.89", accrued: "25.13" });
    const raw = await db.execute<{ quote: string; accrued: string }>(sql`select quoted_amount::text as quote,accrued_quote::text as accrued
      from grz_bond_valuations where household_id=${a}::uuid order by sequence desc limit 1`);
    expect(raw.rows).toEqual([{ quote: "96.87550000", accrued: "2.51366000" }]);
    await record(intent({ quoteBasis: "dirty", quoteUnits: "per_100_nominal", quotedAmount: "99.38916", accruedInterest: "2.51366" })).expect(201);
    expect((await evidence()).at(-1)).toMatchObject({ clean: "968.76", dirty: "993.89", accrued: "25.13" });
    expect((await summary().expect(200)).body.data.netWorth).toBe(993.89);
  });
  it("keeps an old historical mark dated and never relabels it as current", async () => {
    await record(intent({ valuationDate: yesterday, sourceDate: yesterday })).expect(201);
    const list = await request(app).get(path()).set("Cookie", actors.get("member")!.cookie).expect(200);
    expect(list.body.data).toEqual([expect.objectContaining({ valuationDate: yesterday, dirtyValue: { amount: "995.10", currency: "ZMW" } })]);
    await summary().expect(422);
  });
  it("can record dirty total without inventing a clean principal component or an extra coupon asset", async () => {
    const response = await record(intent({ quoteBasis: "dirty", quotedAmount: "995.10", accruedInterest: null })).expect(201);
    expect(response.body.data).toMatchObject({ cleanValue: null, accruedInterest: null, dirtyValue: { amount: "995.10", currency: "ZMW" } });
    expect((await summary().expect(200)).body.data.netWorth).toBe(995.1);
  });
  it("resolves only the evidenced ex-coupon principal under the caller's holding and account locks", async () => {
    await record().expect(201);
    const { readLockedGrzPrincipalValuation } = await import("../../services/grz/bondValuation");
    const locked = () => db.transaction(async tx => {
      await tx.select().from(grzBonds).where(eq(grzBonds.id, bondId)).for("update");
      await tx.select().from(accounts).where(eq(accounts.id, ids.sharedAccount)).for("update");
      return readLockedGrzPrincipalValuation(tx, { householdId: a, userId: actors.get("member")!.id, role: "member" }, bondId, today);
    });
    const principal = await locked(); expect(principal?.amount.toString()).toBe("970.00");
    expect(principal?.includedCouponAmount.toString()).toBe("25.10");
    expect(principal).toMatchObject({ asOfDate: today, sourceKind: "custodian_statement", component: "ex_coupon_principal" });
    await record(intent({ quoteBasis: "dirty", quotedAmount: "995.10", accruedInterest: null })).expect(201);
    expect(await locked()).toBeNull();
    await record(intent({ accruedInterest: "0.00" })).expect(201);
    const exCoupon = await locked(); expect(exCoupon?.amount.toString()).toBe("970.00"); expect(exCoupon?.includedCouponAmount.toString()).toBe("0.00");
  });
  it("replays one operation durably and refuses changed intent including concurrent replay", async () => {
    const body = intent(); const replies = await Promise.all([record(body), record(body)]);
    expect(replies.map(reply => reply.status).sort()).toEqual([200, 201]); expect(replies[0].body.data.id).toBe(replies[1].body.data.id);
    expect(await evidence()).toHaveLength(1);
    await record({ ...body, quotedAmount: "980.00" }).expect(409); expect(await evidence()).toHaveLength(1);
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.householdId, a), eq(auditLogs.entityType, "grz_bond")));
    expect(audits.filter(row => row.details && typeof row.details === "object" && "valuationId" in row.details)).toHaveLength(1);
  });
  it("conflicts safely when two authorized actors race one operation across different bonds", async () => {
    await seed(otherBond); const body = intent();
    const replies = await Promise.all([record(body, "member"), record(body, "admin", otherBond)]);
    expect(replies.map(reply => reply.status).sort()).toEqual([201, 409]); expect(await evidence()).toHaveLength(1);
  });
  it.each(["view_only", "professional"] as const)("denies statement recording and replay after downgrade to %s", async role => {
    const body = intent(); await record(body).expect(201);
    await db.update(householdMembers).set({ role }).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id)));
    await record(body).expect(403); expect(await evidence()).toHaveLength(1);
  });
  it.each([
    { sourceKind: "benchmark_yield" }, { sourceKind: "synthetic" }, { sourceKind: "what_if_calculator" }, { currency: "USD" },
    { quotedAmount: "NaN" }, { quotedAmount: "-1" }, { quotedAmount: "0" }, { quotedAmount: "1e3" },
    { sourceReference: "" }, { quoteBasis: "clean", accruedInterest: null },
  ])("rejects unproven or malformed source intent %j", async patch => { await record(intent(patch)).expect(400); });
  it("requires same issue, exact source date, nonfuture date and account denomination", async () => {
    await record(intent({ isin: "ZM0000000002" })).expect(409);
    await record(intent({ nominalAmount: "2000.00" })).expect(409);
    await record(intent({ sourceDate: yesterday })).expect(400);
    await record(intent({ valuationDate: "2099-01-01", sourceDate: "2099-01-01" })).expect(400);
    await db.update(accounts).set({ currency: "USD" }).where(eq(accounts.id, ids.sharedAccount));
    await record().expect(409);
  });
  it("does not expose private or foreign holding identifiers through record, list or wealth availability", async () => {
    await db.delete(grzBonds).where(eq(grzBonds.id, bondId)); await seed(bondId, ids.privateAccount); await seed(otherBond, ids.foreignAccount, b);
    for (const id of [bondId, otherBond]) {
      await record(intent(), "admin", id).expect(404);
      const response = await request(app).get(path(id)).set("Cookie", actors.get("admin")!.cookie).expect(404);
      expect(JSON.stringify(response.body)).not.toContain(id);
    }
    expect((await summary("admin").expect(200)).body.data.netWorth).toBe(0); await summary("owner").expect(422);
  });
  it("keeps the original private statement private after a holding moves to shared custody", async () => {
    await db.update(grzBonds).set({ accountId: ids.privateAccount }).where(eq(grzBonds.id, bondId));
    const original = intent({ sourceReference: "Private custody receipt" });
    await record(original, "owner").expect(201);
    await db.update(grzBonds).set({ accountId: ids.sharedAccount }).where(eq(grzBonds.id, bondId));
    await record(intent({ sourceReference: "Shared custody receipt" }), "admin").expect(201);
    const history = (role: Role) => request(app).get(path()).set("Cookie", actors.get(role)!.cookie).expect(200);
    const admin = await history("admin");
    expect(admin.body.data.map((row: { sourceReference: string }) => row.sourceReference)).toEqual(["Shared custody receipt"]);
    const owner = await history("owner");
    expect(owner.body.data.map((row: { sourceReference: string }) => row.sourceReference)).toEqual(["Shared custody receipt", "Private custody receipt"]);
    await record(original, "owner").expect(409);
  });
  it.each(["isHidden", "isArchived", "excludeFromNetWorth"] as const)("omits an unvalued %s account bond from totals and incompleteness", async flag => {
    await db.update(accounts).set({ [flag]: true }).where(eq(accounts.id, ids.sharedAccount));
    expect((await summary().expect(200)).body.data.netWorth).toBe(0);
  });
  it("rebuilds when a new attributable mark appears between calculation and final publication", async () => {
    await record().expect(201);
    const gate = beforePublication(async () => { await record(intent({ quotedAmount: "980.00" })).expect(201); });
    expect((await summary().expect(200)).body.data.netWorth).toBe(1005.1); expect(gate).toHaveBeenCalledOnce();
  });
  it("rebuilds after a contributing bond account becomes another member's private account", async () => {
    await record().expect(201);
    const gate = beforePublication(async () => { await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, ids.sharedAccount)); });
    const response = await summary().expect(200); expect(response.body.data.netWorth).toBe(0); expect(gate).toHaveBeenCalledOnce();
    expect(JSON.stringify(response.body)).not.toContain(bondId);
  });
  it("does not carry a mark across a changed issue or nominal amount at publication", async () => {
    await record().expect(201);
    const gate = beforePublication(async () => { await db.update(grzBonds).set({ faceValue: "2000" }).where(eq(grzBonds.id, bondId)); });
    await summary().expect(422); expect(gate).toHaveBeenCalledOnce();
  });
  it.each(["membership", "account"] as const)("lists dated statement evidence only with current %s access in its publication statement", async change => {
    await record().expect(201); const original = Client.prototype.query; let changed = false;
    vi.spyOn(Client.prototype, "query").mockImplementation(function(this: Client, ...args: unknown[]) {
      const input = args[0], text = typeof input === "string" ? input : input && typeof input === "object" && "text" in input ? String(input.text) : "";
      if (!changed && /^\s*(with|select)\b/i.test(text) && text.includes('"grz_bond_valuations"')) {
        changed = true;
        return (async () => {
          if (change === "membership") await db.delete(householdMembers).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id)));
          else await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, ids.sharedAccount));
          return Reflect.apply(original, this, args);
        })();
      }
      return Reflect.apply(original, this, args);
    } as typeof Client.prototype.query);
    const response = await request(app).get(path()).set("Cookie", actors.get("member")!.cookie).expect(change === "membership" ? 403 : 404);
    expect(changed).toBe(true); expect(JSON.stringify(response.body)).not.toMatch(/995\.10|custody statement/); expect(JSON.stringify(response.body)).not.toContain(bondId);
  });
  it("keeps a private ordinary expense with the same key out of a shared bond valuation", async () => {
    await db.update(accounts).set({ initialBalance: "10.00", balance: "10.00" }).where(eq(accounts.id, ids.privateAccount));
    const [payment] = await db.insert(grzBondPayments).values({ bondId, paymentDate: today, paymentType: "coupon",
      grossAmount: "25.10", withholdingTax: "0.00", netAmount: "25.10" }).returning();
    await record().expect(201);
    await request(app).post("/api/transactions").set("Cookie", actors.get("owner")!.cookie).send({
      accountId: ids.privateAccount, name: "Unrelated private expense", date: today, type: "expense",
      amount: { amount: "2.00", currency: "ZMW" }, idempotencyKey: grzCouponPaymentKey(payment.id),
    }).expect(201);
    expect((await summary("admin").expect(200)).body.data.netWorth).toBe(995.1);
    await record(intent({ quotedAmount: "971.00" }), "admin").expect(201);
    expect((await summary("admin").expect(200)).body.data.netWorth).toBe(996.1);
  });
  it("withholds a dirty mark while coupon cash is committed but installment finalization is stranded", async () => {
    const [payment] = await db.insert(grzBondPayments).values({ bondId, paymentDate: today, paymentType: "coupon",
      grossAmount: "25.10", withholdingTax: "0.00", netAmount: "25.10" }).returning();
    const pay = () => request(app).post(`/api/grz/payments/${payment.id}/pay`).set("Cookie", actors.get("member")!.cookie)
      .send({ accountId: ids.sharedAccount, date: today });
    await record().expect(201);
    const hook = "r13_value_" + payment.id.replace(/-/g, "");
    await pool.query(`CREATE FUNCTION ${hook}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic finalization failure'; END $$`);
    try {
      await pool.query(`CREATE TRIGGER ${hook} BEFORE UPDATE ON grz_bond_payments FOR EACH ROW WHEN (NEW.id='${payment.id}'::uuid) EXECUTE FUNCTION ${hook}()`);
      await pay().expect(500);
    } finally { await pool.query(`DROP FUNCTION ${hook}() CASCADE`); }
    expect((await db.select().from(accounts).where(eq(accounts.id, ids.sharedAccount)))[0].balance).toBe("25.10");
    expect((await db.select().from(grzBondPayments).where(eq(grzBondPayments.id, payment.id)))[0].status).toBe("scheduled");
    await summary().expect(422);
    await record().expect(409);
    await pay().expect(200);
    await summary().expect(422);
    await record(intent({ accruedInterest: "0.00" })).expect(201);
    expect((await summary().expect(200)).body.data.netWorth).toBe(995.1);
  });
  it("does not publish a dirty accrued mark after the included coupon state changes to paid cash", async () => {
    const [payment] = await db.insert(grzBondPayments).values({ bondId, paymentDate: today, paymentType: "coupon", grossAmount: "25.10", netAmount: "25.10" }).returning();
    await record().expect(201);
    const gate = beforePublication(async () => {
      await db.update(grzBondPayments).set({ status: "paid", actualPaymentDate: today }).where(eq(grzBondPayments.id, payment.id));
      await db.update(accounts).set({ balance: "25.10" }).where(eq(accounts.id, ids.sharedAccount));
    });
    const response = await summary().expect(422); expect(response.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE"); expect(gate).toHaveBeenCalledOnce();
    await record(intent({ quotedAmount: "970.00", accruedInterest: "0.00" })).expect(201);
    expect((await summary().expect(200)).body.data.netWorth).toBe(995.1);
  });
});
