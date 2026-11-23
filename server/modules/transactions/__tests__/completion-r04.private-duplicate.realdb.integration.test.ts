import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { accounts, outboxEvents } from "@shared/schema";
import type { Transaction } from "../../../../client/src/lib/api";
import { duplicateTransaction } from "../../../../client/src/features/transactions/utils/export";
import { db, pool } from "../../../db";
import { transactionService } from "../../../services/TransactionService";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const peers: Role[] = ["admin", "member", "view_only", "professional"];
const signed = (test: request.Test, role: Role = "owner") => test.set("Cookie", actors.get(role)!.cookie)
  .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);
const post = (body: object) => signed(request(app).post("/api/transactions")).send(body);
function input(key = randomUUID()) {
  return { accountId: ids.sharedAccount, name: "Synthetic private orchard", date: "2026-02-12", type: "expense" as const,
    amount: { amount: "12.35", currency: "ZMW" }, idempotencyKey: key };
}
async function posting(id: string) {
  // Settle the transaction-created outbox observation before comparing a retry.
  await expect.poll(async () => (await pool.query(`select id from outbox_events where household_id=$1
    and aggregate_id=$2 and event_type='transaction.created'`, [a, id])).rowCount).toBe(1);
  return {
    row: (await pool.query("select * from transactions where id=$1", [id])).rows,
    account: (await pool.query("select id,balance::text from accounts where id=$1", [ids.sharedAccount])).rows,
    audits: (await pool.query("select * from audit_logs where entity_id=$1 order by id", [id])).rows,
    events: (await pool.query("select * from outbox_events where aggregate_id=$1 order by id", [id])).rows,
  };
}
async function expectPrivateToPeers(id: string) {
  for (const role of peers) {
    const direct = await signed(request(app).get(`/api/transactions/${id}`), role);
    expect.soft(direct.status, `${role} direct private read`).toBe(404);
    expect.soft(direct.text).not.toContain(id);
    const list = await signed(request(app).get(`/api/transactions?accountId=${ids.sharedAccount}&limit=100`), role).expect(200);
    expect.soft(list.body.data.map((row: { id: string }) => row.id), `${role} private list row`).not.toContain(id);
    // The shared account has exactly one unrelated public fixture transaction.
    expect.soft(list.body.pagination.totalCount, `${role} private count`).toBe(1);
  }
}

describe("R04 ordinary explicit privacy and the real Duplicate payload", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await db.delete(outboxEvents).where(inArray(outboxEvents.householdId, [a, b]));
    await reset();
  });
  afterAll(async () => { await db.delete(outboxEvents).where(inArray(outboxEvents.householdId, [a, b])); await stop(); });

  it.each(["actor-owned public account", "Shared public account"] as const)("persists explicit private on an %s independently of account ownership", async mode => {
    if (mode === "Shared public account") await db.update(accounts).set({ ownerUserId: null }).where(eq(accounts.id, ids.sharedAccount));
    const body = { ...input(), ownerUserId: actors.get("owner")!.id, isPrivate: true };
    const created = await post(body).expect(201), id: string = created.body.data.id;
    expect.soft(created.body.data).toMatchObject({ isPrivate: true, ownerUserId: actors.get("owner")!.id });
    const stored = await posting(id);
    expect.soft(stored.row[0]).toMatchObject({ is_private: true, owner_user_id: actors.get("owner")!.id, amount: "12.35" });
    expect(stored.account).toEqual([{ id: ids.sharedAccount, balance: "976.54" }]);
    await expectPrivateToPeers(id);
    const replay = await post(body).expect(200);
    expect.soft(replay.body.data).toMatchObject({ id, isPrivate: true });
    expect(await posting(id)).toEqual(stored);
  });

  it("keeps a real owner-visible private source private when the actual Duplicate helper's payload reaches ordinary HTTP", async () => {
    // Existing service callers already accept an explicit privacy fact. Use
    // that actual producer for a legacy/private source, without a SQL flag edit.
    const source = await transactionService.createTransaction({ accountId: ids.sharedAccount, name: "Synthetic private orchard",
      date: "2026-02-12", type: "expense", amount: "12.35", currency: "ZMW", isPrivate: true }, a, actors.get("owner")!.id, randomUUID());
    const visible = await signed(request(app).get(`/api/transactions/${source.transaction.id}`)).expect(200);
    const original: Transaction = visible.body.data;
    expect(original.isPrivate).toBe(true);
    const payload = duplicateTransaction(original);
    expect(payload).toMatchObject({ isPrivate: true, ownerUserId: actors.get("owner")!.id, amount: { amount: "12.35", currency: "ZMW" } });
    const duplicated = await post(payload).expect(201), id: string = duplicated.body.data.id;
    expect(id).not.toBe(original.id);
    expect.soft(duplicated.body.data).toMatchObject({ isPrivate: true, ownerUserId: original.ownerUserId });
    const stored = await posting(id);
    expect.soft(stored.row[0]).toMatchObject({ is_private: true, owner_user_id: original.ownerUserId, amount: "12.35" });
    expect(stored.account).toEqual([{ id: ids.sharedAccount, balance: "964.19" }]);
    await expectPrivateToPeers(id);
    expect((await signed(request(app).get(`/api/transactions/${original.id}`)).expect(200)).body.data.isPrivate).toBe(true);
  });

  it.each([false, true])("rejects a keyed privacy change from %s with no second posting, audit or outbox event", async firstPrivacy => {
    const body = { ...input(), ownerUserId: actors.get("owner")!.id, isPrivate: firstPrivacy };
    const created = await post(body).expect(201), id: string = created.body.data.id;
    const before = await posting(id);
    const changed = await post({ ...body, isPrivate: !firstPrivacy });
    expect.soft(changed.status).toBe(409);
    expect(await posting(id)).toEqual(before);
    const count = await pool.query("select count(*)::int as count from transactions where idempotency_key=$1", [body.idempotencyKey]);
    expect(count.rows).toEqual([{ count: 1 }]);
  });

  it.each(["omitted", "Shared", "peer"] as const)("keeps existing public %s ownership and omitted/false keyed equivalence", async choice => {
    const selected = choice === "Shared" ? null : choice === "peer" ? actors.get("member")!.id : undefined;
    const expectedOwner = selected === undefined ? actors.get("owner")!.id : selected;
    const body = { ...input(), ...(selected === undefined ? {} : { ownerUserId: selected }) };
    const created = await post(body).expect(201), id: string = created.body.data.id;
    expect(created.body.data).toMatchObject({ isPrivate: false, ownerUserId: expectedOwner });
    const before = await posting(id);
    const replay = await post({ ...body, isPrivate: false }).expect(200);
    expect(replay.body.data).toMatchObject({ id, isPrivate: false, ownerUserId: expectedOwner });
    expect(await posting(id)).toEqual(before);
    for (const role of peers) expect((await signed(request(app).get(`/api/transactions/${id}`), role).expect(200)).body.data.id).toBe(id);
    const audit = await pool.query("select user_id from audit_logs where entity_id=$1 and action='CREATE'", [id]);
    expect(audit.rows).toEqual([{ user_id: actors.get("owner")!.id }]);
  });

  it("does not copy account privacy into an explicitly public transaction on the actor's private account", async () => {
    const created = await post({ ...input(), accountId: ids.privateAccount, isPrivate: false }).expect(201);
    const row = await pool.query("select is_private,owner_user_id from transactions where id=$1", [created.body.data.id]);
    expect(row.rows).toEqual([{ is_private: false, owner_user_id: actors.get("owner")!.id }]);
    await signed(request(app).get(`/api/transactions/${created.body.data.id}`), "member").expect(404);
  });
});
