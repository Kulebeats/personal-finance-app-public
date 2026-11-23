/**
 * A-32: saving a rule with "apply to past" reports what the apply did, apart
 * from the saved rule. A row whose apply rolled back is a failure with its
 * reason, never a silent success. REAL HTTP, REAL DB.
 *
 * The reachable case: a rule that changes the category and links a goal, run
 * over past rows where one row is already linked to that goal. That row's link
 * throws, so its category change rolls back too.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { categories, categoryGroups, goals, rules, transactionGoalLinks, transactions } from "@shared/schema";
import { db } from "../../../db";
import { a, b, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const lunchTx = randomUUID();
const memberPrivateTx = randomUUID();
let goalId: string;
let categoryId: string;

const owner = () => actors.get("owner")!;
const signed = (call: request.Test) => call.set("Cookie", owner().cookie)
  .set("X-Capital-Subject", owner().id).set("X-Capital-Household", a);

const ruleBody = () => ({
  name: "Coffee to goal",
  conditions: [{ type: "merchant_name", operator: "contains", value: "SHAREDTXN" }],
  actions: [{ type: "categorize", value: categoryId }, { type: "link_goal", value: goalId }],
});

async function clean() {
  await db.delete(rules).where(inArray(rules.householdId, [a, b]));
  await db.delete(transactions).where(inArray(transactions.householdId, [a, b]));
  await db.delete(goals).where(inArray(goals.householdId, [a, b]));
  await db.delete(categoryGroups).where(inArray(categoryGroups.householdId, [a, b]));
}

async function seed() {
  const [group] = await db.insert(categoryGroups).values({ householdId: a, name: "A-32 group", type: "expenses", displayOrder: 1 }).returning();
  const [category] = await db.insert(categories).values({ householdId: a, groupId: group.id, name: "A-32 coffee", displayOrder: 1 }).returning();
  categoryId = category.id;
  // Spending may reduce its progress, so linking an expense is allowed and only the already-linked row fails.
  const [goal] = await db.insert(goals).values({ householdId: a, name: "A-32 goal", targetAmount: "100.00", spendingReducesProgress: true }).returning();
  goalId = goal.id;
  await db.insert(transactions).values([
    { id: lunchTx, householdId: a, accountId: ids.sharedAccount, ownerUserId: owner().id, date: "2026-10-06", name: "SHAREDTXN lunch", amount: "20.00", type: "expense", isPrivate: false },
    // Another member's private row, already linked: the owner may not see it, so it is neither applied nor reported.
    { id: memberPrivateTx, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("member")!.id, date: "2026-10-07", name: "SHAREDTXN member secret", amount: "30.00", type: "expense", isPrivate: true },
  ]);
  // The fixture's "SHAREDTXN coffee" row is already linked to the goal, so re-linking it throws.
  await db.insert(transactionGoalLinks).values([
    { transactionId: ids.sharedTx, goalId, amount: "11.11", linkType: "spending" },
    { transactionId: memberPrivateTx, goalId, amount: "30.00", linkType: "spending" },
  ]);
}

async function categoryOf(transactionId: string) {
  const [row] = await db.select({ categoryId: transactions.categoryId }).from(transactions).where(eq(transactions.id, transactionId));
  return row.categoryId;
}

const expectedOutcome = () => ({
  updated: 1,
  failed: 1,
  failures: [{
    transactionId: ids.sharedTx,
    name: "SHAREDTXN coffee",
    date: "2026-10-05",
    code: "VALIDATION_ERROR",
    message: "Transaction is already linked to this goal",
  }],
});

describe("A-32 apply-to-past reports its outcome (real HTTP/DB)", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await clean(); await reset(); await seed(); });
  afterAll(async () => { await clean(); await stop(); });

  it("create: returns the saved rule and, separately, the rows applied and the row that failed and why", async () => {
    const res = await signed(request(app).post("/api/rules")).send({ ...ruleBody(), applyToPast: true });

    expect(res.status).toBe(201);
    expect(res.body.data.rule).toMatchObject({ name: "Coffee to goal" });
    expect(res.body.data.applied).toEqual(expectedOutcome());
    // The failed row rolled back whole: its category is unchanged. The other visible row changed.
    expect(await categoryOf(ids.sharedTx)).toBeNull();
    expect(await categoryOf(lunchTx)).toBe(categoryId);
    expect(await categoryOf(memberPrivateTx)).toBeNull();
  });

  it("update: re-applying reports the same outcome", async () => {
    const created = await signed(request(app).post("/api/rules")).send(ruleBody()).expect(201);
    expect(created.body.data.applied).toBeUndefined();

    const res = await signed(request(app).put(`/api/rules/${created.body.data.rule.id}`)).send({ applyToPast: true });

    expect(res.status).toBe(200);
    expect(res.body.data.rule.id).toBe(created.body.data.rule.id);
    expect(res.body.data.applied).toEqual(expectedOutcome());
    expect(await categoryOf(ids.sharedTx)).toBeNull();
  });
});
