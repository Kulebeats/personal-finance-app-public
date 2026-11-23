import { randomUUID } from "node:crypto";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { outboxEvents } from "@shared/schema";
import { db, pool } from "../../../db";
import { transactionService } from "../../../services/TransactionService";
import { a, b, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const post = (body: object) => request(app).post("/api/transactions").set("Cookie", actors.get("owner")!.cookie)
  .set("X-Capital-Subject", actors.get("owner")!.id).set("X-Capital-Household", a).send(body);
async function persisted(key: string) {
  const { rows: [row] } = await pool.query("select * from transactions where household_id=$1 and idempotency_key=$2", [a, key]);
  expect(row).toBeDefined();
  await expect.poll(async () => (await pool.query("select count(*)::int as count from outbox_events where aggregate_id=$1 and event_type='transaction.created'", [row.id])).rows[0].count).toBe(1);
  return { row,
    cash: (await pool.query("select id,balance from accounts where id=$1", [ids.sharedAccount])).rows,
    audit: (await pool.query("select * from audit_logs where entity_id=$1 order by id", [row.id])).rows,
    events: (await pool.query("select * from outbox_events where aggregate_id=$1 order by id", [row.id])).rows };
}
describe("R04 real signed committed create retries retain one financial effect", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await db.delete(outboxEvents).where(inArray(outboxEvents.householdId, [a, b])); await reset(); });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await db.delete(outboxEvents).where(inArray(outboxEvents.householdId, [a, b])); await stop(); });
  it.each(["failed acknowledgement projection", "discarded committed success"] as const)("replays after a %s without a second posting, balance change or evidence", async scenario => {
    const key = randomUUID(), body = { accountId: ids.sharedAccount, date: "2026-02-12", name: "Synthetic retry orchard", type: "expense",
      amount: { amount: "25.00", currency: "ZMW" }, ownerUserId: actors.get("owner")!.id, isPrivate: true, idempotencyKey: key };
    const fault = scenario === "failed acknowledgement projection"
      ? vi.spyOn(transactionService, "getTransactionById").mockRejectedValueOnce(new Error("Synthetic projection failure after financial commit")) : undefined;
    try { await post(body).expect(fault ? 500 : 201); } finally { fault?.mockRestore(); }
    const before = await persisted(key);
    expect(before.row).toMatchObject({ amount: "25.00", is_private: true, owner_user_id: actors.get("owner")!.id });
    expect(before.cash).toEqual([{ id: ids.sharedAccount, balance: "963.89" }]);
    const replay = await post(body).expect(200); expect(replay.body).toMatchObject({ isDuplicate: true, data: { id: before.row.id, isPrivate: true } });
    expect(await persisted(key)).toEqual(before);
    await post({ ...body, isPrivate: false }).expect(409); expect(await persisted(key)).toEqual(before);
    const peer = await request(app).get(`/api/transactions/${before.row.id}`).set("Cookie", actors.get("member")!.cookie).expect(404);
    expect(peer.text).not.toContain(before.row.id);
  });
  it("retains a peer's appended tag when the actual initial-create add operation is retried after an ignored acknowledgement", async () => {
    const body = { accountId: ids.sharedAccount, date: "2026-02-12", name: "Synthetic shared retry orchard", type: "expense",
      amount: { amount: "25.00", currency: "ZMW" }, ownerUserId: actors.get("owner")!.id, isPrivate: false, idempotencyKey: randomUUID() };
    const result = await post(body).expect(201), id = result.body.data.id;
    const add = (role: "owner" | "member", tagIds: string[]) => request(app).post(`/api/tags/transaction/${id}`).set("Cookie", actors.get(role)!.cookie).send({ tagIds });
    await add("owner", [ids.tag]).expect(200);
    const peer = await request(app).post("/api/tags").set("Cookie", actors.get("member")!.cookie).send({ name: "Synthetic peer tag B", color: "#123456" }).expect(201);
    await add("member", [peer.body.data.id]).expect(200);
    const cash = (await pool.query("select balance from accounts where id=$1", [ids.sharedAccount])).rows;
    await post(body).expect(200); await add("owner", [ids.tag]).expect(200);
    expect((await pool.query("select tag_id from transaction_tags where transaction_id=$1 order by tag_id", [id])).rows.map(row => row.tag_id))
      .toEqual([ids.tag, peer.body.data.id].sort());
    expect((await pool.query("select balance from accounts where id=$1", [ids.sharedAccount])).rows).toEqual(cash);
  });
});
