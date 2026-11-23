/**
 * #245 review, Astra round 2: a contribution paid from an account is one write.
 * `POST /api/goals/:id/contributions/from-account` creates the expense and its
 * contribution link in one transaction, so a refused link commits nothing and a
 * retry cannot leave a second expense. Real HTTP against real Postgres.
 *
 * Alice (owner) holds a shared ZMW account, a shared USD account, a shared
 * SCR account with no rate to ZMW, and a private ZMW account; Bob is a member.
 * The household's USD→ZMW rate for the source date is 20.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, like } from "drizzle-orm";
import {
  accounts, auditLogs, goals, householdFxRateOverrides, householdMembers, households, notifications,
  transactionGoalLinks, transactions, users,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";

type Member = { id: string; cookie: string };

const password = "SyntheticAccountContribution123!";
const householdId = randomUUID();
const ids = { zmw: randomUUID(), usd: randomUUID(), scr: randomUUID(), alicePrivate: randomUUID() };
const SOURCE_DATE = "2026-10-15";
let app: Awaited<ReturnType<typeof getTestApp>>;
let alice: Member;
let bob: Member;

async function addMember(role: "owner" | "member"): Promise<Member> {
  const id = randomUUID();
  const email = `goal-acct-${id}@example.invalid`;
  await db.insert(users).values({ id, email, username: `goal-acct-${id}`, passwordHash: await hashPassword(password), emailVerified: true });
  await db.insert(householdMembers).values({ householdId, userId: id, role });
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") };
}

async function seed() {
  await db.insert(households).values({ id: householdId, name: "Synthetic account contribution household", currency: "ZMW" });
  alice = await addMember("owner");
  bob = await addMember("member");
  await db.insert(accounts).values([
    { id: ids.zmw, householdId, name: "Synthetic ZMW current", type: "checking", currency: "ZMW", initialBalance: "5000.00", balance: "5000.00" },
    { id: ids.usd, householdId, name: "Synthetic USD current", type: "checking", currency: "USD", initialBalance: "500.00", balance: "500.00" },
    { id: ids.scr, householdId, name: "Synthetic SCR current", type: "checking", currency: "SCR", initialBalance: "500.00", balance: "500.00" },
    { id: ids.alicePrivate, householdId, name: "Synthetic private ZMW", type: "checking", currency: "ZMW", initialBalance: "5000.00", balance: "5000.00", isPrivate: true, ownerUserId: alice.id },
  ]);
  await db.insert(householdFxRateOverrides).values({
    householdId, actorUserId: alice.id, fromCurrency: "USD", toCurrency: "ZMW",
    effectiveDate: "2026-10-01", validThrough: "2026-10-31", rate: "20",
  });
}

async function teardown() {
  await db.delete(notifications).where(eq(notifications.householdId, householdId));
  await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
  await db.delete(goals).where(eq(goals.householdId, householdId));
  await db.delete(householdFxRateOverrides).where(eq(householdFxRateOverrides.householdId, householdId));
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

async function makeGoal(currentAmount: string) {
  const id = randomUUID();
  await db.insert(goals).values({
    id, householdId, name: `Synthetic goal ${id.slice(0, 8)}`, type: "save_up", goalType: "other", currency: "ZMW",
    targetAmount: "1000.00", currentAmount,
  });
  return id;
}

const contribute = (goalId: string, body: Record<string, unknown>, member: Member = alice) =>
  request(app).post(`/api/goals/${goalId}/contributions/from-account`).set("Cookie", member.cookie)
    .send({ date: SOURCE_DATE, ...body });

const nothingWritten = { expenses: [], links: 0, linkAudits: 0, currentAmount: "0.00" };

/** Everything the contribution could have written for this goal. */
async function writtenFor(goalId: string) {
  const expenses = await db.select({ id: transactions.id, amount: transactions.amount, accountId: transactions.accountId })
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), like(transactions.name, `%[goal:${goalId}]%`)));
  const links = await db.select({ id: transactionGoalLinks.id }).from(transactionGoalLinks)
    .where(eq(transactionGoalLinks.goalId, goalId));
  const linkAudits = await db.select({ id: auditLogs.id }).from(auditLogs)
    .where(and(eq(auditLogs.entityId, goalId), eq(auditLogs.action, "LINK")));
  const [goal] = await db.select({ currentAmount: goals.currentAmount }).from(goals).where(eq(goals.id, goalId));
  return { expenses, links: links.length, linkAudits: linkAudits.length, currentAmount: goal.currentAmount };
}

const balance = async (accountId: string) =>
  (await db.select({ balance: accounts.balance }).from(accounts).where(eq(accounts.id, accountId)))[0].balance;

beforeAll(async () => {
  app = await getTestApp();
  await seed();
}, 60_000);

afterAll(teardown);

describe("A contribution from an account is the expense and its link, together or not at all", () => {
  it("refuses a cross-currency overfund with nothing written, then a confirmed retry records one expense, one link, one audit row", async () => {
    const goalId = await makeGoal("900.00");
    // USD 10 at 20 ZMW/USD is ZMW 200: past the ZMW 1,000 target, though 900 + 10 is not.
    const body = { accountId: ids.usd, amount: { amount: "10.00", currency: "USD" }, idempotencyKey: randomUUID() };

    const refused = await contribute(goalId, body);
    expect([refused.status, refused.body.error?.message]).toEqual([409, expect.stringContaining("Confirm overfunding")]);
    expect(await writtenFor(goalId)).toEqual({ expenses: [], links: 0, linkAudits: 0, currentAmount: "900.00" });
    expect(await balance(ids.usd)).toBe("500.00");

    const confirmed = await contribute(goalId, { ...body, confirmOverfund: true });
    expect(confirmed.status).toBe(201);
    const written = await writtenFor(goalId);
    expect(written).toMatchObject({ links: 1, linkAudits: 1, currentAmount: "1100.00" });
    expect(written.expenses).toEqual([{ id: confirmed.body.data.transactionId, amount: "10.00", accountId: ids.usd }]);
    expect(await balance(ids.usd)).toBe("490.00");
    const createAudits = await db.select({ id: auditLogs.id }).from(auditLogs).where(and(
      eq(auditLogs.entityId, confirmed.body.data.transactionId), eq(auditLogs.action, "CREATE"),
    ));
    expect(createAudits).toHaveLength(1);
  });

  it("replays a repeated key instead of recording a second expense, also when the two submits race", async () => {
    const goalId = await makeGoal("0.00");
    const body = { accountId: ids.zmw, amount: { amount: "50.00", currency: "ZMW" }, idempotencyKey: randomUUID() };

    const [first, second] = await Promise.all([contribute(goalId, body), contribute(goalId, body)]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(first.body.data.transactionId).toBe(second.body.data.transactionId);
    const again = await contribute(goalId, body);
    expect([again.status, again.body.data.replayed]).toEqual([200, true]);

    const written = await writtenFor(goalId);
    expect([written.expenses.length, written.links, written.linkAudits, written.currentAmount]).toEqual([1, 1, 1, "50.00"]);
    expect(await balance(ids.zmw)).toBe("4950.00");
  });

  it("refuses a key already used for another goal, and writes nothing for it", async () => {
    const [used, other] = [await makeGoal("0.00"), await makeGoal("0.00")];
    const body = { accountId: ids.zmw, amount: { amount: "5.00", currency: "ZMW" }, idempotencyKey: randomUUID() };
    await contribute(used, body).expect(201);
    const reused = await contribute(other, body);
    expect(reused.status).toBe(409);
    expect(await writtenFor(other)).toEqual({ expenses: [], links: 0, linkAudits: 0, currentAmount: "0.00" });
  });

  it("replays a key whose link was removed since, from the expense's sealed create intent (Astra round 3)", async () => {
    const goalId = await makeGoal("0.00");
    const body = { accountId: ids.zmw, amount: { amount: "7.00", currency: "ZMW" }, idempotencyKey: randomUUID() };
    const first = await contribute(goalId, body).expect(201);
    const transactionId = first.body.data.transactionId as string;
    await request(app).delete(`/api/goals/${goalId}/transactions/${transactionId}`).set("Cookie", alice.cookie).expect(200);
    const before = await balance(ids.zmw);

    const retry = await contribute(goalId, body);
    expect([retry.status, retry.body.data?.transactionId, retry.body.data?.replayed]).toEqual([200, transactionId, true]);
    const written = await writtenFor(goalId);
    expect([written.expenses.map(({ id }) => id), written.links]).toEqual([[transactionId], 0]);
    expect(await balance(ids.zmw)).toBe(before);
  });

  it("refuses a key that an ordinary transaction already holds", async () => {
    const goalId = await makeGoal("0.00");
    const idempotencyKey = randomUUID();
    await request(app).post("/api/transactions").set("Cookie", alice.cookie).send({
      accountId: ids.zmw, type: "expense", amount: { amount: "3.00", currency: "ZMW" }, date: SOURCE_DATE,
      name: "Synthetic ordinary expense", idempotencyKey,
    }).expect(201);
    const reused = await contribute(goalId, { accountId: ids.zmw, amount: { amount: "3.00", currency: "ZMW" }, idempotencyKey });
    expect(reused.status).toBe(409);
    expect(await writtenFor(goalId)).toEqual({ expenses: [], links: 0, linkAudits: 0, currentAmount: "0.00" });
  });

  it("refuses a key resent with another amount, account, date, category or reason, and writes nothing more", async () => {
    const goalId = await makeGoal("0.00");
    const body = { accountId: ids.zmw, amount: { amount: "4.00", currency: "ZMW" }, idempotencyKey: randomUUID() };
    const first = await contribute(goalId, body).expect(201);
    const before = await balance(ids.zmw);
    const changed = [
      { ...body, amount: { amount: "40.00", currency: "ZMW" } },
      { ...body, accountId: ids.usd, amount: { amount: "4.00", currency: "USD" } },
      { ...body, date: "2026-10-16" },
      // Astra round 4: a category would have counted the expense in the budget.
      { ...body, categoryId: randomUUID() },
      { ...body, reason: "Synthetic other reason" },
    ];
    for (const resent of changed) expect((await contribute(goalId, resent)).status).toBe(409);
    const written = await writtenFor(goalId);
    expect([written.expenses.map(({ id }) => id), written.links, written.currentAmount])
      .toEqual([[first.body.data.transactionId], 1, "4.00"]);
    expect(await balance(ids.zmw)).toBe(before);
  });

  it("refuses Bob a key Alice already used, and writes nothing for him", async () => {
    const goalId = await makeGoal("0.00");
    const body = { accountId: ids.zmw, amount: { amount: "6.00", currency: "ZMW" }, idempotencyKey: randomUUID() };
    await contribute(goalId, body).expect(201);
    const before = await balance(ids.zmw);
    expect((await contribute(goalId, body, bob)).status).toBe(409);
    expect((await writtenFor(goalId)).expenses).toHaveLength(1);
    expect(await balance(ids.zmw)).toBe(before);
  });

  it("gives Bob a 404 for Alice's private account, with nothing written", async () => {
    const goalId = await makeGoal("0.00");
    const refused = await contribute(goalId, {
      accountId: ids.alicePrivate, amount: { amount: "5.00", currency: "ZMW" }, idempotencyKey: randomUUID(),
    }, bob);
    expect(refused.status).toBe(404);
    expect(await writtenFor(goalId)).toEqual(nothingWritten);
    expect(await balance(ids.alicePrivate)).toBe("5000.00");
  });

  it("refuses with a 422 when no rate converts the account's currency to the goal's, with nothing written", async () => {
    const goalId = await makeGoal("0.00");
    const refused = await contribute(goalId, {
      accountId: ids.scr, amount: { amount: "5.00", currency: "SCR" }, idempotencyKey: randomUUID(),
    });
    expect(refused.status).toBe(422);
    expect(await writtenFor(goalId)).toEqual(nothingWritten);
    expect(await balance(ids.scr)).toBe("500.00");
  });

  it("asks Bob to confirm a contribution to a goal whose progress he cannot see, revealing nothing and writing nothing", async () => {
    const goalId = await makeGoal("0.00");
    // Alice's private account feeds the goal, so Bob cannot see all of its progress.
    await contribute(goalId, { accountId: ids.alicePrivate, amount: { amount: "10.00", currency: "ZMW" }, idempotencyKey: randomUUID() })
      .expect(201);
    const before = await writtenFor(goalId);
    const body = { accountId: ids.zmw, amount: { amount: "5.00", currency: "ZMW" }, idempotencyKey: randomUUID() };
    const refused = await contribute(goalId, body, bob);
    expect([refused.status, refused.body.error?.message]).toEqual([409, expect.stringContaining("sources you cannot see")]);
    expect(refused.body.error.message).not.toMatch(/\d/);
    expect(await writtenFor(goalId)).toEqual(before);
    // The owner's rule: with that confirmation the contribution is recorded.
    await contribute(goalId, { ...body, confirmOverfund: true }, bob).expect(201);
  });

  it("refuses an amount in another currency than the account's, before writing", async () => {
    const goalId = await makeGoal("0.00");
    const refused = await contribute(goalId, { accountId: ids.zmw, amount: { amount: "5.00", currency: "USD" }, idempotencyKey: randomUUID() });
    expect(refused.status).toBe(400);
    expect(await writtenFor(goalId)).toEqual({ expenses: [], links: 0, linkAudits: 0, currentAmount: "0.00" });
  });
});
