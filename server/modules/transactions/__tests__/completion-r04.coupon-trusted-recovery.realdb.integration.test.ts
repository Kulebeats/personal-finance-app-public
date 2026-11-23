import { randomUUID } from "node:crypto";
import request from "supertest";
import { Client } from "pg";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { grzBondPayments, grzBonds, outboxEvents } from "@shared/schema";
import { db, pool } from "../../../db";
import { grzCouponPaymentKey } from "../../../services/grz/couponPaymentKey";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const bond = randomUUID(), coupon = randomUUID(), date = "2026-02-12";
const signed = (test: request.Test, role: Role = "owner") => test.set("Cookie", actors.get(role)!.cookie)
  .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);
const pay = (role: Role = "owner", accountId = ids.sharedAccount, receiptDate = date) =>
  signed(request(app).post(`/api/grz/payments/${coupon}/pay`), role).send({ accountId, date: receiptDate });
async function clean() {
  await db.delete(grzBondPayments).where(eq(grzBondPayments.bondId, bond));
  await db.delete(grzBonds).where(eq(grzBonds.id, bond));
  await db.delete(outboxEvents).where(inArray(outboxEvents.householdId, [a, b]));
}
async function snapshot() {
  return {
    cash: (await pool.query("select * from transactions where household_id=$1 order by id", [a])).rows,
    balances: (await pool.query("select * from accounts where household_id=$1 order by id", [a])).rows,
    payment: (await pool.query("select * from grz_bond_payments where id=$1", [coupon])).rows,
    audits: (await pool.query("select * from audit_logs where user_id=any($1::uuid[]) order by id", [Array.from(actors.values(), row => row.id)])).rows,
    outbox: (await pool.query("select * from outbox_events where household_id=$1 order by id", [a])).rows,
  };
}
async function stranded(accountId = ids.sharedAccount) {
  await db.insert(grzBonds).values({ id: bond, householdId: a, accountId: ids.privateAccount,
    bondName: "Synthetic private custody recovery", tenorYears: 5, faceValue: "1000", purchasePrice: "950",
    purchaseDate: "2025-01-01", maturityDate: "2030-01-01", couponRate: "0.20" });
  await db.insert(grzBondPayments).values({ id: coupon, bondId: bond, paymentDate: date, paymentType: "coupon",
    grossAmount: "100", withholdingTax: "15", netAmount: "85" });
  const actual = Client.prototype.query; let rejected = false;
  const fault = vi.spyOn(Client.prototype, "query").mockImplementation(function(this: Client, ...args: unknown[]) {
    const input = args[0], text = typeof input === "string" ? input : input && typeof input === "object" && "text" in input ? String(input.text) : "";
    if (!rejected && /^\s*update\s+"grz_bond_payments"/i.test(text)) {
      rejected = true; throw new Error("Synthetic failure after coupon cash commit");
    }
    return Reflect.apply(actual, this, args);
  } as typeof Client.prototype.query);
  try { await pay("owner", accountId).expect(500); } finally { fault.mockRestore(); }
  expect(rejected).toBe(true);
  const { rows: [posting] } = await pool.query("select * from transactions where household_id=$1 and idempotency_key=$2", [a, grzCouponPaymentKey(coupon)]);
  expect(posting).toMatchObject({ account_id: accountId, type: "income", amount: "85.00", currency: "ZMW", is_private: false });
  expect((await pool.query("select * from transaction_create_owner_intents where transaction_id=$1", [posting.id])).rows)
    .toEqual([expect.objectContaining({ household_id: a, actor_user_id: actors.get("owner")!.id, operation: "grz_coupon",
      idempotency_key: grzCouponPaymentKey(coupon), posting_confirmed: true })]);
  expect((await pool.query("select household_id,user_id from audit_logs where entity_id=$1 and action='CREATE'", [posting.id])).rows)
    .toEqual([{ household_id: null, user_id: actors.get("owner")!.id }]);
  return posting;
}
async function shareCustody() {
  await signed(request(app).put(`/api/accounts/${ids.privateAccount}`)).send({ isPrivate: false }).expect(200);
}
async function expectSingleCash(postingId: string, balances: unknown) {
  expect((await pool.query("select id from transactions where household_id=$1 and idempotency_key=$2", [a, grzCouponPaymentKey(coupon)])).rows)
    .toEqual([{ id: postingId }]);
  expect((await snapshot()).balances).toEqual(balances);
}

describe("R04 coupon recovery binds confidential original proof without returning its audit", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await clean(); await reset(); });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await clean(); await stop(); });

  it.each(["original signer", "current shared signer"] as const)("recovers actual committed cash for the %s without another movement", async signer => {
    const posting = await stranded(); if (signer === "current shared signer") await shareCustody();
    const before = await snapshot(), role = signer === "original signer" ? "owner" : "member";
    const recovered = await pay(role).expect(200);
    expect(recovered.body.data).toMatchObject({ id: coupon, status: "paid", incomeTransactionId: posting.id });
    for (const field of ["audit", "details", "actorUserId", "userId", "grzCoupon"]) expect(recovered.body.data).not.toHaveProperty(field);
    await expectSingleCash(posting.id, before.balances);
    expect((await snapshot()).cash).toEqual(before.cash);
    expect((await pool.query("select household_id,user_id from audit_logs where entity_id=$1 and action='CREATE'", [posting.id])).rows)
      .toEqual([{ household_id: null, user_id: actors.get("owner")!.id }]);
  });
  it.each(["original signer", "current shared signer"] as const)("preserves legacy net-only restrictions for the %s", async signer => {
    const posting = await stranded(); if (signer === "current shared signer") await shareCustody();
    await pool.query("update audit_logs set details=details-'grzCoupon' where entity_id=$1 and action='CREATE'", [posting.id]);
    await pool.query("update grz_bond_payments set gross_amount=110,withholding_tax=25 where id=$1", [coupon]);
    const before = await snapshot(); await pay(signer === "original signer" ? "owner" : "member").expect(200);
    const { rows: [audit] } = await pool.query("select details from audit_logs where entity_id=$1 and action='PROCESS'", [coupon]);
    expect(audit.details).toMatchObject({ netAmount: "85.00", breakdownEvidence: "legacy_net_only" });
    expect(audit.details).not.toHaveProperty("grossAmount"); expect(audit.details).not.toHaveProperty("withholdingTax");
    await expectSingleCash(posting.id, before.balances);
  });
  it.each(["private custody", "private cash", "revoked writer"] as const)("does not use original confidential proof with %s", async scenario => {
    const posting = await stranded(scenario === "private cash" ? ids.privateAccount : ids.sharedAccount);
    if (scenario !== "private custody") await shareCustody();
    if (scenario === "private cash") await pool.query("update transactions set is_private=true where id=$1", [posting.id]);
    if (scenario === "revoked writer") await pool.query("update household_members set role='view_only' where household_id=$1 and user_id=$2", [a, actors.get("member")!.id]);
    const before = await snapshot(); await pay("member", posting.account_id).expect(scenario === "revoked writer" ? 403 : 404);
    expect(await snapshot()).toEqual(before);
  });
  it.each(["missing audit", "duplicate audit", "wrong original actor", "changed cash terms", "changed coupon breakdown", "different receipt date"] as const)(
    "refuses cross-signer recovery with %s and makes no financial or evidence write", async scenario => {
    const posting = await stranded(); await shareCustody();
    const predicate = "entity_id=$1 and entity_type='transaction' and action='CREATE'";
    if (scenario === "missing audit") await pool.query(`delete from audit_logs where ${predicate}`, [posting.id]);
    if (scenario === "duplicate audit") await pool.query(`insert into audit_logs(household_id,user_id,entity_type,entity_id,action,details)
      select household_id,user_id,entity_type,entity_id,action,details from audit_logs where ${predicate}`, [posting.id]);
    if (scenario === "wrong original actor") await pool.query(`update audit_logs set user_id=$2 where ${predicate}`, [posting.id, actors.get("member")!.id]);
    if (scenario === "changed cash terms") await pool.query(`update audit_logs set details=jsonb_set(details,'{newValue,amount}','"84.00"') where ${predicate}`, [posting.id]);
    if (scenario === "changed coupon breakdown") await pool.query("update grz_bond_payments set gross_amount=110,withholding_tax=25 where id=$1", [coupon]);
    const before = await snapshot(); await pay("member", ids.sharedAccount, scenario === "different receipt date" ? "2026-02-13" : date).expect(409);
    expect(await snapshot()).toEqual(before);
  });
});
