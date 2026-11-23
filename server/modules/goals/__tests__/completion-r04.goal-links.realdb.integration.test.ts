import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { accounts, auditLogs, goalActivityLog, goalContributions, goals, transactionGoalLinks, transactions } from "@shared/schema";
import { db, pool } from "../../../db";
import { a, actors, app, b, ids, reset, roles, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const sharedGoalId = randomUUID();
const foreignGoalId = randomUUID();
const goalIds = [sharedGoalId, foreignGoalId];
type Viewer = Role | "outsider";

function getLinks(goalId: string, viewer: Viewer) {
  return request(app).get(`/api/goals/${goalId}/transactions`).set("Cookie", actors.get(viewer)!.cookie);
}

function linkIds(body: { data: Array<{ transactionId: string }> }) {
  return body.data.map((link) => link.transactionId).sort();
}

async function clearGoals() {
  await db.delete(transactionGoalLinks).where(inArray(transactionGoalLinks.goalId, goalIds));
  await db.delete(goals).where(inArray(goals.id, goalIds));
}

async function persistedState() {
  return {
    audit: await db.select().from(auditLogs).where(inArray(auditLogs.entityId, goalIds)).orderBy(auditLogs.id),
    activity: await db.select().from(goalActivityLog).where(inArray(goalActivityLog.goalId, goalIds)).orderBy(goalActivityLog.id),
    contributions: await db.select().from(goalContributions).where(inArray(goalContributions.goalId, goalIds)).orderBy(goalContributions.id),
    goals: await db.select().from(goals).where(inArray(goals.id, goalIds)).orderBy(goals.id),
    links: await db.select().from(transactionGoalLinks).where(inArray(transactionGoalLinks.goalId, goalIds)).orderBy(transactionGoalLinks.id),
    transactions: await db.select().from(transactions).where(inArray(transactions.id, [ids.privateTx, ids.sharedTx, ids.foreignTx])).orderBy(transactions.id),
    accounts: await db.select().from(accounts).where(inArray(accounts.id, [ids.privateAccount, ids.sharedAccount, ids.foreignAccount])).orderBy(accounts.id),
  };
}

async function goalState() {
  const { transactions: sourceTransactions, accounts: sourceAccounts, ...state } = await persistedState();
  return state;
}

async function unlinkDuringChange(sql: string, parameters: string[]) {
  const blocker = await pool.connect();
  let pending: Promise<request.Response> | undefined;
  try {
    await blocker.query("BEGIN");
    const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await blocker.query(sql, parameters);
    let settled = false;
    pending = request(app).delete(`/api/goals/${sharedGoalId}/transactions/${ids.sharedTx}`)
      .set("Cookie", actors.get("member")!.cookie).timeout(8_000)
      .then(response => { settled = true; return response; });
    let blocked = false;
    const deadline = Date.now() + 4_000;
    while (!settled && Date.now() < deadline) {
      const { rows } = await pool.query<{ blocked: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked", [pid],
      );
      if (rows[0].blocked) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await blocker.query("COMMIT");
    return { response: await pending, blocked };
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await pending;
  }
}

describe("R04 goal transaction links respect the current actor's transaction and account visibility", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await clearGoals();
    await reset();
    await db.insert(goals).values([
      { id: sharedGoalId, householdId: a, name: "R04 shared goal", type: "save_up", goalType: "other", targetAmount: "1000.00", currentAmount: "0.00", currency: "ZMW" },
      { id: foreignGoalId, householdId: b, name: "R04 foreign goal", type: "save_up", goalType: "other", targetAmount: "1000.00", currentAmount: "0.00", currency: "ZMW" },
    ]);
    await db.insert(transactionGoalLinks).values([
      { goalId: sharedGoalId, transactionId: ids.privateTx, linkType: "spending", amount: "777.77" },
      { goalId: sharedGoalId, transactionId: ids.sharedTx, linkType: "spending", amount: "11.11" },
      { goalId: foreignGoalId, transactionId: ids.foreignTx, linkType: "spending", amount: "22.22" },
    ]);
  });
  afterEach(clearGoals);
  afterAll(async () => { await clearGoals(); await stop(); });

  it.each(["admin", "member"] as const)("%s cannot unlink another member's private-account transaction", async viewer => {
    const before = await persistedState();
    await request(app).delete(`/api/goals/${sharedGoalId}/transactions/${ids.privateTx}`)
      .set("Cookie", actors.get(viewer)!.cookie).expect(404);
    expect(await persistedState()).toEqual(before);
  });

  it("cannot unlink a private transaction merely because its account is shared", async () => {
    await db.update(transactions).set({ isPrivate: true, ownerUserId: actors.get("member")!.id })
      .where(eq(transactions.id, ids.sharedTx));
    const before = await persistedState();
    await request(app).delete(`/api/goals/${sharedGoalId}/transactions/${ids.sharedTx}`)
      .set("Cookie", actors.get("owner")!.cookie).expect(404);
    expect(await persistedState()).toEqual(before);
  });

  it.each(["view_only", "professional"] as const)("%s cannot unlink a visible shared transaction", async viewer => {
    const before = await persistedState();
    await request(app).delete(`/api/goals/${sharedGoalId}/transactions/${ids.sharedTx}`)
      .set("Cookie", actors.get(viewer)!.cookie).expect(403);
    expect(await persistedState()).toEqual(before);
  });

  it.each(["deleted transaction", "deleted account", "foreign account"] as const)("rejects a %s without changing the goal", async kind => {
    if (kind === "deleted transaction") await db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, ids.sharedTx));
    if (kind === "deleted account") await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, ids.sharedAccount));
    if (kind === "foreign account") await db.update(transactions).set({ accountId: ids.foreignAccount }).where(eq(transactions.id, ids.sharedTx));
    const before = await persistedState();
    await request(app).delete(`/api/goals/${sharedGoalId}/transactions/${ids.sharedTx}`)
      .set("Cookie", actors.get("owner")!.cookie).expect(404);
    expect(await persistedState()).toEqual(before);
  });

  it.each(["account privacy", "transaction privacy", "role downgrade"] as const)("rechecks %s after a real database lock wait", async kind => {
    const before = await goalState();
    const change = kind === "account privacy"
      ? { sql: "UPDATE accounts SET is_private = true WHERE id = $1", parameters: [ids.sharedAccount] }
      : kind === "transaction privacy"
        ? { sql: "UPDATE transactions SET is_private = true WHERE id = $1", parameters: [ids.sharedTx] }
        : { sql: "UPDATE household_members SET role = 'professional' WHERE household_id = $1 AND user_id = $2", parameters: [a, actors.get("member")!.id] };
    const result = await unlinkDuringChange(change.sql, change.parameters);
    expect(result.response.status).toBe(kind === "role downgrade" ? 403 : 404);
    expect(result.blocked).toBe(true);
    expect(await goalState()).toEqual(before);
  });

  it("keeps display-hidden shared accounts editable", async () => {
    await db.update(accounts).set({ isHidden: true }).where(eq(accounts.id, ids.sharedAccount));
    await request(app).delete(`/api/goals/${sharedGoalId}/transactions/${ids.sharedTx}`)
      .set("Cookie", actors.get("member")!.cookie).expect(200);
    expect((await persistedState()).links.some(link => link.transactionId === ids.sharedTx)).toBe(false);
  });

  it("unlinks a contribution made by the ordinary link route exactly once", async () => {
    await db.delete(transactionGoalLinks).where(eq(transactionGoalLinks.transactionId, ids.sharedTx));
    await db.update(transactions).set({ type: "income" }).where(eq(transactions.id, ids.sharedTx));
    const before = await persistedState();
    const cookie = actors.get("member")!.cookie;
    await request(app).post(`/api/goals/${sharedGoalId}/transactions`).set("Cookie", cookie)
      .send({ transactionId: ids.sharedTx, linkType: "contribution", confirmOverfund: true }).expect(201);
    const linked = await persistedState();
    expect(linked.goals.find(goal => goal.id === sharedGoalId)?.currentAmount).toBe("11.11");
    expect(linked.contributions).toHaveLength(1);
    const responses = await Promise.all([0, 1].map(() => request(app)
      .delete(`/api/goals/${sharedGoalId}/transactions/${ids.sharedTx}`).set("Cookie", cookie)));
    expect(responses.map(response => response.status).sort()).toEqual([200, 404]);
    const after = await persistedState();
    expect(after.goals.find(goal => goal.id === sharedGoalId)?.currentAmount).toBe("0.00");
    expect(after.links.some(link => link.transactionId === ids.sharedTx)).toBe(false);
    expect(after.contributions).toEqual([]);
    expect(after.transactions).toEqual(before.transactions);
    expect(after.accounts).toEqual(before.accounts);
    expect(after.activity).toHaveLength(linked.activity.length + 1);
    expect(after.audit).toHaveLength(linked.audit.length + 1);
  });

  it.each([
    ["member", "sharedTx", "11.11"],
    ["owner", "privateTx", "777.77"],
  ] as const)("allows %s to unlink their visible %s", async (viewer, transactionKey, amount) => {
    const before = await persistedState();
    await request(app).delete(`/api/goals/${sharedGoalId}/transactions/${ids[transactionKey]}`)
      .set("Cookie", actors.get(viewer)!.cookie).expect(200);
    const after = await persistedState();
    expect(after.links.some(link => link.goalId === sharedGoalId && link.transactionId === ids[transactionKey])).toBe(false);
    expect(after.goals.find(goal => goal.id === sharedGoalId)?.currentAmount).toBe(amount);
    expect(after.transactions).toEqual(before.transactions);
    expect(after.accounts).toEqual(before.accounts);
    expect(after.activity).toHaveLength(before.activity.length + 1);
    expect(after.audit).toHaveLength(before.audit.length + 1);
  });

  it.each(roles)("%s sees the shared link and only their own private-account link", async (viewer) => {
    const before = await persistedState();
    const response = await getLinks(sharedGoalId, viewer).expect(200);
    const expected = viewer === "owner" ? [ids.privateTx, ids.sharedTx].sort() : [ids.sharedTx];
    expect(linkIds(response.body)).toEqual(expected);
    expect(response.body.data.find((link: { transactionId: string }) => link.transactionId === ids.sharedTx))
      .toMatchObject({ transaction: { id: ids.sharedTx, name: "SHAREDTXN coffee", amount: "11.11" } });
    if (viewer === "owner") {
      expect(response.body.data.find((link: { transactionId: string }) => link.transactionId === ids.privateTx))
        .toMatchObject({ transaction: { id: ids.privateTx, name: "PRIVSECRET purchase", amount: "777.77" } });
    } else {
      const serialized = JSON.stringify(response.body);
      for (const secret of [ids.privateTx, "PRIVSECRET", "777.77"]) expect(serialized).not.toContain(secret);
    }
    expect(await persistedState()).toEqual(before);
  });

  it("a private transaction on a shared account is visible only to its owner", async () => {
    await db.update(transactions).set({ isPrivate: true, ownerUserId: actors.get("member")!.id }).where(eq(transactions.id, ids.sharedTx));
    const before = await persistedState();
    expect(linkIds((await getLinks(sharedGoalId, "member").expect(200)).body)).toEqual([ids.sharedTx]);
    expect(linkIds((await getLinks(sharedGoalId, "owner").expect(200)).body)).toEqual([ids.privateTx]);
    for (const viewer of ["admin", "view_only", "professional"] as const) {
      const response = await getLinks(sharedGoalId, viewer).expect(200);
      expect(response.body.data).toEqual([]);
      expect(JSON.stringify(response.body)).not.toContain(ids.sharedTx);
    }
    expect(await persistedState()).toEqual(before);
  });

  it("a private-only goal link returns an empty list without a hidden count or marker", async () => {
    await db.delete(transactionGoalLinks).where(eq(transactionGoalLinks.transactionId, ids.sharedTx));
    const before = await persistedState();
    const response = await getLinks(sharedGoalId, "member").expect(200);
    expect(response.body).toEqual({ success: true, data: [] });
    for (const secret of [ids.privateTx, "PRIVSECRET", "777.77"]) expect(JSON.stringify(response.body)).not.toContain(secret);
    expect(linkIds((await getLinks(sharedGoalId, "owner").expect(200)).body)).toEqual([ids.privateTx]);
    expect(await persistedState()).toEqual(before);
  });

  it("a foreign account cannot authorize a household transaction and foreign goals stay 404", async () => {
    await db.update(transactions).set({ accountId: ids.foreignAccount }).where(eq(transactions.id, ids.privateTx));
    const before = await persistedState();
    expect(linkIds((await getLinks(sharedGoalId, "owner").expect(200)).body)).toEqual([ids.sharedTx]);
    await getLinks(sharedGoalId, "outsider").expect(404);
    await getLinks(foreignGoalId, "owner").expect(404);
    expect(linkIds((await getLinks(foreignGoalId, "outsider").expect(200)).body)).toEqual([ids.foreignTx]);
    expect(await persistedState()).toEqual(before);
  });
});
