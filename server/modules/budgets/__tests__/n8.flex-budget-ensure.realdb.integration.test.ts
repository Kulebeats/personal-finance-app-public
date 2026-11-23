/**
 * N8 (b)2: a household on the flex system that has no flex budget yet (a new
 * household: budget_system defaults to "flex", and the bucket was only made
 * when settings were saved) can get one, so its first flex amount is saved
 * instead of dropped. POST /api/budgets/flex returns the household's flex
 * budget, creating and auditing it once; the amount is then written through
 * the ordinary PUT /api/budgets/:id, as the budget page does.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, budgets } from "@shared/schema";
import { db } from "../../../db";
import { a, b, actors, app, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

function signed(call: request.Test, role: Role) {
  const actor = actors.get(role)!;
  return call.set("Cookie", actor.cookie).set("X-Capital-Subject", actor.id).set("X-Capital-Household", a);
}

const ensureFlex = (role: Role = "member") => signed(request(app).post("/api/budgets/flex"), role).send({});

const flexBudgets = () => db.select().from(budgets)
  .where(and(inArray(budgets.householdId, [a, b]), eq(budgets.isFlexBucket, true)));

const fixtureAudits = () => db.select().from(auditLogs).where(or(
  inArray(auditLogs.householdId, [a, b]),
  inArray(auditLogs.userId, Array.from(actors.values(), ({ id }) => id)),
));

describe("N8 (b)2 POST /api/budgets/flex", () => {
  beforeAll(start, 30_000);
  afterEach(async () => {
    await db.delete(budgets).where(inArray(budgets.householdId, [a, b]));
    await db.delete(auditLogs).where(or(
      inArray(auditLogs.householdId, [a, b]),
      inArray(auditLogs.userId, Array.from(actors.values(), ({ id }) => id)),
    ));
  });
  afterAll(stop);

  it("creates the household's one flex budget, audited, and returns the same one again", async () => {
    expect(await flexBudgets()).toEqual([]);

    const first = await ensureFlex().expect(200);
    expect(first.body).toMatchObject({
      success: true,
      data: { isFlexBucket: true, householdId: a, amount: { amount: "0.00", currency: "ZMW" } },
    });
    const stored = await flexBudgets();
    expect(stored.map(({ id, householdId }) => ({ id, householdId }))).toEqual([{ id: first.body.data.id, householdId: a }]);

    const second = await ensureFlex().expect(200);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await flexBudgets()).toHaveLength(1);

    const creates = (await fixtureAudits()).filter((row) => row.action === "CREATE" && row.entityType === "budget");
    expect(creates).toMatchObject([{ householdId: a, userId: actors.get("member")!.id, entityId: first.body.data.id }]);
  });

  it("takes the first flex amount through the ordinary budget update", async () => {
    const { body } = await ensureFlex().expect(200);
    await signed(request(app).put(`/api/budgets/${body.data.id}`), "member")
      .send({ amount: { amount: "1500.00", currency: "ZMW" } })
      .expect(200);
    const [stored] = await flexBudgets();
    expect({ amount: stored.amount, isFlexBucket: stored.isFlexBucket }).toEqual({ amount: "1500.00", isFlexBucket: true });
  });

  it("refuses a request with no session (401) and writes nothing", async () => {
    const before = await fixtureAudits();
    await request(app).post("/api/budgets/flex").send({}).expect(401);
    expect(await flexBudgets()).toEqual([]);
    expect(await fixtureAudits()).toEqual(before);
  });

  it("rejects a body it does not take (400) and writes nothing", async () => {
    const before = await fixtureAudits();
    await signed(request(app).post("/api/budgets/flex"), "member").send({ amount: "1500.00" }).expect(400);
    expect(await flexBudgets()).toEqual([]);
    expect(await fixtureAudits()).toEqual(before);
  });

  it("denies a read-only actor without creating a flex budget or an audit row", async () => {
    const before = await fixtureAudits();
    await ensureFlex("view_only").expect(403);
    expect(await flexBudgets()).toEqual([]);
    expect(await fixtureAudits()).toEqual(before);
  });
});
