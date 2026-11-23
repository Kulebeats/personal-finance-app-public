/**
 * FIN-13 / NEW-32 (goals): each goal money write and its audit row commit in
 * one transaction. A write produces exactly one audit row, and when the audit
 * insert fails the write is rolled back, never committed unlogged.
 *
 * Writers: create, delete, archive, unarchive, and account assignment create,
 * update and remove. REAL HTTP against real Postgres, synthetic data only.
 * The audit failure is injected by a trigger scoped to this file's household.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { goalAccountAssignments, goals, notifications } from "@shared/schema";
import { db, pool } from "../../../db";
import { a, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const trigger = `fin13_goal_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const member = () => actors.get("member")!;
const send = (method: "post" | "put" | "delete", path: string) => request(app)[method](path).set("Cookie", member().cookie);

/** Makes this household's next goal audit insert fail, as a broken audit store would. */
async function blockGoalAudit() {
  await pool.query(`CREATE OR REPLACE FUNCTION ${trigger}() RETURNS trigger AS $$ BEGIN
      IF NEW.household_id = '${a}'::uuid AND NEW.entity_type = 'goal' THEN RAISE EXCEPTION 'Synthetic FIN-13 audit failure'; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
}

async function unblockGoalAudit() {
  await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON audit_logs; DROP FUNCTION IF EXISTS ${trigger}()`);
}

async function goalAudits(goalId: string) {
  return (await pool.query("select * from audit_logs where entity_type='goal' and entity_id=$1 order by created_at, id", [goalId])).rows;
}

async function createGoal(name = "FIN-13 synthetic savings"): Promise<string> {
  const response = await send("post", "/api/goals").send({
    name, type: "save_up", goalType: "other", targetAmount: { amount: "10000.00", currency: "ZMW" },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data.id as string;
}

const readGoal = async (id: string) => (await db.select().from(goals).where(eq(goals.id, id)))[0];
const assignmentsOf = (goalId: string) => db.select().from(goalAccountAssignments).where(eq(goalAccountAssignments.goalId, goalId));
const assign = (goalId: string) => send("post", `/api/goals/${goalId}/assign-account`)
  .send({ accountId: ids.sharedAccount, assignmentType: "full_balance", autoUpdate: true });
const clearAudits = () => pool.query("delete from audit_logs where household_id=$1", [a]);

describe("FIN-13: goal writes and their audit rows commit together", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await db.delete(goals).where(eq(goals.householdId, a));
    await reset();
    await clearAudits();
  });
  afterEach(async () => {
    await unblockGoalAudit();
    await db.delete(goals).where(eq(goals.householdId, a));
  });
  afterAll(async () => {
    await unblockGoalAudit();
    await clearAudits();
    await db.delete(notifications).where(inArray(notifications.userId, [...actors.values()].map(({ id }) => id)));
    await stop();
  });

  describe("POST /api/goals", () => {
    it("writes one CREATE row with the goal", async () => {
      const id = await createGoal();
      const rows = await goalAudits(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "CREATE", household_id: a, user_id: member().id });
      expect(rows[0].details.newValue).toMatchObject({ name: "FIN-13 synthetic savings", targetAmount: "10000.00" });
    });

    it("creates no goal when its audit row cannot be written", async () => {
      await blockGoalAudit();
      const response = await send("post", "/api/goals").send({
        name: "FIN-13 unaudited", type: "save_up", goalType: "other", targetAmount: { amount: "10000.00", currency: "ZMW" },
      });
      expect(response.status).toBe(500);
      expect(await db.select().from(goals).where(eq(goals.householdId, a))).toEqual([]);
    });
  });

  describe("DELETE /api/goals/:id", () => {
    it("writes one DELETE row with the deletion", async () => {
      const id = await createGoal();
      await clearAudits();
      await send("delete", `/api/goals/${id}`).expect(200);
      const rows = await goalAudits(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "DELETE", household_id: a, user_id: member().id });
      expect(rows[0].details.oldValue).toMatchObject({ name: "FIN-13 synthetic savings", type: "save_up" });
    });

    it("keeps the goal when the deletion's audit row cannot be written", async () => {
      const id = await createGoal();
      await blockGoalAudit();
      expect((await send("delete", `/api/goals/${id}`)).status).toBe(500);
      expect(await readGoal(id)).toBeDefined();
    });
  });

  describe.each([
    { route: "archive", isArchived: true },
    { route: "unarchive", isArchived: false },
  ])("POST /api/goals/:id/$route", ({ route, isArchived }) => {
    const prepare = async () => {
      const id = await createGoal();
      if (route === "unarchive") await send("post", `/api/goals/${id}/archive`).expect(200);
      await clearAudits();
      return id;
    };

    it("writes one UPDATE row with the change", async () => {
      const id = await prepare();
      await send("post", `/api/goals/${id}/${route}`).expect(200);
      const rows = await goalAudits(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "UPDATE", household_id: a, user_id: member().id });
      expect(rows[0].details).toMatchObject({ newValue: { isArchived }, operation: `${route}Goal` });
      expect((await readGoal(id)).isArchived).toBe(isArchived);
    });

    it("leaves the goal unchanged when the audit row cannot be written", async () => {
      const id = await prepare();
      await blockGoalAudit();
      expect((await send("post", `/api/goals/${id}/${route}`)).status).toBe(500);
      expect((await readGoal(id)).isArchived).toBe(!isArchived);
    });
  });

  describe("account assignments", () => {
    it("assign: writes one UPDATE row with the assignment", async () => {
      const id = await createGoal();
      await clearAudits();
      expect((await assign(id)).status).toBe(201);
      const rows = await goalAudits(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "UPDATE", household_id: a, user_id: member().id });
      expect(rows[0].details).toMatchObject({ operation: "assignAccount",
        newValue: { accountId: ids.sharedAccount, assignmentType: "full_balance", autoUpdate: true } });
    });

    it("assign: writes no assignment and no progress when the audit row cannot be written", async () => {
      const id = await createGoal();
      const before = await readGoal(id);
      await blockGoalAudit();
      expect((await assign(id)).status).toBe(500);
      expect(await assignmentsOf(id)).toEqual([]);
      expect((await readGoal(id)).currentAmount).toBe(before.currentAmount);
    });

    // A full-balance assignment must auto-update, so the update case changes a
    // partial assignment's amount, which also moves the goal's progress.
    const partial = (amount: string) => ({
      accountId: ids.sharedAccount, assignmentType: "partial_balance", partialAmount: { amount, currency: "ZMW" }, autoUpdate: false,
    });
    const assignPartial = (id: string) => send("post", `/api/goals/${id}/assign-account`).send(partial("100.00"));
    const update = (id: string) => send("put", `/api/goals/${id}/accounts/${ids.sharedAccount}`).send(partial("200.00"));

    it("update: writes one UPDATE row with the old and new assignment", async () => {
      const id = await createGoal();
      expect((await assignPartial(id)).status).toBe(201);
      await clearAudits();
      await update(id).expect(200);
      const rows = await goalAudits(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].details).toMatchObject({ operation: "updateAssignment",
        oldValue: { partialAmount: "100.00" }, newValue: { partialAmount: "200.00" } });
    });

    it("update: leaves the assignment and progress unchanged when the audit row cannot be written", async () => {
      const id = await createGoal();
      expect((await assignPartial(id)).status).toBe(201);
      const before = await readGoal(id);
      await blockGoalAudit();
      expect((await update(id)).status).toBe(500);
      expect((await assignmentsOf(id)).map(row => row.partialAmount)).toEqual(["100.00"]);
      expect((await readGoal(id)).currentAmount).toBe(before.currentAmount);
    });

    it("remove: writes one UPDATE row with the removed assignment", async () => {
      const id = await createGoal();
      expect((await assign(id)).status).toBe(201);
      await clearAudits();
      await send("delete", `/api/goals/${id}/accounts/${ids.sharedAccount}`).expect(200);
      const rows = await goalAudits(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].details).toMatchObject({ operation: "removeAssignment",
        oldValue: { accountId: ids.sharedAccount, assignmentType: "full_balance" } });
      expect(await assignmentsOf(id)).toEqual([]);
    });

    it("remove: keeps the assignment and progress when the audit row cannot be written", async () => {
      const id = await createGoal();
      expect((await assign(id)).status).toBe(201);
      const before = await readGoal(id);
      await blockGoalAudit();
      expect((await send("delete", `/api/goals/${id}/accounts/${ids.sharedAccount}`)).status).toBe(500);
      expect(await assignmentsOf(id)).toHaveLength(1);
      expect((await readGoal(id)).currentAmount).toBe(before.currentAmount);
    });
  });
});
