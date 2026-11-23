import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import { accounts, auditLogs, tags, transactionTags, transactions } from "@shared/schema";
import { tagService } from "../tags.service";
import { a, actors, app, ids, reset, snapshot, start, stop } from "./completion-r04.tags.fixture";

const post = (tagId: string) => request(app).post(`/api/tags/transaction/${ids.sharedTx}`).set("Cookie", actors.get("member")!.cookie).send({ tagIds: [tagId] }).then((response) => response);
const signal = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
async function bounded<T>(operation: PromiseLike<T>, milliseconds = 8000): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Synthetic tag operation timed out")), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
async function ledger() {
  return { accounts: await db.select().from(accounts).where(eq(accounts.householdId, a)).orderBy(accounts.id),
    transactions: await db.select().from(transactions).where(eq(transactions.householdId, a)).orderBy(transactions.id) };
}
function timedQuery(client: pg.PoolClient, text: string, values: string[] = [], milliseconds = 6000) {
  const query: pg.QueryConfig<string[]> & { query_timeout: number } = { text, values, query_timeout: milliseconds };
  return client.query(query);
}
async function rollbackAndRelease(client: pg.PoolClient) {
  try { await bounded(timedQuery(client, "ROLLBACK", [], 3000), 4000); }
  catch (error) { client.release(error instanceof Error ? error : new Error("Uncertain synthetic transaction")); throw error; }
  client.release();
}
function deadline() { let timer!: ReturnType<typeof setTimeout>; return {
  promise: new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Synthetic tag lock barrier timed out")), 8000); }),
  clear: () => clearTimeout(timer),
}; }
async function blocked(holderPid: number, waiterPid: number, limit: Promise<never>) {
  while (true) {
    const { rows: [row] } = await Promise.race([pool.query<{ blocked: boolean }>("SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked", [holderPid, waiterPid]), limit]);
    if (row.blocked) return;
  }
}
function watch(test: (text: string, pid: number, result: unknown) => unknown) {
  const original = pg.Client.prototype.query;
  return vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: Parameters<typeof original>) {
    const result: unknown = Reflect.apply(original, this, args);
    const [query] = args as unknown as [unknown];
    const text = typeof query === "object" && query !== null && "text" in query ? query.text : query;
    return (typeof text === "string" ? test(text, Reflect.get(this, "processID") as number, result) : result) as ReturnType<typeof original>;
  });
}
const changes = [
  { name: "membership downgrade", table: "household_members", sql: "UPDATE household_members SET role='view_only' WHERE household_id=$1 AND user_id=$2", values: () => [a, actors.get("member")!.id], denied: 403 },
  { name: "membership removal", table: "household_members", sql: "DELETE FROM household_members WHERE household_id=$1 AND user_id=$2", values: () => [a, actors.get("member")!.id], denied: 403 },
  { name: "account privacy", table: "accounts", sql: "UPDATE accounts SET is_private=true WHERE id=$1", values: () => [ids.sharedAccount], denied: 404 },
  { name: "account owner", table: "accounts", sql: "UPDATE accounts SET is_private=true, owner_user_id=$2 WHERE id=$1", values: () => [ids.sharedAccount, actors.get("admin")!.id], denied: 404 },
  { name: "account deletion", table: "accounts", sql: "UPDATE accounts SET deleted_at=NOW() WHERE id=$1", values: () => [ids.sharedAccount], denied: 404 },
  { name: "transaction privacy", table: "transactions", sql: "UPDATE transactions SET is_private=true WHERE id=$1", values: () => [ids.sharedTx], denied: 404 },
  { name: "transaction owner", table: "transactions", sql: "UPDATE transactions SET is_private=true, owner_user_id=$2 WHERE id=$1", values: () => [ids.sharedTx, actors.get("admin")!.id], denied: 404 },
  { name: "transaction deletion", table: "transactions", sql: "UPDATE transactions SET deleted_at=NOW() WHERE id=$1", values: () => [ids.sharedTx], denied: 404 },
  { name: "transaction parent", table: "transactions", sql: "UPDATE transactions SET account_id=$2 WHERE id=$1", values: () => [ids.sharedTx, ids.privateAccount], denied: 404 },
  { name: "referenced member removal", table: "household_members", sql: "DELETE FROM household_members WHERE household_id=$1 AND user_id=$2", values: () => [a, actors.get("admin")!.id], denied: 404, reference: true },
] as const;

describe("R04 actual PostgreSQL writer ordering", () => {
  beforeAll(start, 20000); beforeEach(reset); afterEach(() => vi.restoreAllMocks()); afterAll(stop);

  it.each(changes)("$name commits first: writer waits then denies unchanged", async (change) => {
    if ("reference" in change) await db.update(tags).set({ memberId: actors.get("admin")!.id }).where(eq(tags.id, ids.tag));
    const holder = await pool.connect(), reached = signal(), limit = deadline();
    let writerPid = 0, pending: Promise<request.Response> | undefined;
    const before = await snapshot();
    try {
      const holderPid = (await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await holder.query("BEGIN"); await holder.query(change.sql, [...change.values()]);
      watch((text, pid, result) => {
        if (text.includes(`from "${change.table}"`) && /for update/i.test(text)) { writerPid = pid; reached.resolve(); }
        return result;
      });
      pending = post(ids.tag);
      await Promise.race([reached.promise, limit.promise]);
      await blocked(holderPid, writerPid, limit.promise);
      await holder.query("COMMIT");
      expect((await bounded(pending)).status).toBe(change.denied);
      // The change itself is outside this business snapshot for membership, or
      // legitimately changes account fields. The command changes no links/count/audit.
      const after = await snapshot();
      expect(after.tags).toEqual(before.tags);
      expect(after.links.map((row) => row.transaction_tags)).toEqual(before.links.map((row) => row.transaction_tags));
      expect(after.audit).toEqual(before.audit);
    } finally {
      limit.clear();
      try { await rollbackAndRelease(holder); }
      finally { await bounded(Promise.allSettled(pending ? [pending] : [])); }
    }
  });

  it.each(changes)("writer commits first: $name waits, next request denies", async (change) => {
    if ("reference" in change) await db.update(tags).set({ memberId: actors.get("admin")!.id }).where(eq(tags.id, ids.tag));
    const other = randomUUID(); await db.insert(tags).values({ id: other, householdId: a, name: `Race ${other}`, usageCount: 0 });
    const reached = signal(), gate = signal(), limit = deadline(), changer = await pool.connect(), before = await ledger();
    let writerPid = 0, pending: Promise<request.Response> | undefined, changing: Promise<unknown> | undefined;
    let held = false;
    watch((text, pid, result) => {
      if (!held && /^insert into "transaction_tags"/i.test(text)) {
        held = true; writerPid = pid;
        return Promise.resolve(result).then(async (value) => { reached.resolve(); await gate.promise; return value; });
      }
      return result;
    });
    try {
      const changerPid = (await changer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      pending = post(other); await Promise.race([reached.promise, limit.promise]);
      await changer.query("BEGIN");
      changing = timedQuery(changer, change.sql, [...change.values()]);
      await blocked(writerPid, changerPid, limit.promise);
      gate.resolve(); expect((await bounded(pending)).status).toBe(200); await bounded(changing);
      // The external change is still uncommitted: an independent reader sees
      // exactly the ledger state before the tag command.
      expect(await ledger()).toEqual(before);
      const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, ids.sharedTx));
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ userId: actors.get("member")!.id, action: "LINK",
        details: { operation: "add_tags", addedTagIds: [other], removedTagIds: [] } });
      await changer.query("COMMIT");
      expect((await db.select().from(tags).where(eq(tags.id, other)))[0].usageCount).toBe(1);
      expect(await db.select().from(transactionTags).where(and(eq(transactionTags.transactionId, ids.sharedTx), eq(transactionTags.tagId, other)))).toHaveLength(1);
      const committed = await ledger();
      // Removal before a new request resolves no household at admission; a
      // removal after admission is caught by the locked writer as403.
      expect((await bounded(post(other))).status).toBe(change.name === "membership removal" ? 404 : change.denied);
      expect(await ledger()).toEqual(committed);
      expect(await db.select().from(auditLogs).where(eq(auditLogs.entityId, ids.sharedTx))).toEqual(audit);
    } finally {
      limit.clear(); gate.resolve();
      try { await bounded(Promise.allSettled([pending, changing].filter(Boolean))); }
      finally { await rollbackAndRelease(changer); }
    }
  });

  it("a tag member reference introduced after discovery conflicts without out-of-order locks", async () => {
    const reached = signal(), gate = signal(), limit = deadline(); let held = false;
    watch((text, _pid, result) => {
      if (!held && text.includes('from "household_members"') && /for update/i.test(text)) {
        held = true;
        return Promise.resolve(result).then(async (value) => { reached.resolve(); await gate.promise; return value; });
      }
      return result;
    });
    const pending = post(ids.tag);
    try {
      await Promise.race([reached.promise, limit.promise]);
      await db.update(tags).set({ memberId: actors.get("admin")!.id }).where(eq(tags.id, ids.tag));
      const changed = await snapshot();
      gate.resolve(); expect((await bounded(pending)).status).toBe(409);
      expect(await snapshot()).toEqual(changed);
    } finally { limit.clear(); gate.resolve(); await bounded(Promise.allSettled([pending])); }
  });

  it("concurrent add/add and set/remove retain exact SQL link counts", async () => {
    const other = randomUUID(); await db.insert(tags).values({ id: other, householdId: a, name: `Concurrent ${other}`, usageCount: 0 });
    const results = await Promise.all([post(other), post(other)]);
    expect(results.map((row) => row.status)).toEqual([200, 200]);
    expect((await db.select().from(tags).where(eq(tags.id, other)))[0].usageCount).toBe(1);
    const cookie = actors.get("member")!.cookie;
    const raced = await Promise.all([
      request(app).put(`/api/tags/transaction/${ids.sharedTx}`).set("Cookie", cookie).send({ tagIds: [other] }),
      request(app).delete(`/api/tags/transaction/${ids.sharedTx}/${other}`).set("Cookie", cookie),
    ]);
    expect(raced.map((row) => row.status)).toEqual([200, 200]);
    const links = await db.select().from(transactionTags).where(inArray(transactionTags.tagId, [ids.tag, other]));
    for (const tag of await db.select().from(tags).where(inArray(tags.id, [ids.tag, other]))) expect(tag.usageCount).toBe(links.filter((link) => link.tagId === tag.id).length);
  });

  it("direct service requires actor and validates identifiers before touching DB", async () => {
    await expect(tagService.addTransactionTags(ids.sharedTx, [ids.tag], undefined as never)).rejects.toMatchObject({ statusCode: 403 });
    const actor = { userId: actors.get("member")!.id, householdId: a, role: "member" as const }, before = await snapshot();
    await expect(tagService.addTransactionTags("bad", [ids.tag], actor)).rejects.toMatchObject({ statusCode: 400 });
    await expect(tagService.removeTransactionTag(ids.sharedTx, "bad", actor)).rejects.toMatchObject({ statusCode: 400 });
    await expect(tagService.setTransactionTags(ids.sharedTx, ["bad"], actor)).rejects.toMatchObject({ statusCode: 400 });
    expect(await snapshot()).toEqual(before);
  });
});
