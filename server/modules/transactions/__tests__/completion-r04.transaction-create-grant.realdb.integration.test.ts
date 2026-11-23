import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import request from "supertest";
import { accounts, auditLogs, householdMembers, merchantAliases, merchants, outboxEvents, transactions } from "@shared/schema";
import { db, pool } from "../../../db";
import { accountRepository } from "../../../repositories/AccountRepository";
import { transactionRepository } from "../../../repositories/TransactionRepository";
import { a, actors, app, b, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const destinationId = randomUUID(), memberPrivateId = randomUUID(), merchantId = randomUUID();
const rawName = "Grant Local Branch", merchantName = "Grant Local Merchant";
function payload(accountId = destinationId, idempotencyKey?: string) {
  return { accountId, merchantId, name: rawName, date: "2026-11-02", type: "expense",
    amount: { amount: "7.25", currency: "ZMW" }, idempotencyKey };
}
function post(viewer: Role = "member", body = payload()) {
  return request(app).post("/api/transactions").set("Cookie", actors.get(viewer)!.cookie).send(body);
}
function memberWhere() {
  return and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id));
}
async function state() {
  return {
    transactions: await db.select().from(transactions).where(inArray(transactions.householdId, [a, b])).orderBy(transactions.id),
    aliases: await db.select().from(merchantAliases).where(eq(merchantAliases.merchantId, merchantId)).orderBy(merchantAliases.id),
    audit: await db.select().from(auditLogs).where(eq(auditLogs.householdId, a)).orderBy(auditLogs.id),
    outbox: await db.select().from(outboxEvents).where(eq(outboxEvents.householdId, a)).orderBy(outboxEvents.id),
  };
}
async function clean() {
  await db.delete(transactions).where(inArray(transactions.householdId, [a, b]));
  await db.delete(auditLogs).where(eq(auditLogs.householdId, a));
  await db.delete(outboxEvents).where(eq(outboxEvents.householdId, a));
  await db.delete(merchants).where(eq(merchants.id, merchantId));
  await db.delete(accounts).where(inArray(accounts.id, [destinationId, memberPrivateId]));
}
async function waitForEvent(transactionId: string) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if ((await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, transactionId))).length) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Expected committed create event");
}
async function unchanged(before: Awaited<ReturnType<typeof state>>) {
  expect(await state()).toEqual(before);
  const balances = await db.select({ balance: accounts.balance }).from(accounts)
    .where(inArray(accounts.id, [destinationId, memberPrivateId]));
  expect(balances).toHaveLength(2);
  expect(balances.every(account => account.balance === "1000.00")).toBe(true);
}

describe("R04 pointer-free create rechecks the actor grant and locked destination", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await clean();
    await reset();
    await db.insert(accounts).values([
      { id: destinationId, householdId: a, ownerUserId: actors.get("owner")!.id, name: "Initially shared destination",
        type: "checking", currency: "ZMW", balance: "1000.00", isAsset: true, isPrivate: false },
      { id: memberPrivateId, householdId: a, ownerUserId: actors.get("member")!.id, name: "Member private destination",
        type: "checking", currency: "ZMW", balance: "1000.00", isAsset: true, isPrivate: true },
    ]);
    await db.insert(merchants).values({ id: merchantId, householdId: a, name: merchantName });
  });
  afterEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => { await clean(); await stop(); });

  it.each(["view_only", "professional", "removed"] as const)("rejects a grant changed to %s after the service account pre-read", async mode => {
    const before = await state();
    const original = accountRepository.findByIdWithVisibility.bind(accountRepository);
    vi.spyOn(accountRepository, "findByIdWithVisibility").mockImplementationOnce(async (...args) => {
      const account = await original(...args);
      if (mode === "removed") await db.delete(householdMembers).where(memberWhere());
      else await db.update(householdMembers).set({ role: mode }).where(memberWhere());
      return account;
    });
    await post().expect(mode === "removed" ? 404 : 403);
    await unchanged(before);
  });

  it.each(["view_only", "removed"] as const)("waits on an uncommitted %s grant change then denies the stale request", async mode => {
    const before = await state();
    const blocker = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    let waiting = false;
    try {
      await blocker.query("BEGIN");
      const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      if (mode === "removed") await blocker.query("DELETE FROM household_members WHERE household_id=$1 AND user_id=$2", [a, actors.get("member")!.id]);
      else await blocker.query("UPDATE household_members SET role='view_only' WHERE household_id=$1 AND user_id=$2", [a, actors.get("member")!.id]);
      let settled = false;
      pending = post().timeout(10_000).then(response => { settled = true; return response; });
      void pending.catch(() => { settled = true; });
      const deadline = Date.now() + 5_000;
      while (!waiting && !settled && Date.now() < deadline) {
        const { rows } = await pool.query<{ blocked: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked", [pid],
        );
        waiting = rows[0].blocked;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
      }
      await blocker.query("COMMIT");
    } finally {
      try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
      if (pending) await Promise.allSettled([pending]);
    }
    expect(waiting).toBe(true);
    expect((await pending!).status).toBe(mode === "removed" ? 404 : 403);
    await unchanged(before);
  });

  it.each(["private", "foreign", "deleted"] as const)("uses the locked destination's fresh %s state", async mode => {
    const before = await state();
    const blocker = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    let waiting = false;
    try {
      await blocker.query("BEGIN");
      const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      if (mode === "private") await blocker.query("UPDATE accounts SET is_private=true WHERE id=$1", [destinationId]);
      else if (mode === "foreign") await blocker.query("UPDATE accounts SET household_id=$1 WHERE id=$2", [b, destinationId]);
      else await blocker.query("UPDATE accounts SET deleted_at=now() WHERE id=$1", [destinationId]);
      pending = post().timeout(10_000).then(response => response);
      void pending.catch(() => undefined);
      const deadline = Date.now() + 5_000;
      while (!waiting && Date.now() < deadline) {
        const { rows } = await pool.query<{ blocked: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked", [pid],
        );
        waiting = rows[0].blocked;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
      }
      await blocker.query("COMMIT");
    } finally {
      try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
      if (pending) await Promise.allSettled([pending]);
    }
    expect(waiting).toBe(true);
    expect((await pending!).status).toBe(404);
    await unchanged(before);
  });

  it.each(["owner", "admin", "member"] as const)("retains a current %s grant, one posting, alias and audit", async viewer => {
    const created = await post(viewer).expect(201);
    await waitForEvent(created.body.data.id);
    expect(created.body.data).toMatchObject({ accountId: destinationId, recurringTransactionId: null });
    const saved = await state();
    expect(saved.aliases.map(alias => alias.aliasName)).toEqual([rawName]);
    expect(saved.audit.filter(row => row.entityId === created.body.data.id && row.action === "CREATE")).toHaveLength(1);
  });

  it("retains the actor's own private destination", async () => {
    const created = await post("member", payload(memberPrivateId)).expect(201);
    await waitForEvent(created.body.data.id);
    expect(created.body.data.accountId).toBe(memberPrivateId);
  });

  it("retains trusted caller-owned createWithinTransaction without an ordinary actor option", async () => {
    await db.delete(householdMembers).where(memberWhere());
    const result = await db.transaction(tx => transactionRepository.createWithinTransaction(tx, {
      householdId: a, accountId: destinationId, name: "TRUSTED_CALLER_OWNED_WRITE", amount: "7.25",
      currency: "ZMW", date: "2026-11-02", type: "expense", ownerUserId: null,
    }, { audit: { userId: null, householdId: a } }));
    expect(result.account.balance).toBe("992.75");
    expect((await state()).audit.filter(row => row.entityId === result.transaction.id && row.action === "CREATE"))
      .toEqual([expect.objectContaining({ userId: null })]);
  });

  it("retains a visible idempotent replay without another posting, alias or action audit", async () => {
    const body = payload(destinationId, randomUUID());
    const created = await post("member", body).expect(201);
    await waitForEvent(created.body.data.id);
    const before = await state();
    const replay = await post("member", body).expect(200);
    expect(replay.body).toMatchObject({ isDuplicate: true, data: { id: created.body.data.id } });
    expect(await state()).toEqual(before);
  });
});
