/**
 * FIN-13 follow-ups (review of #362), goals. REAL HTTP against real Postgres,
 * synthetic data only.
 *
 * - Lock order: an audited goal transaction takes the household row before the
 *   goal row. Erasure, accept-invite and ownership transfer hold the household
 *   FOR UPDATE and then take goal rows, so a writer that held the goal while
 *   waiting for the household (its audit insert's FK) could deadlock with them.
 *   Each test holds the household FOR UPDATE, as erasure does, starts the write,
 *   and checks the goal row is still free while the write waits.
 * - Assignment update and remove audit the row they locked in their own
 *   transaction, not one read before it: a concurrent change committed while
 *   the write waited is the audit's oldValue.
 */
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { goals, notifications } from "@shared/schema";
import { db, pool } from "../../../db";
import { a, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const member = () => actors.get("member")!;
const send = (method: "post" | "put" | "delete", path: string) => request(app)[method](path).set("Cookie", member().cookie);
const LOCK_WAIT_MS = 10_000;
const POLL_MS = 50;

const clearAudits = () => pool.query("delete from audit_logs where household_id=$1", [a]);

async function createGoal(): Promise<string> {
  const response = await send("post", "/api/goals").send({
    name: "FIN-13 lock-order savings", type: "save_up", goalType: "other", targetAmount: { amount: "10000.00", currency: "ZMW" },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data.id as string;
}

/** Opens a transaction on its own connection that holds `sql` locks until released. */
async function holdLock(sql: string, params: unknown[]): Promise<{ client: PoolClient; pid: number }> {
  const client = await pool.connect();
  await client.query("BEGIN");
  await client.query(sql, params);
  const { rows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
  return { client, pid: rows[0].pid };
}

async function release(holder: { client: PoolClient }, outcome: "COMMIT" | "ROLLBACK") {
  try {
    await holder.client.query(outcome);
  } finally {
    holder.client.release();
  }
}

/** Resolves once `count` other backends are waiting on a lock `pid` holds. */
async function waitUntilBlockedBy(pid: number, count = 1): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    const { rows } = await pool.query("select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))", [pid]);
    if (rows.length >= count) return;
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`Fewer than ${count} writes waited on the held lock`);
}

/** True when the goal row can be locked right now, i.e. the waiting write does not hold it. */
async function goalRowIsFree(goalId: string): Promise<boolean> {
  const probe = await pool.connect();
  try {
    await probe.query("BEGIN");
    await probe.query("select id from goals where id=$1 for update nowait", [goalId]);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "55P03") return false;
    throw error;
  } finally {
    await probe.query("ROLLBACK");
    probe.release();
  }
}

/**
 * Holds the household as erasure does, starts `write`, and reports whether the
 * goal row was still free while the write waited. The hold is then released
 * and the write must still succeed with `status`.
 */
async function goalFreeWhileHouseholdHeld(goalId: string, write: () => request.Test, status: number): Promise<boolean> {
  const holder = await holdLock("select id from households where id=$1 for update", [a]);
  let pending: Promise<request.Response> | undefined;
  try {
    pending = write().then(response => response);
    await waitUntilBlockedBy(holder.pid);
    return await goalRowIsFree(goalId);
  } finally {
    await release(holder, "ROLLBACK");
    if (pending) {
      const response = await pending;
      expect(response.status, JSON.stringify(response.body)).toBe(status);
    }
  }
}

const partial = (amount: string) => ({
  accountId: ids.sharedAccount, assignmentType: "partial_balance", partialAmount: { amount, currency: "ZMW" }, autoUpdate: false,
});

async function assignmentAudits(goalId: string, operation: string) {
  return (await pool.query(
    "select * from audit_logs where entity_type='goal' and entity_id=$1 and details->>'operation' = $2 order by created_at, id",
    [goalId, operation],
  )).rows;
}

/**
 * Commits a concurrent change of the assignment's amount to 150.00 while
 * `write` waits on that row, then returns the write's response.
 */
async function writeAfterConcurrentChange(goalId: string, write: () => request.Test): Promise<request.Response> {
  const holder = await holdLock(
    "update goal_account_assignments set partial_amount='150.00' where goal_id=$1 and account_id=$2",
    [goalId, ids.sharedAccount],
  );
  let pending: Promise<request.Response> | undefined;
  try {
    pending = write().then(response => response);
    await waitUntilBlockedBy(holder.pid);
  } finally {
    await release(holder, "COMMIT");
  }
  return pending;
}

describe("FIN-13 follow-ups: goal lock order and the locked assignment row", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await db.delete(goals).where(eq(goals.householdId, a));
    await reset();
    await clearAudits();
  });
  afterEach(async () => {
    await db.delete(goals).where(eq(goals.householdId, a));
  });
  afterAll(async () => {
    await clearAudits();
    await db.delete(notifications).where(inArray(notifications.userId, [...actors.values()].map(({ id }) => id)));
    await stop();
  });

  describe("an audited goal write takes the household before the goal", () => {
    it("POST /api/goals/:id/contribute", async () => {
      const id = await createGoal();
      const contribute = () => send("post", `/api/goals/${id}/contribute`).send({ amount: { amount: "25.00", currency: "ZMW" } });
      expect(await goalFreeWhileHouseholdHeld(id, contribute, 201)).toBe(true);
    });

    it("POST /api/goals/:id/contributions/:contributionId/reverse", async () => {
      const id = await createGoal();
      const contributed = await send("post", `/api/goals/${id}/contribute`).send({ amount: { amount: "25.00", currency: "ZMW" } });
      expect(contributed.status, JSON.stringify(contributed.body)).toBe(201);
      const contributionId = contributed.body.data.contribution.id as string;
      const reverse = () => send("post", `/api/goals/${id}/contributions/${contributionId}/reverse`).send({ reason: "Synthetic mistake" });
      expect(await goalFreeWhileHouseholdHeld(id, reverse, 201)).toBe(true);
    });

    it("POST /api/goals/:id/complete", async () => {
      const id = await createGoal();
      const complete = () => send("post", `/api/goals/${id}/complete`).send({});
      expect(await goalFreeWhileHouseholdHeld(id, complete, 200)).toBe(true);
    });
  });

  describe("assignment update and remove audit the row locked in their transaction", () => {
    it("PUT /api/goals/:id/accounts/:accountId records the committed amount as oldValue", async () => {
      const id = await createGoal();
      expect((await send("post", `/api/goals/${id}/assign-account`).send(partial("100.00"))).status).toBe(201);
      await clearAudits();

      const response = await writeAfterConcurrentChange(id,
        () => send("put", `/api/goals/${id}/accounts/${ids.sharedAccount}`).send(partial("200.00")));
      expect(response.status, JSON.stringify(response.body)).toBe(200);

      const rows = await assignmentAudits(id, "updateAssignment");
      expect(rows).toHaveLength(1);
      expect(rows[0].details).toMatchObject({ oldValue: { partialAmount: "150.00" }, newValue: { partialAmount: "200.00" } });
    });

    it("DELETE /api/goals/:id/accounts/:accountId records the committed amount as oldValue", async () => {
      const id = await createGoal();
      expect((await send("post", `/api/goals/${id}/assign-account`).send(partial("100.00"))).status).toBe(201);
      await clearAudits();

      const response = await writeAfterConcurrentChange(id,
        () => send("delete", `/api/goals/${id}/accounts/${ids.sharedAccount}`));
      expect(response.status, JSON.stringify(response.body)).toBe(200);

      const rows = await assignmentAudits(id, "removeAssignment");
      expect(rows).toHaveLength(1);
      expect(rows[0].details).toMatchObject({ oldValue: { partialAmount: "150.00" } });
    });
  });

  describe("two assignment writes on one account at once", () => {
    // Both PUTs are held at the household (as erasure would hold it) and then
    // released together, so each reaches its own assignment row at the same
    // moment. A writer that locks its own row and then the account's other rows
    // deadlocks with the other one (40P01, a 500); both must complete.
    it("PUT /api/goals/:id/accounts/:accountId on two goals sharing an account both succeed", async () => {
      const first = await createGoal();
      const second = await createGoal();
      for (const id of [first, second]) {
        expect((await send("post", `/api/goals/${id}/assign-account`).send(partial("100.00"))).status).toBe(201);
      }

      for (const round of ["110.00", "120.00", "130.00"]) {
        const holder = await holdLock("select id from households where id=$1 for update", [a]);
        let pending: Promise<request.Response[]> | undefined;
        try {
          pending = Promise.all([first, second].map(id =>
            send("put", `/api/goals/${id}/accounts/${ids.sharedAccount}`).send(partial(round)).then(response => response)));
          await waitUntilBlockedBy(holder.pid, 2);
        } finally {
          await release(holder, "ROLLBACK");
        }
        const responses = await pending;
        for (const response of responses) {
          expect(response.status, `${round}: ${JSON.stringify(response.body)}`).toBe(200);
        }
      }
    }, 60_000);
  });
});
