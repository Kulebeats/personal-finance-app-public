import { randomUUID } from "node:crypto";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { grzBondPayments, grzBonds, outboxEvents } from "@shared/schema";
import { db, pool } from "../../../db";
import { grzCouponPaymentKey } from "../../../services/grz/couponPaymentKey";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const bond = randomUUID(), coupon = randomUUID(), secret = "Synthetic Confidential Custody Holding";
const signed = (test: request.Test, role: Role = "owner") => test.set("Cookie", actors.get(role)!.cookie);
async function clean() {
  await db.delete(grzBondPayments).where(eq(grzBondPayments.bondId, bond));
  await db.delete(grzBonds).where(eq(grzBonds.id, bond));
  await db.delete(outboxEvents).where(inArray(outboxEvents.householdId, [a, b]));
}
async function post(custody: "private" | "absent" | "public") {
  await db.insert(grzBonds).values({ id: bond, householdId: a,
    accountId: custody === "absent" ? null : custody === "private" ? ids.privateAccount : ids.sharedAccount,
    bondName: secret, tenorYears: 5, faceValue: "1000", purchasePrice: "950", purchaseDate: "2025-01-01", maturityDate: "2030-01-01", couponRate: "0.20" });
  await db.insert(grzBondPayments).values({ id: coupon, bondId: bond, paymentDate: "2026-02-12", paymentType: "coupon",
    grossAmount: "100", withholdingTax: "15", netAmount: "85" });
  const result = await signed(request(app).post(`/api/grz/payments/${coupon}/pay`)).send({ accountId: ids.sharedAccount, date: "2026-02-12" }).expect(200);
  return result.body.data.incomeTransactionId as string;
}
async function peerCash(id: string) {
  const detail = await signed(request(app).get(`/api/transactions/${id}`), "member").expect(200);
  const list = await signed(request(app).get("/api/transactions").query({ accountId: ids.sharedAccount, limit: 100 }), "member").expect(200);
  const listed = list.body.data.find((row: { id: string }) => row.id === id);
  expect(listed).toBeDefined();
  for (const row of [detail.body.data, listed]) {
    expect(row).toMatchObject({ id, accountId: ids.sharedAccount, date: "2026-02-12", type: "income", isPrivate: false,
      amount: { amount: "85.00", currency: "ZMW" } });
  }
  return [detail.body.data, listed] as Array<{ name: string; notes?: string | null; merchantName?: string | null }>;
}
function expectGeneric(rows: Awaited<ReturnType<typeof peerCash>>) {
  for (const row of rows) {
    expect(row.name).toBeTruthy();
    const text = JSON.stringify(row).toLowerCase();
    for (const privateDetail of [secret.toLowerCase(), "gross:", "wht:"]) expect(text).not.toContain(privateDetail);
  }
}

describe("R04 public coupon cash preserves ordinary money without private custody descriptions", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await clean(); await reset(); });
  afterAll(async () => { await clean(); await stop(); });

  it.each(["private", "absent"] as const)("gives public cash a generic description for %s custody and retains authorized asset evidence", async custody => {
    const id = await post(custody); expectGeneric(await peerCash(id));
    const owner = await signed(request(app).get("/api/grz/bonds")).expect(200);
    expect(owner.body.data.find((row: { id: string }) => row.id === bond)).toMatchObject({ bondName: secret,
      payments: [expect.objectContaining({ id: coupon, grossAmount: { amount: "100.00", currency: "ZMW" }, withholdingTax: { amount: "15.00", currency: "ZMW" }, netAmount: { amount: "85.00", currency: "ZMW" }, incomeTransactionId: id })] });
    if (custody === "private") {
      const peer = await signed(request(app).get("/api/grz/bonds"), "member").expect(200);
      expect(peer.body.data.some((row: { id: string }) => row.id === bond)).toBe(false);
    }
    expect((await pool.query("select id from transactions where household_id=$1 and idempotency_key=$2", [a, grzCouponPaymentKey(coupon)])).rows).toEqual([{ id }]);
  });
  it("protects already-posted detailed cash through its actual bound coupon without rewriting the original proof", async () => {
    const id = await post("private");
    await pool.query("update transactions set name=$2,notes=$3 where id=$1", [id, `GRZ Coupon: ${secret}`, `Coupon Payment for ${secret}. Gross: 100.00, WHT: 15.00`]);
    const before = (await pool.query("select * from audit_logs where entity_id=$1 and action='CREATE'", [id])).rows;
    expectGeneric(await peerCash(id));
    expect((await pool.query("select * from audit_logs where entity_id=$1 and action='CREATE'", [id])).rows).toEqual(before);
    expect((await pool.query("select name,notes from transactions where id=$1", [id])).rows[0].notes).toContain(secret);
  });
  it("retains attributable descriptions when the custody is actually shared and visible", async () => {
    const id = await post("public");
    for (const row of await peerCash(id)) expect(row.notes).toContain(`Coupon Payment for ${secret}. Gross: 100.00, WHT: 15.00`);
  });
  it("does not reveal a private linked holding through ordinary search or pagination counts", async () => {
    const id = await post("private");
    await pool.query("update transactions set name=$2,original_name=$2,notes=$3 where id=$1", [id, `GRZ Coupon: ${secret}`, `Coupon Payment for ${secret}. Gross: 100.00, WHT: 15.00`]);
    const result = await signed(request(app).get("/api/transactions").query({ accountId: ids.sharedAccount, search: secret, limit: 100 }), "member").expect(200);
    expect(result.body.data).toEqual([]); expect(result.body.pagination.totalCount).toBe(0);
  });
  it("does not interpret ordinary public notes as a hidden bond linkage", async () => {
    const name = `GRZ Coupon: ${secret}`, notes = `Coupon Payment for ${secret}. Gross: 100.00, WHT: 15.00`;
    const created = await signed(request(app).post("/api/transactions")).send({ accountId: ids.sharedAccount, date: "2026-02-12", type: "income",
      amount: { amount: "85.00", currency: "ZMW" }, name, notes, isPrivate: false, ownerUserId: null, idempotencyKey: randomUUID() }).expect(201);
    for (const row of await peerCash(created.body.data.id)) expect(row.notes).toBe(notes);
  });
  it.each(["ordinary PUT", "review", "owner", "bulk owner"] as const)("keeps rich legacy receipt details out of the actual %s acknowledgement", async operation => {
    const id = await post("private");
    await pool.query("update transactions set name=$2,original_name=$2,notes=$3 where id=$1", [id, `GRZ Coupon: ${secret}`, `Coupon Payment for ${secret}. Gross: 100.00, WHT: 15.00`]);
    const original = (await pool.query("select * from audit_logs where entity_id=$1 and action='CREATE'", [id])).rows;
    const before = (await pool.query("select balance from accounts where id=$1", [ids.sharedAccount])).rows;
    const path = operation === "bulk owner" ? "/api/transactions/bulk-owner" : `/api/transactions/${id}${operation === "review" ? "/review" : operation === "owner" ? "/owner" : ""}`;
    const body = operation === "ordinary PUT" ? { isPending: false } : operation === "review" ? { reviewed: true }
      : { ownerUserId: actors.get("member")!.id, ...(operation === "bulk owner" ? { transactionIds: [id] } : {}) };
    const result = await signed(request(app).put(path), "member").send(body).expect(200);
    const rows = Array.isArray(result.body.data) ? result.body.data : [result.body.data]; expectGeneric(rows);
    expect(rows).toEqual([expect.objectContaining({ id, amount: { amount: "85.00", currency: "ZMW" }, accountId: ids.sharedAccount })]);
    expect((await pool.query("select balance from accounts where id=$1", [ids.sharedAccount])).rows).toEqual(before);
    expect((await pool.query("select * from audit_logs where entity_id=$1 and action='CREATE'", [id])).rows).toEqual(original);
  });
  it.each(["private at booking", "private after booking"] as const)("keeps raw descriptor-change and DELETE evidence actor scoped with custody %s", async scope => {
    if (scope === "private after booking") await signed(request(app).put(`/api/accounts/${ids.privateAccount}`)).send({ isPrivate: false }).expect(200);
    const id = await post("private");
    if (scope === "private after booking") await signed(request(app).put(`/api/accounts/${ids.privateAccount}`)).send({ isPrivate: true }).expect(200);
    await pool.query("update transactions set name=$2,notes=$3 where id=$1", [id, `GRZ Coupon: ${secret}`, `Coupon Payment for ${secret}. Gross: 100.00, WHT: 15.00`]);
    const original = (await pool.query("select * from audit_logs where entity_id=$1 and action='CREATE'", [id])).rows;
    await signed(request(app).put(`/api/transactions/${id}`), "member").send({ notes: "Public cash annotation" }).expect(200);
    await signed(request(app).delete(`/api/transactions/${id}`), "member").expect(200);
    const evidence = (await pool.query("select action,household_id,user_id,details from audit_logs where entity_id=$1 and action in ('UPDATE','DELETE') order by action", [id])).rows;
    expect(evidence).toEqual(["DELETE", "UPDATE"].map(action => expect.objectContaining({ action, household_id: null, user_id: actors.get("member")!.id })));
    expect(JSON.stringify(evidence)).toContain(secret);
    expect((await pool.query("select * from audit_logs where entity_id=$1 and action='CREATE'", [id])).rows).toEqual(original);
  });
  it("keeps detailed currently shared coupon cash in the legitimate review acknowledgement", async () => {
    const id = await post("public");
    const response = await signed(request(app).put(`/api/transactions/${id}/review`), "member").send({ reviewed: true }).expect(200);
    expect(response.body.data.notes).toContain(`Coupon Payment for ${secret}. Gross: 100.00, WHT: 15.00`);
    expect(response.body.data.amount).toEqual({ amount: "85.00", currency: "ZMW" });
  });
});
