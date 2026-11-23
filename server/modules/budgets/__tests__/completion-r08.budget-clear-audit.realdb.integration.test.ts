import { randomUUID } from "node:crypto";
import { inArray, or } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, budgetPeriods, budgets } from "@shared/schema";
import { db, pool } from "../../../db";
import { a, b, actors, app, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const removedIds = [randomUUID(), randomUUID()].sort();
const retainedIds: string[] = [randomUUID(), randomUUID()];
const budgetIds = [...removedIds, ...retainedIds];
const periodIds = budgetIds.map(() => randomUUID());
const removedPeriodIds = periodIds.slice(0, removedIds.length);
const retainedPeriodIds = periodIds.slice(removedIds.length);
const fault = `r08_budget_clear_${randomUUID().replaceAll("-", "")}`;
const faultSequence = `${fault}_seen`;

function clear(role: Role = "member", forwardedFor?: string) {
  const actor = actors.get(role)!;
  const call = request(app).post("/api/budgets/clear")
    .set("Cookie", actor.cookie)
    .set("X-Capital-Subject", actor.id)
    .set("X-Capital-Household", a);
  if (forwardedFor) call.set("X-Forwarded-For", forwardedFor);
  return call.send({ confirm: true });
}

function fixtureAuditScope() {
  return or(
    inArray(auditLogs.householdId, [a, b]),
    inArray(auditLogs.userId, Array.from(actors.values(), ({ id }) => id)),
  );
}

async function readState() {
  return {
    budgets: await db.select().from(budgets).where(inArray(budgets.householdId, [a, b])).orderBy(budgets.id),
    periods: await db.select().from(budgetPeriods)
      .where(or(inArray(budgetPeriods.id, periodIds), inArray(budgetPeriods.budgetId, budgetIds)))
      .orderBy(budgetPeriods.id),
    audits: await db.select().from(auditLogs).where(fixtureAuditScope()).orderBy(auditLogs.id),
  };
}

async function removeFixtures() {
  await db.delete(budgets).where(inArray(budgets.id, budgetIds));
  await db.delete(auditLogs).where(fixtureAuditScope());
}

async function rejectMemberBudgetDeleteAudit() {
  const uuidList = (ids: string[]) => ids.map(id => `'${id}'::uuid`).join(", ");
  const retainedState = `jsonb_build_object(
    'budgets', (SELECT jsonb_agg(to_jsonb(retained) ORDER BY retained.id)
      FROM public.budgets AS retained WHERE retained.id IN (${uuidList(retainedIds)})),
    'periods', (SELECT jsonb_agg(to_jsonb(retained) ORDER BY retained.id)
      FROM public.budget_periods AS retained WHERE retained.id IN (${uuidList(retainedPeriodIds)}))
  )`;
  const { rows } = await pool.query<{ snapshot: string }>(`SELECT (${retainedState})::text AS snapshot`);
  const snapshot = Buffer.from(rows[0].snapshot, "utf8").toString("base64");

  // Check final in-transaction state regardless of statement order. The
  // sequence records that the precondition passed even after rollback.
  await pool.query(`
    CREATE SEQUENCE ${faultSequence};
    CREATE FUNCTION ${fault}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM public.budgets WHERE id IN (${uuidList(removedIds)}))
        OR EXISTS (SELECT 1 FROM public.budget_periods WHERE id IN (${uuidList(removedPeriodIds)}))
        OR ${retainedState} IS DISTINCT FROM convert_from(decode('${snapshot}', 'base64'), 'UTF8')::jsonb
      THEN
        RAISE EXCEPTION 'Synthetic budget clear state did not reach the audit fault';
      END IF;
      PERFORM nextval('${faultSequence}');
      RAISE EXCEPTION 'Synthetic mandatory budget clear audit failure';
    END;
    $$;
    CREATE CONSTRAINT TRIGGER ${fault} AFTER INSERT ON audit_logs
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      WHEN (NEW.household_id = '${a}'::uuid
        AND NEW.user_id = '${actors.get("member")!.id}'::uuid
        AND NEW.action = 'DELETE' AND NEW.entity_type = 'budget')
      EXECUTE FUNCTION ${fault}();
  `);
}

describe("R08 NEW-32 signed budget clear audit", () => {
  beforeAll(start, 30_000);

  beforeEach(async () => {
    await db.insert(budgets).values([
      { id: removedIds[0], householdId: a, name: "Synthetic default budget", amount: "700.00" },
      { id: removedIds[1], householdId: a, name: "Synthetic month-only budget", amount: null },
      { id: retainedIds[0], householdId: a, name: "Synthetic flex budget", amount: "500.00", isFlexBucket: true },
      { id: retainedIds[1], householdId: b, name: "Synthetic foreign budget", amount: "400.00" },
    ]);
    await db.insert(budgetPeriods).values(budgetIds.map((budgetId, index) => ({
      id: periodIds[index],
      budgetId,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      budgetAmount: "75.00",
      spentAmount: "12.34",
      rolloverIn: "3.45",
      version: index + 1,
    })));
  });

  afterEach(removeFixtures);
  afterAll(stop);

  it("clears exactly the owned non-flex budgets and records one audit for those IDs", async () => {
    const before = await readState();
    const result = await clear().expect(200);
    expect(result.body.data).toEqual({ cleared: 2 });

    const after = await readState();
    expect(after.budgets).toEqual(before.budgets.filter(row => retainedIds.includes(row.id)));
    expect(after.periods).toEqual(before.periods.filter(row => retainedIds.includes(row.budgetId)));

    const added = after.audits.filter(row => !before.audits.some(prior => prior.id === row.id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      householdId: a,
      userId: actors.get("member")!.id,
      action: "DELETE",
      entityType: "budget",
      entityId: expect.stringMatching(/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i),
      details: {
        operation: "clear",
        oldValue: { cleared: 2, budgetIds: expect.arrayContaining(removedIds) },
      },
    });
    const details = added[0].details as { oldValue: { budgetIds: string[] } };
    expect([...details.oldValue.budgetIds].sort()).toEqual(removedIds);
  });

  it("returns zero on a second clear without changing the remaining state or adding an audit", async () => {
    const first = await clear().expect(200);
    expect(first.body.data).toEqual({ cleared: 2 });
    const afterFirst = await readState();

    const second = await clear().expect(200);
    expect(second.body.data).toEqual({ cleared: 0 });
    expect(await readState()).toEqual(afterFirst);
  });

  it.each(["203.0.113.10, 10.0.0.1", "not-an-ip"])(
    "commits the clear and its audit with forwarded provenance %s",
    async forwardedFor => {
      const before = await readState();
      const response = await clear("member", forwardedFor).expect(200);
      expect(response.body.data).toEqual({ cleared: 2 });

      const after = await readState();
      expect(after.budgets).toEqual(before.budgets.filter(row => retainedIds.includes(row.id)));
      expect(after.periods).toEqual(before.periods.filter(row => retainedIds.includes(row.budgetId)));
      const added = after.audits.filter(row => !before.audits.some(prior => prior.id === row.id));
      expect(added).toMatchObject([{
        householdId: a,
        userId: actors.get("member")!.id,
        action: "DELETE",
        entityType: "budget",
        details: { operation: "clear", oldValue: { cleared: 2, budgetIds: removedIds } },
      }]);
      expect(added[0].ipAddress ?? "").not.toMatch(/,|not-an-ip/);
    },
  );

  it("retains both budgets and their periods when the required audit insert fails", async () => {
    const before = await readState();
    await rejectMemberBudgetDeleteAudit();
    try {
      const result = await clear();
      const { rows } = await pool.query<{ is_called: boolean }>(`SELECT is_called FROM ${faultSequence}`);
      expect.soft(rows[0].is_called).toBe(true);
      expect.soft(result.status).toBe(500);
      expect(await readState()).toEqual(before);
    } finally {
      await pool.query(`
        DROP TRIGGER ${fault} ON audit_logs;
        DROP FUNCTION ${fault}();
        DROP SEQUENCE ${faultSequence};
      `);
    }
  });

  it("denies a signed read-only actor without deleting budgets or auditing a deletion", async () => {
    const before = await readState();
    await clear("view_only").expect(403);
    expect(await readState()).toEqual(before);
  });
});
