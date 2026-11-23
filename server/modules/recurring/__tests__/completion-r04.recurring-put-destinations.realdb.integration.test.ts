import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import {
  auditLogs, categories, merchants, outboxEvents,
  recurringTransactionHistory, recurringTransactions,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { a, actors, app, b, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const ruleId = randomUUID();
const refs = { category: randomUUID(), deletedCategory: randomUUID(), foreignCategory: randomUUID(),
  merchant: randomUUID(), foreignMerchant: randomUUID() };
function put(body: Record<string, unknown>) {
  return request(app).put(`/api/recurring/${ruleId}`).set("Cookie", actors.get("member")!.cookie).send(body);
}
async function state() {
  return {
    rules: await db.select().from(recurringTransactions).where(eq(recurringTransactions.id, ruleId)),
    history: await db.select().from(recurringTransactionHistory).where(eq(recurringTransactionHistory.recurringTransactionId, ruleId)).orderBy(recurringTransactionHistory.id),
    audit: await db.select().from(auditLogs).where(eq(auditLogs.entityId, ruleId)).orderBy(auditLogs.id),
    outbox: await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, ruleId)).orderBy(outboxEvents.id),
  };
}
async function clean() {
  await db.delete(recurringTransactions).where(eq(recurringTransactions.id, ruleId));
  await db.delete(auditLogs).where(eq(auditLogs.entityId, ruleId));
  await db.delete(outboxEvents).where(eq(outboxEvents.aggregateId, ruleId));
  await db.delete(categories).where(inArray(categories.id, [refs.category, refs.deletedCategory, refs.foreignCategory]));
  await db.delete(merchants).where(inArray(merchants.id, [refs.merchant, refs.foreignMerchant]));
}

/** Observe a real PostgreSQL wait or completed request before releasing the row. */
async function compete(statement: string, id: string, body: Record<string, unknown>) {
  const blocker = await pool.connect();
  let pending: Promise<request.Response> | undefined;
  let blocked = false;
  try {
    await blocker.query("BEGIN");
    const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await blocker.query(statement, [id]);
    let settled = false;
    pending = put(body).timeout(10_000).then(response => { settled = true; return response; });
    void pending.catch(() => { settled = true; });
    const deadline = Date.now() + 5_000;
    while (!blocked && !settled && Date.now() < deadline) {
      const { rows } = await pool.query<{ blocked: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked", [pid],
      );
      blocked = rows[0].blocked;
      if (!blocked) await new Promise(resolve => setTimeout(resolve, 25));
    }
    await blocker.query("COMMIT");
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    if (pending) await Promise.allSettled([pending]);
  }
  return { blocked, response: await pending! };
}

describe("R04 recurring PUT locks only authorized destination references", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await clean();
    await reset();
    await db.insert(categories).values([
      { id: refs.category, householdId: a, name: "LIVE_DESTINATION_CATEGORY", displayOrder: 1 },
      { id: refs.deletedCategory, householdId: a, name: "DELETED_DESTINATION_CATEGORY", displayOrder: 1, deletedAt: new Date() },
      { id: refs.foreignCategory, householdId: b, name: "FOREIGN_DESTINATION_CATEGORY", displayOrder: 1 },
    ]);
    await db.insert(merchants).values([
      { id: refs.merchant, householdId: a, name: "LIVE_DESTINATION_MERCHANT" },
      { id: refs.foreignMerchant, householdId: b, name: "FOREIGN_DESTINATION_MERCHANT" },
    ]);
    await db.insert(recurringTransactions).values({ id: ruleId, householdId: a, accountId: ids.sharedAccount,
      name: "SHARED_RULE", amount: "17.17", type: "expense", frequency: "monthly",
      startDate: "2026-11-01", nextDueDate: "2026-12-01" });
  });
  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  it("rejects an already soft-deleted destination category without history, audit or outbox", async () => {
    const before = await state();
    const response = await put({ categoryId: refs.deletedCategory }).expect(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(await state()).toEqual(before);
  });

  it("waits on a proposed category's soft delete then rejects its fresh deleted state", async () => {
    const before = await state();
    const result = await compete("UPDATE categories SET deleted_at=now() WHERE id=$1", refs.category,
      { categoryId: refs.category });
    expect(result.blocked).toBe(true);
    expect(result.response.status).toBe(404);
    expect(await state()).toEqual(before);
    expect((await db.select().from(categories).where(eq(categories.id, refs.category)))[0].deletedAt).not.toBeNull();
  });

  it("waits on a proposed merchant's household change then rejects its foreign state", async () => {
    const before = await state();
    // The household UUID is a generated fixture constant, while the reference ID
    // remains a query parameter for the independent competing transaction.
    const blocker = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    let blocked = false;
    try {
      await blocker.query("BEGIN");
      const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await blocker.query("UPDATE merchants SET household_id=$1 WHERE id=$2", [b, refs.merchant]);
      let settled = false;
      pending = put({ merchantId: refs.merchant }).timeout(10_000).then(response => { settled = true; return response; });
      void pending.catch(() => { settled = true; });
      const deadline = Date.now() + 5_000;
      while (!blocked && !settled && Date.now() < deadline) {
        const { rows } = await pool.query<{ blocked: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked", [pid],
        );
        blocked = rows[0].blocked;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 25));
      }
      await blocker.query("COMMIT");
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      if (pending) await Promise.allSettled([pending]);
    }
    expect(blocked).toBe(true);
    expect((await pending!).status).toBe(404);
    expect(await state()).toEqual(before);
  });

  it.each(["private", "foreign"] as const)("rejects a locked %s destination account without waiting on that row", async kind => {
    const before = await state();
    const accountId = kind === "private" ? ids.privateAccount : ids.foreignAccount;
    const result = await compete("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", accountId, { accountId });
    expect(result.blocked).toBe(false);
    expect(result.response.status).toBe(404);
    expect(await state()).toEqual(before);
  });

  it.each(["category", "merchant"] as const)("rejects a locked foreign proposed %s without waiting on that row", async kind => {
    const before = await state();
    const result = kind === "category"
      ? await compete("SELECT id FROM categories WHERE id=$1 FOR UPDATE", refs.foreignCategory, { categoryId: refs.foreignCategory })
      : await compete("SELECT id FROM merchants WHERE id=$1 FOR UPDATE", refs.foreignMerchant, { merchantId: refs.foreignMerchant });
    expect(result.blocked).toBe(false);
    expect(result.response.status).toBe(404);
    expect(await state()).toEqual(before);
  });

  it("retains legitimate new references, mixed-case UUIDs and explicit null clears", async () => {
    const assigned = await put({ categoryId: refs.category.toUpperCase(), merchantId: refs.merchant.toUpperCase() }).expect(200);
    expect(assigned.body.data).toMatchObject({ categoryId: refs.category, merchantId: refs.merchant });
    const cleared = await put({ categoryId: null, merchantId: null }).expect(200);
    expect(cleared.body.data).toMatchObject({ categoryId: null, merchantId: null });
    const current = await state();
    expect(current.rules[0]).toMatchObject({ categoryId: null, merchantId: null });
    expect(current.history).toHaveLength(2);
    expect(current.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ newState: expect.objectContaining({ categoryId: refs.category, merchantId: refs.merchant }) }),
      expect.objectContaining({ newState: expect.objectContaining({ categoryId: null, merchantId: null }) }),
    ]));
    let events = current.outbox;
    for (let attempt = 0; attempt < 80 && events.length < 2; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 25));
      events = await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, ruleId));
    }
    expect(events).toHaveLength(2);
  });
});
