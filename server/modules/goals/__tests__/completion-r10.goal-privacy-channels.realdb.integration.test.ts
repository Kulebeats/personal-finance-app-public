/**
 * FIN-01 close-out, the remaining channels (#235 review M1-M6): a member who
 * cannot see all of a goal's progress learns no hidden number from a write
 * response, a refusal, the AI readers, the activity feed or a notification,
 * and a member who can see everything is never locked out by retained history.
 * The #235 round-3 follow-ups are here too: a milestone notice leaves only
 * after its write commits (R3-1), the audience is one statement (R3-3), a
 * hidden member's write gets one constant refusal (R2-5), and a legacy
 * source-edit row is judged by the transaction it cites (R2-4).
 *
 * Real HTTP against real Postgres. Alice owns private sources; Bob is a member
 * who cannot see them.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  accounts, auditLogs, goalActivityLog, goals, householdMembers, households, notifications, transactions, users,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { readGoalAssignments, readGoalsStatus } from "../../ai/ai.goal-readers";
import { sanitizeGoalAssignmentData, sanitizeGoalData } from "../../ai/ai.goal-sanitizer";
import { notificationService } from "../../../services/NotificationService";
import { accountRepository } from "../../../repositories/AccountRepository";
import { transactionGoalLinkService } from "../../../services/TransactionGoalLinkService";
import { goalProgressAudience } from "../../../services/notification/audience";
import { withTransaction } from "../../../utils/withTransaction";

type Json = Record<string, unknown>;
type Member = { id: string; cookie: string };

const password = "SyntheticGoalChannels123!";
const householdId = randomUUID();
const ids = { shared: randomUUID(), privateCash: randomUUID(), privateDebt: randomUUID() };
const SOURCE_DATE = "2026-10-15";
const HIDDEN = "7350.00";
let app: Awaited<ReturnType<typeof getTestApp>>;
let alice: Member;
let bob: Member;

const zmw = (amount: string) => ({ amount, currency: "ZMW" });

async function addMember(role: "owner" | "member"): Promise<Member> {
  const id = randomUUID();
  const email = `goal-channels-${id}@example.invalid`;
  await db.insert(users).values({ id, email, username: `goal-channels-${id}`, passwordHash: await hashPassword(password), emailVerified: true });
  await db.insert(householdMembers).values({ householdId, userId: id, role });
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") };
}

async function seed() {
  await db.insert(households).values({ id: householdId, name: "Synthetic goal channels household", currency: "ZMW" });
  alice = await addMember("owner");
  bob = await addMember("member");
  const own = { isPrivate: true, ownerUserId: alice.id };
  await db.insert(accounts).values([
    { id: ids.shared, householdId, name: "Synthetic shared current", type: "checking", currency: "ZMW", initialBalance: "50000.00", balance: "50000.00" },
    { id: ids.privateCash, householdId, name: "Synthetic private current", type: "checking", currency: "ZMW", initialBalance: "50000.00", balance: "50000.00", ...own },
    { id: ids.privateDebt, householdId, name: "Synthetic private loan", type: "loan", currency: "ZMW", initialBalance: "-4200.00", balance: "-4200.00", ...own },
  ]);
}

async function teardown() {
  await db.delete(notifications).where(eq(notifications.householdId, householdId));
  await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
  await db.delete(goals).where(eq(goals.householdId, householdId));
  await db.delete(transactions).where(eq(transactions.householdId, householdId));
  await db.delete(accounts).where(eq(accounts.householdId, householdId));
  await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
  await db.delete(households).where(eq(households.id, householdId));
  for (const member of [alice, bob].filter(Boolean)) {
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
  delete: (path: string) => request(app).delete(path).set("Cookie", member.cookie),
});

async function makeGoal(values: Partial<typeof goals.$inferInsert> = {}) {
  const id = randomUUID();
  await db.insert(goals).values({
    id, householdId, name: `Synthetic goal ${id.slice(0, 8)}`, type: "save_up", goalType: "other", currency: "ZMW",
    targetAmount: "100000.00", currentAmount: "0.00", spendingReducesProgress: true, ...values,
  });
  return id;
}

async function makeTransaction(member: Member, type: "income" | "expense", amount: string, accountId: string) {
  const response = await as(member).post("/api/transactions", {
    accountId, type, amount: { amount, currency: "ZMW" }, date: SOURCE_DATE, name: `Synthetic ${type} ${amount}`,
  }).expect(201);
  return (response.body.data as { id: string }).id;
}

async function linkAs(member: Member, goalId: string, transactionId: string, linkType: "contribution" | "spending") {
  // Fixtures confirm over-funding; whether a link needs it is tested in completion-r10.goal-qa-defects.
  await as(member).post(`/api/goals/${goalId}/transactions`, { transactionId, linkType, confirmOverfund: true }).expect(201);
}

/** A goal Bob cannot see all of: Alice's private income counts toward it. */
async function hiddenGoal(privateAmount: string, values: Partial<typeof goals.$inferInsert> = {}) {
  const goalId = await makeGoal(values);
  await linkAs(alice, goalId, await makeTransaction(alice, "income", privateAmount, ids.privateCash), "contribution");
  return goalId;
}

async function sharedReserve(balance = "5000.00") {
  const id = randomUUID();
  await db.insert(accounts).values({
    id, householdId, name: "Synthetic shared reserve", type: "savings", currency: "ZMW", initialBalance: balance, balance,
  });
  return id;
}

async function progress(goalId: string): Promise<string> {
  const [goal] = await db.select({ currentAmount: goals.currentAmount }).from(goals).where(eq(goals.id, goalId));
  return goal.currentAmount;
}

/** The body discloses neither the hidden total nor any amount derived from it. */
function expectNoHiddenNumber(body: unknown, ...forbidden: string[]) {
  const text = JSON.stringify(body);
  for (const value of ["7350", ...forbidden]) expect(text).not.toContain(value);
}

const bobActor = () => ({ householdId, userId: bob.id, role: "member" as const });

beforeAll(async () => {
  app = await getTestApp();
  await seed();
}, 60_000);

afterAll(async () => {
  await teardown();
});

describe("M1: every goal a write returns is the redacted read model", () => {
  // An edit and a completion by Bob are refused (#235 R2-5, goals QA), so they are not write responses.
  it("archive and unarchive answer Bob with no hidden progress", async () => {
    const goalId = await hiddenGoal(HIDDEN);
    for (const response of [
      await as(bob).post(`/api/goals/${goalId}/archive`).expect(200),
      await as(bob).post(`/api/goals/${goalId}/unarchive`).expect(200),
    ]) {
      const goal = response.body.data as Json;
      expect([goal.currentAmount, goal.progressAvailability]).toEqual([null, "unavailable"]);
      expectNoHiddenNumber(goal);
    }
  });

  it("assigning, changing and removing an account answer Bob with no hidden progress", async () => {
    const goalId = await hiddenGoal(HIDDEN);
    const reserve = await sharedReserve();
    const assigned = await as(bob).post(`/api/goals/${goalId}/assign-account`, {
      accountId: reserve, assignmentType: "partial_balance", partialAmount: zmw("0.01"),
    }).expect(201);
    const changed = await as(bob).put(`/api/goals/${goalId}/accounts/${reserve}`, { accountId: reserve,
      assignmentType: "partial_balance", partialAmount: zmw("0.02"),
    }).expect(200);
    const removed = await as(bob).delete(`/api/goals/${goalId}/accounts/${reserve}`).expect(200);
    for (const response of [assigned, changed, removed]) {
      const goal = (response.body.data as { goal: Json }).goal;
      expect([goal.currentAmount, goal.progressAvailability]).toEqual([null, "unavailable"]);
      expectNoHiddenNumber(response.body, "7350.01", "7350.02");
    }
    expect(await progress(goalId)).toBe(HIDDEN);
  });
});

describe("M2: a refusal never depends on whether hidden progress completed the goal", () => {
  it("answers Bob the same for a completed and an open goal he cannot see all of", async () => {
    const completed = await hiddenGoal("150.00", { targetAmount: "100.00" });
    const open = await hiddenGoal("50.00", { targetAmount: "100.00" });
    const [stored] = await db.select({ isCompleted: goals.isCompleted }).from(goals).where(eq(goals.id, completed));
    expect(stored.isCompleted).toBe(true);

    const answers = async (goalId: string) => {
      const contribute = await as(bob).post(`/api/goals/${goalId}/contribute`, { amount: zmw("0.01") });
      const update = await as(bob).put(`/api/goals/${goalId}`, { name: "Synthetic renamed goal" });
      return [contribute.status, contribute.body.error?.message ?? null, update.status, update.body.error?.message ?? null];
    };
    const forCompleted = await answers(completed);
    expect(forCompleted).toEqual(await answers(open));
    expect(forCompleted[0]).toBe(409);
    expect(String(forCompleted[1])).not.toMatch(/\d/);
  });

  // #235 R2-5: the completed-goal rule held only for members who can see the
  // progress. A refusal that depends on completion would reveal it, so every
  // contribution and edit by a member who cannot see all of it gets one answer.
  it("refuses Bob's contribution, even with confirmOverfund, and his edit, the same way for a completed and an open goal", async () => {
    const completed = await hiddenGoal("150.00", { targetAmount: "100.00" });
    const open = await hiddenGoal("50.00", { targetAmount: "100.00" });

    const answers = async (goalId: string) => {
      const plain = await as(bob).post(`/api/goals/${goalId}/contribute`, { amount: zmw("0.01") });
      const confirmed = await as(bob).post(`/api/goals/${goalId}/contribute`, { amount: zmw("0.01"), confirmOverfund: true });
      const update = await as(bob).put(`/api/goals/${goalId}`, { name: "Synthetic renamed goal", targetAmount: zmw("5000.00") });
      return [plain, confirmed, update].map((response) => [response.status, response.body.error?.message ?? null]);
    };
    const forCompleted = await answers(completed);
    expect(forCompleted).toEqual(await answers(open));
    for (const [status, message] of forCompleted) {
      expect(status).toBe(409);
      expect(String(message)).not.toMatch(/\d/);
    }
    expect(new Set(forCompleted.map(([, message]) => message)).size).toBe(1);

    const stored = await db.select({ id: goals.id, name: goals.name, targetAmount: goals.targetAmount, currentAmount: goals.currentAmount })
      .from(goals).where(eq(goals.householdId, householdId));
    expect(stored.find((goal) => goal.id === completed)).toMatchObject({ targetAmount: "100.00", currentAmount: "150.00" });
    expect(stored.find((goal) => goal.id === open)).toMatchObject({ targetAmount: "100.00", currentAmount: "50.00" });
    expect(stored.filter((goal) => (goal.id === completed || goal.id === open) && goal.name === "Synthetic renamed goal")).toHaveLength(0);
    // A member who can see all of the progress still edits as before.
    await as(alice).put(`/api/goals/${open}`, { name: "Synthetic owner rename" }).expect(200);
  });
});

describe("M3: an assignment release takes what progress holds, so it is never refused", () => {
  // The owner's own case (removal lands at zero) is in completion-r10.goal-hardening, Round 4 P1.
  it("lowering a partial assignment on a goal Bob cannot see all of succeeds whether or not hidden progress covers it", async () => {
    const goalId = await hiddenGoal("50.00");
    const reserve = await sharedReserve();
    await as(bob).post(`/api/goals/${goalId}/assign-account`, {
      accountId: reserve, assignmentType: "partial_balance", partialAmount: zmw("1000.00"),
    }).expect(201);
    await linkAs(bob, goalId, await makeTransaction(bob, "expense", "1000.00", ids.shared), "spending");
    // Progress now holds exactly Alice's hidden 50.
    const fits = await as(bob).put(`/api/goals/${goalId}/accounts/${reserve}`, { accountId: reserve,
      assignmentType: "partial_balance", partialAmount: zmw("990.00"),
    });
    const short = await as(bob).put(`/api/goals/${goalId}/accounts/${reserve}`, { accountId: reserve,
      assignmentType: "partial_balance", partialAmount: zmw("800.00"),
    });
    expect([fits.status, short.status]).toEqual([200, 200]);
    expect(await progress(goalId)).toBe("0.00");
  });
});

describe("M4: the AI goal readers withhold what the goal screens withhold", () => {
  it("sends no pay-down target and keeps a hidden completed goal in the list", async () => {
    const debtGoal = await makeGoal({
      name: "Synthetic loan payoff", type: "pay_down", goalType: "loan", debtAccountId: ids.privateDebt,
      targetAmount: "4200.00", originalBalance: "4200.00", currentAmount: "4200.00",
      minimumPayment: "100.00", monthlyPayment: "150.00",
    });
    const completed = await hiddenGoal("150.00", { targetAmount: "100.00" });

    const statuses = await readGoalsStatus(bobActor(), "ZMW");
    const debt = statuses.find((goal) => goal.goalId === debtGoal)!;
    expect([debt.progressAvailability, debt.target]).toEqual(["unavailable", null]);
    expect(statuses.map((goal) => goal.goalId)).toContain(completed);
    expectNoHiddenNumber(sanitizeGoalData(statuses), "4200");

    const assignments = await readGoalAssignments(bobActor(), "ZMW");
    expect(assignments.find((row) => row.goalId === debtGoal)?.target).toBeNull();
    expect(assignments.map((row) => row.goalId)).toContain(completed);
    expectNoHiddenNumber(sanitizeGoalAssignmentData(assignments), "4200");
  });
});

describe("M5: retained history never hides a goal from a member who can see all of it", () => {
  it("the owner still sees progress and can transfer out after editing a linked source", async () => {
    const goalId = await makeGoal();
    const other = await makeGoal();
    const income = await makeTransaction(alice, "income", "1000.00", ids.shared);
    await linkAs(alice, goalId, income, "contribution");
    await as(alice).put(`/api/transactions/${income}`, { amount: zmw("1100.00") }).expect(200);

    const detail = (await as(alice).get(`/api/goals/${goalId}`).expect(200)).body.data as Json;
    expect([detail.progressAvailability, detail.currentAmount]).toEqual(["available", zmw("1100.00")]);
    await as(alice).post("/api/goals/transfers", { fromGoalId: goalId, toGoalId: other, amount: zmw("10.00") }).expect(201);
    expect((await as(bob).get(`/api/goals/${goalId}`).expect(200)).body.data.progressAvailability).toBe("available");
  });

  it("the owner still sees progress and can transfer out after deleting a linked source", async () => {
    const goalId = await makeGoal();
    const other = await makeGoal();
    const income = await makeTransaction(alice, "income", "500.00", ids.shared);
    await linkAs(alice, goalId, income, "contribution");
    await as(alice).post(`/api/goals/${goalId}/contribute`, { amount: zmw("20.00") }).expect(201);
    await as(alice).delete(`/api/transactions/${income}`).expect((response) => expect(response.status).toBeLessThan(300));

    const detail = (await as(alice).get(`/api/goals/${goalId}`).expect(200)).body.data as Json;
    expect([detail.progressAvailability, detail.currentAmount]).toEqual(["available", zmw("20.00")]);
    await as(alice).post("/api/goals/transfers", { fromGoalId: goalId, toGoalId: other, amount: zmw("10.00") }).expect(201);
  });

  // #235 R2-3: the same lockout through a soft-deleted account rather than a transaction.
  it("the owner still sees progress and can transfer out after deleting a shared account that fed the goal", async () => {
    const goalId = await makeGoal();
    const other = await makeGoal();
    const fed = await sharedReserve("800.00");
    await linkAs(alice, goalId, await makeTransaction(alice, "income", "300.00", fed), "contribution");
    // The account route needs a step-up re-auth; this is the soft delete it runs after it.
    expect(await accountRepository.softDelete(fed, householdId, { userId: alice.id })).toEqual({ deleted: true });
    const [deleted] = await db.select({ deletedAt: accounts.deletedAt }).from(accounts).where(eq(accounts.id, fed));
    expect(deleted.deletedAt).not.toBeNull();

    for (const member of [alice, bob]) {
      const detail = (await as(member).get(`/api/goals/${goalId}`).expect(200)).body.data as Json;
      expect([detail.progressAvailability, detail.currentAmount]).toEqual(["available", zmw("300.00")]);
    }
    await as(alice).post("/api/goals/transfers", { fromGoalId: goalId, toGoalId: other, amount: zmw("10.00") }).expect(201);
  });

  // #235 R2-4: a source-edit row written before #235 has no accountId. Old data
  // is not backfilled; the row is judged by the transaction it cites instead.
  const legacyEditRow = (goalId: string, metadata: Json) => db.insert(goalActivityLog).values({
    goalId, activityType: "balance_synced", amount: "0.00", previousBalance: "300.00", newBalance: "300.00",
    metadata: { trigger: "source_edited", linkType: "contribution", ...metadata },
  });
  const availability = async (member: Member, goalId: string) =>
    ((await as(member).get(`/api/goals/${goalId}`).expect(200)).body.data as Json).progressAvailability;

  it("a legacy source-edit row citing a shared transaction hides nothing from anyone", async () => {
    const goalId = await makeGoal();
    const other = await makeGoal();
    const shared = await makeTransaction(bob, "income", "300.00", ids.shared);
    await linkAs(bob, goalId, shared, "contribution");
    await legacyEditRow(goalId, { transactionId: shared });

    for (const member of [alice, bob]) {
      const detail = (await as(member).get(`/api/goals/${goalId}`).expect(200)).body.data as Json;
      expect([detail.progressAvailability, detail.currentAmount]).toEqual(["available", zmw("300.00")]);
    }
    await as(alice).post("/api/goals/transfers", { fromGoalId: goalId, toGoalId: other, amount: zmw("10.00") }).expect(201);
  });

  it("a legacy source-edit row fails closed when it cites a private transaction or cites nothing", async () => {
    const citesPrivate = await makeGoal();
    await linkAs(bob, citesPrivate, await makeTransaction(bob, "income", "300.00", ids.shared), "contribution");
    await legacyEditRow(citesPrivate, { transactionId: await makeTransaction(alice, "income", "40.00", ids.privateCash) });
    expect([await availability(alice, citesPrivate), await availability(bob, citesPrivate)]).toEqual(["available", "unavailable"]);

    const citesNothing = await makeGoal();
    await linkAs(bob, citesNothing, await makeTransaction(bob, "income", "300.00", ids.shared), "contribution");
    await legacyEditRow(citesNothing, {});
    expect([await availability(alice, citesNothing), await availability(bob, citesNothing)]).toEqual(["unavailable", "unavailable"]);
  });
});

describe("M6: the activity feed and milestone notices carry no hidden number", () => {
  it("withholds a clamped spend's amount from the activity feed and the summary", async () => {
    const goalId = await hiddenGoal(HIDDEN);
    const spend = await makeTransaction(bob, "expense", "20000.00", ids.shared);
    await linkAs(bob, goalId, spend, "spending");

    const activity = (await as(bob).get(`/api/goals/${goalId}/activity`).expect(200)).body;
    expectNoHiddenNumber(activity);
    expectNoHiddenNumber((await as(bob).get("/api/goals/summary").expect(200)).body);
    await as(bob).delete(`/api/goals/${goalId}/transactions/${spend}`).expect(200);
    expect(await progress(goalId)).toBe(HIDDEN);
  });

  // #235 R2-1: the audience is judged on the link's own transaction, so the private
  // source that crosses the milestone already hides the goal from Bob. It is decided
  // before the response returns, so nothing here depends on timing.
  it("tells only the members who can see the progress the write produced that it reached a milestone", async () => {
    const goalId = await makeGoal({ targetAmount: "1000.00" });
    await linkAs(bob, goalId, await makeTransaction(bob, "income", "100.00", ids.shared), "contribution");
    const dispatch = vi.spyOn(notificationService, "dispatchGoalMilestone");
    try {
      await linkAs(alice, goalId, await makeTransaction(alice, "income", "500.00", ids.privateCash), "contribution");
      const index = dispatch.mock.calls.findIndex(([, , , notice]) => notice.dedupeKey === `goal:${goalId}:milestone:50`);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(dispatch.mock.calls[index][0]).toEqual([alice.id]);
      await dispatch.mock.results[index].value;
    } finally {
      dispatch.mockRestore();
    }
    const milestone = (userId: string) => db.select().from(notifications).where(and(
      eq(notifications.userId, userId), eq(notifications.dedupeKey, `goal:${goalId}:milestone:50:user:${userId}`),
    ));
    expect(await milestone(alice.id)).toHaveLength(1);
    expect(await milestone(bob.id)).toHaveLength(0);
  });

  // #235 R2-2: the status worker records the status progress produced.
  it("withholds a status change on a goal whose progress Bob cannot see", async () => {
    const goalId = await hiddenGoal(HIDDEN);
    await db.insert(goalActivityLog).values({
      goalId, activityType: "status_changed",
      metadata: { previousStatus: "behind", newStatus: "completed", percentComplete: 100 },
    });
    const entries = (await as(bob).get(`/api/goals/${goalId}/activity`).expect(200)).body.data as Json[];
    const change = entries.find((entry) => entry.activityType === "status_changed");
    expect(change).toBeDefined();
    expect(JSON.stringify(change)).not.toMatch(/previousStatus|newStatus|completed|behind|percentComplete/);
    const own = (await as(alice).get(`/api/goals/${goalId}/activity`).expect(200)).body.data as Json[];
    expect(JSON.stringify(own.find((entry) => entry.activityType === "status_changed"))).toContain("completed");
  });

  // #235 R3-1: a rule application links on a transaction its caller owns. The
  // notice may only leave once that transaction commits: a rollback sends none,
  // and its dedupe key is not spent on a milestone that never happened.
  it("sends a milestone only after the caller's transaction commits, and never for one that rolls back", async () => {
    const goalId = await makeGoal({ targetAmount: "1000.00" });
    const dispatch = vi.spyOn(notificationService, "dispatchGoalMilestone");
    try {
      const rolledBack = await makeTransaction(bob, "income", "600.00", ids.shared);
      await expect(withTransaction(async (tx) => {
        await transactionGoalLinkService.linkTransaction(goalId, householdId, bob.id,
          { transactionId: rolledBack, linkType: "contribution" }, tx);
        throw new Error("synthetic rollback after the link");
      })).rejects.toThrow("synthetic rollback after the link");
      expect(dispatch).not.toHaveBeenCalled();
      expect(await progress(goalId)).toBe("0.00");

      const committed = await makeTransaction(bob, "income", "600.00", ids.shared);
      let callsBeforeCommit = -1;
      await withTransaction(async (tx) => {
        await transactionGoalLinkService.linkTransaction(goalId, householdId, bob.id,
          { transactionId: committed, linkType: "contribution" }, tx);
        callsBeforeCommit = dispatch.mock.calls.length;
      });
      expect(callsBeforeCommit).toBe(0);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0][0]).toEqual([alice.id, bob.id]);
      await dispatch.mock.results[0].value;
    } finally {
      dispatch.mockRestore();
    }
    const milestone = await db.select().from(notifications).where(and(
      eq(notifications.userId, bob.id), eq(notifications.dedupeKey, `goal:${goalId}:milestone:50:user:${bob.id}`),
    ));
    expect(milestone).toHaveLength(1);
  });

  // #235 R3-3: the audience is decided while the writer holds the goal row, so
  // every member's verdict comes from one statement, not one query per member.
  it("judges every member's verdict in one statement, in membership order", async () => {
    const shared = await makeGoal();
    await linkAs(bob, shared, await makeTransaction(bob, "income", "10.00", ids.shared), "contribution");
    const hidden = await hiddenGoal("10.00");
    // A login rewrites the member's row (last_active_at), which moves it in the
    // heap: membership order must come from the query, not from row placement.
    await db.update(householdMembers).set({ lastActiveAt: new Date() })
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, alice.id)));

    const query = vi.spyOn(pool, "query");
    try {
      expect(await goalProgressAudience(householdId, shared)).toEqual([alice.id, bob.id]);
      const citing = query.mock.calls.filter((call) => {
        const [first, second] = call as unknown[];
        const values = typeof first === "object" && first !== null && "values" in first
          ? (first as { values?: unknown[] }).values : second;
        return Array.isArray(values) && values.includes(shared);
      });
      expect(citing).toHaveLength(1);
    } finally {
      query.mockRestore();
    }
    expect(await goalProgressAudience(householdId, hidden)).toEqual([alice.id]);
  });
});
