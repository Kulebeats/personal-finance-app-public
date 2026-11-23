import { randomUUID } from "node:crypto";
import request from "supertest";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { grzBondPayments, grzBonds, outboxEvents } from "@shared/schema";
import { db, pool } from "../../../db";
import { transactionService } from "../../../services/TransactionService";
import { a, b, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const bond = randomUUID(), coupon = randomUUID();
const signed = (test: request.Test) => test.set("Cookie", actors.get("owner")!.cookie)
  .set("X-Capital-Subject", actors.get("owner")!.id).set("X-Capital-Household", a);
async function create(isPrivate = false, accountId = ids.sharedAccount) {
  const result = await transactionService.createTransaction({ accountId, date: "2026-02-12", name: "Synthetic private audience",
    type: "expense", amount: "12.35", currency: "ZMW", isPrivate, notes: "Private evidence detail" }, a, actors.get("owner")!.id, randomUUID());
  return result.transaction;
}
async function snapshot() {
  return {
    tx: (await pool.query("select * from transactions where household_id=any($1::uuid[]) order by id", [[a, b]])).rows,
    accounts: (await pool.query("select * from accounts where household_id=any($1::uuid[]) order by id", [[a, b]])).rows,
    audits: (await pool.query("select * from audit_logs where user_id=any($1::uuid[]) order by id", [Array.from(actors.values(), actor => actor.id)])).rows,
    events: (await pool.query("select * from outbox_events where household_id=any($1::uuid[]) order by id", [[a, b]])).rows,
  };
}
async function clean() {
  await db.delete(grzBondPayments).where(eq(grzBondPayments.bondId, bond)); await db.delete(grzBonds).where(eq(grzBonds.id, bond));
  await db.delete(outboxEvents).where(inArray(outboxEvents.householdId, [a, b]));
}

describe("R04 private audit audience, legacy proof and atomic owner batches", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await clean(); await reset(); });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await clean(); await stop(); });

  it.each(["private transaction", "private account"] as const)("keeps CREATE evidence for a %s in the actor's audit audience", async scope => {
    const row = await create(scope === "private transaction", scope === "private account" ? ids.privateAccount : ids.sharedAccount);
    const audit = await pool.query("select household_id,user_id,details from audit_logs where entity_id=$1 and action='CREATE'", [row.id]);
    expect(audit.rows).toEqual([{ household_id: null, user_id: actors.get("owner")!.id, details: expect.objectContaining({
      newValue: expect.objectContaining({ accountId: row.accountId, amount: "12.35", isPrivate: row.isPrivate, ownerUserId: row.ownerUserId }) }) }]);
    // This is a persisted audience assertion, not a claim that peers have a
    // normal audit endpoint. Confidential proof stays attributable and retained.
    expect((await pool.query("select id from audit_logs where household_id=$1 and entity_id=$2", [a, row.id])).rows).toEqual([]);
  });
  it.each(["private transaction", "private account", "public to private", "private to public"] as const)("keeps UPDATE before/after evidence actor-scoped for %s", async mode => {
    const row = await create(mode === "private transaction" || mode === "private to public", mode === "private account" ? ids.privateAccount : ids.sharedAccount);
    const changed = { notes: "Private before and after evidence", ...(mode === "public to private" ? { isPrivate: true } : mode === "private to public" ? { isPrivate: false } : {}) };
    await signed(request(app).put(`/api/transactions/${row.id}`)).send(changed).expect(200);
    const audit = await pool.query("select household_id,user_id,details from audit_logs where entity_id=$1 and action='UPDATE'", [row.id]);
    expect(audit.rows).toEqual([{ household_id: null, user_id: actors.get("owner")!.id,
      details: expect.objectContaining({ changes: expect.objectContaining({ notes: expect.objectContaining({ after: changed.notes }) }) }) }]);
  });
  it("retains household-scoped proof for a public create and ordinary public edit", async () => {
    const row = await create(); await signed(request(app).put(`/api/transactions/${row.id}`)).send({ notes: "Public update" }).expect(200);
    await signed(request(app).delete(`/api/transactions/${row.id}`)).expect(200);
    const audit = await pool.query("select action,household_id,user_id from audit_logs where entity_id=$1 order by action", [row.id]);
    expect(audit.rows).toEqual(["CREATE", "DELETE", "UPDATE"].map(action => ({ action, household_id: a, user_id: actors.get("owner")!.id })));
  });
  it.each(["private transaction", "private account"] as const)("keeps ordinary DELETE evidence for a %s actor-scoped", async scope => {
    const row = await create(scope === "private transaction", scope === "private account" ? ids.privateAccount : ids.sharedAccount);
    await signed(request(app).delete(`/api/transactions/${row.id}`)).expect(200);
    const audit = await pool.query("select household_id,user_id,details from audit_logs where entity_id=$1 and action='DELETE'", [row.id]);
    expect(audit.rows).toEqual([{ household_id: null, user_id: actors.get("owner")!.id,
      details: expect.objectContaining({ oldValue: expect.objectContaining({ accountId: row.accountId, amount: "12.35" }) }) }]);
  });
  it.each([false, true])("denies explicit legacy false with no immutable privacy proof when stored privacy is %s", async storedPrivate => {
    const key = randomUUID();
    await pool.query("update transactions set idempotency_key=$1,is_private=$2 where id=$3", [key, storedPrivate, ids.sharedTx]);
    const input = { accountId: ids.sharedAccount, date: "2026-02-12", name: "Legacy ordinary replay", type: "expense",
      amount: { amount: "12.35", currency: "ZMW" }, idempotencyKey: key };
    const before = await snapshot();
    await signed(request(app).post("/api/transactions")).send({ ...input, isPrivate: false }).expect(409);
    const omitted = await signed(request(app).post("/api/transactions")).send(input).expect(200);
    expect(omitted.body.data).toMatchObject({ id: ids.sharedTx, isPrivate: storedPrivate }); expect(await snapshot()).toEqual(before);
  });
  it.each(["public first", "private first"] as const)("rolls back a mixed owner batch completely with %s", async order => {
    const shared = await create(), privateRow = await create(true);
    const before = await snapshot(), transactionIds = order === "public first" ? [shared.id, privateRow.id] : [privateRow.id, shared.id];
    await signed(request(app).put("/api/transactions/bulk-owner")).send({ transactionIds, ownerUserId: actors.get("member")!.id }).expect(400);
    expect(await snapshot()).toEqual(before);
  });
  it("commits a wholly public owner batch once with unchanged balances and one audit/event per row", async () => {
    const first = await create(), second = await create(); const before = await snapshot();
    const result = await signed(request(app).put("/api/transactions/bulk-owner")).send({ transactionIds: [second.id, first.id], ownerUserId: actors.get("member")!.id }).expect(200);
    expect(result.body.data.map((row: { id: string }) => row.id)).toEqual([second.id, first.id]);
    const after = await snapshot(); expect(after.accounts).toEqual(before.accounts);
    const selected = [first.id, second.id];
    expect(after.tx.filter(row => selected.includes(row.id)).map(row => row.owner_user_id)).toEqual([actors.get("member")!.id, actors.get("member")!.id]);
    expect(after.audits.filter(row => selected.includes(row.entity_id) && row.action === "UPDATE")).toHaveLength(2);
    expect(after.events.filter(row => selected.includes(row.aggregate_id) && row.event_type === "transaction.updated")).toHaveLength(2);
  });
  it("reads each joined owner batch transaction through the same locked SQL client", async () => {
    const first = await create(), second = await create();
    const actual = Client.prototype.query; let outer: Client | undefined, observed = false; const escaped: boolean[] = [];
    vi.spyOn(Client.prototype, "query").mockImplementation(function(this: Client, ...args: unknown[]) {
      const input = args[0], text = typeof input === "string" ? input : input && typeof input === "object" && "text" in input ? String(input.text) : "";
      if (/^\s*begin\b/i.test(text) && !outer) { outer = this; observed = true; }
      if (outer && /^\s*select\b/i.test(text) && text.includes('from "transactions"') && this !== outer) escaped.push(true);
      if (/^\s*(commit|rollback)\b/i.test(text) && this === outer) outer = undefined;
      return Reflect.apply(actual, this, args);
    } as typeof Client.prototype.query);
    await signed(request(app).put("/api/transactions/bulk-owner")).send({ transactionIds: [first.id, second.id], ownerUserId: actors.get("member")!.id }).expect(200);
    expect(observed).toBe(true); expect(escaped).toEqual([]);
  });
  it.each(["private", "absent"] as const)("keeps coupon CREATE evidence actor-scoped for %s custody and explicit public cash", async custody => {
    await db.insert(grzBonds).values({ id: bond, householdId: a, accountId: custody === "private" ? ids.privateAccount : null,
      bondName: "Synthetic confidential custody", tenorYears: 5, faceValue: "1000", purchasePrice: "950", purchaseDate: "2025-01-01", maturityDate: "2030-01-01", couponRate: "0.20" });
    await db.insert(grzBondPayments).values({ id: coupon, bondId: bond, paymentDate: "2026-02-12", paymentType: "coupon", grossAmount: "20", netAmount: "20" });
    const paid = await signed(request(app).post(`/api/grz/payments/${coupon}/pay`)).send({ accountId: ids.sharedAccount, date: "2026-02-12" }).expect(200);
    const receiptId = paid.body.data.incomeTransactionId;
    const audit = await pool.query("select household_id,user_id from audit_logs where entity_id=$1 and action='CREATE'", [receiptId]);
    expect(audit.rows).toEqual([{ household_id: null, user_id: actors.get("owner")!.id }]);
    const peer = await request(app).get(`/api/transactions/${receiptId}`).set("Cookie", actors.get("member")!.cookie).expect(200);
    expect(peer.body.data).toMatchObject({ amount: { amount: "20.00", currency: "ZMW" }, accountId: ids.sharedAccount });
  });
  it("uses retained actor-scoped CREATE proof when paying a real coupon into its owner's private account", async () => {
    await db.insert(grzBonds).values({ id: bond, householdId: a, accountId: ids.privateAccount, bondName: "Synthetic private coupon",
      tenorYears: 5, faceValue: "1000", purchasePrice: "950", purchaseDate: "2025-01-01", maturityDate: "2030-01-01", couponRate: "0.20" });
    await db.insert(grzBondPayments).values({ id: coupon, bondId: bond, paymentDate: "2026-02-12", paymentType: "coupon", grossAmount: "20", netAmount: "20" });
    const paid = await signed(request(app).post(`/api/grz/payments/${coupon}/pay`)).send({ accountId: ids.privateAccount, date: "2026-02-12" }).expect(200);
    const audit = await pool.query("select household_id,user_id,details from audit_logs where entity_id=$1 and action='CREATE'", [paid.body.data.incomeTransactionId]);
    expect(audit.rows).toEqual([{ household_id: null, user_id: actors.get("owner")!.id, details: expect.objectContaining({ grzCoupon: expect.objectContaining({ paymentId: coupon }) }) }]);
  });
});
