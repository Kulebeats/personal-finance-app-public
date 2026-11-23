/**
 * FIN-01 / OPS-005 / GOAL (misc): one member's private data never reaches the
 * other members through the goal activity log, the goal readers, the cash-flow
 * forecast (and its export), or the "recurring due" notice.
 *
 * Alice owns a private account, a private transaction, and a recurring rule on
 * her private account. A shared goal draws its progress from her private
 * account. Bob is a member of the same household. Every assertion goes through
 * a real HTTP request against real Postgres; nothing is mocked.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { parse } from "csv-parse/sync";
import {
  accounts, auditLogs, categories, dataExports, goalAccountAssignments, goalActivityLog, goalContributions, goals,
  householdMembers, households, notifications, recurringTransactions, transactions, users,
} from "@shared/schema";
import { db, pool } from "../db";
import { hashPassword } from "../auth";
import { postCronDoor } from "./cron-door-fixture";
import { getTestApp } from "./fixtures";

type Member = "alice" | "bob";
type Logins = Map<Member, { id: string; cookie: string }>;
type Json = Record<string, unknown>;

const password = "SyntheticPrivacyLeftovers123!";
const CRON_SECRET = "synthetic-privacy-leftovers-cron";
const DAY_MS = 86_400_000;
let app: Awaited<ReturnType<typeof getTestApp>>;

/** UTC calendar date `days` from now; the reminder cron compares against UTC midnight. */
function utcDate(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

/** First and last day of the current UTC month, so the forecast starts next month. */
function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

async function seedHousehold(householdId: string): Promise<Logins> {
  await db.insert(households).values({ id: householdId, name: "Synthetic privacy household", currency: "ZMW" });
  const passwordHash = await hashPassword(password);
  const logins: Logins = new Map();
  for (const member of ["alice", "bob"] as const) {
    const id = randomUUID();
    const email = `privacy-leftovers-${id}@example.invalid`;
    await db.insert(users).values({ id, email, username: `privacy-leftovers-${id}`, passwordHash, emailVerified: true });
    await db.insert(householdMembers).values({ householdId, userId: id, role: member === "alice" ? "owner" : "member" });
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    logins.set(member, { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") });
  }
  return logins;
}

async function removeHousehold(householdId: string, logins: Logins | undefined) {
  const userIds = logins ? [...logins.values()].map(({ id }) => id) : [];
  if (userIds.length) await db.delete(notifications).where(inArray(notifications.userId, userIds));
  await db.delete(dataExports).where(eq(dataExports.householdId, householdId));
  await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
  await db.delete(goals).where(eq(goals.householdId, householdId));
  await db.delete(recurringTransactions).where(eq(recurringTransactions.householdId, householdId));
  await db.delete(transactions).where(eq(transactions.householdId, householdId));
  await db.delete(categories).where(eq(categories.householdId, householdId));
  await db.delete(accounts).where(eq(accounts.householdId, householdId));
  await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
  await db.delete(households).where(eq(households.id, householdId));
  for (const id of userIds) {
    await db.delete(auditLogs).where(eq(auditLogs.userId, id));
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [id]);
    await db.delete(users).where(eq(users.id, id));
  }
}

function get(logins: Logins, member: Member, path: string) {
  return request(app).get(path).set("Cookie", logins.get(member)!.cookie);
}

function expectNoneOf(body: unknown, secrets: readonly string[]) {
  const text = JSON.stringify(body);
  for (const secret of secrets) expect(text).not.toContain(secret);
}

async function runReminderCron() {
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  try {
    expect((await postCronDoor(app, "recurring-reminders", CRON_SECRET)).status).toBe(200);
  } finally {
    vi.unstubAllEnvs();
  }
}

async function noticesFor(userId: string, ruleId: string) {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
  return rows.filter(row => (row.metadata as Json | null)?.recurringId === ruleId);
}

beforeAll(async () => {
  app = await getTestApp();
});

describe("FIN-01 / OPS-005 a member's private sources stay hidden from the other members", () => {
  const householdId = randomUUID();
  const ids = {
    sharedAccount: randomUUID(), privateAccount: randomUUID(), category: randomUUID(),
    privateTxn: randomUUID(), privateAccountTxn: randomUUID(), rule: randomUUID(),
    hiddenGoal: randomUUID(), visibleGoal: randomUUID(), debtAccount: randomUUID(), debtGoal: randomUUID(),
  };
  const names = {
    privateAccount: "Alice hidden savings", privateTxn: "Alice hidden payment",
    privateAccountTxn: "Alice hidden groceries", rule: "Alice hidden subscription", debtAccount: "Alice hidden card",
  };
  const amounts = {
    balance: "13579.24", previous: "12715.04", txn: "864.20", accountTxn: "531.00", rule: "246.80", debt: "4321.09",
  };
  const range = currentMonthRange();
  let members: Logins;
  let secrets: string[];

  beforeAll(async () => {
    members = await seedHousehold(householdId);
    const aliceId = members.get("alice")!.id;
    await db.insert(accounts).values([
      { id: ids.sharedAccount, householdId, name: "Shared current", type: "checking", currency: "ZMW",
        initialBalance: "1000.00", balance: "1000.00", isPrivate: false, ownerUserId: null },
      { id: ids.privateAccount, householdId, name: names.privateAccount, type: "savings", currency: "ZMW",
        initialBalance: amounts.balance, balance: amounts.balance, isPrivate: true, ownerUserId: aliceId },
      { id: ids.debtAccount, householdId, name: names.debtAccount, type: "credit", currency: "ZMW",
        initialBalance: amounts.debt, balance: amounts.debt, isPrivate: true, ownerUserId: aliceId },
    ]);
    await db.insert(categories).values({ id: ids.category, householdId, name: "Synthetic household costs", displayOrder: 0 });
    await db.insert(transactions).values([
      // Private by its own flag, on the Shared account.
      { id: ids.privateTxn, householdId, accountId: ids.sharedAccount, categoryId: ids.category, type: "expense",
        currency: "ZMW", date: range.from, amount: amounts.txn, name: names.privateTxn, isPrivate: true, ownerUserId: aliceId },
      // Not flagged private, but on Alice's private account.
      { id: ids.privateAccountTxn, householdId, accountId: ids.privateAccount, categoryId: ids.category, type: "expense",
        currency: "ZMW", date: range.from, amount: amounts.accountTxn, name: names.privateAccountTxn, isPrivate: false, ownerUserId: aliceId },
    ]);
    await db.insert(recurringTransactions).values({
      id: ids.rule, householdId, accountId: ids.privateAccount, name: names.rule, amount: amounts.rule,
      type: "expense", frequency: "monthly", startDate: utcDate(3), nextDueDate: utcDate(3),
      reminderDays: 3, detectionMethod: "manual", isActive: true, isPaused: false,
    });
    await db.insert(goals).values([
      { id: ids.hiddenGoal, householdId, name: "Family holiday", type: "save_up", goalType: "other", targetAmount: "50000.00",
        currentAmount: amounts.balance, currency: "ZMW", linkedAccountId: ids.privateAccount },
      { id: ids.visibleGoal, householdId, name: "Shared emergency fund", type: "save_up", goalType: "other",
        targetAmount: "1000.00", currentAmount: "250.00", currency: "ZMW" },
      // Its progress is the balance of Alice's private card.
      { id: ids.debtGoal, householdId, name: "Clear the card", type: "pay_down", goalType: "credit_card",
        targetAmount: "5000.00", originalBalance: "5000.00", currentAmount: amounts.debt, currency: "ZMW",
        debtAccountId: ids.debtAccount, interestRate: "18.99", minimumPayment: "150.00", monthlyPayment: "400.00" },
    ]);
    await db.insert(goalContributions).values([
      { goalId: ids.hiddenGoal, amount: amounts.txn, date: range.from, transactionId: ids.privateTxn },
      { goalId: ids.hiddenGoal, amount: "125.00", date: range.from, notes: "Shared top-up" },
    ]);
    await db.insert(goalAccountAssignments).values({
      goalId: ids.hiddenGoal, accountId: ids.privateAccount, assignmentType: "full_balance", autoUpdate: true,
    });
    await db.insert(goalActivityLog).values([
      { goalId: ids.hiddenGoal, activityType: "goal_created", createdAt: new Date("2026-10-01T09:00:00Z") },
      { goalId: ids.hiddenGoal, activityType: "transaction_linked", amount: amounts.txn, previousBalance: amounts.previous,
        newBalance: amounts.balance, metadata: { transactionId: ids.privateTxn }, createdAt: new Date("2026-10-02T09:00:00Z") },
      { goalId: ids.hiddenGoal, activityType: "balance_synced", amount: amounts.balance, newBalance: amounts.balance,
        metadata: { accountId: ids.privateAccount }, createdAt: new Date("2026-10-03T09:00:00Z") },
    ]);
    secrets = [
      ids.privateAccount, ids.privateTxn, ids.privateAccountTxn, ids.rule, ids.debtAccount, amounts.debt,
      ...Object.values(names), amounts.balance, amounts.previous, amounts.txn, amounts.accountTxn, amounts.rule,
    ];
  }, 30_000);

  afterAll(() => removeHousehold(householdId, members));

  describe("goal activity log", () => {
    const path = () => `/api/goals/${ids.hiddenGoal}/activity`;

    it("shows Bob only the entry that names no hidden source, without running balances", async () => {
      const response = await get(members, "bob", path()).expect(200);
      expect(response.body.data.map((entry: Json) => entry.activityType)).toEqual(["goal_created"]);
      expectNoneOf(response.body, secrets);
    });

    it("still shows Alice every entry with its amounts", async () => {
      const response = await get(members, "alice", path()).expect(200);
      expect(response.body.data.map((entry: Json) => entry.activityType))
        .toEqual(["balance_synced", "transaction_linked", "goal_created"]);
      expect(response.body.data[1]).toMatchObject({
        amount: amounts.txn, previousBalance: amounts.previous, newBalance: amounts.balance,
        metadata: { transactionId: ids.privateTxn },
      });
    });
  });

  describe("goal detail, list, summary and projection", () => {
    it("withholds the hidden goal's progress and private account from Bob on the detail", async () => {
      const response = await get(members, "bob", `/api/goals/${ids.hiddenGoal}`).expect(200);
      expect(response.body.data).toMatchObject({
        id: ids.hiddenGoal, name: "Family holiday", targetAmount: { amount: "50000.00", currency: "ZMW" },
        currentAmount: null, progressAvailability: "unavailable", linkedAccountId: null, debtAccountId: null,
        percentComplete: null, remaining: null, status: null, assignments: [],
      });
      expectNoneOf(response.body, secrets);
    });

    it("still shows Alice the hidden goal's progress and account", async () => {
      const response = await get(members, "alice", `/api/goals/${ids.hiddenGoal}`).expect(200);
      expect(response.body.data).toMatchObject({
        currentAmount: { amount: amounts.balance, currency: "ZMW" }, progressAvailability: "available",
        linkedAccountId: ids.privateAccount,
      });
      expect(response.body.data.assignments).toEqual([expect.objectContaining({ accountId: ids.privateAccount })]);
    });

    it("lists both goals for Bob, with progress only where every source is visible", async () => {
      const response = await get(members, "bob", "/api/goals").expect(200);
      const byId = new Map<string, Json>(response.body.data.map((goal: Json) => [goal.id as string, goal]));
      expect(byId.get(ids.hiddenGoal)).toMatchObject({ currentAmount: null, progressAvailability: "unavailable", linkedAccountId: null });
      expect(byId.get(ids.visibleGoal)).toMatchObject({
        currentAmount: { amount: "250.00", currency: "ZMW" }, progressAvailability: "available",
      });
      expectNoneOf(response.body, secrets);
    });

    it("totals only Bob-visible progress on the summary and drops hidden activity", async () => {
      const bob = await get(members, "bob", "/api/goals/summary").expect(200);
      // R10.3 / NEW-35: summary money fields are MoneyDto in the household currency.
      expect(bob.body.data.saveUp).toMatchObject({ total: 2,
        totalSaved: { amount: "250.00", currency: "ZMW" }, totalTarget: { amount: "1000.00", currency: "ZMW" } });
      expect(bob.body.data.recentActivity.map((entry: Json) => entry.activityType)).toEqual(["goal_created"]);
      expectNoneOf(bob.body, secrets);
      const alice = await get(members, "alice", "/api/goals/summary").expect(200);
      expect(alice.body.data.saveUp).toMatchObject({ total: 2,
        totalSaved: { amount: "13829.24", currency: "ZMW" }, totalTarget: { amount: "51000.00", currency: "ZMW" } });
    });

    it("returns no projection for Bob on the hidden goal", async () => {
      const response = await get(members, "bob", `/api/goals/${ids.hiddenGoal}/projection`).expect(200);
      // NEW-15: the same constant body a visible goal gets when a price or rate its
      // valuation needs is missing (completion-new15), so it tells Bob nothing about the goal.
      expect(response.body.data).toEqual({
        availability: "unavailable", monthlyProjection: null, projectedCompletionDate: null, status: null, monthsRemaining: null,
      });
      expectNoneOf(response.body, secrets);
    });
  });

  describe("payoff calculations and contributions", () => {
    const payoffBody = { monthlyPayment: 400 };

    it("gives Bob no payoff figures derived from Alice's private card balance", async () => {
      const scenarios = await get(members, "bob", `/api/goals/${ids.debtGoal}/payoff-scenarios`).expect(200);
      expect(scenarios.body).toEqual({ success: true, data: null });
      const payoff = await request(app).post(`/api/goals/${ids.debtGoal}/calculate-payoff`)
        .set("Cookie", members.get("bob")!.cookie).send(payoffBody).expect(200);
      expect(payoff.body).toEqual({ success: true, data: null });
    });

    it("still gives Alice her payoff figures", async () => {
      const scenarios = await get(members, "alice", `/api/goals/${ids.debtGoal}/payoff-scenarios`).expect(200);
      expect(scenarios.body.data).toEqual(expect.objectContaining({ current: expect.any(Object), minimum: expect.any(Object) }));
      const payoff = await request(app).post(`/api/goals/${ids.debtGoal}/calculate-payoff`)
        .set("Cookie", members.get("alice")!.cookie).send(payoffBody).expect(200);
      expect(payoff.body.data).toEqual(expect.objectContaining({ monthlyPayment: 400, monthsToPayoff: expect.any(Number) }));
      expect(payoff.body.data.monthsToPayoff).toBeGreaterThan(0);
    });

    it("lists only contributions whose source Bob can see", async () => {
      const response = await get(members, "bob", `/api/goals/${ids.hiddenGoal}/contributions`).expect(200);
      expect(response.body.data).toEqual([expect.objectContaining({ amount: "125.00", transactionId: null })]);
      expectNoneOf(response.body, secrets);
    });

    it("still lists Alice's contribution from her private transaction", async () => {
      const response = await get(members, "alice", `/api/goals/${ids.hiddenGoal}/contributions`).expect(200);
      expect(response.body.data.map((row: Json) => row.transactionId).sort())
        .toEqual([ids.privateTxn, null].sort());
    });
  });

  describe("cash-flow forecast and its export", () => {
    const forecastQuery = () => ({ ...range, interval: "month", includeForecast: "true", forecastMonths: "3" });
    const forecastPoints = (body: { data: { series: Json[] } }) => body.data.series.filter(point => point.isForecast === true);

    it("projects none of Alice's private rule or private-account spending for Bob", async () => {
      const response = await get(members, "bob", "/api/reports/cashflow").query(forecastQuery()).expect(200);
      const points = forecastPoints(response.body);
      expect(points).toHaveLength(3);
      for (const point of points) expect(point.expenses).toEqual({ amount: "0.00", currency: "ZMW" });
      expectNoneOf(points, secrets);
    });

    it("still projects Alice's own rule for Alice", async () => {
      const response = await get(members, "alice", "/api/reports/cashflow").query(forecastQuery()).expect(200);
      const points = forecastPoints(response.body);
      expect(points).toHaveLength(3);
      for (const point of points) expect(point.expenses).toEqual({ amount: amounts.rule, currency: "ZMW" });
    });

    it("exports Bob's forecast without Alice's private amounts", async () => {
      const created = await request(app).post("/api/reports/exports").set("Cookie", members.get("bob")!.cookie).send({
        reportType: "cashflow", format: "csv", startDate: range.from, endDate: range.to, scope: "mine",
        interval: "month", includePending: false, includeTransfers: false, includeForecast: true, forecastMonths: 3,
      }).expect(200);
      const download = await get(members, "bob", `/api/reports/exports/${created.body.data.id}?download=true`).expect(200);
      const rows = parse(download.text, { columns: true, skip_empty_lines: true, record_delimiter: "\n" }) as Json[];
      // The export does not yet pass includeForecast to the repository, so it
      // emits no forecast rows today (separate follow-up). Whatever forecast it
      // emits must still be the reader's own.
      const forecastRows = rows.filter(row => row.dataType === "forecast");
      for (const row of forecastRows) expect(row.expenses).toBe("0.00");
      expect(rows.length).toBeGreaterThan(0);
      expectNoneOf(download.text, secrets);
    });
  });

  describe("recurring due notice", () => {
    it("reaches only Alice, who can see her private rule", async () => {
      await runReminderCron();
      expect(await noticesFor(members.get("bob")!.id, ids.rule)).toEqual([]);
      const bobNotices = await db.select().from(notifications).where(eq(notifications.userId, members.get("bob")!.id));
      expectNoneOf(bobNotices, secrets);
      const [notice] = await noticesFor(members.get("alice")!.id, ids.rule);
      expect(notice).toMatchObject({ type: "recurring_due", title: `Upcoming: ${names.rule}` });
      expect(notice.body).toContain(new Intl.NumberFormat("en-ZM", { style: "currency", currency: "ZMW" }).format(246.8));
    });
  });
});

describe("OPS-005 the recurring due notice is formatted in the rule's own currency", () => {
  const householdId = randomUUID();
  const accountId = randomUUID();
  const ruleId = randomUUID();
  let members: Logins;

  beforeAll(async () => {
    members = await seedHousehold(householdId);
    await db.insert(accounts).values({
      id: accountId, householdId, name: "Alice dollar account", type: "checking", currency: "USD",
      initialBalance: "0.00", balance: "0.00", isPrivate: true, ownerUserId: members.get("alice")!.id,
    });
    await db.insert(recurringTransactions).values({
      id: ruleId, householdId, accountId, name: "Alice dollar plan", amount: "75.50", type: "expense",
      frequency: "monthly", startDate: utcDate(3), nextDueDate: utcDate(3), reminderDays: 3,
      detectionMethod: "manual", isActive: true, isPaused: false,
    });
  }, 30_000);

  afterAll(() => removeHousehold(householdId, members));

  it("tells Alice the amount in USD and tells Bob nothing", async () => {
    await runReminderCron();
    const [notice] = await noticesFor(members.get("alice")!.id, ruleId);
    const usd = new Intl.NumberFormat("en-ZM", { style: "currency", currency: "USD" }).format(75.5);
    const zmw = new Intl.NumberFormat("en-ZM", { style: "currency", currency: "ZMW" }).format(75.5);
    expect(notice.body).toContain(usd);
    expect(notice.body).not.toContain(zmw);
    expect(notice.metadata).toMatchObject({ recurringId: ruleId, amount: "75.50", currency: "USD" });
    expect(await noticesFor(members.get("bob")!.id, ruleId)).toEqual([]);
  });
});
