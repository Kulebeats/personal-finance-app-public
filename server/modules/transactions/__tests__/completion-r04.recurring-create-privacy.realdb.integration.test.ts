import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  accounts, auditLogs, merchantAliases, merchants, outboxEvents,
  recurringTransactions, transactions,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { businessAuditService } from "../../../services/BusinessAuditService";
import { a, actors, app, b, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const ruleId = randomUUID(), privateRuleId = randomUUID();
const destinationId = randomUUID(), merchantId = randomUUID();
const rawName = "Create Guard Branch", merchantName = "Create Guard Merchant";

function payload(recurringTransactionId: string | undefined = ruleId, idempotencyKey = randomUUID()) {
  return {
    accountId: destinationId, merchantId, name: rawName, date: "2026-11-02", type: "expense",
    amount: { amount: "7.25", currency: "ZMW" }, recurringTransactionId, idempotencyKey,
  };
}
type PostingBody = Omit<ReturnType<typeof payload>, "recurringTransactionId"> & { recurringTransactionId?: string };
function post(body: PostingBody) {
  return request(app).post("/api/transactions").set("Cookie", actors.get("member")!.cookie).send(body);
}
async function waitForCreateEvent(transactionId: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const events = await db.select({ id: outboxEvents.id }).from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, transactionId));
    if (events.length) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Expected committed transaction create event");
}
async function state() {
  return {
    accounts: await db.select().from(accounts).where(inArray(accounts.id, [destinationId, ids.sharedAccount])).orderBy(accounts.id),
    transactions: await db.select().from(transactions).where(eq(transactions.householdId, a)).orderBy(transactions.id),
    aliases: await db.select().from(merchantAliases).where(eq(merchantAliases.merchantId, merchantId)).orderBy(merchantAliases.id),
    audit: await db.select().from(auditLogs).where(eq(auditLogs.householdId, a)).orderBy(auditLogs.id),
    outbox: await db.select().from(outboxEvents).where(eq(outboxEvents.householdId, a)).orderBy(outboxEvents.id),
  };
}
async function clean() {
  await db.delete(transactions).where(inArray(transactions.householdId, [a, b]));
  await db.delete(recurringTransactions).where(inArray(recurringTransactions.id, [ruleId, privateRuleId]));
  await db.delete(auditLogs).where(eq(auditLogs.householdId, a));
  await db.delete(outboxEvents).where(eq(outboxEvents.householdId, a));
  await db.delete(merchants).where(eq(merchants.id, merchantId));
  await db.delete(accounts).where(eq(accounts.id, destinationId));
}

describe("ordinary create with a recurring pointer authorizes all writes", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await clean();
    await reset();
    await db.insert(accounts).values({
      id: destinationId, householdId: a, ownerUserId: actors.get("owner")!.id,
      name: "Separate destination", type: "checking", currency: "ZMW", balance: "1000.00",
    });
    await db.insert(merchants).values({ id: merchantId, householdId: a, name: merchantName });
    await db.insert(recurringTransactions).values([
      { id: ruleId, accountId: ids.sharedAccount }, { id: privateRuleId, accountId: ids.privateAccount },
    ].map(rule => ({
      ...rule, householdId: a, name: "Recurring parent", amount: "12.34", type: "expense" as const,
      frequency: "monthly" as const, startDate: "2026-11-01", nextDueDate: "2026-12-01",
    })));
  });
  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  it.each(["private", "missing"] as const)("does not persist a merchant alias for a denied %s parent", async kind => {
    const before = await state();
    await post(payload(kind === "private" ? privateRuleId : randomUUID())).expect(404);
    expect(await state()).toEqual(before);
  });

  it("rolls an alias back when the authorized transaction cannot commit its audit", async () => {
    const before = await state();
    const failure = vi.spyOn(businessAuditService, "logCreate")
      .mockRejectedValueOnce(new Error("R04_CREATE_AUDIT_ROLLBACK"));
    try { await post(payload()).expect(500); }
    finally { failure.mockRestore(); }
    expect(await state()).toEqual(before);
  });

  it("rechecks a different destination that becomes peer-private while create waits", async () => {
    const before = await state();
    const blocker = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    let waiting = false;
    try {
      await blocker.query("BEGIN");
      const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await blocker.query("UPDATE accounts SET is_private=true WHERE id=$1", [destinationId]);
      pending = post(payload()).timeout(10_000).then(response => response);
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
    const response = await pending!;
    expect(response.status).toBe(404);
    expect(await state()).toEqual({
      ...before, accounts: before.accounts.map(account => account.id === destinationId ? { ...account, isPrivate: true } : account),
    });
  });

  it("keeps a successful pointer create, merchant recognition and idempotent replay", async () => {
    const body = payload();
    const created = await post(body).expect(201);
    expect(created.body).toMatchObject({
      isDuplicate: false,
      data: { accountId: destinationId, merchantId, name: merchantName, isRecurring: true,
        recurringTransactionId: ruleId, amount: { amount: "7.25", currency: "ZMW" } },
    });
    await post({ ...body, name: "Replay Must Not Learn Another Alias" }).expect(409);
    const replay = await post(body).expect(200);
    expect(replay.body).toMatchObject({ isDuplicate: true, data: { id: created.body.data.id, name: merchantName } });
    await waitForCreateEvent(created.body.data.id);
    const saved = await state();
    expect(saved.accounts.find(account => account.id === destinationId)?.balance).toBe("992.75");
    expect(saved.transactions.filter(transaction => transaction.idempotencyKey === body.idempotencyKey)).toHaveLength(1);
    expect(saved.aliases.map(alias => alias.aliasName)).toEqual([rawName]);
    expect(saved.audit.filter(audit => audit.entityId === created.body.data.id && audit.action === "CREATE")).toHaveLength(1);
  });

  it("keeps one posting, alias and audit when the same idempotency key overlaps", async () => {
    const body = payload();
    const responses = await Promise.all([post(body), post(body)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 201]);
    expect(responses[0].body.data.id).toBe(responses[1].body.data.id);
    await waitForCreateEvent(responses[0].body.data.id);
    const saved = await state();
    expect(saved.accounts.find(account => account.id === destinationId)?.balance).toBe("992.75");
    expect(saved.transactions.filter(transaction => transaction.idempotencyKey === body.idempotencyKey)).toHaveLength(1);
    expect(saved.aliases.map(alias => alias.aliasName)).toEqual([rawName]);
    expect(saved.audit.filter(audit => audit.entityId === responses[0].body.data.id && audit.action === "CREATE")).toHaveLength(1);
  });

  it("preserves ordinary creation without a recurring pointer", async () => {
    const body = { ...payload(), recurringTransactionId: undefined };
    const created = await post(body).expect(201);
    await waitForCreateEvent(created.body.data.id);
    expect(created.body.data).toMatchObject({ merchantId, name: merchantName, isRecurring: false, recurringTransactionId: null });
    const [saved] = await db.select().from(transactions).where(and(eq(transactions.id, created.body.data.id), eq(transactions.householdId, a)));
    expect(saved.merchantId).toBe(merchantId);
    expect((await state()).aliases.map(alias => alias.aliasName)).toEqual([rawName]);
  });
});
