import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { accounts, auditLogs, outboxEvents, recurringTransactionHistory, recurringTransactionLinks, recurringTransactions, transactions } from "@shared/schema";
import { db, pool } from "../../../db";
import { a, actors, app, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const actions = ["pause", "resume", "skip", "end", "delete"] as const;
type Action = typeof actions[number];
const ruleId = randomUUID();
const survivorIds = [randomUUID(), randomUUID()];

function mutate(action: Action, viewer: Role | "outsider", id: string = ruleId) {
  const path = `/api/recurring/${id}`;
  const req = action === "delete" ? request(app).delete(path) : request(app).post(`${path}/${action}`);
  return req.set("Cookie", actors.get(viewer)!.cookie).send(action === "end" ? { endDate: "2027-01-15" } : {});
}

async function state() {
  return {
    rules: await db.select().from(recurringTransactions).where(eq(recurringTransactions.id, ruleId)),
    history: await db.select().from(recurringTransactionHistory).where(eq(recurringTransactionHistory.recurringTransactionId, ruleId)).orderBy(recurringTransactionHistory.id),
    links: await db.select().from(recurringTransactionLinks).where(eq(recurringTransactionLinks.recurringTransactionId, ruleId)).orderBy(recurringTransactionLinks.id),
    audits: await db.select().from(auditLogs).where(eq(auditLogs.entityId, ruleId)).orderBy(auditLogs.id),
    events: await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, ruleId)).orderBy(outboxEvents.id),
    accounts: await db.select().from(accounts).where(inArray(accounts.id, [ids.privateAccount, ids.sharedAccount])).orderBy(accounts.id),
    transactions: await db.select().from(transactions).where(inArray(transactions.id, [ids.privateTx, ids.sharedTx])).orderBy(transactions.id),
  };
}

async function clean() {
  await db.delete(recurringTransactions).where(inArray(recurringTransactions.id, [ruleId, ...survivorIds]));
  await db.delete(outboxEvents).where(eq(outboxEvents.aggregateId, ruleId));
  await db.delete(auditLogs).where(eq(auditLogs.entityId, ruleId));
}

async function seed(action: Action, accountId: string, id = ruleId) {
  await db.insert(recurringTransactions).values({
    id, householdId: a, accountId, name: "Lifecycle rule marker", amount: "12.34",
    type: "expense", frequency: "monthly", startDate: "2026-11-01", nextDueDate: "2026-12-01", isPaused: action === "resume",
  });
}

describe("ordinary recurring lifecycle writes use the actor's full rule audience", () => {
  beforeAll(start, 20_000);
  beforeEach(reset);
  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  it.each(["rule move", "membership downgrade", "account privacy", "linked source privacy", "historical account privacy"] as const)("revalidates after a concurrent %s commits", async change => {
    await seed("pause", ids.sharedAccount);
    if (change === "linked source privacy") {
      await db.insert(recurringTransactionLinks).values({ recurringTransactionId: ruleId, transactionId: ids.sharedTx });
    }
    if (change === "historical account privacy") {
      await db.update(accounts).set({ isPrivate: false }).where(eq(accounts.id, ids.privateAccount));
      await db.insert(recurringTransactionHistory).values({ recurringTransactionId: ruleId, action: "updated",
        previousState: { accountId: ids.privateAccount }, newState: { accountId: ids.sharedAccount } });
    }
    const initial = await state();
    const blocker = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await blocker.query("BEGIN");
      const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      if (change === "rule move") {
        await blocker.query("UPDATE recurring_transactions SET account_id=$1 WHERE id=$2", [ids.privateAccount, ruleId]);
      } else if (change === "linked source privacy") {
        await blocker.query("UPDATE transactions SET is_private=true, owner_user_id=$1 WHERE id=$2", [actors.get("owner")!.id, ids.sharedTx]);
      } else if (change === "account privacy" || change === "historical account privacy") {
        await blocker.query("UPDATE accounts SET is_private=true, owner_user_id=$1 WHERE id=$2",
          [actors.get("owner")!.id, change === "account privacy" ? ids.sharedAccount : ids.privateAccount]);
      } else {
        await blocker.query("UPDATE household_members SET role=$1 WHERE household_id=$2 AND user_id=$3",
          ["view_only", a, actors.get("member")!.id]);
      }
      pending = mutate("pause", "member").timeout(10_000).then(response => response);
      let blocked = false;
      const deadline = Date.now() + 5_000;
      while (!blocked && Date.now() < deadline) {
        const { rows } = await pool.query<{ blocked: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked", [pid],
        );
        blocked = rows[0].blocked;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 25));
      }
      await blocker.query("COMMIT");
      const response = await pending;
      expect.soft(blocked).toBe(true);
      const after = await state();
      expect.soft(response.status).toBe(change === "membership downgrade" ? 403 : 404);
      expect.soft(after.rules[0]).toMatchObject({
        accountId: change === "rule move" ? ids.privateAccount : ids.sharedAccount, isPaused: false,
      });
      expect.soft(after.history).toEqual(initial.history);
      expect.soft(after.audits).toHaveLength(0);
      expect(after.events).toHaveLength(0);
    } finally {
      try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
      await pending;
    }
  });

  it("clears the last recurring pointer when the rule is deleted after an ordinary link", async () => {
    await seed("delete", ids.sharedAccount);
    await request(app).post(`/api/recurring/${ruleId}/link`).set("Cookie", actors.get("member")!.cookie)
      .send({ transactionId: ids.sharedTx }).expect(200);
    const linked = await state();
    expect(linked.links).toHaveLength(1);
    expect(linked.transactions.find(row => row.id === ids.sharedTx)).toMatchObject({ isRecurring: true, recurringTransactionId: ruleId });
    await mutate("delete", "member").expect(200);
    const after = await state();
    expect(after.rules).toHaveLength(0);
    expect(after.links).toHaveLength(0);
    expect(after.accounts).toEqual(linked.accounts);
    expect(after.transactions.find(row => row.id === ids.sharedTx)).toMatchObject({
      isRecurring: false, recurringTransactionId: null, amount: "11.11", accountId: ids.sharedAccount,
    });
  });

  it.each(["direct pointer", "one survivor", "existing survivor pointer", "ambiguous survivors", "private survivor"] as const)(
    "handles %s when deleting without changing the account balance", async scenario => {
      await seed("delete", ids.sharedAccount);
      if (scenario !== "direct pointer") {
        await db.insert(recurringTransactionLinks).values({ recurringTransactionId: ruleId, transactionId: ids.sharedTx });
        const remaining = scenario === "ambiguous survivors" ? survivorIds : survivorIds.slice(0, 1);
        for (const id of remaining) {
          await seed("delete", scenario === "private survivor" ? ids.privateAccount : ids.sharedAccount, id);
          await db.insert(recurringTransactionLinks).values({ recurringTransactionId: id, transactionId: ids.sharedTx });
        }
      }
      await db.update(transactions).set({ isRecurring: true,
        recurringTransactionId: scenario === "existing survivor pointer" ? survivorIds[0] : ruleId,
      }).where(eq(transactions.id, ids.sharedTx));
      const before = await state();
      const response = await mutate("delete", "member");
      const after = await state();
      if (scenario === "private survivor" || scenario === "ambiguous survivors") {
        expect(response.status).toBe(scenario === "private survivor" ? 404 : 409);
        expect(after).toEqual(before);
      } else {
        expect(response.status).toBe(200);
        expect(after.rules).toHaveLength(0);
        expect(after.accounts).toEqual(before.accounts);
        expect(after.transactions.find(row => row.id === ids.sharedTx)).toMatchObject({
          recurringTransactionId: scenario === "direct pointer" ? null : survivorIds[0],
          isRecurring: scenario !== "direct pointer", amount: "11.11",
        });
      }
    });

  it("rolls back the first pointer repair when a later source has conflicting links", async () => {
    await seed("delete", ids.sharedAccount);
    const sortedSources = [ids.privateTx, ids.sharedTx].sort();
    await db.update(transactions).set({ isRecurring: true, recurringTransactionId: ruleId })
      .where(inArray(transactions.id, sortedSources));
    for (const id of survivorIds) {
      await seed("delete", ids.sharedAccount, id);
      await db.insert(recurringTransactionLinks).values({ recurringTransactionId: id, transactionId: sortedSources[1] });
    }
    const before = await state();
    await mutate("delete", "owner").expect(409);
    expect(await state()).toEqual(before);
  });

  function postWithPointer(viewer: "owner" | "member" | "outsider", accountId: string, pointer = ruleId) {
    return request(app).post("/api/transactions").set("Cookie", actors.get(viewer)!.cookie).send({
      name: "Direct recurring source", date: "2026-11-01", type: "expense", accountId,
      amount: { amount: "7.00", currency: "ZMW" }, recurringRuleId: pointer,
    });
  }

  it("clears a linked pointer when the DELETE path uses uppercase UUID text", async () => {
    await seed("delete", ids.sharedAccount);
    await request(app).post(`/api/recurring/${ruleId}/link`).set("Cookie", actors.get("member")!.cookie)
      .send({ transactionId: ids.sharedTx }).expect(200);
    await mutate("delete", "member", ruleId.toUpperCase()).expect(200);
    expect((await state()).transactions.find(row => row.id === ids.sharedTx)?.recurringTransactionId).toBeNull();
  });

  it("permits deletion despite a legacy foreign household pointer and leaves that transaction untouched", async () => {
    await seed("delete", ids.sharedAccount);
    await db.update(transactions).set({ recurringTransactionId: ruleId, isRecurring: true }).where(eq(transactions.id, ids.foreignTx));
    const readForeign = () => db.select().from(transactions).where(eq(transactions.id, ids.foreignTx));
    const foreign = await readForeign();
    await mutate("delete", "member").expect(200);
    expect(await readForeign()).toEqual(foreign);
  });

  it.each(["foreign", "private", "missing"] as const)("rejects an ordinary create with a %s recurring parent", async kind => {
    await seed("delete", kind === "private" ? ids.privateAccount : ids.sharedAccount);
    const id = kind === "missing" ? randomUUID() : ruleId;
    const viewer = kind === "foreign" ? "outsider" : "member";
    const accountId = kind === "foreign" ? ids.foreignAccount : ids.sharedAccount;
    const readAccount = () => db.select().from(accounts).where(eq(accounts.id, accountId));
    const before = await readAccount();
    const response = await postWithPointer(viewer, accountId, id);
    expect.soft(response.status).toBe(404);
    expect(await readAccount()).toEqual(before);
  });

  it("records a valid direct pointer from ordinary transaction creation and clears it on delete", async () => {
    await seed("delete", ids.sharedAccount);
    const response = await postWithPointer("member", ids.sharedAccount).expect(201);
    expect.soft(response.body.data).toMatchObject({ isRecurring: true, recurringTransactionId: ruleId });
    const readAccount = () => db.select().from(accounts).where(eq(accounts.id, ids.sharedAccount));
    const balanceAfterCreate = await readAccount();
    await mutate("delete", "member").expect(200);
    expect(await readAccount()).toEqual(balanceAfterCreate);
    const [saved] = await db.select().from(transactions).where(eq(transactions.id, response.body.data.id));
    expect(saved).toMatchObject({ isRecurring: false, recurringTransactionId: null });
  });

  it("denies an overlapping create after its deleted parent commits", async () => {
    await seed("delete", ids.sharedAccount);
    const blocker = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await blocker.query("BEGIN");
      const { rows: [{ pid }] } = await blocker.query("SELECT pg_backend_pid() AS pid");
      await blocker.query("DELETE FROM recurring_transactions WHERE id=$1", [ruleId]);
      pending = postWithPointer("member", ids.sharedAccount).timeout(10000).then(response => response);
      let waiting = false;
      const deadline = Date.now() + 3000;
      while (!waiting && Date.now() < deadline) {
        const { rows } = await pool.query("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked", [pid]);
        waiting = rows[0].blocked;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
      }
      await blocker.query("COMMIT");
      expect.soft(waiting).toBe(true);
      expect.soft((await pending).status).toBe(404);
      expect(await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.recurringTransactionId, ruleId))).toHaveLength(0);
    } finally {
      try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
      await pending;
    }
  });

  it("deletes an unambiguous legacy direct pointer stored with the old false flag", async () => {
    await seed("delete", ids.sharedAccount);
    await db.update(transactions).set({ isRecurring: false, recurringTransactionId: ruleId }).where(eq(transactions.id, ids.sharedTx));
    const before = await state();
    await mutate("delete", "member").expect(200);
    const after = await state();
    expect(after.accounts).toEqual(before.accounts);
    expect(after.transactions.find(row => row.id === ids.sharedTx)).toMatchObject({ isRecurring: false, recurringTransactionId: null });
  });

  it("waits for an ordinary direct create and reconciles its pointer on DELETE", async () => {
    await seed("delete", ids.sharedAccount);
    const blocker = await pool.connect();
    let creating: Promise<request.Response> | undefined;
    let deleting: Promise<request.Response> | undefined;
    async function waitForWaiter(blockedBy: number) {
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        const { rows } = await pool.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))", [blockedBy]);
        if (rows.length) return Number(rows[0].pid);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error("Expected a blocked transaction");
    }
    try {
      await blocker.query("BEGIN");
      const { rows: [{ pid }] } = await blocker.query("SELECT pg_backend_pid() AS pid");
      await blocker.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [ids.privateAccount]);
      creating = postWithPointer("owner", ids.privateAccount).timeout(20000).then(response => response);
      const creator = await waitForWaiter(pid);
      deleting = mutate("delete", "member").timeout(20000).then(response => response);
      await waitForWaiter(creator);
      await blocker.query("COMMIT");
      const created = await creating;
      expect(created.status).toBe(201);
      // The member cannot clear the newly committed source on the owner's private account.
      expect((await deleting).status).toBe(404);
      await mutate("delete", "owner").expect(200);
      const [saved] = await db.select().from(transactions).where(eq(transactions.id, created.body.data.id));
      expect(saved).toMatchObject({ isRecurring: false, recurringTransactionId: null });
    } finally {
      try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
      await Promise.allSettled([creating, deleting]);
    }
  });
  describe.each(actions)("%s", action => {
    it.each(["private rule account", "private linked transaction", "private historical account"] as const)(
      "conceals a %s from a peer and preserves its durable state", async source => {
        await seed(action, source === "private rule account" ? ids.privateAccount : ids.sharedAccount);
        if (source === "private linked transaction") {
          await db.update(transactions).set({ isPrivate: true, ownerUserId: actors.get("owner")!.id }).where(eq(transactions.id, ids.sharedTx));
          await db.insert(recurringTransactionLinks).values({ recurringTransactionId: ruleId, transactionId: ids.sharedTx });
        }
        if (source === "private historical account") {
          await db.insert(recurringTransactionHistory).values({ recurringTransactionId: ruleId, action: "updated",
            previousState: { accountId: ids.privateAccount }, newState: { accountId: ids.sharedAccount } });
        }
        const missing = await mutate(action, "member", randomUUID()).expect(404);
        const before = await state();
        const response = await mutate(action, "member");
        const after = await state();
        expect.soft(response.status).toBe(404);
        expect.soft(response.body.error).toMatchObject({ code: missing.body.error.code, message: missing.body.error.message });
        expect.soft(JSON.stringify(response.body)).not.toContain("Lifecycle rule marker");
        expect(after).toEqual(before);
      });

    it.each(["professional", "view_only", "outsider"] as const)("denies %s on the shared rule", async viewer => {
      await seed(action, ids.sharedAccount);
      const before = await state();
      await mutate(action, viewer).expect(viewer === "outsider" ? 404 : 403);
      expect(await state()).toEqual(before);
    });

    it.each(["member", "owner"] as const)("allows %s to change a visible rule", async viewer => {
      await seed(action, viewer === "owner" ? ids.privateAccount : ids.sharedAccount);
      const before = await state();
      await mutate(action, viewer).expect(200);
      const after = await state();
      expect(after.accounts).toEqual(before.accounts);
      expect(after.transactions).toEqual(before.transactions);
      expect(after.audits).toHaveLength(1);
      if (action === "delete") {
        expect(after.rules).toEqual([]);
        return;
      }
      const expected = {
        pause: { isPaused: true }, resume: { isPaused: false }, skip: { nextDueDate: "2027-01-01" },
        end: { isActive: false, endDate: "2027-01-15" },
      };
      expect(after.rules[0]).toMatchObject(expected[action]);
      expect(after.history).toHaveLength(1);
    });
  });
});
