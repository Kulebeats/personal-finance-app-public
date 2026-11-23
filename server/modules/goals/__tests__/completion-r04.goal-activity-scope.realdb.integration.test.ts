import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import request from "supertest";
import { goalActivityLog, goals, householdMembers } from "@shared/schema";
import { db } from "../../../db";
import { goalActivityLogService } from "../../../services/GoalActivityLogService";
import { a, actors, app, b, reset, roles, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const sharedGoalId = randomUUID();
const emptyGoalId = randomUUID();
const foreignGoalId = randomUUID();
const missingGoalId = randomUUID();
const goalIds = [sharedGoalId, emptyGoalId, foreignGoalId];
const activityIds = {
  oldest: randomUUID(),
  middle: randomUUID(),
  newest: randomUUID(),
  foreign: randomUUID(),
};

function getActivity(goalId: string, viewer: Role | "outsider", query = "") {
  return request(app).get(`/api/goals/${goalId}/activity${query}`).set("Cookie", actors.get(viewer)!.cookie);
}

async function clearGoals() {
  await db.delete(goals).where(inArray(goals.id, goalIds));
}

async function persistedState() {
  return {
    goals: await db.select().from(goals).where(inArray(goals.id, goalIds)).orderBy(goals.id),
    activity: await db.select().from(goalActivityLog).where(inArray(goalActivityLog.goalId, goalIds)).orderBy(goalActivityLog.id),
  };
}

describe("R04 goal activity is scoped to the actor's current household membership", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await clearGoals();
    await reset();
    await db.insert(goals).values([
      { id: sharedGoalId, householdId: a, name: "R04 shared activity goal", type: "save_up", goalType: "other", targetAmount: "1000.00", currentAmount: "0.00", currency: "ZMW" },
      { id: emptyGoalId, householdId: a, name: "R04 empty activity goal", type: "save_up", goalType: "other", targetAmount: "1000.00", currentAmount: "0.00", currency: "ZMW" },
      { id: foreignGoalId, householdId: b, name: "R04 foreign activity goal", type: "save_up", goalType: "other", targetAmount: "1000.00", currentAmount: "0.00", currency: "ZMW" },
    ]);
    await db.insert(goalActivityLog).values([
      { id: activityIds.oldest, goalId: sharedGoalId, activityType: "goal_created", metadata: { marker: "A_OLDEST" }, createdAt: new Date("2026-10-05T10:00:00Z") },
      { id: activityIds.middle, goalId: sharedGoalId, activityType: "contribution_added", amount: "11.11", metadata: { marker: "A_MIDDLE" }, createdAt: new Date("2026-10-05T10:01:00Z") },
      { id: activityIds.newest, goalId: sharedGoalId, activityType: "goal_updated", metadata: { marker: "A_NEWEST" }, createdAt: new Date("2026-10-05T10:02:00Z") },
      { id: activityIds.foreign, goalId: foreignGoalId, activityType: "contribution_added", amount: "777.77", metadata: { marker: "B_PRIVATE_ACTIVITY" }, createdAt: new Date("2026-10-05T10:03:00Z") },
    ]);
  });
  afterEach(clearGoals);
  afterAll(async () => { await clearGoals(); await stop(); });

  it.each(roles)("%s can read populated and empty goals in their own household", async (viewer) => {
    const before = await persistedState();
    const populated = await getActivity(sharedGoalId, viewer).expect(200);
    expect(populated.body.data.map((entry: { id: string }) => entry.id))
      .toEqual([activityIds.newest, activityIds.middle, activityIds.oldest]);
    expect(populated.body.data[1]).toMatchObject({ amount: "11.11", metadata: { marker: "A_MIDDLE" } });
    expect((await getActivity(emptyGoalId, viewer).expect(200)).body).toEqual({ success: true, data: [] });
    expect(await persistedState()).toEqual(before);
  });

  it("pagination applies to authorized activity and preserves the existing array response", async () => {
    const before = await persistedState();
    const page = await getActivity(sharedGoalId, "member", "?limit=1&offset=1").expect(200);
    expect(page.body).toEqual({ success: true, data: [expect.objectContaining({ id: activityIds.middle })] });
    const beyond = await getActivity(sharedGoalId, "member", "?limit=1&offset=10").expect(200);
    expect(beyond.body).toEqual({ success: true, data: [] });
    expect(await persistedState()).toEqual(before);
  });

  it("foreign and missing goal IDs return indistinguishable 404s while the outsider reads B", async () => {
    const before = await persistedState();
    const ownerForeign = await getActivity(foreignGoalId, "owner").expect(404);
    const ownerMissing = await getActivity(missingGoalId, "owner").expect(404);
    const outsiderForeign = await getActivity(sharedGoalId, "outsider").expect(404);
    const outsiderMissing = await getActivity(missingGoalId, "outsider").expect(404);
    const denial = (body: { success: boolean; error: { code: string; message: string } }) =>
      ({ success: body.success, code: body.error.code, message: body.error.message });
    expect(denial(ownerForeign.body)).toEqual(denial(ownerMissing.body));
    expect(denial(outsiderForeign.body)).toEqual(denial(outsiderMissing.body));
    expect(denial(ownerForeign.body)).toEqual({ success: false, code: "NOT_FOUND", message: "Goal not found" });
    for (const denied of [ownerForeign, outsiderForeign]) {
      for (const secret of [activityIds.foreign, activityIds.middle, foreignGoalId, sharedGoalId, "B_PRIVATE_ACTIVITY", "A_MIDDLE", "777.77", "11.11"])
        expect(JSON.stringify(denied.body)).not.toContain(secret);
    }
    const own = await getActivity(foreignGoalId, "outsider").expect(200);
    expect(own.body.data).toEqual([expect.objectContaining({ id: activityIds.foreign, amount: "777.77" })]);
    expect(await persistedState()).toEqual(before);
  });

  it("the service denies a stale actor after current membership is removed", async () => {
    const member = actors.get("member")!;
    const actor = { householdId: a, userId: member.id, role: "member" as const };
    expect((await goalActivityLogService.getActivity(sharedGoalId, actor)).map((entry) => entry.id))
      .toEqual([activityIds.newest, activityIds.middle, activityIds.oldest]);
    await db.delete(householdMembers).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, member.id)));
    const before = await persistedState();
    try {
      await expect(goalActivityLogService.getActivity(sharedGoalId, actor))
        .rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
      expect(await persistedState()).toEqual(before);
    } finally {
      await db.insert(householdMembers).values({ householdId: a, userId: member.id, role: "member" });
    }
  });
});
