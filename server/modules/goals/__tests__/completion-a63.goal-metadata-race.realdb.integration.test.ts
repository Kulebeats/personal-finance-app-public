import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, goalActivityLog, goalContributions, goals } from "@shared/schema";
import { createSignedHousehold, type SignedHousehold } from "../../../__tests__/signed-household-fixture";
import { db, pool } from "../../../db";
import { businessAuditService } from "../../../services/BusinessAuditService";

const originalName = "Synthetic rainwater fund";
const editedName = "Synthetic water storage fund";
let owner: SignedHousehold;

const signed = (call: request.Test) => call.set(owner.headers);
const contribute = (goalId: string, amount: string) => signed(request(owner.app).post(`/api/goals/${goalId}/contribute`))
  .send({ amount: { amount, currency: "ZMW" } });
const rename = (goalId: string) => signed(request(owner.app).put(`/api/goals/${goalId}`)).send({ name: editedName });
const readGoal = (goalId: string) => signed(request(owner.app).get(`/api/goals/${goalId}`));

async function makeGoal() {
  const created = await signed(request(owner.app).post("/api/goals")).send({
    name: originalName, type: "save_up", goalType: "other", targetAmount: { amount: "100.00", currency: "ZMW" },
  }).expect(201);
  const id: string = created.body.data.id;
  const funded = await contribute(id, "90.00").expect(201);
  expect(funded.body.data.goal).toMatchObject({
    currentAmount: { amount: "90.00", currency: "ZMW" }, isCompleted: false,
  });
  return id;
}

async function state(id: string) {
  const [goal] = await db.select({
    name: goals.name, currentAmount: goals.currentAmount, isCompleted: goals.isCompleted,
    completedAt: goals.completedAt, status: goals.status,
  }).from(goals).where(eq(goals.id, id));
  const activities = await db.select({ type: goalActivityLog.activityType, metadata: goalActivityLog.metadata })
    .from(goalActivityLog).where(and(eq(goalActivityLog.goalId, id), eq(goalActivityLog.activityType, "goal_updated")));
  const audits = await db.select({ details: auditLogs.details }).from(auditLogs).where(and(
    eq(auditLogs.entityType, "goal"), eq(auditLogs.entityId, id), eq(auditLogs.action, "UPDATE"),
  ));
  const contributions = await db.select({ amount: goalContributions.amount }).from(goalContributions)
    .where(eq(goalContributions.goalId, id)).orderBy(goalContributions.amount);
  return { goal, activities, audits, contributions };
}

/** Pause the first real mutation after its audit write and before it commits. */
async function race(goalId: string, firstKind: "rename" | "contribution") {
  let announce!: (pid: number) => void;
  const held = new Promise<number>(resolve => { announce = resolve; });
  let release!: () => void;
  const go = new Promise<void>(resolve => { release = resolve; });
  const audit = businessAuditService.logUpdate.bind(businessAuditService);
  const pause = vi.spyOn(businessAuditService, "logUpdate").mockImplementation(async params => {
    const result = await audit(params);
    const matches = firstKind === "rename" ? params.newValue?.name === editedName
      : params.metadata?.operation === "addContribution";
    if (params.entityType === "goal" && params.entityId === goalId && matches) {
      if (!params.tx) throw new Error("Goal write did not carry its audit transaction");
      const { rows: [row] } = await params.tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
      announce(row.pid);
      await go;
    }
    return result;
  });
  const start = (kind: "rename" | "contribution") =>
    (kind === "rename" ? rename(goalId) : contribute(goalId, "10.00")).timeout(12_000).then(result => result);
  const first = start(firstKind);
  void first.catch(() => undefined);
  let second: Promise<request.Response> | undefined;
  try {
    const pid = await Promise.race([held, first.then(response => { throw new Error(`First request exited before commit cut: ${response.status}`); })]);
    second = start(firstKind === "rename" ? "contribution" : "rename");
    void second.catch(() => undefined);
    let waiting = false;
    const deadline = Date.now() + 5_000;
    while (!waiting && Date.now() < deadline) {
      const { rows: [row] } = await pool.query<{ blocked: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked", [pid]);
      waiting = row.blocked;
      if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(waiting).toBe(true);
    release();
    return await Promise.all([first, second]);
  } finally {
    release();
    await Promise.allSettled(second ? [first, second] : [first]);
    pause.mockRestore();
  }
}

async function expectCompleted(id: string, name: string) {
  const { goal, contributions } = await state(id);
  expect(goal).toEqual({ name, currentAmount: "100.00", status: "completed", isCompleted: true, completedAt: expect.any(Date) });
  expect(contributions).toEqual([{ amount: "10.00" }, { amount: "90.00" }]);
  const response = await readGoal(id).expect(200);
  expect(response.body.data).toMatchObject({
    name, currentAmount: { amount: "100.00", currency: "ZMW" }, status: "completed", isCompleted: true,
  });
}

describe("A-63 signed goal metadata and contribution concurrency", () => {
  beforeAll(async () => { owner = await createSignedHousehold("goal-metadata-race", "ZMW"); }, 30_000);
  afterAll(async () => { await owner.cleanup(); });

  it("enforces completed-goal edit policy when the contribution wins the goal lock", async () => {
    const id = await makeGoal();
    const [added, refused] = await race(id, "contribution");
    expect(added.status).toBe(201);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatchObject({ code: "VALIDATION_ERROR", message: expect.stringMatching(/completed goal/i) });
    await expectCompleted(id, originalName);
    const committed = await state(id);
    expect(committed.activities).toEqual([]);
    expect(committed.audits).toHaveLength(2);
  }, 20_000);

  it("keeps the renamed goal and completes it when the rename wins the goal lock", async () => {
    const id = await makeGoal();
    const [edited, added] = await race(id, "rename");
    expect(edited.status).toBe(200);
    expect(edited.body.data.name).toBe(editedName);
    expect(added.status).toBe(201);
    await expectCompleted(id, editedName);
    const committed = await state(id);
    expect(committed.activities).toEqual([{
      type: "goal_updated", metadata: { fields: ["name"], previousValues: { name: originalName } },
    }]);
    expect(committed.audits).toHaveLength(3);
    expect(committed.audits).toEqual(expect.arrayContaining([expect.objectContaining({
      details: expect.objectContaining({
        oldValue: expect.objectContaining({ name: originalName, currentAmount: "90.00" }),
        newValue: expect.objectContaining({ name: editedName, currentAmount: "90.00" }),
      }),
    })]));
  }, 20_000);

  it("rolls back the rename and its activity when the business audit fails", async () => {
    const id = await makeGoal();
    const before = await state(id);
    const failing = vi.spyOn(businessAuditService, "logUpdate").mockRejectedValueOnce(new Error("Synthetic goal rename audit failure"));
    try {
      await rename(id).expect(500);
    } finally { failing.mockRestore(); }
    expect(await state(id)).toEqual(before);
    const read = await readGoal(id).expect(200);
    expect(read.body.data).toMatchObject({ name: originalName, currentAmount: { amount: "90.00", currency: "ZMW" } });
    await rename(id).expect(200);
    expect((await state(id)).activities).toHaveLength(1);
  });
});
