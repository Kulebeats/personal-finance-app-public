/**
 * FIN-01 close-out (#184 Astra findings 1-4, #222 round-4 review): a member who
 * cannot see all of a goal's progress sources learns nothing about that
 * progress, from reads, filters, transfers, or the answer to an edit.
 *
 * Real HTTP against real Postgres. Alice owns private sources; Bob is a member
 * who cannot see them.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  accounts, auditLogs, goals, householdMembers, households, transactions, users,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";

type Json = Record<string, unknown>;
type Member = { id: string; cookie: string };

const password = "SyntheticGoalPrivacy123!";
const householdId = randomUUID();
const ids = { shared: randomUUID(), privateCash: randomUUID(), privateDebt: randomUUID(), privateBroker: randomUUID() };
const SOURCE_DATE = "2026-10-15";
let app: Awaited<ReturnType<typeof getTestApp>>;
let alice: Member;
let bob: Member;

const zmw = (amount: string) => ({ amount, currency: "ZMW" });

/** Every string and number anywhere in a response body. */
function leafValues(value: unknown): Array<string | number> {
  if (typeof value === "string" || typeof value === "number") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(leafValues);
  return [];
}

/**
 * The values in `body` that carry this hidden amount, alone or in text: "130",
 * 130, "-130.00", "…K130.00 would take…", "ZMW 4,200.00". The amount must stand
 * as its own number: a hex digit, a dot, a comma or a hyphen next to it (a uuid,
 * a timestamp's milliseconds, a longer number) does not count, so ids and dates
 * that happen to contain the digits never fail the check.
 */
function hiddenAmountValues(body: unknown, amount: number): Array<string | number> {
  const digits = String(amount).replace(/\B(?=(\d{3})+$)/g, ",?");
  const pattern = new RegExp(`(?<![0-9a-f.,-])-?${digits}(\\.0+)?(?![0-9a-f]|[.,]\\d)`);
  return leafValues(body).filter((value) => pattern.test(String(value)));
}

async function addMember(role: "owner" | "member"): Promise<Member> {
  const id = randomUUID();
  const email = `goal-privacy-${id}@example.invalid`;
  await db.insert(users).values({ id, email, username: `goal-privacy-${id}`, passwordHash: await hashPassword(password), emailVerified: true });
  await db.insert(householdMembers).values({ householdId, userId: id, role });
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") };
}

async function seed() {
  await db.insert(households).values({ id: householdId, name: "Synthetic goal privacy household", currency: "ZMW" });
  alice = await addMember("owner");
  bob = await addMember("member");
  const own = { isPrivate: true, ownerUserId: alice.id };
  await db.insert(accounts).values([
    { id: ids.shared, householdId, name: "Synthetic shared current", type: "checking", currency: "ZMW", initialBalance: "10000.00", balance: "10000.00" },
    { id: ids.privateCash, householdId, name: "Synthetic private current", type: "checking", currency: "ZMW", initialBalance: "10000.00", balance: "10000.00", ...own },
    { id: ids.privateDebt, householdId, name: "Synthetic private loan", type: "loan", currency: "ZMW", initialBalance: "-4200.00", balance: "-4200.00", ...own },
    { id: ids.privateBroker, householdId, name: "Synthetic private broker", type: "investment", currency: "ZMW", initialBalance: "0.00", balance: "0.00", ...own },
  ]);
}

async function teardown() {
  await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
  await db.delete(goals).where(eq(goals.householdId, householdId));
  await pool.query("DELETE FROM investment_transactions WHERE household_id = $1", [householdId]);
  await db.delete(transactions).where(eq(transactions.householdId, householdId));
  await db.delete(accounts).where(eq(accounts.householdId, householdId));
  await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
  await db.delete(households).where(eq(households.id, householdId));
  for (const member of [alice, bob].filter(Boolean)) {
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
    targetAmount: "1000.00", currentAmount: "0.00", spendingReducesProgress: true, ...values,
  });
  return id;
}

async function makeTransaction(member: Member, type: "income" | "expense", amount: string, accountId: string) {
  const response = await as(member).post("/api/transactions", {
    accountId, type, amount: { amount, currency: "ZMW" }, date: SOURCE_DATE, name: `Synthetic ${type} ${amount}`,
  }).expect(201);
  return (response.body.data as { id: string }).id;
}

/** A goal Bob cannot see all of: Alice's private income counts toward it. */
async function hiddenGoal(privateAmount: string, values: Partial<typeof goals.$inferInsert> = {}) {
  const goalId = await makeGoal(values);
  const income = await makeTransaction(alice, "income", privateAmount, ids.privateCash);
  await as(alice).post(`/api/goals/${goalId}/transactions`, { transactionId: income, linkType: "contribution", confirmOverfund: true }).expect(201);
  return goalId;
}

async function progress(goalId: string): Promise<string> {
  const [goal] = await db.select({ currentAmount: goals.currentAmount }).from(goals).where(eq(goals.id, goalId));
  return goal.currentAmount;
}

beforeAll(async () => {
  app = await getTestApp();
  await seed();
}, 60_000);

afterAll(async () => {
  await teardown();
});

describe("A1: a debt goal's amounts come from its debt account", () => {
  it("withholds target and original balance when the debt account is hidden", async () => {
    const goalId = await makeGoal({
      type: "pay_down", goalType: "loan", debtAccountId: ids.privateDebt,
      targetAmount: "4200.00", originalBalance: "4200.00", currentAmount: "4200.00",
      minimumPayment: "100.00", monthlyPayment: "150.00",
    });
    const detail = (await as(bob).get(`/api/goals/${goalId}`).expect(200)).body.data as Json;
    const listed = ((await as(bob).get("/api/goals").expect(200)).body.data as Json[]).find((goal) => goal.id === goalId)!;
    for (const goal of [detail, listed]) {
      expect([goal.progressAvailability, goal.targetAmount, goal.originalBalance, goal.currentAmount])
        .toEqual(["unavailable", null, null, null]);
    }
    expect(hiddenAmountValues(detail, 4200)).toEqual([]);

    const own = (await as(alice).get(`/api/goals/${goalId}`).expect(200)).body.data as Json;
    expect(own.originalBalance).toEqual(zmw("4200.00"));
  });
});

describe("A2: completion follows the progress it is derived from", () => {
  it("withholds isCompleted and completedAt, and status and completion filters never select on hidden values", async () => {
    const goalId = await hiddenGoal("150.00", { targetAmount: "100.00" });
    const [stored] = await db.select().from(goals).where(eq(goals.id, goalId));
    expect(stored.isCompleted).toBe(true);

    const detail = (await as(bob).get(`/api/goals/${goalId}`).expect(200)).body.data as Json;
    expect([detail.isCompleted, detail.completedAt, detail.status]).toEqual([null, null, null]);

    const listIds = async (query: string) =>
      ((await as(bob).get(`/api/goals${query}`).expect(200)).body.data as Json[]).map((goal) => goal.id);
    // A hidden goal reads the same whatever its stored completion: in the default list, never in a status filter.
    expect(await listIds("")).toContain(goalId);
    expect(await listIds("?status=completed&includeCompleted=true")).not.toContain(goalId);
    expect(await listIds("?status=on_track")).not.toContain(goalId);

    expect(await (async () => ((await as(alice).get("/api/goals?status=completed&includeCompleted=true").expect(200))
      .body.data as Json[]).map((goal) => goal.id))()).toContain(goalId);
  });
});

describe("A3: a contribution into a holdings-tracked goal follows its investment account", () => {
  it("hides a contribution into a private investment account from a member who cannot see it", async () => {
    const goalId = await makeGoal({
      type: "investment", goalType: "retirement", progressSource: "holdings", linkedAccountId: ids.privateBroker,
    });
    await as(alice).post(`/api/goals/${goalId}/contribute`, { amount: zmw("40.00"), notes: "Synthetic broker top-up" }).expect(201);

    const seen = (await as(bob).get(`/api/goals/${goalId}/contributions`).expect(200)).body.data as Json[];
    expect(seen).toEqual([]);
    const own = (await as(alice).get(`/api/goals/${goalId}/contributions`).expect(200)).body.data as Json[];
    expect(own).toHaveLength(1);
  });
});

describe("A5: a goal transfer never moves or discloses hidden progress", () => {
  it("refuses a transfer out of a goal whose progress the caller cannot see, the same way whatever the amount", async () => {
    const hidden = await hiddenGoal("100.00");
    const other = await makeGoal();
    const small = await as(bob).post("/api/goals/transfers", { fromGoalId: hidden, toGoalId: other, amount: zmw("10.00") });
    const large = await as(bob).post("/api/goals/transfers", { fromGoalId: hidden, toGoalId: other, amount: zmw("500.00") });
    expect([small.status, large.status]).toEqual([403, 403]);
    expect(small.body.error.message).toBe(large.body.error.message);
    expect(small.body.error.message).not.toMatch(/\d/);
    expect([await progress(hidden), await progress(other)]).toEqual(["100.00", "0.00"]);
  });

  it("redacts a hidden goal in the response to a transfer into it", async () => {
    const hidden = await hiddenGoal("100.00");
    const visible = await makeGoal({ currentAmount: "80.00" });
    const response = await as(bob).post("/api/goals/transfers", { fromGoalId: visible, toGoalId: hidden, amount: zmw("30.00"), confirmOverfund: true }).expect(201);
    const body = response.body.data as { fromGoal: Json; toGoal: Json };
    expect([body.toGoal.currentAmount, body.toGoal.progressAvailability]).toEqual([null, "unavailable"]);
    expect(body.fromGoal.currentAmount).toEqual(zmw("50.00"));
    expect(hiddenAmountValues(body, 130)).toEqual([]);
  });
});

describe("A6: whether an edit is accepted never depends on progress the editor cannot see", () => {
  it("refuses the same way an edit that would fit and one that would not, when the goal has a later transfer out", async () => {
    const goalId = await makeGoal();
    const bobIncome = await makeTransaction(bob, "income", "100.00", ids.shared);
    await as(bob).post(`/api/goals/${goalId}/transactions`, { transactionId: bobIncome, linkType: "contribution" }).expect(201);
    const aliceIncome = await makeTransaction(alice, "income", "30.00", ids.privateCash);
    await as(alice).post(`/api/goals/${goalId}/transactions`, { transactionId: aliceIncome, linkType: "contribution" }).expect(201);
    const other = await makeGoal();
    await as(alice).post("/api/goals/transfers", { fromGoalId: goalId, toGoalId: other, amount: zmw("120.00") }).expect(201);
    expect(await progress(goalId)).toBe("10.00");

    // 95 + 30 still covers the 120 sent; 50 + 30 does not. Bob cannot see the 30, so both answers must match.
    const fits = await as(bob).put(`/api/transactions/${bobIncome}`, { amount: zmw("95.00") });
    const short = await as(bob).put(`/api/transactions/${bobIncome}`, { amount: zmw("50.00") });
    expect([fits.status, short.status]).toEqual([409, 409]);
    expect(fits.body.error.message).toBe(short.body.error.message);
    expect(fits.body.error.message).not.toMatch(/\d/);
    const unlinked = await as(bob).delete(`/api/goals/${goalId}/transactions/${bobIncome}`);
    expect([unlinked.status, unlinked.body.error.message]).toEqual([409, fits.body.error.message]);
    expect(await progress(goalId)).toBe("10.00");

    // Alice can see every source, so her edit is judged on the amounts.
    await as(alice).put(`/api/transactions/${aliceIncome}`, { amount: zmw("25.00") }).expect(200);
    expect(await progress(goalId)).toBe("5.00");
  });
});
