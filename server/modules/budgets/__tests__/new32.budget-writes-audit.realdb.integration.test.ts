import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { budgetPeriods, budgets } from "@shared/schema";
import { db, pool } from "../../../db";
import { a, actors, app, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

// NEW-32: budget update, delete, forecast override and move each commit with
// exactly one audit row in the same transaction; a failing audit insert rolls
// the write back.
const trigger = `new32_budget_${randomUUID().replaceAll("-", "")}`;
const fromId = randomUUID(), toId = randomUUID();
const budgetIds = [fromId, toId];

const signed = (call: request.Test, role: Role = "member") => call
  .set("Cookie", actors.get(role)!.cookie)
  .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);

type BudgetWrite = { name: string; action: "UPDATE" | "DELETE" | "TRANSFER"; send: () => request.Test };
const writes: BudgetWrite[] = [
  { name: "update", action: "UPDATE",
    send: () => signed(request(app).put(`/api/budgets/${fromId}`)).send({ name: "NEW32 renamed budget" }) },
  { name: "delete", action: "DELETE",
    send: () => signed(request(app).delete(`/api/budgets/${fromId}`)) },
  { name: "forecast override", action: "UPDATE",
    send: () => signed(request(app).put(`/api/budgets/forecast/${fromId}`))
      .send({ year: 2026, month: 10, amount: { amount: "80.00", currency: "ZMW" } }) },
  { name: "move", action: "TRANSFER",
    send: () => signed(request(app).post("/api/budgets/move"))
      .send({ fromBudgetId: fromId, toBudgetId: toId, amount: { amount: "10.00", currency: "ZMW" }, year: 2026, month: 10 }) },
];

async function state() {
  const actorIds = Array.from(actors.values(), actor => actor.id);
  return {
    budgets: (await pool.query("select * from budgets where household_id=$1 order by id", [a])).rows,
    periods: (await pool.query("select * from budget_periods where budget_id=any($1::uuid[]) order by id", [budgetIds])).rows,
    audits: (await pool.query("select * from audit_logs where household_id=$1 or user_id=any($2::uuid[]) order by id", [a, actorIds])).rows,
  };
}
type State = Awaited<ReturnType<typeof state>>;
const added = (before: State, after: State) => after.audits.filter(row => !before.audits.some(prior => prior.id === row.id));

async function dropFailure() {
  await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON audit_logs; DROP FUNCTION IF EXISTS ${trigger}()`);
}
async function rejectMemberAudits() {
  await pool.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.user_id='${actors.get("member")!.id}'::uuid THEN
        RAISE EXCEPTION 'Synthetic mandatory budget audit failure';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
}

describe("NEW-32 budget writes commit with exactly one audit row", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await dropFailure();
    await db.delete(budgets).where(inArray(budgets.id, budgetIds));
    await pool.query("delete from audit_logs where user_id=any($1::uuid[])", [Array.from(actors.values(), actor => actor.id)]);
    await db.insert(budgets).values([
      { id: fromId, householdId: a, name: "NEW32 from budget", amount: "700.00", currency: "ZMW" },
      { id: toId, householdId: a, name: "NEW32 to budget", amount: "300.00", currency: "ZMW" },
    ]);
    await db.insert(budgetPeriods).values(budgetIds.map(budgetId => ({ budgetId,
      startDate: "2026-10-01", endDate: "2026-10-31", budgetAmount: budgetId === fromId ? "75.00" : "25.00", currency: "ZMW" })));
  });
  afterEach(dropFailure);
  afterAll(async () => {
    await dropFailure();
    await db.delete(budgets).where(inArray(budgets.id, budgetIds));
    await stop();
  });

  it.each(writes)("$name writes one $action budget audit row with the write", async write => {
    const before = await state();
    const result = await write.send();
    expect(result.status).toBe(200);
    const after = await state();
    expect(after.budgets.concat(after.periods)).not.toEqual(before.budgets.concat(before.periods));
    const rows = added(before, after);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ household_id: a, user_id: actors.get("member")!.id,
      action: write.action, entity_type: "budget", entity_id: fromId });
  });

  it.each(writes)("$name leaves no write behind when its audit insert fails", async write => {
    const before = await state();
    await rejectMemberAudits();
    const result = await write.send();
    expect.soft(result.status).toBe(500);
    expect(await state()).toEqual(before);
  });

  // P1-1: the confirmed recalculation apply locks the household row FOR UPDATE,
  // then budgets, then periods. Each writer must take the household lock first,
  // so it holds no budget or period lock while it waits (else 40P01).
  it.each(writes)("$name waits on the household lock holding no budget lock, then completes", async write => {
    const before = await state();
    const side = await pool.connect();
    try {
      await side.query("BEGIN");
      const sidePid = (await side.query("select pg_backend_pid() as pid")).rows[0].pid;
      await side.query("select id from households where id=$1 for update", [a]);
      const pending = write.send().then(result => result);
      let isWaiting = false;
      for (let tries = 0; tries < 100 && !isWaiting; tries++) {
        const blocked = await pool.query(
          "select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid))", [sidePid]);
        isWaiting = blocked.rows.length > 0;
        if (!isWaiting) await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(isWaiting).toBe(true);
      // NOWAIT: a writer that already holds these row locks fails this at once.
      await side.query("select id from budgets where id=any($1::uuid[]) order by id for update nowait", [budgetIds]);
      await side.query("select id from budget_periods where budget_id=any($1::uuid[]) order by id for update nowait", [budgetIds]);
      await side.query("COMMIT");
      const result = await pending;
      expect(result.status).toBe(200);
      expect(added(before, await state())).toHaveLength(1);
    } finally {
      await side.query("ROLLBACK").catch(() => undefined);
      side.release();
    }
  });
});
