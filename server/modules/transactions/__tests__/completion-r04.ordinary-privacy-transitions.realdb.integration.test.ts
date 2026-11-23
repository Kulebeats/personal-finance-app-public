import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { outboxEvents } from "@shared/schema";
import { db, pool } from "../../../db";
import { transactionService } from "../../../services/TransactionService";
import { a, b, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const signed = (test: request.Test, role: "owner" | "member" = "owner") => test.set("Cookie", actors.get(role)!.cookie)
  .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);
const post = (body: object) => signed(request(app).post("/api/transactions")).send(body);
const put = (id: string, body: object, role: "owner" | "member" = "owner") => signed(request(app).put(`/api/transactions/${id}`), role).send(body);
function body(key = randomUUID()) { return { accountId: ids.sharedAccount, name: "Private transition source", type: "expense" as const,
  date: "2026-02-12", amount: { amount: "12.35", currency: "ZMW" }, idempotencyKey: key }; }
async function source() {
  const input = body();
  const saved = await transactionService.createTransaction({ accountId: input.accountId, name: input.name, type: input.type,
    date: input.date, amount: input.amount.amount, currency: "ZMW", isPrivate: true }, a, actors.get("owner")!.id, input.idempotencyKey);
  return { id: saved.transaction.id, input };
}
async function snapshot() {
  return {
    transactions: (await pool.query("select * from transactions where household_id=any($1::uuid[]) order by id", [[a, b]])).rows,
    accounts: (await pool.query("select * from accounts where household_id=any($1::uuid[]) order by id", [[a, b]])).rows,
    audit: (await pool.query("select * from audit_logs where user_id=any($1::uuid[]) order by id", [Array.from(actors.values(), actor => actor.id)])).rows,
    events: (await pool.query("select * from outbox_events where household_id=any($1::uuid[]) order by id", [[a, b]])).rows,
  };
}
async function settled(id: string) {
  await expect.poll(async () => (await pool.query("select id from outbox_events where aggregate_id=$1 and event_type='transaction.created'", [id])).rowCount).toBe(1);
}

describe("R04 ordinary privacy changes preserve attribution and original replay evidence", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await db.delete(outboxEvents).where(inArray(outboxEvents.householdId, [a, b])); await reset(); });
  afterAll(async () => { await db.delete(outboxEvents).where(inArray(outboxEvents.householdId, [a, b])); await stop(); });

  it.each(["Shared", "peer"] as const)("refuses a new private record attributed to %s rather than replacing the selected owner", async choice => {
    const before = await snapshot();
    const result = await post({ ...body(), isPrivate: true, ownerUserId: choice === "Shared" ? null : actors.get("member")!.id });
    expect(result.status).toBe(400); expect(await snapshot()).toEqual(before);
  });
  it.each([null, "true", 1])("rejects malformed privacy %j on ordinary POST and PUT without changing business data", async isPrivate => {
    const { id } = await source(); await settled(id); const before = await snapshot();
    const create = await post({ ...body(), isPrivate }); expect.soft(create.status).toBe(400);
    const update = await put(id, { isPrivate }); expect.soft(update.status).toBe(400);
    expect(await snapshot()).toEqual(before);
  });
  it("preserves omitted PUT privacy and requires explicit publication before sharing attribution", async () => {
    const { id } = await source();
    const edited = await put(id, { notes: "Retain private" }).expect(200); expect(edited.body.data.isPrivate).toBe(true);
    await signed(request(app).get(`/api/transactions/${id}`), "member").expect(404);
    const shared = await put(id, { isPrivate: false, ownerUserId: null, updatedAt: edited.body.data.updatedAt }).expect(200);
    expect(shared.body.data).toMatchObject({ isPrivate: false, ownerUserId: null });
    await signed(request(app).get(`/api/transactions/${id}`), "member").expect(200);
    const privateAgain = await put(id, { isPrivate: true, ownerUserId: actors.get("owner")!.id, updatedAt: shared.body.data.updatedAt }).expect(200);
    expect(privateAgain.body.data).toMatchObject({ isPrivate: true, ownerUserId: actors.get("owner")!.id });
    await signed(request(app).get(`/api/transactions/${id}`), "member").expect(404);
    const balance = await pool.query("select balance::text from accounts where id=$1", [ids.sharedAccount]);
    expect(balance.rows).toEqual([{ balance: "976.54" }]);
    const audited = await pool.query("select details from audit_logs where entity_id=$1 and action='UPDATE'", [id]);
    expect(audited.rows).toContainEqual({ details: expect.objectContaining({ changes: expect.objectContaining({ isPrivate: expect.anything() }) }) });
  });
  it.each(["ordinary", "owner", "bulk-owner"] as const)("keeps an existing private owner on the %s owner-only caller", async path => {
    const { id } = await source(); await settled(id);
    for (const ownerUserId of [null, actors.get("member")!.id]) {
      const before = await snapshot();
      const result = path === "ordinary" ? await put(id, { ownerUserId })
        : path === "owner" ? await signed(request(app).put(`/api/transactions/${id}/owner`)).send({ ownerUserId })
        : await signed(request(app).put("/api/transactions/bulk-owner")).send({ transactionIds: [id], ownerUserId });
      expect.soft(result.status).toBe(400); expect(await snapshot()).toEqual(before);
    }
  });
  it("conceals another member's private transaction from a signed bulk ownership change", async () => {
    const { id } = await source(); await settled(id);
    const before = await snapshot();
    const changeOwner = (target: string) => signed(request(app).put("/api/transactions/bulk-owner"), "member")
      .send({ transactionIds: [target], ownerUserId: actors.get("member")!.id });
    const hidden = await changeOwner(id).expect(404);
    const missing = await changeOwner(randomUUID()).expect(404);
    expect(hidden.body.error.code).toBe(missing.body.error.code);
    expect(hidden.body.error.message).toBe(missing.body.error.message);
    expect(await snapshot()).toEqual(before);
  });
  it("does not let a peer publish another person's private record with an explicit false flag", async () => {
    const { id } = await source(); await settled(id); const before = await snapshot();
    await put(id, { isPrivate: false, ownerUserId: null }, "member").expect(404); expect(await snapshot()).toEqual(before);
  });
  it("uses the immutable original create digest after an authorized privacy edit", async () => {
    const { id, input } = await source();
    await put(id, { isPrivate: false }).expect(200); const before = await snapshot();
    const original = await post({ ...input, isPrivate: true }).expect(200);
    expect(original.body.data).toMatchObject({ id, isPrivate: false });
    await post({ ...input, isPrivate: false }).expect(409); expect(await snapshot()).toEqual(before);
  });
  it("refuses unproven legacy explicit private intent while preserving the omitted ordinary replay", async () => {
    const key = randomUUID();
    await pool.query("update transactions set idempotency_key=$1 where id=$2", [key, ids.sharedTx]);
    const before = await snapshot();
    await post({ ...body(key), isPrivate: true }).expect(409);
    expect((await post(body(key)).expect(200)).body.data.id).toBe(ids.sharedTx);
    expect(await snapshot()).toEqual(before);
  });
});
