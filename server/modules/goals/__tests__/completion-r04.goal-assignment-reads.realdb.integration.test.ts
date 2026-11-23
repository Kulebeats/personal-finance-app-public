import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import request from "supertest";
import { accounts, goalAccountAssignments, goals, householdMembers } from "@shared/schema";
import { db } from "../../../db";
import { a, actors, app, b, ids, reset, roles, snapshot, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const sharedGoalId = randomUUID();
const foreignGoalId = randomUUID();
const goalIds = [sharedGoalId, foreignGoalId];
const assignmentIds = { shared: randomUUID(), private: randomUUID(), corrupt: randomUUID(), foreign: randomUUID(), foreignGoalLocal: randomUUID() };
type Viewer = Role | "outsider";

function detail(goalId: string, viewer: Viewer) {
  return request(app).get(`/api/goals/${goalId}`).set("Cookie", actors.get(viewer)!.cookie);
}

function assignments(goalId: string, viewer: Viewer) {
  return request(app).get(`/api/goals/${goalId}/assignments`).set("Cookie", actors.get(viewer)!.cookie);
}

function householdAssignments(viewer: Viewer) {
  return request(app).get("/api/goals/assignments").set("Cookie", actors.get(viewer)!.cookie);
}

async function clearGoals() {
  await db.delete(goalAccountAssignments).where(inArray(goalAccountAssignments.goalId, goalIds));
  await db.delete(goals).where(inArray(goals.id, goalIds));
}

async function persistedState() {
  return {
    fixture: await snapshot(),
    goals: await db.select().from(goals).where(inArray(goals.id, goalIds)).orderBy(goals.id),
    assignments: await db.select().from(goalAccountAssignments).where(inArray(goalAccountAssignments.goalId, goalIds)).orderBy(goalAccountAssignments.id),
  };
}

describe("R04 goal assignment read privacy on marked PostgreSQL", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await clearGoals();
    await reset();
    await db.insert(goals).values([
      { id: sharedGoalId, householdId: a, name: "R04 assignment goal", type: "save_up", goalType: "other", targetAmount: "9000.00", currentAmount: "100.00", currency: "ZMW" },
      { id: foreignGoalId, householdId: b, name: "FOREIGN_GOAL_SECRET", type: "save_up", goalType: "other", targetAmount: "1000.00", currentAmount: "0.00", currency: "ZMW" },
    ]);
    await db.insert(goalAccountAssignments).values([
      { id: assignmentIds.shared, goalId: sharedGoalId, accountId: ids.sharedAccount, assignmentType: "partial_balance", partialAmount: "11.11", autoUpdate: false },
      { id: assignmentIds.private, goalId: sharedGoalId, accountId: ids.privateAccount, assignmentType: "partial_balance", partialAmount: "777.77", autoUpdate: false },
      // The schema allows this mismatched household pair; a read must not expose its account.
      { id: assignmentIds.corrupt, goalId: sharedGoalId, accountId: ids.foreignAccount, assignmentType: "partial_balance", partialAmount: "222.22", autoUpdate: false },
      { id: assignmentIds.foreign, goalId: foreignGoalId, accountId: ids.foreignAccount, assignmentType: "partial_balance", partialAmount: "33.33", autoUpdate: false },
      { id: assignmentIds.foreignGoalLocal, goalId: foreignGoalId, accountId: ids.sharedAccount, assignmentType: "partial_balance", partialAmount: "44.44", autoUpdate: false },
    ]);
  });
  afterEach(clearGoals);
  afterAll(async () => { await clearGoals(); await stop(); });

  it.each(roles)("%s receives only visible account assignments in both read DTOs", async viewer => {
    const before = await persistedState();
    const goal = await detail(sharedGoalId, viewer).expect(200);
    const separate = await assignments(sharedGoalId, viewer).expect(200);
    const expected = viewer === "owner" ? [assignmentIds.shared, assignmentIds.private] : [assignmentIds.shared];
    expect(goal.body.data.assignments.map((row: { id: string }) => row.id).sort()).toEqual([...expected].sort());
    expect(separate.body.data.map((row: { id: string }) => row.id).sort()).toEqual([...expected].sort());
    expect(goal.body.data.assignments.find((row: { id: string }) => row.id === assignmentIds.shared)).toMatchObject({
      id: assignmentIds.shared, goalId: sharedGoalId, accountId: ids.sharedAccount,
      assignmentType: "partial_balance", partialAmount: "11.11", autoUpdate: false,
      accountName: "A5 SHARED", accountBalance: "988.89", accountCurrency: "ZMW",
    });
    expect(separate.body.data.find((row: { id: string }) => row.id === assignmentIds.shared)).toMatchObject({
      id: assignmentIds.shared, goalId: sharedGoalId, accountId: ids.sharedAccount,
      assignmentType: "partial_balance", partialAmount: { amount: "11.11", currency: "ZMW" }, autoUpdate: false,
      accountName: "A5 SHARED", accountBalance: { amount: "988.89", currency: "ZMW" },
      accountCurrency: "ZMW", accountType: "checking",
    });
    for (const body of [goal.body.data.assignments, separate.body.data]) {
      const serialized = JSON.stringify(body);
      for (const secret of [assignmentIds.corrupt, ids.foreignAccount, "Foreign parent", "222.22"])
        expect(serialized).not.toContain(secret);
      if (viewer !== "owner")
        for (const secret of [assignmentIds.private, ids.privateAccount, "A5 PRIVATE", "777.77", "4222.23"])
          expect(serialized).not.toContain(secret);
    }
    expect(await persistedState()).toEqual(before);
  });

  it("excludes deleted accounts from both assignment read paths", async () => {
    await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, ids.sharedAccount));
    const before = await persistedState();
    for (const read of [detail, assignments]) {
      const owner = await read(sharedGoalId, "owner").expect(200);
      const ownerRows = read === detail ? owner.body.data.assignments : owner.body.data;
      expect(ownerRows.map((row: { id: string }) => row.id)).toEqual([assignmentIds.private]);
      const member = await read(sharedGoalId, "member").expect(200);
      expect(read === detail ? member.body.data.assignments : member.body.data).toEqual([]);
    }
    expect(await persistedState()).toEqual(before);
  });

  it("returns 404 for the outsider's foreign goal and still reads their own assignment", async () => {
    const before = await persistedState();
    await detail(sharedGoalId, "outsider").expect(404);
    await assignments(sharedGoalId, "outsider").expect(404);
    await detail(foreignGoalId, "owner").expect(404);
    await assignments(foreignGoalId, "owner").expect(404);
    const ownGoal = await detail(foreignGoalId, "outsider").expect(200);
    const ownAssignments = await assignments(foreignGoalId, "outsider").expect(200);
    expect(ownGoal.body.data.assignments.map((row: { id: string }) => row.id)).toEqual([assignmentIds.foreign]);
    expect(ownAssignments.body.data.map((row: { id: string }) => row.id)).toEqual([assignmentIds.foreign]);
    expect(await persistedState()).toEqual(before);
  });

  it.each(roles)("%s receives only actor-visible household assignments with the existing DTO", async viewer => {
    const before = await persistedState();
    const response = await householdAssignments(viewer).expect(200);
    const rows = response.body.data as Array<{ id: string }>;
    const expected = viewer === "owner" ? [assignmentIds.shared, assignmentIds.private] : [assignmentIds.shared];
    expect(response.body.success).toBe(true);
    expect(rows.map(row => row.id).sort()).toEqual([...expected].sort());
    expect(rows.find(row => row.id === assignmentIds.shared)).toMatchObject({
      id: assignmentIds.shared, goalId: sharedGoalId, accountId: ids.sharedAccount,
      assignmentType: "partial_balance", partialAmount: { amount: "11.11", currency: "ZMW" }, autoUpdate: false,
      accountName: "A5 SHARED", accountBalance: { amount: "988.89", currency: "ZMW" },
      accountCurrency: "ZMW", accountType: "checking",
      goalName: "R04 assignment goal", goalType: "save_up", goalCurrency: "ZMW",
    });
    if (viewer === "owner") {
      expect(rows.find(row => row.id === assignmentIds.private)).toMatchObject({
        goalId: sharedGoalId, accountId: ids.privateAccount,
        partialAmount: { amount: "777.77", currency: "ZMW" },
        accountName: "A5 PRIVATE", accountBalance: { amount: "4222.23", currency: "ZMW" },
      });
    }
    const serialized = JSON.stringify(response.body);
    for (const secret of [assignmentIds.corrupt, ids.foreignAccount, "Foreign parent", "222.22", assignmentIds.foreign, assignmentIds.foreignGoalLocal, foreignGoalId, "FOREIGN_GOAL_SECRET", "44.44"])
      expect(serialized).not.toContain(secret);
    if (viewer !== "owner")
      for (const secret of [assignmentIds.private, ids.privateAccount, "A5 PRIVATE", "777.77", "4222.23"])
        expect(serialized).not.toContain(secret);
    expect(await persistedState()).toEqual(before);
  });

  it("returns only the outsider's valid household assignment, never a foreign account link", async () => {
    const before = await persistedState();
    const response = await householdAssignments("outsider").expect(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.map((row: { id: string }) => row.id)).toEqual([assignmentIds.foreign]);
    expect(response.body.data[0]).toMatchObject({
      id: assignmentIds.foreign, goalId: foreignGoalId, accountId: ids.foreignAccount,
      partialAmount: { amount: "33.33", currency: "ZMW" },
      accountName: "Foreign parent", goalName: "FOREIGN_GOAL_SECRET", goalCurrency: "ZMW",
    });
    const serialized = JSON.stringify(response.body);
    for (const secret of [assignmentIds.foreignGoalLocal, ids.sharedAccount, "A5 SHARED", sharedGoalId, assignmentIds.private, ids.privateAccount])
      expect(serialized).not.toContain(secret);
    expect(await persistedState()).toEqual(before);
  });

  it("omits deleted account references from the household assignment response", async () => {
    await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, ids.sharedAccount));
    const before = await persistedState();
    const owner = await householdAssignments("owner").expect(200);
    expect(owner.body.data.map((row: { id: string }) => row.id)).toEqual([assignmentIds.private]);
    for (const viewer of ["admin", "member", "view_only", "professional"] as const) {
      const response = await householdAssignments(viewer).expect(200);
      expect(response.body.data).toEqual([]);
    }
    const outsider = await householdAssignments("outsider").expect(200);
    expect(outsider.body.data.map((row: { id: string }) => row.id)).toEqual([assignmentIds.foreign]);
    expect(await persistedState()).toEqual(before);
  });

  it("does not return household assignments after the actor loses membership", async () => {
    const memberId = actors.get("member")!.id;
    await db.delete(householdMembers).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, memberId)));
    const response = await householdAssignments("member");
    expect(response.status).toBe(404);
    expect(response.body.data).toBeUndefined();
  });
});
