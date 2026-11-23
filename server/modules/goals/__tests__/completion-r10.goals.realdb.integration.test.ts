/**
 * R10.3 (FIN-09, NEW-29, NEW-35 goal part): goal progress is reversible.
 *
 * Every progress source keeps the effect it actually applied, so unlinking,
 * editing or deleting the source restores the exact prior progress. A
 * cross-currency link uses the household's dated rate or is refused. A
 * contribution is validated money, overfunding needs an explicit
 * confirmation, and a mistaken contribution is reversed by an audited
 * correction row. Real HTTP against real Postgres; nothing is mocked.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  accounts, auditLogs, goalContributions, goals, householdFxRateOverrides, householdMembers, households,
  transactionGoalLinks, transactions, users,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";

type Json = Record<string, unknown>;

const password = "SyntheticGoalProgress123!";
const householdId = randomUUID();
const ids = { checking: randomUUID(), savings: randomUUID(), dollars: randomUUID() };
const SOURCE_DATE = "2026-10-15";
let app: Awaited<ReturnType<typeof getTestApp>>;
let alice: { id: string; cookie: string };

const zmw = (amount: string) => ({ amount, currency: "ZMW" });

async function seed() {
  await db.insert(households).values({ id: householdId, name: "Synthetic goal household", currency: "ZMW" });
  const id = randomUUID();
  const email = `goal-progress-${id}@example.invalid`;
  await db.insert(users).values({ id, email, username: `goal-progress-${id}`, passwordHash: await hashPassword(password), emailVerified: true });
  await db.insert(householdMembers).values({ householdId, userId: id, role: "owner" });
  await db.insert(accounts).values([
    { id: ids.checking, householdId, name: "Synthetic current", type: "checking", currency: "ZMW", initialBalance: "10000.00", balance: "10000.00" },
    { id: ids.savings, householdId, name: "Synthetic savings", type: "savings", currency: "ZMW", initialBalance: "500.00", balance: "500.00" },
    { id: ids.dollars, householdId, name: "Synthetic dollars", type: "checking", currency: "USD", initialBalance: "1000.00", balance: "1000.00" },
  ]);
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  alice = { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") };
}

async function teardown() {
  await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
  await db.delete(goals).where(eq(goals.householdId, householdId));
  await db.delete(householdFxRateOverrides).where(eq(householdFxRateOverrides.householdId, householdId));
  await db.delete(transactions).where(eq(transactions.householdId, householdId));
  await db.delete(accounts).where(eq(accounts.householdId, householdId));
  await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
  await db.delete(households).where(eq(households.id, householdId));
  if (alice) {
    await db.delete(auditLogs).where(eq(auditLogs.userId, alice.id));
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [alice.id]);
    await db.delete(users).where(eq(users.id, alice.id));
  }
}

const api = {
  get: (path: string) => request(app).get(path).set("Cookie", alice.cookie),
  post: (path: string, body: object = {}) => request(app).post(path).set("Cookie", alice.cookie).send(body),
  put: (path: string, body: object) => request(app).put(path).set("Cookie", alice.cookie).send(body),
  delete: (path: string) => request(app).delete(path).set("Cookie", alice.cookie),
};

async function makeGoal(options: { current?: string; target?: string; spendingReduces?: boolean } = {}) {
  const id = randomUUID();
  await db.insert(goals).values({
    id, householdId, name: `Synthetic goal ${id.slice(0, 8)}`, type: "save_up", goalType: "other", currency: "ZMW",
    targetAmount: options.target ?? "100.00", currentAmount: options.current ?? "5.00",
    spendingReducesProgress: options.spendingReduces ?? true,
  });
  return id;
}

async function makeTransaction(type: "income" | "expense", amount: string, accountId = ids.checking, currency = "ZMW") {
  const response = await api.post("/api/transactions", {
    accountId, type, amount: { amount, currency }, date: SOURCE_DATE, name: `Synthetic ${type} ${amount}`,
  }).expect(201);
  return (response.body.data as { id: string }).id;
}

async function progress(goalId: string): Promise<string> {
  const [goal] = await db.select({ currentAmount: goals.currentAmount }).from(goals).where(eq(goals.id, goalId));
  return goal.currentAmount;
}

function link(goalId: string, transactionId: string, linkType: "contribution" | "spending") {
  // Fixtures confirm over-funding; whether a link needs it is tested in completion-r10.goal-qa-defects.
  return api.post(`/api/goals/${goalId}/transactions`, { transactionId, linkType, confirmOverfund: true });
}

async function goalAudits(goalId: string) {
  return db.select().from(auditLogs).where(and(eq(auditLogs.householdId, householdId), eq(auditLogs.entityId, goalId)));
}

beforeAll(async () => {
  app = await getTestApp();
  await seed();
}, 30_000);

afterAll(teardown);

describe("R10.3 linked transactions restore the exact prior progress", () => {
  it("unlinking a spend that hit the zero floor restores the prior progress", async () => {
    const goalId = await makeGoal({ current: "5.00" });
    const spend = await makeTransaction("expense", "10.00");
    await link(goalId, spend, "spending").expect(201);
    expect(await progress(goalId)).toBe("0.00");

    await api.delete(`/api/goals/${goalId}/transactions/${spend}`).expect(200);
    expect(await progress(goalId)).toBe("5.00");
  });

  it("editing a linked source reverses its old effect exactly and applies the new one", async () => {
    const goalId = await makeGoal({ current: "5.00" });
    const spend = await makeTransaction("expense", "10.00");
    await link(goalId, spend, "spending").expect(201);

    await api.put(`/api/transactions/${spend}`, { amount: zmw("3.00") }).expect(200);
    expect(await progress(goalId)).toBe("2.00");

    await api.delete(`/api/goals/${goalId}/transactions/${spend}`).expect(200);
    expect(await progress(goalId)).toBe("5.00");
  });

  it("deleting a linked source reverses its effect and removes the link", async () => {
    const goalId = await makeGoal({ current: "5.00" });
    const income = await makeTransaction("income", "10.00");
    await link(goalId, income, "contribution").expect(201);
    expect(await progress(goalId)).toBe("15.00");

    await api.delete(`/api/transactions/${income}`).expect(200);
    expect(await progress(goalId)).toBe("5.00");
    expect(await db.select().from(transactionGoalLinks).where(eq(transactionGoalLinks.goalId, goalId))).toEqual([]);
    expect(await db.select().from(goalContributions).where(eq(goalContributions.goalId, goalId))).toEqual([]);
  });

  it("converts a cross-currency link with the household's dated rate, and refuses it without one", async () => {
    const goalId = await makeGoal({ current: "5.00" });
    const dollars = await makeTransaction("income", "10.00", ids.dollars, "USD");

    const refused = await link(goalId, dollars, "contribution").expect(422);
    expect((refused.body.error as Json).code).toBe("MISSING_FX_RATE");
    expect(await progress(goalId)).toBe("5.00");

    await db.insert(householdFxRateOverrides).values({
      householdId, actorUserId: alice.id, fromCurrency: "USD", toCurrency: "ZMW",
      effectiveDate: "2026-10-01", validThrough: "2026-10-31", rate: "25.5",
    });
    await link(goalId, dollars, "contribution").expect(201);
    expect(await progress(goalId)).toBe("260.00");

    await api.delete(`/api/goals/${goalId}/transactions/${dollars}`).expect(200);
    expect(await progress(goalId)).toBe("5.00");
  });

  it("refuses an auto-synced full-balance assignment on a goal that already counts links", async () => {
    const goalId = await makeGoal({ current: "5.00", spendingReduces: false });
    const income = await makeTransaction("income", "10.00");
    await link(goalId, income, "contribution").expect(201);

    await api.post(`/api/goals/${goalId}/assign-account`, {
      accountId: ids.savings, assignmentType: "full_balance", autoUpdate: true,
    }).expect(409);
    expect(await progress(goalId)).toBe("15.00");
  });
});

describe("R10.3 contributions are validated money and reversible", () => {
  it("rejects 1,000,000 against a small target unless overfunding is confirmed", async () => {
    const goalId = await makeGoal({ current: "5.00", target: "100.00" });
    const body = { amount: zmw("1000000.00") };

    const refused = await api.post(`/api/goals/${goalId}/contribute`, body).expect(409);
    expect((refused.body.error as Json).message).toMatch(/target/i);
    expect(await progress(goalId)).toBe("5.00");

    await api.post(`/api/goals/${goalId}/contribute`, { ...body, confirmOverfund: true }).expect(201);
    expect(await progress(goalId)).toBe("1000005.00");
  });

  it("rejects a contribution with more than two decimal places", async () => {
    const goalId = await makeGoal();
    await api.post(`/api/goals/${goalId}/contribute`, { amount: zmw("1.005") }).expect(400);
    expect(await progress(goalId)).toBe("5.00");
  });

  it("reverses a mistaken contribution with an audited correction row, once", async () => {
    const goalId = await makeGoal({ current: "5.00" });
    const added = await api.post(`/api/goals/${goalId}/contribute`, { amount: zmw("20.00") }).expect(201);
    const contributionId = ((added.body.data as Json).contribution as { id: string }).id;
    expect(await progress(goalId)).toBe("25.00");

    const reversed = await api.post(`/api/goals/${goalId}/contributions/${contributionId}/reverse`, { reason: "Entered twice" }).expect(201);
    expect(await progress(goalId)).toBe("5.00");
    const correction = (reversed.body.data as Json).correction as Json;
    expect(correction).toMatchObject({
      kind: "correction", correctsContributionId: contributionId, amount: zmw("-20.00"), appliedDelta: zmw("-20.00"),
    });

    const rows = await db.select().from(goalContributions).where(eq(goalContributions.goalId, goalId));
    expect(rows.map(row => row.amount).sort()).toEqual(["-20.00", "20.00"]);
    const audit = (await goalAudits(goalId)).find(row => (row.details as Json).operation === "reverseContribution");
    expect(audit).toBeDefined();
    expect(audit!.details).toMatchObject({ contributionId, correctionId: correction.id, amount: "20.00" });

    await api.post(`/api/goals/${goalId}/contributions/${contributionId}/reverse`, {}).expect(409);
    expect(await progress(goalId)).toBe("5.00");
  });

  it("reconciles two concurrent contributions and audits both", async () => {
    const goalId = await makeGoal({ current: "5.00" });
    const [first, second] = await Promise.all([
      api.post(`/api/goals/${goalId}/contribute`, { amount: zmw("10.00") }),
      api.post(`/api/goals/${goalId}/contribute`, { amount: zmw("10.00") }),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(await progress(goalId)).toBe("25.00");
    expect(await db.select().from(goalContributions).where(eq(goalContributions.goalId, goalId))).toHaveLength(2);
    const audits = (await goalAudits(goalId)).filter(row => (row.details as Json).operation === "addContribution");
    expect(audits).toHaveLength(2);
  });
});

describe("R10.3 assignment defaults and summary money", () => {
  it("accepts the default partial assignment request", async () => {
    const goalId = await makeGoal({ current: "5.00", spendingReduces: false });
    await api.post(`/api/goals/${goalId}/assign-account`, {
      accountId: ids.savings, assignmentType: "partial_balance", partialAmount: zmw("20.00"),
    }).expect(201);
    expect(await progress(goalId)).toBe("25.00");
    await db.delete(goals).where(inArray(goals.id, [goalId]));
  });

  it("returns the goal summary's money fields as MoneyDto", async () => {
    await makeGoal({ current: "5.00" });
    const response = await api.get("/api/goals/summary").expect(200);
    const data = response.body.data as { saveUp: Json; payDown: Json; investment: Json; recentActivity: Json[] };
    const moneyDto = { amount: expect.stringMatching(/^-?\d+\.\d{2}$/), currency: "ZMW" };
    expect(data.saveUp.totalSaved).toEqual(moneyDto);
    expect(data.saveUp.totalTarget).toEqual(moneyDto);
    expect(data.payDown.totalDebt).toEqual(moneyDto);
    expect(data.payDown.totalPaid).toEqual(moneyDto);
    expect(data.payDown.projectedInterest).toEqual(moneyDto);
    expect(data.investment.totalSaved).toEqual(moneyDto);
    expect(data.investment.totalTarget).toEqual(moneyDto);
    for (const activity of data.recentActivity) {
      if (activity.amount !== null) expect(activity.amount).toEqual(moneyDto);
    }
  });
});
