import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { goals, transactionGoalLinks, transactions } from "@shared/schema";
import { db } from "../../../db";
import { a, actors, app, b, ids, reset, roles, snapshot, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const sharedGoalId = randomUUID();
const secondGoalId = randomUUID();
const foreignGoalId = randomUUID();
const goalIds = [sharedGoalId, secondGoalId, foreignGoalId];
const linkIds = { private: randomUUID(), shared: randomUUID(), second: randomUUID(), foreign: randomUUID(), corrupt: randomUUID() };
const missingTransactionId = randomUUID();
type Viewer = Role | "outsider";

function getLinks(transactionId: string, viewer: Viewer) {
  return request(app).get(`/api/transactions/${transactionId}/goals`).set("Cookie", actors.get(viewer)!.cookie);
}

async function clearGoals() {
  await db.delete(transactionGoalLinks).where(inArray(transactionGoalLinks.goalId, goalIds));
  await db.delete(goals).where(inArray(goals.id, goalIds));
}

async function persistedState() {
  return {
    fixture: await snapshot(),
    goals: await db.select().from(goals).where(inArray(goals.id, goalIds)).orderBy(goals.id),
    links: await db.select().from(transactionGoalLinks).where(inArray(transactionGoalLinks.goalId, goalIds)).orderBy(transactionGoalLinks.id),
  };
}

function denial(body: { success: boolean; error: { code: string; message: string } }) {
  return { success: body.success, code: body.error.code, message: body.error.message };
}

describe("R04 reverse transaction goal links on marked PostgreSQL", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await clearGoals();
    await reset();
    await db.insert(goals).values([
      { id: sharedGoalId, householdId: a, name: "R04 shared goal", type: "save_up", goalType: "other", targetAmount: "9999.99", currentAmount: "8888.88", currency: "ZMW" },
      { id: secondGoalId, householdId: a, name: "R04 second goal", type: "save_up", goalType: "other", targetAmount: "5555.55", currentAmount: "4444.44", currency: "ZMW" },
      { id: foreignGoalId, householdId: b, name: "FOREIGN_GOAL_SECRET", type: "save_up", goalType: "other", targetAmount: "1000.00", currentAmount: "0.00", currency: "ZMW" },
    ]);
    await db.insert(transactionGoalLinks).values([
      { id: linkIds.private, goalId: sharedGoalId, transactionId: ids.privateTx, linkType: "spending", amount: "777.77" },
      { id: linkIds.shared, goalId: sharedGoalId, transactionId: ids.sharedTx, linkType: "spending", amount: "11.11", linkedAt: new Date("2026-10-02T00:00:00.000Z") },
      { id: linkIds.second, goalId: secondGoalId, transactionId: ids.sharedTx, linkType: "spending", amount: "44.44", linkedAt: new Date("2026-10-01T00:00:00.000Z") },
      { id: linkIds.foreign, goalId: foreignGoalId, transactionId: ids.foreignTx, linkType: "spending", amount: "22.22" },
      // A foreign goal can be linked by legacy or corrupt data; it is never an authorized result for A.
      { id: linkIds.corrupt, goalId: foreignGoalId, transactionId: ids.sharedTx, linkType: "spending", amount: "33.33" },
    ]);
  });
  afterEach(clearGoals);
  afterAll(async () => { await clearGoals(); await stop(); });

  it.each(roles)("%s reads an allowed link without foreign goal or aggregate data", async viewer => {
    const before = await persistedState();
    const response = await getLinks(ids.sharedTx, viewer).expect(200);
    expect(response.body.data.map((link: { id: string }) => link.id)).toEqual([linkIds.shared, linkIds.second]);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0]).toMatchObject({
      id: linkIds.shared, transactionId: ids.sharedTx, goalId: sharedGoalId,
      linkType: "spending", amount: { amount: "11.11", currency: "ZMW" },
    });
    expect(response.body.data[1]).toMatchObject({
      id: linkIds.second, transactionId: ids.sharedTx, goalId: secondGoalId,
      linkType: "spending", amount: { amount: "44.44", currency: "ZMW" },
    });
    expect(response.body.data[0].goal).toEqual({
      id: sharedGoalId, name: "R04 shared goal", type: "save_up", goalType: "other",
      icon: null, color: null, customImageUrl: null, currency: "ZMW",
    });
    const serialized = JSON.stringify(response.body);
    for (const secret of [foreignGoalId, "FOREIGN_GOAL_SECRET", "8888.88", "9999.99", "4444.44", "5555.55", "33.33"])
      expect(serialized).not.toContain(secret);
    expect(await persistedState()).toEqual(before);
  });

  it("admits the owner of a private account but denies other roles and outsiders", async () => {
    const before = await persistedState();
    const owner = await getLinks(ids.privateTx, "owner").expect(200);
    expect(owner.body.data).toMatchObject([{
      id: linkIds.private, transactionId: ids.privateTx, goalId: sharedGoalId,
      amount: { amount: "777.77", currency: "ZMW" },
    }]);
    for (const viewer of [...roles.filter(role => role !== "owner"), "outsider"] as Viewer[]) {
      const denied = await getLinks(ids.privateTx, viewer).expect(404);
      expect(denial(denied.body)).toEqual({ success: false, code: "NOT_FOUND", message: "Transaction not found" });
      for (const secret of [ids.privateTx, sharedGoalId, "777.77"]) expect(JSON.stringify(denied.body)).not.toContain(secret);
    }
    expect(await persistedState()).toEqual(before);
  });

  it("checks private transaction ownership even when its account is shared", async () => {
    await db.update(transactions).set({ isPrivate: true, ownerUserId: actors.get("member")!.id }).where(eq(transactions.id, ids.sharedTx));
    const before = await persistedState();
    const member = await getLinks(ids.sharedTx, "member").expect(200);
    expect(member.body.data.map((link: { id: string }) => link.id)).toEqual([linkIds.shared, linkIds.second]);
    for (const viewer of ["owner", "admin", "view_only", "professional", "outsider"] as const)
      await getLinks(ids.sharedTx, viewer).expect(404);
    expect(await persistedState()).toEqual(before);
  });

  it("requires the transaction's account to belong to the same readable household", async () => {
    await db.update(transactions).set({ accountId: ids.foreignAccount }).where(eq(transactions.id, ids.sharedTx));
    const before = await persistedState();
    for (const viewer of roles) await getLinks(ids.sharedTx, viewer).expect(404);
    expect(await persistedState()).toEqual(before);
  });

  it("returns an exact empty list for a visible unlinked transaction", async () => {
    await db.delete(transactionGoalLinks).where(eq(transactionGoalLinks.transactionId, ids.sharedTx));
    const before = await persistedState();
    expect((await getLinks(ids.sharedTx, "member").expect(200)).body).toEqual({ success: true, data: [] });
    expect(await persistedState()).toEqual(before);
  });

  it("makes missing and foreign transactions indistinguishable and accepts the outsider's own link", async () => {
    const before = await persistedState();
    const missing = await getLinks(missingTransactionId, "owner").expect(404);
    const foreign = await getLinks(ids.foreignTx, "owner").expect(404);
    const outsiderForeign = await getLinks(ids.sharedTx, "outsider").expect(404);
    const outsiderMissing = await getLinks(missingTransactionId, "outsider").expect(404);
    expect(denial(foreign.body)).toEqual(denial(missing.body));
    expect(denial(outsiderForeign.body)).toEqual(denial(outsiderMissing.body));
    const own = await getLinks(ids.foreignTx, "outsider").expect(200);
    expect(own.body.data).toMatchObject([{
      id: linkIds.foreign, transactionId: ids.foreignTx, goalId: foreignGoalId,
      amount: { amount: "22.22", currency: "ZMW" },
    }]);
    for (const denied of [foreign, outsiderForeign])
      for (const secret of [ids.foreignTx, ids.sharedTx, sharedGoalId, foreignGoalId, "FOREIGN_GOAL_SECRET"])
        expect(JSON.stringify(denied.body)).not.toContain(secret);
    expect(await persistedState()).toEqual(before);
  });

  it("rejects a malformed transaction UUID before querying links", async () => {
    const before = await persistedState();
    await getLinks("not-a-uuid", "owner").expect(400);
    expect(await persistedState()).toEqual(before);
  });
});
