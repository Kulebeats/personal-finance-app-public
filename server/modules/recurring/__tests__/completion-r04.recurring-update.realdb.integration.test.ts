import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import type { PoolClient } from "pg";
import request from "supertest";
import { accounts, auditLogs, householdMembers, outboxEvents, recurringTransactionHistory, recurringTransactionLinks, recurringTransactions, transactions } from "@shared/schema";
import { db, pool } from "../../../db";
import { recurringRepository } from "../../../repositories/RecurringRepository";
import { a, actors, app, b, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const ruleIds = { shared: randomUUID(), private: randomUUID(), hidden: randomUUID(), deleted: randomUUID(), foreign: randomUUID(), corrupt: randomUUID(), moveA: randomUUID(), moveB: randomUUID() };
const hiddenAccountId = randomUUID(), deletedAccountId = randomUUID();
const moveAAccountId = `a${randomUUID().slice(1)}`, moveBAccountId = `b${randomUUID().slice(1)}`;
const allRuleIds = Object.values(ruleIds);
type Viewer = Role | "outsider";

function update(ruleId: string, viewer: Viewer, body: Record<string, unknown>) {
  return request(app).put(`/api/recurring/${ruleId}`).set("Cookie", actors.get(viewer)!.cookie).send(body);
}
function list(viewer: Viewer) {
  return request(app).get("/api/recurring").set("Cookie", actors.get(viewer)!.cookie);
}
function detail(ruleId: string, viewer: Viewer) {
  return request(app).get(`/api/recurring/${ruleId}`).set("Cookie", actors.get(viewer)!.cookie);
}

async function clearRules() {
  await db.delete(auditLogs).where(inArray(auditLogs.entityId, allRuleIds));
  await db.delete(outboxEvents).where(inArray(outboxEvents.aggregateId, allRuleIds));
  await db.delete(recurringTransactions).where(inArray(recurringTransactions.id, allRuleIds));
}

async function businessState() {
  return {
    rules: await db.select().from(recurringTransactions).where(inArray(recurringTransactions.id, allRuleIds)).orderBy(recurringTransactions.id),
    history: await db.select().from(recurringTransactionHistory).where(inArray(recurringTransactionHistory.recurringTransactionId, allRuleIds)).orderBy(recurringTransactionHistory.id),
    links: await db.select().from(recurringTransactionLinks).where(inArray(recurringTransactionLinks.recurringTransactionId, allRuleIds)).orderBy(recurringTransactionLinks.id),
    audit: await db.select().from(auditLogs).where(inArray(auditLogs.entityId, allRuleIds)).orderBy(auditLogs.id),
    outbox: await db.select().from(outboxEvents).where(inArray(outboxEvents.aggregateId, allRuleIds)).orderBy(outboxEvents.id),
    transactions: await db.select().from(transactions).where(inArray(transactions.id, [ids.sharedTx, ids.privateTx, ids.foreignTx])).orderBy(transactions.id),
  };
}

describe("R04 recurring PUT account privacy on marked PostgreSQL", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await clearRules();
    await reset();
    await db.insert(accounts).values([
      { id: hiddenAccountId, householdId: a, name: "HIDDEN_ACCOUNT", type: "checking", currency: "ZMW", isHidden: true },
      { id: deletedAccountId, householdId: a, name: "DELETED_ACCOUNT", type: "checking", currency: "ZMW", deletedAt: new Date() },
      { id: moveAAccountId, householdId: a, name: "MOVE_A_SHARED", type: "checking", currency: "ZMW" },
      { id: moveBAccountId, householdId: a, name: "MOVE_B_SHARED", type: "checking", currency: "ZMW" },
    ]);
    await db.insert(recurringTransactions).values([
      { id: ruleIds.shared, householdId: a, accountId: ids.sharedAccount, name: "SHARED_RULE", amount: "15.00", type: "expense", frequency: "monthly", startDate: "2026-10-01", nextDueDate: "2026-12-01" },
      { id: ruleIds.private, householdId: a, accountId: ids.privateAccount, name: "PRIVATE_RULE", amount: "25.00", type: "expense", frequency: "monthly", startDate: "2026-10-01", nextDueDate: "2026-12-01" },
      { id: ruleIds.hidden, householdId: a, accountId: hiddenAccountId, name: "HIDDEN_RULE", amount: "35.00", type: "expense", frequency: "monthly", startDate: "2026-10-01", nextDueDate: "2026-12-01" },
      { id: ruleIds.deleted, householdId: a, accountId: deletedAccountId, name: "DELETED_RULE", amount: "45.00", type: "expense", frequency: "monthly", startDate: "2026-10-01", nextDueDate: "2026-12-01" },
      { id: ruleIds.foreign, householdId: b, accountId: ids.foreignAccount, name: "FOREIGN_RULE", amount: "55.00", type: "expense", frequency: "monthly", startDate: "2026-10-01", nextDueDate: "2026-12-01" },
      { id: ruleIds.corrupt, householdId: a, accountId: ids.foreignAccount, name: "CORRUPT_LOCAL_RULE", amount: "65.00", type: "expense", frequency: "monthly", startDate: "2026-10-01", nextDueDate: "2026-12-01" },
      { id: ruleIds.moveA, householdId: a, accountId: moveAAccountId, name: "MOVE_A_RULE", amount: "75.00", type: "expense", frequency: "monthly", startDate: "2026-10-01", nextDueDate: "2026-12-01" },
      { id: ruleIds.moveB, householdId: a, accountId: moveBAccountId, name: "MOVE_B_RULE", amount: "85.00", type: "expense", frequency: "monthly", startDate: "2026-10-01", nextDueDate: "2026-12-01" },
    ]);
  });
  afterEach(clearRules);
  afterAll(async () => { await clearRules(); await stop(); });

  it.each(["admin", "member"] as const)("%s cannot rename a peer's private-account rule", async viewer => {
    const before = await businessState();
    const missing = await update(randomUUID(), viewer, { name: "DENIED" }).expect(404);
    const response = await update(ruleIds.private, viewer, { name: "DENIED" }).expect(404);
    expect(response.body.error).toMatchObject({ code: missing.body.error.code, message: missing.body.error.message });
    expect(JSON.stringify(response.body)).not.toContain("PRIVATE_RULE");
    expect(await businessState()).toEqual(before);
  });

  it("rejects deleted, foreign-rule and corrupt local-rule account references without writes", async () => {
    const before = await businessState();
    const missing = await update(randomUUID(), "owner", { name: "DENIED" }).expect(404);
    for (const id of [ruleIds.deleted, ruleIds.foreign, ruleIds.corrupt]) {
      const response = await update(id, "owner", { name: "DENIED" }).expect(404);
      expect(response.body.error).toMatchObject({ code: missing.body.error.code, message: missing.body.error.message });
    }
    expect(await businessState()).toEqual(before);
  });

  it("rejects private, deleted and foreign destination accounts without writes", async () => {
    const before = await businessState();
    for (const [viewer, accountId] of [["admin", ids.privateAccount], ["owner", deletedAccountId], ["owner", ids.foreignAccount]] as const) {
      const response = await update(ruleIds.shared, viewer, { accountId }).expect(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    }
    expect(await businessState()).toEqual(before);
  });

  it.each(["view_only", "professional"] as const)("%s cannot update a visible rule", async viewer => {
    const before = await businessState();
    await update(ruleIds.shared, viewer, { name: "DENIED" }).expect(403);
    expect(await businessState()).toEqual(before);
  });

  it("rechecks a live role change after login", async () => {
    const before = await businessState();
    await db.update(householdMembers).set({ role: "view_only" }).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id)));
    await update(ruleIds.shared, "member", { name: "DENIED" }).expect(403);
    expect(await businessState()).toEqual(before);
  });

  it("allows shared-rule edits and owner edits of the owner's private rule and destination", async () => {
    const shared = await update(ruleIds.shared, "admin", { name: "UPDATED_SHARED" }).expect(200);
    expect(shared.body.data).toMatchObject({ id: ruleIds.shared, name: "UPDATED_SHARED", accountId: ids.sharedAccount, amount: { amount: "15.00", currency: null } }); // FIN-05: seeded without a currency / denomination receipt, so the unit is unknown (null), never a default ZMW.
    const own = await update(ruleIds.private, "owner", { name: "UPDATED_PRIVATE" }).expect(200);
    expect(own.body.data).toMatchObject({ id: ruleIds.private, name: "UPDATED_PRIVATE", accountId: ids.privateAccount });
    const moved = await update(ruleIds.shared, "owner", { accountId: ids.privateAccount }).expect(200);
    expect(moved.body.data).toMatchObject({ id: ruleIds.shared, accountId: ids.privateAccount });
    const [stored] = await db.select().from(recurringTransactions).where(eq(recurringTransactions.id, ruleIds.shared));
    expect(stored).toMatchObject({ name: "UPDATED_SHARED", accountId: ids.privateAccount });
    const history = await db.select().from(recurringTransactionHistory).where(eq(recurringTransactionHistory.recurringTransactionId, ruleIds.shared));
    expect(history.filter(entry => entry.action === "updated")).toHaveLength(2);
    expect(history.filter(entry => entry.action === "denomination_invalidated_v1")).toEqual([expect.objectContaining({
      newState: { version: 1, reason: "unproven_definition_change" },
    })]);
    expect(history).toHaveLength(3);
    const publicHistory = await request(app).get(`/api/recurring/${ruleIds.shared}/history?limit=2`).set("Cookie", actors.get("owner")!.cookie).expect(200);
    expect(publicHistory.body.data).toHaveLength(2);
    expect(publicHistory.body.data.every((entry: { action: string }) => entry.action === "updated")).toBe(true);
  });

  it("rolls back a private-to-shared PUT when required history cannot be written", async () => {
    const before = await businessState();
    await detail(ruleIds.private, "admin").expect(404);
    const injected = vi.spyOn(recurringRepository, "logHistory")
      .mockRejectedValueOnce(new Error("R04_INJECTED_HISTORY_WRITE_FAILURE"));
    try {
      const response = await update(ruleIds.private, "owner", {
        accountId: ids.sharedAccount, name: "PRIVATE_ORIGIN_MOVED",
      }).expect(500);
      expect(response.body.success).toBe(false);
    } finally {
      injected.mockRestore();
    }
    // The event writer is asynchronous; allow any incorrectly started write to settle.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(await businessState()).toEqual(before);
    await detail(ruleIds.private, "admin").expect(404);
    expect((await list("admin").expect(200)).body.data.map((item: { id: string }) => item.id)).not.toContain(ruleIds.private);
    expect((await detail(ruleIds.private, "owner").expect(200)).body.data.accountId).toBe(ids.privateAccount);
  });

  it("stores the private-to-shared prior source with the successful PUT", async () => {
    const response = await update(ruleIds.private, "owner", {
      accountId: ids.sharedAccount, name: "PRIVATE_ORIGIN_MOVED",
    }).expect(200);
    expect(response.body.data).toMatchObject({
      id: ruleIds.private, accountId: ids.sharedAccount,
      name: "PRIVATE_ORIGIN_MOVED", amount: { amount: "25.00", currency: null }, // FIN-05: seeded without a currency / denomination receipt, so the unit is unknown (null), never a default ZMW.
    });
    const [stored] = await db.select().from(recurringTransactions).where(eq(recurringTransactions.id, ruleIds.private));
    expect(stored.accountId).toBe(ids.sharedAccount);
    const history = await db.select().from(recurringTransactionHistory)
      .where(eq(recurringTransactionHistory.recurringTransactionId, ruleIds.private));
    expect(history.filter(entry => entry.action === "updated")).toHaveLength(1);
    expect(history.find(entry => entry.action === "updated")).toMatchObject({
      action: "updated", performedBy: actors.get("owner")!.id,
      previousState: { id: ruleIds.private, accountId: ids.privateAccount, name: "PRIVATE_RULE" },
      newState: { id: ruleIds.private, accountId: ids.sharedAccount, name: "PRIVATE_ORIGIN_MOVED" },
    });
    expect(history.filter(entry => entry.action === "denomination_invalidated_v1")).toEqual([expect.objectContaining({
      newState: { version: 1, reason: "unproven_definition_change" },
    })]);
    expect(history).toHaveLength(2);
    const publicHistory = await request(app).get(`/api/recurring/${ruleIds.private}/history?limit=1`).set("Cookie", actors.get("owner")!.cookie).expect(200);
    expect(publicHistory.body.data).toEqual([expect.objectContaining({ action: "updated", previousState: expect.objectContaining({ accountId: ids.privateAccount }) })]);
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, ruleIds.private));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "UPDATE", entityType: "recurring_rule", userId: actors.get("owner")!.id,
      details: {
        oldValue: { name: "PRIVATE_RULE", amount: "25.00" },
        newValue: { name: "PRIVATE_ORIGIN_MOVED", amount: "25.00" },
      },
    });
    let events = await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, ruleIds.private));
    for (let attempt = 0; attempt < 40 && events.length === 0; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 25));
      events = await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, ruleIds.private));
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "recurring.updated", aggregateType: "recurring", householdId: a,
      payload: { id: ruleIds.private, changes: ["accountId", "name"] },
    });
    await detail(ruleIds.private, "admin").expect(404);
    expect((await list("admin").expect(200)).body.data.map((item: { id: string }) => item.id)).not.toContain(ruleIds.private);
    expect((await detail(ruleIds.private, "owner").expect(200)).body.data).toMatchObject({
      id: ruleIds.private, accountId: ids.sharedAccount,
    });
  });

  it("keeps display-hidden but otherwise visible accounts manageable", async () => {
    const renamed = await update(ruleIds.hidden, "admin", { name: "UPDATED_HIDDEN" }).expect(200);
    expect(renamed.body.data).toMatchObject({ id: ruleIds.hidden, name: "UPDATED_HIDDEN", accountId: hiddenAccountId });
    const moved = await update(ruleIds.shared, "admin", { accountId: hiddenAccountId }).expect(200);
    expect(moved.body.data).toMatchObject({ id: ruleIds.shared, accountId: hiddenAccountId });
  });

  it("serializes inverse moves with mixed-case UUID destinations across two actors", async () => {
    let blockerA: PoolClient | undefined;
    let blockerB: PoolClient | undefined;
    let first: Promise<{ status: number; body: any }> | undefined;
    let second: Promise<{ status: number; body: any }> | undefined;
    const startedRequests: Promise<{ status: number; body: any }>[] = [];
    let sawTwoQueuedOnA = false, sawQueuedOnB = false;
    try {
      blockerA = await pool.connect();
      blockerB = await pool.connect();
      await blockerA.query("BEGIN");
      await blockerB.query("BEGIN");
      const pidA = (await blockerA.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
      const pidB = (await blockerB.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
      await blockerA.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [moveAAccountId]);
      await blockerB.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [moveBAccountId]);
      first = update(ruleIds.moveA, "admin", { accountId: moveBAccountId.toUpperCase() }).then(response => ({ status: response.status, body: response.body }));
      startedRequests.push(first);
      void first.catch(() => undefined);
      second = update(ruleIds.moveB, "member", { accountId: moveAAccountId }).then(response => ({ status: response.status, body: response.body }));
      startedRequests.push(second);
      void second.catch(() => undefined);
      for (let attempt = 0; attempt < 120; attempt++) {
        const result = await pool.query(`WITH RECURSIVE blocked_a(pid) AS (
          SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))
          UNION
          SELECT s.pid FROM pg_stat_activity s JOIN blocked_a b ON b.pid = ANY(pg_blocking_pids(s.pid))
        ) SELECT (SELECT count(*)::int FROM blocked_a) AS on_a,
                 (SELECT count(*)::int FROM pg_stat_activity WHERE $2 = ANY(pg_blocking_pids(pid))) AS on_b`, [pidA, pidB]);
        sawTwoQueuedOnA = result.rows[0].on_a >= 2;
        sawQueuedOnB = result.rows[0].on_b > 0;
        if (sawTwoQueuedOnA || sawQueuedOnB) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      await blockerA.query("COMMIT");
      await blockerB.query("COMMIT");
    } finally {
      try {
        await Promise.allSettled([blockerA, blockerB].map(async client => {
          if (!client) return;
          try { await client.query("ROLLBACK"); }
          finally { client.release(); }
        }));
      } finally {
        await Promise.allSettled(startedRequests);
      }
    }
    const [aMove, bMove] = await Promise.all([first!, second!]);
    expect(sawTwoQueuedOnA).toBe(true);
    expect(sawQueuedOnB).toBe(false);
    expect([aMove.status, bMove.status]).toEqual([200, 200]);
    const stored = await db.select().from(recurringTransactions).where(inArray(recurringTransactions.id, [ruleIds.moveA, ruleIds.moveB]));
    expect(stored.find(rule => rule.id === ruleIds.moveA)?.accountId).toBe(moveBAccountId);
    expect(stored.find(rule => rule.id === ruleIds.moveB)?.accountId).toBe(moveAAccountId);
  });

  it("refuses an update when the source account becomes private while its row is locked", async () => {
    const before = await businessState();
    const blocker = await pool.connect();
    let pending: Promise<{ status: number; body: any }> | undefined;
    let blocked = false;
    try {
      await blocker.query("BEGIN");
      const pid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
      await blocker.query("UPDATE accounts SET is_private = TRUE WHERE id = $1", [ids.sharedAccount]);
      pending = update(ruleIds.shared, "admin", { name: "RACE_DENIED" }).then(response => ({ status: response.status, body: response.body }));
      for (let attempt = 0; attempt < 120; attempt++) {
        const result = await pool.query("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid <> $1 AND $1 = ANY(pg_blocking_pids(pid))) AS blocked", [pid]);
        if (result.rows[0].blocked) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      await blocker.query("COMMIT");
    } finally {
      await blocker.query("ROLLBACK").catch(() => {});
      blocker.release();
    }
    const response = await pending!;
    expect(blocked).toBe(true);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    const after = await businessState();
    expect(after).toEqual(before);
  });
});
