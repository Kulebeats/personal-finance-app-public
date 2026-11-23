import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  accounts, auditLogs, outboxEvents, recurringTransactionHistory,
  recurringTransactionLinks, recurringTransactions, transactions,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { a, actors, app, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const ruleId = randomUUID();
const privateOrigins = ["linked account", "linked transaction", "historical account", "historical transaction"] as const;
type Origin = typeof privateOrigins[number] | "shared" | "suggested";

function put(viewer: Role, body: Record<string, unknown> = { name: "PUT_CHANGED" }, id = ruleId) {
  return request(app).put(`/api/recurring/${id}`).set("Cookie", actors.get(viewer)!.cookie).send(body);
}
function detail(viewer: Role) {
  return request(app).get(`/api/recurring/${ruleId}`).set("Cookie", actors.get(viewer)!.cookie);
}
async function state() {
  return {
    rules: await db.select().from(recurringTransactions).where(eq(recurringTransactions.id, ruleId)),
    history: await db.select().from(recurringTransactionHistory).where(eq(recurringTransactionHistory.recurringTransactionId, ruleId)).orderBy(recurringTransactionHistory.id),
    links: await db.select().from(recurringTransactionLinks).where(eq(recurringTransactionLinks.recurringTransactionId, ruleId)).orderBy(recurringTransactionLinks.id),
    audit: await db.select().from(auditLogs).where(eq(auditLogs.entityId, ruleId)).orderBy(auditLogs.id),
    outbox: await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, ruleId)).orderBy(outboxEvents.id),
    transactions: await db.select().from(transactions).where(inArray(transactions.id, [ids.privateTx, ids.sharedTx])).orderBy(transactions.id),
  };
}
async function clean() {
  await db.delete(recurringTransactions).where(eq(recurringTransactions.id, ruleId));
  await db.delete(auditLogs).where(eq(auditLogs.entityId, ruleId));
  await db.delete(outboxEvents).where(eq(outboxEvents.aggregateId, ruleId));
}
async function seed(origin: Origin) {
  await db.insert(recurringTransactions).values({
    id: ruleId, householdId: a, accountId: ids.sharedAccount,
    name: "PUT_ORIGIN_SECRET", amount: "73.21", type: "expense", frequency: "monthly",
    startDate: "2026-11-01", nextDueDate: "2026-12-01",
    detectionMethod: origin === "suggested" ? "suggested" : "manual",
  });
  if (origin === "linked account") {
    await db.insert(recurringTransactionLinks).values({ recurringTransactionId: ruleId, transactionId: ids.privateTx });
  } else if (origin === "linked transaction" || origin === "historical transaction") {
    await db.update(transactions).set({ isPrivate: true }).where(eq(transactions.id, ids.sharedTx));
    if (origin === "linked transaction") {
      await db.insert(recurringTransactionLinks).values({ recurringTransactionId: ruleId, transactionId: ids.sharedTx });
    } else {
      await db.insert(recurringTransactionHistory).values({
        recurringTransactionId: ruleId, action: "unlinked", linkedTransactionId: ids.sharedTx,
      });
    }
  } else if (origin === "historical account") {
    await db.insert(recurringTransactionHistory).values({
      recurringTransactionId: ruleId, action: "updated",
      previousState: { accountId: ids.privateAccount, amount: "73.21" },
      newState: { accountId: ids.sharedAccount, categoryId: null, merchantId: null },
    });
  } else if (origin === "suggested") {
    // A surviving visible sample still does not prove every original contributor.
    await db.insert(recurringTransactionLinks).values({ recurringTransactionId: ruleId, transactionId: ids.sharedTx });
  }
}

describe("ordinary recurring PUT preserves the full actor audience", () => {
  beforeAll(start, 20_000);
  beforeEach(reset);
  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  it.each(privateOrigins)("conceals a peer's private %s from member/admin PUT without effects", async origin => {
    await seed(origin);
    const before = await state();
    for (const viewer of ["member", "admin"] as const) {
      await detail(viewer).expect(404);
      const absent = await put(viewer, { name: "PUT_CHANGED" }, randomUUID()).expect(404);
      const denied = await put(viewer).expect(404);
      expect(denied.body.error).toMatchObject({ code: absent.body.error.code, message: absent.body.error.message });
      expect(JSON.stringify(denied.body)).not.toMatch(/PUT_ORIGIN_SECRET|73\.21/);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(await state()).toEqual(before);
  });

  it("does not give the household owner access to a peer's private transaction", async () => {
    await seed("linked transaction");
    await db.update(transactions).set({ ownerUserId: actors.get("member")!.id }).where(eq(transactions.id, ids.sharedTx));
    const before = await state();
    await detail("owner").expect(404);
    await put("owner").expect(404);
    expect(await state()).toEqual(before);
    expect((await put("member").expect(200)).body.data.name).toBe("PUT_CHANGED");
  });

  it("conceals a suggested origin from PUT even when its surviving sample is visible", async () => {
    await seed("suggested");
    const before = await state();
    for (const viewer of ["owner", "admin", "member"] as const) {
      await detail(viewer).expect(404);
      await put(viewer).expect(404);
    }
    expect(await state()).toEqual(before);
  });

  it.each(["shared", ...privateOrigins] as const)("keeps an authorized %s update and its history", async origin => {
    await seed(origin);
    const viewer = origin === "shared" ? "member" : "owner";
    await detail(viewer).expect(200);
    const before = await state();
    const response = await put(viewer).expect(200);
    // FIN-05: seeded without a currency / denomination receipt, so the unit is unknown (null), never a default ZMW.
    expect(response.body.data).toMatchObject({ id: ruleId, name: "PUT_CHANGED", amount: { amount: "73.21", currency: null } });
    const after = await state();
    expect(after.rules[0].name).toBe("PUT_CHANGED");
    expect(after.history).toHaveLength(before.history.length + 1);
    expect(after.history.find(entry => entry.action === "updated" && entry.performedBy === actors.get(viewer)!.id))
      .toMatchObject({ previousState: { name: "PUT_ORIGIN_SECRET" }, newState: { name: "PUT_CHANGED" } });
    expect(after.links).toEqual(before.links);
    expect(after.transactions).toEqual(before.transactions);
  });

  it.each(["linked transaction", "historical account"] as const)("rechecks a %s privacy change after the PUT waits", async origin => {
    await seed(origin);
    if (origin === "linked transaction") {
      await db.update(transactions).set({ isPrivate: false }).where(eq(transactions.id, ids.sharedTx));
    } else {
      await db.update(accounts).set({ isPrivate: false }).where(eq(accounts.id, ids.privateAccount));
    }
    await detail("member").expect(200);
    const before = await state();
    const blocker = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    let blocked = false;
    try {
      await blocker.query("BEGIN");
      const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      if (origin === "linked transaction") {
        await blocker.query("UPDATE transactions SET is_private=true WHERE id=$1", [ids.sharedTx]);
      } else {
        await blocker.query("UPDATE accounts SET is_private=true WHERE id=$1", [ids.privateAccount]);
      }
      let settled = false;
      pending = put("member").timeout(10_000).then(response => { settled = true; return response; });
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
    const response = await pending!;
    expect(blocked).toBe(true);
    expect(response.status).toBe(404);
    const after = await state();
    expect(after.rules).toEqual(before.rules);
    expect(after.history).toEqual(before.history);
    expect(after.links).toEqual(before.links);
    expect(after.audit).toEqual(before.audit);
    expect(after.outbox).toEqual(before.outbox);
  });
});
