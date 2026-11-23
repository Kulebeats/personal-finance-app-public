/**
 * Goals end-to-end QA, 2026-11-17 (`goals-qa-2026-11-17.md`): the defects it
 * found, reproduced over real HTTP against real Postgres.
 *
 * F1 (P0): the goals progress report showed an admin the progress of goals fed
 * by another member's private account. F2 (P1): an edit relabelled a goal's
 * progress in another currency. F4: the weekly goals notice and the deadline
 * reminder were judged on progress the recipient cannot see. F5: a whole
 * transaction link and a transfer could take a goal past its target without
 * confirmation. A hidden member could mark a goal complete. "Goal not found
 * not found".
 *
 * Alice (owner) holds a private current account and a private loan; Carol is
 * an admin and Bob a member, and neither can see them.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, inArray, like, notInArray } from "drizzle-orm";
import type { ReportsGoalsProgressResponse } from "@shared/reports";
import {
  accounts, auditLogs, goals, householdMembers, households, notifications, transactions, users,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { runGoalDeadlineReminders, runWeeklyGoalReport } from "../../../jobs/goalReminderWorker";
import { linkGoalsToTransaction } from "../../../services/rule/actions";
import { businessAuditService } from "../../../services/BusinessAuditService";
import { withTransaction } from "../../../utils/withTransaction";
import { notificationService } from "../../../services/NotificationService";
import { notificationRepository } from "../../../repositories/NotificationRepository";
import { transactionRepository } from "../../../repositories/TransactionRepository";

type Json = Record<string, unknown>;
type Member = { id: string; cookie: string };

const password = "SyntheticGoalQa123!";
const householdId = randomUUID();
const ids = { shared: randomUUID(), privateCash: randomUUID(), privateDebt: randomUUID() };
const SOURCE_DATE = "2026-10-15";
let app: Awaited<ReturnType<typeof getTestApp>>;
let alice: Member;
let carol: Member;
let bob: Member;
/** Members a single test adds; torn down with the rest. */
const extraMembers: Member[] = [];

const zmw = (amount: string) => ({ amount, currency: "ZMW" });

async function addMember(role: "owner" | "admin" | "member"): Promise<Member> {
  const id = randomUUID();
  const email = `goal-qa-${id}@example.invalid`;
  await db.insert(users).values({ id, email, username: `goal-qa-${id}`, passwordHash: await hashPassword(password), emailVerified: true });
  await db.insert(householdMembers).values({ householdId, userId: id, role });
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") };
}

async function seed() {
  await db.insert(households).values({ id: householdId, name: "Synthetic goal QA household", currency: "ZMW" });
  alice = await addMember("owner");
  carol = await addMember("admin");
  bob = await addMember("member");
  const own = { isPrivate: true, ownerUserId: alice.id };
  await db.insert(accounts).values([
    { id: ids.shared, householdId, name: "Synthetic shared current", type: "checking", currency: "ZMW", initialBalance: "50000.00", balance: "50000.00" },
    { id: ids.privateCash, householdId, name: "Synthetic private current", type: "checking", currency: "ZMW", initialBalance: "50000.00", balance: "50000.00", ...own },
    { id: ids.privateDebt, householdId, name: "Synthetic private loan", type: "loan", currency: "ZMW", initialBalance: "-4200.00", balance: "-4200.00", ...own },
  ]);
}

async function teardown() {
  const members = [alice, carol, bob, ...extraMembers].filter(Boolean);
  await db.delete(notifications).where(eq(notifications.householdId, householdId));
  await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
  await db.delete(goals).where(eq(goals.householdId, householdId));
  await db.delete(transactions).where(eq(transactions.householdId, householdId));
  await db.delete(accounts).where(eq(accounts.householdId, householdId));
  await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
  await db.delete(households).where(eq(households.id, householdId));
  for (const member of members) {
    await db.delete(notifications).where(eq(notifications.userId, member.id));
    await db.delete(auditLogs).where(eq(auditLogs.userId, member.id));
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [member.id]);
    await db.delete(users).where(eq(users.id, member.id));
  }
}

const as = (member: Member) => ({
  get: (path: string) => request(app).get(path).set("Cookie", member.cookie),
  post: (path: string, body: object = {}) => request(app).post(path).set("Cookie", member.cookie).send(body),
  put: (path: string, body: object) => request(app).put(path).set("Cookie", member.cookie).send(body),
});

async function makeGoal(values: Partial<typeof goals.$inferInsert> = {}) {
  const id = randomUUID();
  await db.insert(goals).values({
    id, householdId, name: `Synthetic goal ${id.slice(0, 8)}`, type: "save_up", goalType: "other", currency: "ZMW",
    targetAmount: "1000.00", currentAmount: "0.00", ...values,
  });
  return id;
}

async function makeTransaction(member: Member, amount: string, accountId: string) {
  const response = await as(member).post("/api/transactions", {
    accountId, type: "income", amount: zmw(amount), date: SOURCE_DATE, name: `Synthetic income ${amount}`,
  }).expect(201);
  return (response.body.data as { id: string }).id;
}

const link = (member: Member, goalId: string, transactionId: string, extra: Json = {}) =>
  as(member).post(`/api/goals/${goalId}/transactions`, { transactionId, linkType: "contribution", ...extra });

/** A goal Bob and Carol cannot see all of: Alice's private income counts toward it. */
async function hiddenGoal(privateAmount: string, values: Partial<typeof goals.$inferInsert> = {}) {
  const goalId = await makeGoal(values);
  await link(alice, goalId, await makeTransaction(alice, privateAmount, ids.privateCash), { confirmOverfund: true }).expect(201);
  return goalId;
}

async function sharedGoal(amount: string, values: Partial<typeof goals.$inferInsert> = {}) {
  const goalId = await makeGoal(values);
  await link(bob, goalId, await makeTransaction(bob, amount, ids.shared)).expect(201);
  return goalId;
}

/** Only these goals stay active, so a household-wide count is about them alone. */
async function keepOnlyActive(goalIds: string[]) {
  await db.update(goals).set({ isArchived: true })
    .where(and(eq(goals.householdId, householdId), notInArray(goals.id, goalIds)));
}

const goalRow = async (goalId: string) => (await db.select().from(goals).where(eq(goals.id, goalId)))[0];

beforeAll(async () => {
  app = await getTestApp();
  await seed();
}, 60_000);

afterAll(async () => {
  await teardown();
});

describe("F1: the goals progress report withholds progress the viewer cannot see", () => {
  it("shows an admin no amount, percent or status for goals fed by a private account, and leaves them out of the counts", async () => {
    const hidden = await hiddenGoal("1056.00");
    const debt = await makeGoal({ type: "pay_down", targetAmount: "4200.00", originalBalance: "4200.00", currentAmount: "1000.00",
      debtAccountId: ids.privateDebt });
    const shared = await sharedGoal("300.00");
    await keepOnlyActive([hidden, debt, shared]);

    const report = async (member: Member) =>
      (await as(member).get("/api/reports/goals/progress?scope=household").expect(200)).body.data as {
        goals: Json[]; summary: Json;
      };
    const forCarol = await report(carol);
    const byId = new Map(forCarol.goals.map((goal) => [goal.id, goal]));
    for (const goalId of [hidden, debt]) {
      expect(byId.get(goalId)).toMatchObject({
        progressAvailability: "unavailable", currentAmount: null, progress: null, onTrack: null, monthlyRequired: null,
      });
    }
    expect(byId.get(debt)?.targetAmount).toBeNull();
    expect(byId.get(shared)).toMatchObject({ progressAvailability: "available", currentAmount: zmw("300.00"), progress: 30 });
    expect(JSON.stringify(forCarol)).not.toMatch(/1056|105\.6|4200/);
    // The two hidden goals are listed but counted in no status bucket.
    const { totalGoals, onTrackCount, behindCount, completedCount } = forCarol.summary as Record<string, number>;
    expect([totalGoals, onTrackCount + behindCount, completedCount]).toEqual([3, 1, 0]);

    const forAlice = await report(alice);
    const own = forAlice.goals.find((goal) => goal.id === hidden);
    expect(own).toMatchObject({ progressAvailability: "available", currentAmount: zmw("1056.00"), progress: 105.6 });
    expect(forAlice.summary.completedCount).toBe(1);
  });

  it("reports half-repaid and fully repaid debt like signed goal detail while withholding private debt", async () => {
    const [halfCard, paidCard, privateCard] = await db.insert(accounts).values([
      { name: "Synthetic half-repaid card", balance: "1000.00", isPrivate: false },
      { name: "Synthetic fully repaid card", balance: "1000.00", isPrivate: false },
      { name: "Synthetic private card", balance: "2319.85", isPrivate: true },
    ].map(account => ({ ...account, householdId, ownerUserId: alice.id, type: "credit" as const,
      currency: "ZMW", initialBalance: account.balance, isAsset: false }))).returning({ id: accounts.id });
    const signed = (call: request.Test, member = alice) => call.set({
      Cookie: member.cookie, "X-Capital-Subject": member.id, "X-Capital-Household": householdId,
    });
    async function createPayDown(debtAccountId: string, name: string, originalBalance: string) {
      const created = await signed(request(app).post("/api/goals")).send({
        name, type: "pay_down", goalType: "personal_loan", debtAccountId, interestRate: "0.00",
        minimumPayment: zmw("50.00"), monthlyPayment: zmw("100.00"),
      }).expect(201);
      expect(created.body.data).toMatchObject({ debtAccountId, targetAmount: zmw("0.00"),
        originalBalance: zmw(originalBalance), currentAmount: zmw(originalBalance) });
      return created.body.data.id as string;
    }

    const half = await createPayDown(halfCard.id, "Synthetic half payoff", "1000.00");
    const paid = await createPayDown(paidCard.id, "Synthetic full payoff", "1000.00");
    const privateGoal = await createPayDown(privateCard.id, "Synthetic private payoff", "2319.85");
    const name = "Synthetic renamed half payoff";
    const renamed = await signed(request(app).put(`/api/goals/${half}`)).send({ name }).expect(200);
    expect(renamed.body.data).toMatchObject({ name, targetAmount: zmw("0.00"), debtAccountId: halfCard.id,
      originalBalance: zmw("1000.00"), currentAmount: zmw("1000.00") });
    await keepOnlyActive([half, paid, privateGoal]);

    await signed(request(app).post("/api/settings/security/step-up")).send({ password }).expect(200);
    const repay = (toAccountId: string, amount: string) => signed(request(app).post("/api/transactions/transfer"))
      .send({ fromAccountId: ids.shared, toAccountId, amount: zmw(amount), date: SOURCE_DATE,
        name: "Synthetic card repayment", idempotencyKey: randomUUID() }).expect(201);
    await repay(halfCard.id, "500.00");
    await repay(paidCard.id, "1000.00");

    const detail = async (id: string) => (await signed(request(app).get(`/api/goals/${id}`), carol).expect(200)).body.data;
    const report: ReportsGoalsProgressResponse = (await signed(request(app).get("/api/reports/goals/progress?scope=household"), carol)
      .expect(200)).body.data;
    const byId = new Map(report.goals.map(goal => [goal.id, goal]));
    for (const [id, outstanding, percentComplete] of [[half, "500.00", 50], [paid, "0.00", 100]] as const) {
      const goal = await detail(id);
      expect(goal).toMatchObject({ progressAvailability: "available", currentAmount: zmw(outstanding),
        originalBalance: zmw("1000.00"), remaining: Number(outstanding), percentComplete });
      expect.soft(byId.get(id)).toMatchObject({ progressAvailability: "available", currentAmount: goal.currentAmount,
        progress: goal.percentComplete });
    }
    expect.soft(report.summary).toMatchObject({ totalGoals: 3, completedCount: 1 });
    expect(byId.get(privateGoal)).toMatchObject({ progressAvailability: "unavailable", targetAmount: null,
      currentAmount: null, progress: null, onTrack: null, monthlyRequired: null });
    expect(await detail(privateGoal)).toMatchObject({ progressAvailability: "unavailable", targetAmount: null,
      currentAmount: null, originalBalance: null, remaining: null, percentComplete: null });
  });

  it("uses only a positive finite starting debt and preserves the debt's native currency", async () => {
    const nextYear = new Date();
    nextYear.setUTCFullYear(nextYear.getUTCFullYear() + 1);
    const targetDate = nextYear.toISOString().slice(0, 10);
    const cases = [
      { name: "Legacy original absent", originalBalance: null, targetAmount: "1000.00", progress: 80 },
      { name: "Legacy target zero without starting debt", originalBalance: null, targetAmount: "0.00", progress: 0 },
      { name: "Stored original zero", originalBalance: "0.00", targetAmount: "1000.00", progress: 0 },
      { name: "Stored original negative", originalBalance: "-100.00", targetAmount: "1000.00", progress: 0 },
      { name: "Stored original nonfinite", originalBalance: "NaN", targetAmount: "1000.00", progress: 0 },
      { name: "Outstanding above original", originalBalance: "100.00", targetAmount: "0.00", progress: 0 },
    ];
    const goalIds: string[] = [];
    for (const { name, originalBalance, targetAmount } of cases) {
      goalIds.push(await makeGoal({ name, type: "pay_down", currency: "USD", originalBalance, targetAmount,
        currentAmount: "200.00", targetDate }));
    }
    const savings = await makeGoal({ targetAmount: "1000.00", currentAmount: "200.00", targetDate });

    const report: ReportsGoalsProgressResponse = (await as(alice).get("/api/reports/goals/progress?scope=household")
      .set("X-Capital-Subject", alice.id).set("X-Capital-Household", householdId).expect(200)).body.data;
    const byId = new Map(report.goals.map(goal => [goal.id, goal]));
    cases.forEach(({ name, targetAmount, progress }, index) => {
      const row = byId.get(goalIds[index]);
      expect.soft(row, name).toMatchObject({ progressAvailability: "available", progress,
        targetAmount: { amount: targetAmount, currency: "USD" }, currentAmount: { amount: "200.00", currency: "USD" } });
      expect.soft(row, name).not.toHaveProperty("monthlyRequired");
    });
    expect(byId.get(savings)?.monthlyRequired).toMatchObject({ currency: "ZMW", amount: expect.stringMatching(/^\d+\.\d{2}$/) });
  });
});

describe("F2: a goal's currency cannot be changed by an edit", () => {
  it("refuses a target in another currency and leaves the goal as it was", async () => {
    const goalId = await sharedGoal("100.15");
    const refused = await as(alice).put(`/api/goals/${goalId}`, { targetAmount: { amount: "1000.00", currency: "USD" } });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain("ZMW");
    expect(await goalRow(goalId)).toMatchObject({ currency: "ZMW", targetAmount: "1000.00", currentAmount: "100.15" });

    await as(alice).put(`/api/goals/${goalId}`, { targetAmount: zmw("2000.00") }).expect(200);
    expect(await goalRow(goalId)).toMatchObject({ currency: "ZMW", targetAmount: "2000.00" });
  });
});

describe("F5: a whole-transaction link and a transfer follow the over-fund rule", () => {
  it("asks for confirmation before a whole-transaction contribution link takes a goal past its target", async () => {
    const goalId = await makeGoal({ targetAmount: "50.00" });
    const income = await makeTransaction(alice, "80.00", ids.shared);
    const refused = await link(alice, goalId, income);
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain("past its target");
    expect((await goalRow(goalId)).currentAmount).toBe("0.00");
    await link(alice, goalId, income, { confirmOverfund: true }).expect(201);
    expect((await goalRow(goalId)).currentAmount).toBe("80.00");
  });

  it("asks for confirmation before a transfer takes the receiving goal past its target", async () => {
    const from = await sharedGoal("100.00");
    const to = await makeGoal({ targetAmount: "50.00" });
    const body = { fromGoalId: from, toGoalId: to, amount: zmw("80.00") };
    const refused = await as(alice).post("/api/goals/transfers", body);
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain("past its target");
    expect(String(refused.body.error?.message)).toMatch(/^This transfer of /);
    expect([(await goalRow(from)).currentAmount, (await goalRow(to)).currentAmount]).toEqual(["100.00", "0.00"]);
    await as(alice).post("/api/goals/transfers", { ...body, confirmOverfund: true }).expect(201);
    expect([(await goalRow(from)).currentAmount, (await goalRow(to)).currentAmount]).toEqual(["20.00", "80.00"]);
  });

  it("asks Bob to confirm a transfer into a goal whose progress he cannot see, in words that reveal nothing", async () => {
    const from = await sharedGoal("100.00");
    const to = await hiddenGoal("30.00");
    const body = { fromGoalId: from, toGoalId: to, amount: zmw("20.00") };
    const refused = await as(bob).post("/api/goals/transfers", body);
    expect([refused.status, refused.body.error?.message]).toEqual([409,
      "This goal's progress includes sources you cannot see, so it may already be at its target. " +
        "Confirm overfunding to record this transfer."]);
    expect([(await goalRow(from)).currentAmount, (await goalRow(to)).currentAmount]).toEqual(["100.00", "30.00"]);
    await as(bob).post("/api/goals/transfers", { ...body, confirmOverfund: true }).expect(201);
    expect([(await goalRow(from)).currentAmount, (await goalRow(to)).currentAmount]).toEqual(["80.00", "50.00"]);
  });

  it("does not ask for confirmation on a member's contribution link to a debt goal, which has no target to overfund", async () => {
    const goalId = await makeGoal({ type: "pay_down", targetAmount: "4200.00", originalBalance: "4200.00", currentAmount: "4000.00" });
    const response = await link(bob, goalId, await makeTransaction(bob, "300.00", ids.shared));
    expect([response.status, JSON.stringify(response.body)]).toEqual([201, expect.not.stringContaining("past its target")]);
  });

  it("leaves a rule's auto-link out of the over-fund rule, since no member is asking", async () => {
    const goalId = await makeGoal({ targetAmount: "50.00" });
    const [income] = await db.select().from(transactions)
      .where(eq(transactions.id, await makeTransaction(alice, "80.00", ids.shared)));
    await withTransaction((tx) => linkGoalsToTransaction(income, householdId, [goalId], undefined, tx));
    expect((await goalRow(goalId)).currentAmount).toBe("80.00");
  });
});

describe("A member who cannot see a goal's progress cannot complete it", () => {
  it("gives Bob the same constant refusal as a contribution, and leaves the goal open", async () => {
    const goalId = await hiddenGoal("40.00");
    const contribute = await as(bob).post(`/api/goals/${goalId}/contribute`, { amount: zmw("1.00") });
    const complete = await as(bob).post(`/api/goals/${goalId}/complete`);
    expect([complete.status, complete.body.error?.message]).toEqual([409, contribute.body.error?.message]);
    expect(String(complete.body.error?.message)).not.toMatch(/\d/);
    expect((await goalRow(goalId)).isCompleted).toBe(false);
    await as(alice).post(`/api/goals/${goalId}/complete`).expect(200);

    // Rule 9: one business audit row, Alice's, committed with the completion; none for Bob's refusal.
    const audits = await db.select().from(auditLogs).where(and(
      eq(auditLogs.entityId, goalId), eq(auditLogs.entityType, "goal"), eq(auditLogs.action, "UPDATE"),
    ));
    expect(audits.map((row) => [row.userId, (row.details as Json).operation])).toEqual([[alice.id, "completeGoal"]]);
  });

  it("rolls the completion back when its business audit row cannot be written (Rule 9)", async () => {
    const goalId = await sharedGoal("40.00");
    const failing = vi.spyOn(businessAuditService, "logUpdate").mockRejectedValueOnce(new Error("synthetic audit failure"));
    try {
      const response = await as(alice).post(`/api/goals/${goalId}/complete`);
      expect(response.status).toBe(500);
    } finally {
      failing.mockRestore();
    }
    expect(await goalRow(goalId)).toMatchObject({ isCompleted: false, completedAt: null });
  });
});

describe("F4: goal notices count only the goals each recipient can see", () => {
  const weeklyRows = (userId: string) => db.select().from(notifications).where(and(
    eq(notifications.userId, userId), eq(notifications.householdId, householdId), like(notifications.dedupeKey, "goals:weekly:%"),
  ));
  /** A member's one check-in this week: a second would be a duplicate send. */
  const weeklyFor = async (userId: string) => {
    const rows = await weeklyRows(userId);
    expect(rows).toHaveLength(1);
    return rows[0];
  };

  it("the weekly check-in counts hidden goals only for the members who can see them", async () => {
    const hidden = await hiddenGoal("40.00");
    const shared = await sharedGoal("10.00");
    await db.update(goals).set({ status: "on_track" }).where(eq(goals.id, hidden));
    await db.update(goals).set({ status: "behind" }).where(eq(goals.id, shared));
    await keepOnlyActive([hidden, shared]);

    await runWeeklyGoalReport();
    const [own, others] = [await weeklyFor(alice.id), await weeklyFor(bob.id)];
    expect(own.metadata).toMatchObject({ saveUpTotal: 2, saveUpOnTrack: 1 });
    expect(own.body).toContain("1/2");
    expect(others.metadata).toMatchObject({ saveUpTotal: 1, saveUpOnTrack: 0 });
    expect(others.body).toContain("0/1");
    expect((await weeklyFor(carol.id)).metadata).toMatchObject({ saveUpTotal: 1, saveUpOnTrack: 0 });
  });

  it("the weekly check-in skips a member who can see none of the goals", async () => {
    const dave = await addMember("member");
    extraMembers.push(dave);
    const hidden = await hiddenGoal("40.00");
    await keepOnlyActive([hidden]);

    await runWeeklyGoalReport();
    expect(await weeklyRows(dave.id)).toEqual([]);
    // The household was reported on: Alice, who sees the goal, has her one check-in.
    expect((await weeklyFor(alice.id)).metadata).toMatchObject({ reportType: "weekly" });
  });

  it("a deadline reminder reaches only the members who can see whether the goal is complete", async () => {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const goalId = await hiddenGoal("40.00", { targetDate: soon });
    await runGoalDeadlineReminders();
    const reminders = await db.select({ userId: notifications.userId }).from(notifications).where(and(
      eq(notifications.householdId, householdId), like(notifications.dedupeKey, `goal:${goalId}:deadline:%`),
      inArray(notifications.userId, [alice.id, carol.id, bob.id]),
    ));
    expect(reminders.map(({ userId }) => userId)).toEqual([alice.id]);
  });
});

describe("#245 Astra round 3: a member removed while earlier notices are still going out hears nothing", () => {
  /**
   * Runs `job` with the first delivery in this household to anyone but `leaver`
   * removing the leaver first, as if they left while it was in flight.
   */
  async function removedMidRun(
    leaver: Member, job: () => Promise<unknown>, keyPattern: string,
    change: () => Promise<unknown> = () => db.delete(householdMembers).where(and(
      eq(householdMembers.householdId, householdId), eq(householdMembers.userId, leaver.id),
    )),
  ) {
    const original = notificationService.notifyDetailed.bind(notificationService);
    let removed = false;
    const spy = vi.spyOn(notificationService, "notifyDetailed").mockImplementation(async (userId, inHousehold, ...rest) => {
      if (!removed && inHousehold === householdId && userId !== leaver.id) {
        removed = true;
        await change();
      }
      return original(userId, inHousehold, ...rest);
    });
    try {
      await job();
    } finally {
      spy.mockRestore();
    }
    expect(removed).toBe(true);
    return db.select({ dedupeKey: notifications.dedupeKey }).from(notifications)
      .where(and(eq(notifications.userId, leaver.id), like(notifications.dedupeKey, keyPattern)));
  }

  it("the weekly check-in skips a member who left after the batch began", async () => {
    const erin = await addMember("member");
    extraMembers.push(erin);
    await keepOnlyActive([await sharedGoal("10.00")]);
    expect(await removedMidRun(erin, runWeeklyGoalReport, "goals:weekly:%")).toEqual([]);
  });

  /**
   * Runs `job` with `change` made just as the in-app row is about to be written
   * for `member`: after the job's own recheck, before the send (pre-check P2-1).
   */
  async function changedAtSend(member: Member, change: () => Promise<unknown>, job: () => Promise<unknown>, keyPattern: string) {
    const original = notificationService.getUserPreferences.bind(notificationService);
    let changed = false;
    const spy = vi.spyOn(notificationService, "getUserPreferences").mockImplementation(async (userId, type) => {
      if (!changed && userId === member.id) {
        changed = true;
        await change();
      }
      return original(userId, type);
    });
    try {
      await job();
    } finally {
      spy.mockRestore();
    }
    expect(changed).toBe(true);
    return db.select({ dedupeKey: notifications.dedupeKey }).from(notifications)
      .where(and(eq(notifications.userId, member.id), like(notifications.dedupeKey, keyPattern)));
  }

  it("the weekly check-in holds the send for a member removed after the job's own recheck", async () => {
    const gina = await addMember("member");
    extraMembers.push(gina);
    await keepOnlyActive([await sharedGoal("10.00")]);
    const removeGina = () => db.delete(householdMembers).where(and(
      eq(householdMembers.householdId, householdId), eq(householdMembers.userId, gina.id),
    ));
    expect(await changedAtSend(gina, removeGina, runWeeklyGoalReport, "goals:weekly:%")).toEqual([]);
  });

  it("a deadline reminder holds the send for a member who loses sight of the goal mid-run", async () => {
    const hank = await addMember("member");
    extraMembers.push(hank);
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const goalId = await sharedGoal("10.00", { targetDate: soon });
    await keepOnlyActive([goalId]);
    // Alice's private income now feeds the goal: Hank can no longer see all of its progress.
    const hideFromHank = async () => link(alice, goalId, await makeTransaction(alice, "40.00", ids.privateCash), { confirmOverfund: true }).expect(201);
    expect(await changedAtSend(hank, hideFromHank, runGoalDeadlineReminders, "goal:%:deadline:%")).toEqual([]);
  });

  it("a deadline reminder is not sent for a goal completed after the batch read it (pre-check P2-3)", async () => {
    const ivy = await addMember("member");
    extraMembers.push(ivy);
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const goalId = await sharedGoal("10.00", { targetDate: soon });
    await keepOnlyActive([goalId]);
    const complete = () => db.update(goals).set({ isCompleted: true }).where(eq(goals.id, goalId));
    expect(await removedMidRun(ivy, runGoalDeadlineReminders, "goal:%:deadline:%", complete)).toEqual([]);
  });

  /** A goal due soon, fed only by a fresh shared account that a test can make private. */
  async function dueGoalOnOwnAccount() {
    const accountId = randomUUID();
    await db.insert(accounts).values({
      id: accountId, householdId, name: `Synthetic soon-private ${accountId.slice(0, 8)}`, type: "checking",
      currency: "ZMW", initialBalance: "1000.00", balance: "1000.00",
    });
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const goalId = await makeGoal({ targetDate: soon });
    await link(bob, goalId, await makeTransaction(bob, "10.00", accountId)).expect(201);
    await keepOnlyActive([goalId]);
    return { accountId, goalId };
  }

  const deadlineRowsFor = (userId: string, goalId: string) => db.select({ id: notifications.id }).from(notifications)
    .where(and(eq(notifications.userId, userId), like(notifications.dedupeKey, `goal:${goalId}:deadline:%`)));
  const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  /** Alice makes the account private on her own connection; the caller commits. */
  async function privacyWrite(accountId: string) {
    const writer = await pool.connect();
    await writer.query("SET lock_timeout = '20s'");
    await writer.query("BEGIN");
    const update = writer.query("UPDATE accounts SET is_private = true, owner_user_id = $1 WHERE id = $2", [alice.id, accountId]);
    return { writer, update };
  }

  it("a reminder waits for a privacy change already in flight, then sends nothing to the member it excludes (r4 P1)", async () => {
    const kim = await addMember("member");
    extraMembers.push(kim);
    const { accountId, goalId } = await dueGoalOnOwnAccount();
    const { writer, update } = await privacyWrite(accountId);
    try {
      await update;
      let finished = false;
      const job = runGoalDeadlineReminders().then(() => { finished = true; });
      await settle(750);
      // The in-app write locks the household's accounts: it cannot pass the open privacy write.
      expect(finished).toBe(false);
      await writer.query("COMMIT");
      await job;
    } finally {
      writer.release();
    }
    expect(await deadlineRowsFor(kim.id, goalId)).toEqual([]);
    expect(await deadlineRowsFor(alice.id, goalId)).toHaveLength(1);
  });

  it("a privacy change made while the final check holds its locks waits until the reminder is written (r4 P1)", async () => {
    const lee = await addMember("member");
    extraMembers.push(lee);
    const { accountId, goalId } = await dueGoalOnOwnAccount();
    const order: string[] = [];
    let pending: Awaited<ReturnType<typeof privacyWrite>> | undefined;
    const original = notificationRepository.createInTransaction.bind(notificationRepository);
    const spy = vi.spyOn(notificationRepository, "createInTransaction").mockImplementation(async (tx, data) => {
      if (data.userId === lee.id && !pending) {
        // The final check has passed and holds its locks: the change now starts.
        pending = await privacyWrite(accountId);
        pending.update = pending.update.then((result) => { order.push("privacy write"); return result; });
        await settle(500);
      }
      const row = await original(tx, data);
      if (data.userId === lee.id) order.push("reminder row");
      return row;
    });
    try {
      await runGoalDeadlineReminders();
    } finally {
      spy.mockRestore();
    }
    expect(pending).toBeDefined();
    try {
      await pending!.update;
      await pending!.writer.query("COMMIT");
    } finally {
      pending!.writer.release();
    }
    // The change could not land between the check and the row: it waited for the row's commit.
    expect(order).toEqual(["reminder row", "privacy write"]);
    expect(await deadlineRowsFor(lee.id, goalId)).toHaveLength(1);
  });

  it("a reminder's final check cannot deadlock a tag write that holds memberships, then locks the account (r5 blocking)", async () => {
    const { accountId, goalId } = await dueGoalOnOwnAccount();
    // A tag write's order (TagWriteRepository): household, the members FOR UPDATE, then the account.
    const writer = await pool.connect();
    let job: Promise<unknown> | undefined;
    try {
      await writer.query("SET lock_timeout = '20s'");
      await writer.query("BEGIN");
      await writer.query("SELECT id FROM households WHERE id = $1 FOR NO KEY UPDATE", [householdId]);
      await writer.query("SELECT id FROM household_members WHERE household_id = $1 ORDER BY user_id FOR UPDATE", [householdId]);
      job = runGoalDeadlineReminders();
      await settle(750);
      // The final check waits at the membership row, before any account: the writer still gets its account.
      await writer.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [accountId]);
      await writer.query("COMMIT");
    } catch (error) {
      await writer.query("ROLLBACK");
      throw error;
    } finally {
      writer.release();
      await job;
    }
    expect(await deadlineRowsFor(alice.id, goalId)).toHaveLength(1);
  });

  it("a rule's owner change on a transaction waits for a goal notice's account lock (r5 P2)", async () => {
    const { accountId } = await dueGoalOnOwnAccount();
    const transactionId = await makeTransaction(bob, "5.00", accountId);
    const reader = await pool.connect();
    try {
      await reader.query("BEGIN");
      // What a goal notice's final check holds on the account until its row commits.
      await reader.query("SELECT id FROM accounts WHERE id = $1 FOR SHARE", [accountId]);
      let finished = false;
      // Rule apply passes no actor: only the owner changes.
      const write = transactionRepository.update(transactionId, householdId, { ownerUserId: alice.id })
        .then((result) => { finished = true; return result; });
      await settle(750);
      expect(finished).toBe(false);
      await reader.query("COMMIT");
      expect((await write).transaction?.ownerUserId).toBe(alice.id);
    } finally {
      reader.release();
    }
  });

  it("a rule's owner change still applies to a live transaction on a soft-deleted account (r6 P2-2)", async () => {
    const { accountId } = await dueGoalOnOwnAccount();
    const transactionId = await makeTransaction(bob, "5.00", accountId);
    // Deleting an account leaves its transactions live.
    await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, accountId));
    try {
      const result = await transactionRepository.update(transactionId, householdId, { ownerUserId: alice.id });
      expect(result.transaction?.ownerUserId).toBe(alice.id);
    } finally {
      await db.update(accounts).set({ deletedAt: null }).where(eq(accounts.id, accountId));
    }
  });

  it("a deadline reminder skips a member who left after the batch began", async () => {
    const frank = await addMember("member");
    extraMembers.push(frank);
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await keepOnlyActive([await sharedGoal("10.00", { targetDate: soon })]);
    expect(await removedMidRun(frank, runGoalDeadlineReminders, "goal:%:deadline:%")).toEqual([]);
  });
});

describe("Owner decision on #235 F1: a transfer touching a hidden goal is listed without its amount", () => {
  it("lists every transfer to Bob, with no amount where either goal's progress is hidden from him", async () => {
    const hiddenName = "Synthetic hidden transfer goal";
    const visibleName = "Synthetic visible transfer goal";
    const hidden = await hiddenGoal("500.00", { name: hiddenName });
    const visible = await sharedGoal("100.00", { name: visibleName });
    const [openFrom, openTo] = [await sharedGoal("100.00"), await sharedGoal("100.00")];
    const transfer = (fromGoalId: string, toGoalId: string, amount: string) => as(alice).post("/api/goals/transfers",
      { fromGoalId, toGoalId, amount: zmw(amount), confirmOverfund: true }).expect(201);
    const out = ((await transfer(hidden, visible, "40.00")).body.data as { transfer: Json }).transfer.id;
    const into = ((await transfer(visible, hidden, "10.00")).body.data as { transfer: Json }).transfer.id;
    // Neither goal has ever touched the hidden one, so Bob sees this amount.
    const open = ((await transfer(openFrom, openTo, "25.00")).body.data as { transfer: Json }).transfer.id;

    const listed = async (member: Member, path: string) => {
      const rows = (await as(member).get(path).expect(200)).body.data as Json[];
      return new Map(rows.map((row) => [row.id, row]));
    };
    function scalarValues(value: unknown): unknown[] {
      return value !== null && typeof value === "object" ? Object.values(value).flatMap(scalarValues) : [value];
    }
    function expectNoTransferAmounts(value: unknown) {
      // Compare complete scalar values so a timestamp ending in :10.001Z is safe.
      const amounts = scalarValues(value).filter(candidate =>
        (typeof candidate === "string" || typeof candidate === "number") && [10, 40].includes(Math.abs(Number(candidate))));
      expect(amounts).toEqual([]);
    }
    expect((await listed(bob, "/api/goals/transfers")).get(open)?.amount).toEqual(zmw("25.00"));
    expect((await listed(bob, `/api/goals/${openTo}/transfers`)).get(open)?.amount).toEqual(zmw("25.00"));
    for (const path of ["/api/goals/transfers", `/api/goals/${visible}/transfers`]) {
      const forBob = await listed(bob, path);
      expect(forBob.get(out)).toMatchObject({ fromGoalId: hidden, toGoalId: visible, amount: null, reason: null });
      expect(forBob.get(into)).toMatchObject({ fromGoalId: visible, toGoalId: hidden, amount: null, reason: null });
      expectNoTransferAmounts([forBob.get(out), forBob.get(into)]);
      expect(JSON.stringify([...forBob.values()])).not.toContain("amountVisible");

      const forAlice = await listed(alice, path);
      expect([forAlice.get(out)?.amount, forAlice.get(into)?.amount]).toEqual([zmw("40.00"), zmw("10.00")]);
    }
    const ownList = await listed(bob, `/api/goals/${hidden}/transfers`);
    for (const entry of [ownList.get(out), ownList.get(into)]) expect(entry).toMatchObject({ amount: null, reason: null });
    expectNoTransferAmounts([ownList.get(out), ownList.get(into)]);

    // The activity feeds: the hidden goal's entries keep no amount or balance for
    // Bob, and so do the receiving goal's, which the transfer closure hides too.
    const activity = async (member: Member, goalId: string) => new Map(
      ((await as(member).get(`/api/goals/${goalId}/activity`).expect(200)).body.data as Json[])
        .filter((entry) => String(entry.activityType).startsWith("transfer_"))
        .map((entry) => [`${entry.activityType}:${(entry.metadata as Json).toGoalId ?? (entry.metadata as Json).fromGoalId}`, entry]),
    );
    const expectRedactedActivity = (entry: Json | undefined, relatedGoal: Json) => {
      expect(entry).toMatchObject({ amount: null, previousBalance: null, newBalance: null });
      expect(entry?.metadata).toEqual({ ...relatedGoal, reason: null });
    };
    const hiddenFeed = await activity(bob, hidden);
    expectRedactedActivity(hiddenFeed.get(`transfer_out:${visible}`), { toGoalId: visible, toGoalName: visibleName });
    expectRedactedActivity(hiddenFeed.get(`transfer_in:${visible}`), { fromGoalId: visible, fromGoalName: visibleName });
    expectNoTransferAmounts([...hiddenFeed.values()]);
    const receiverFeed = await activity(bob, visible);
    const received = receiverFeed.get(`transfer_in:${hidden}`);
    expectRedactedActivity(received, { fromGoalId: hidden, fromGoalName: hiddenName });
    expectNoTransferAmounts(received);
    // Alice sees the exact logged amounts.
    const ownFeed = await activity(alice, hidden);
    expect([ownFeed.get(`transfer_out:${visible}`)?.amount, ownFeed.get(`transfer_in:${visible}`)?.amount])
      .toEqual(["-40.00", "10.00"]);
  });

  it("still shows a visible sender's own transfer out to a hidden goal: the owner's accepted limit", async () => {
    const hidden = await hiddenGoal("500.00");
    const sender = await sharedGoal("100.00");
    await as(alice).post("/api/goals/transfers",
      { fromGoalId: sender, toGoalId: hidden, amount: zmw("15.00"), confirmOverfund: true }).expect(201);
    // Bob still sees the sender's progress, so its own balance drop is no secret.
    const feed = (await as(bob).get(`/api/goals/${sender}/activity`).expect(200)).body.data as Json[];
    expect(feed.find((entry) => entry.activityType === "transfer_out"))
      .toMatchObject({ amount: "-15.00", previousBalance: "100.00", newBalance: "85.00" });
  });
});

describe("Not-found copy", () => {
  it("says the goal was not found once", async () => {
    const response = await as(alice).post(`/api/goals/${randomUUID()}/contribute`, { amount: zmw("1.00") });
    expect([response.status, response.body.error?.message]).toEqual([404, "Goal not found"]);
  });
});
