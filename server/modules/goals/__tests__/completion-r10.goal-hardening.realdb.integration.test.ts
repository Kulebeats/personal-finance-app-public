/**
 * R10.3 follow-up (#192 review): goal progress stays exact and private under edits and races.
 *
 * Each case reproduces one review finding over real HTTP against real Postgres.
 * The races hold a row lock in a separate database transaction, wait until the
 * request is queued behind it, change the row, and commit, so the request runs
 * on exactly the interleaving the finding describes. Nothing is mocked.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import {
  accounts, auditLogs, goalAccountAssignments, goalContributions, goals, householdFxRateOverrides, householdMembers,
  households, transactionGoalLinks, transactions, users,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { transactionGoalLinkService } from "../../../services/TransactionGoalLinkService";
import { withTransaction, type TransactionType } from "../../../utils/withTransaction";

type Json = Record<string, unknown>;
type Member = { id: string; cookie: string };

const password = "SyntheticGoalHardening123!";
const householdId = randomUUID();
const ids = { checking: randomUUID(), savings: randomUUID(), dollars: randomUUID() };
const SOURCE_DATE = "2026-10-15";
let app: Awaited<ReturnType<typeof getTestApp>>;
let alice: Member;
let bob: Member;

const zmw = (amount: string) => ({ amount, currency: "ZMW" });

async function addMember(role: "owner" | "member"): Promise<Member> {
  const id = randomUUID();
  const email = `goal-hardening-${id}@example.invalid`;
  await db.insert(users).values({ id, email, username: `goal-hardening-${id}`, passwordHash: await hashPassword(password), emailVerified: true });
  await db.insert(householdMembers).values({ householdId, userId: id, role });
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") };
}

async function seed() {
  await db.insert(households).values({ id: householdId, name: "Synthetic goal hardening household", currency: "ZMW" });
  alice = await addMember("owner");
  bob = await addMember("member");
  await db.insert(accounts).values([
    { id: ids.checking, householdId, name: "Synthetic current", type: "checking", currency: "ZMW", initialBalance: "10000.00", balance: "10000.00" },
    { id: ids.savings, householdId, name: "Synthetic savings", type: "savings", currency: "ZMW", initialBalance: "500.00", balance: "500.00" },
    { id: ids.dollars, householdId, name: "Synthetic dollars", type: "checking", currency: "USD", initialBalance: "1000.00", balance: "1000.00" },
  ]);
  await db.insert(householdFxRateOverrides).values({
    householdId, actorUserId: alice.id, fromCurrency: "USD", toCurrency: "ZMW",
    effectiveDate: "2026-10-01", validThrough: "2026-10-31", rate: "25.5",
  });
}

async function teardown() {
  await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
  await db.delete(goals).where(eq(goals.householdId, householdId));
  await db.delete(householdFxRateOverrides).where(eq(householdFxRateOverrides.householdId, householdId));
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
  post: (path: string, body: object = {}) => request(app).post(path).set("Cookie", member.cookie).send(body),
  put: (path: string, body: object) => request(app).put(path).set("Cookie", member.cookie).send(body),
});

async function makeGoal(options: { current?: string; target?: string } = {}) {
  const id = randomUUID();
  await db.insert(goals).values({
    id, householdId, name: `Synthetic goal ${id.slice(0, 8)}`, type: "save_up", goalType: "other", currency: "ZMW",
    targetAmount: options.target ?? "1000.00", currentAmount: options.current ?? "0.00", spendingReducesProgress: true,
  });
  return id;
}

async function makeTransaction(type: "income" | "expense", amount: string, accountId = ids.checking, currency = "ZMW") {
  const response = await as(alice).post("/api/transactions", {
    accountId, type, amount: { amount, currency }, date: SOURCE_DATE, name: `Synthetic ${type} ${amount}`,
  }).expect(201);
  return (response.body.data as { id: string }).id;
}

async function progress(goalId: string): Promise<string> {
  const [goal] = await db.select({ currentAmount: goals.currentAmount }).from(goals).where(eq(goals.id, goalId));
  return goal.currentAmount;
}

/** Sum of the deltas the goal's links and contributions say they applied, in cents. */
async function storedDeltaCents(goalId: string): Promise<number> {
  const { rows } = await pool.query<{ cents: string }>(`SELECT (
    COALESCE((SELECT SUM(applied_delta) FROM transaction_goal_links WHERE goal_id = $1 AND link_type = 'spending'), 0) +
    COALESCE((SELECT SUM(applied_delta) FROM goal_contributions WHERE goal_id = $1), 0)) * 100 AS cents`, [goalId]);
  return Number.parseInt(rows[0].cents, 10);
}

function link(member: Member, goalId: string, body: object) {
  return as(member).post(`/api/goals/${goalId}/transactions`, body);
}

/**
 * Runs `hold` in its own database transaction, starts `request` once `hold`
 * holds its locks, waits until the request is blocked behind this
 * transaction, then lets `afterQueued` change rows before the commit.
 */
async function raceBehindLock<T>(
  hold: (tx: TransactionType) => Promise<void>,
  start: () => Promise<T>,
  afterQueued: (tx: TransactionType) => Promise<void> = async () => undefined,
): Promise<{ result: T; queued: boolean; holder: string }> {
  let pending: Promise<T> | undefined;
  let queued = false;
  // withTransaction, as production writers use: a milestone waits for its commit (#235 R3-1).
  const holder = await withTransaction(async (tx) => {
    await hold(tx);
    const pid = (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
    pending = start();
    for (let i = 0; i < 200 && !queued; i++) {
      const { rows } = await pool.query<{ blocked: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked", [pid],
      );
      queued = rows[0].blocked;
      if (!queued) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await afterQueued(tx);
  }).then(() => "committed", (error: { code?: string }) => error.code ?? "failed");
  return { result: await pending!, queued, holder };
}

beforeAll(async () => {
  app = await getTestApp();
  await seed();
}, 30_000);

afterAll(teardown);

describe("P1-1 editing a linked source applies one net change", () => {
  it("a date-only edit after a spend used the progress leaves progress unchanged", async () => {
    const goalId = await makeGoal({ current: "0.00" });
    const income = await makeTransaction("income", "100.00");
    const spend = await makeTransaction("expense", "80.00");
    await link(alice, goalId, { transactionId: income, linkType: "contribution" }).expect(201);
    await link(alice, goalId, { transactionId: spend, linkType: "spending" }).expect(201);
    expect(await progress(goalId)).toBe("20.00");

    await as(alice).put(`/api/transactions/${income}`, { date: "2026-10-20" }).expect(200);
    expect(await progress(goalId)).toBe("20.00");
    expect(await storedDeltaCents(goalId)).toBe(2000);

    await as(alice).put(`/api/transactions/${income}`, { amount: zmw("150.00") }).expect(200);
    expect(await progress(goalId)).toBe("70.00");
    expect(await storedDeltaCents(goalId)).toBe(7000);
  });
});

describe("P1-2 the locked re-read of a link source rechecks visibility", () => {
  it("a source made private while the link waited is not found, and nothing is linked", async () => {
    const goalId = await makeGoal({ current: "0.00" });
    const income = await makeTransaction("income", "40.00");

    const { result, queued, holder } = await raceBehindLock(
      async (tx) => {
        await tx.update(transactions).set({ isPrivate: true, amount: "70.00" }).where(eq(transactions.id, income));
      },
      () => link(bob, goalId, { transactionId: income, linkType: "contribution" }).then((response) => response),
    );

    expect([queued, holder]).toEqual([true, "committed"]);
    expect(result.status).toBe(404);
    expect(JSON.stringify(result.body)).not.toContain("70.00");
    expect(await db.select().from(transactionGoalLinks).where(eq(transactionGoalLinks.goalId, goalId))).toEqual([]);
    expect(await progress(goalId)).toBe("0.00");
  });
});

describe("P1-3 a reversal never discloses progress the member cannot see", () => {
  it("redacts the applied delta when a private source landed while the reversal waited", async () => {
    const goalId = await makeGoal({ current: "0.00" });
    const added = await as(alice).post(`/api/goals/${goalId}/contribute`, { amount: zmw("100.00") }).expect(201);
    const contributionId = (added.body.data.contribution as { id: string }).id;
    const privateSpend = await makeTransaction("expense", "70.00");
    await db.update(transactions).set({ isPrivate: true }).where(eq(transactions.id, privateSpend));

    const { result, queued, holder } = await raceBehindLock(
      async (tx) => {
        await transactionGoalLinkService.linkTransaction(
          goalId, householdId, alice.id, { transactionId: privateSpend, linkType: "spending" }, tx,
        );
      },
      () => as(bob).post(`/api/goals/${goalId}/contributions/${contributionId}/reverse`, {}).then((response) => response),
    );

    expect([queued, holder]).toEqual([true, "committed"]);
    expect(result.status).toBe(201);
    const correction = result.body.data.correction as Json;
    expect(correction.appliedDelta).toBeNull();
    expect(JSON.stringify(result.body)).not.toContain("30.00");
    expect((result.body.data.goal as Json).currentAmount).toBeNull();
    expect(await progress(goalId)).toBe("0.00");
  });
});

describe("P1-4 an explicit link amount keeps its currency", () => {
  it("refuses an amount whose currency is not the transaction's, and converts a matching one", async () => {
    const goalId = await makeGoal({ current: "0.00" });
    const dollars = await makeTransaction("income", "10.00", ids.dollars, "USD");

    const refused = await link(alice, goalId, {
      transactionId: dollars, linkType: "contribution", amount: zmw("10.00"),
    }).expect(400);
    expect(JSON.stringify(refused.body)).toContain("USD");
    expect(await progress(goalId)).toBe("0.00");

    await link(alice, goalId, {
      transactionId: dollars, linkType: "contribution", amount: { amount: "4.00", currency: "USD" },
    }).expect(201);
    expect(await progress(goalId)).toBe("102.00");
  });
});

describe("P1-5 a contribution rechecks auto-sync after taking the goal lock", () => {
  it("refuses a contribution queued behind an auto-synced assignment", async () => {
    const goalId = await makeGoal({ current: "0.00" });

    const { result, queued, holder } = await raceBehindLock(
      async (tx) => {
        await tx.select().from(goals).where(eq(goals.id, goalId)).for("update");
      },
      () => as(alice).post(`/api/goals/${goalId}/contribute`, { amount: zmw("20.00") }).then((response) => response),
      async (tx) => {
        await tx.insert(goalAccountAssignments).values({ goalId, accountId: ids.savings, assignmentType: "full_balance", autoUpdate: true });
        await tx.update(goals).set({ currentAmount: "500.00" }).where(eq(goals.id, goalId));
      },
    );

    expect([queued, holder]).toEqual([true, "committed"]);
    expect(result.status).toBe(400);
    expect(await progress(goalId)).toBe("500.00");
    expect(await db.select().from(goalContributions).where(eq(goalContributions.goalId, goalId))).toEqual([]);
  });
});

describe("P2-6 a contribution citing a linked transaction takes the writer's lock order", () => {
  it("waits for the transaction writer instead of deadlocking with it", async () => {
    const goalId = await makeGoal({ current: "0.00" });
    const spend = await makeTransaction("expense", "5.00");
    await link(alice, goalId, { transactionId: spend, linkType: "spending" }).expect(201);

    // The transaction writer's order: the transaction FOR UPDATE, then its linked goals.
    const { result, queued, holder } = await raceBehindLock(
      async (tx) => {
        await tx.select().from(transactions).where(eq(transactions.id, spend)).for("update");
      },
      () => as(alice).post(`/api/goals/${goalId}/contribute`, { amount: zmw("20.00"), transactionId: spend })
        .then((response) => response),
      async (tx) => {
        await tx.select().from(goals).where(eq(goals.id, goalId)).for("update");
      },
    );

    expect([queued, holder]).toEqual([true, "committed"]);
    expect(result.status).toBe(201);
    expect(await progress(goalId)).toBe("20.00");
  });
});

describe("P2-7 an explicit link amount follows the overfund rule", () => {
  it("needs confirmOverfund to take progress past the target", async () => {
    const goalId = await makeGoal({ current: "90.00", target: "100.00" });
    const income = await makeTransaction("income", "50.00");
    const body = { transactionId: income, linkType: "contribution", amount: zmw("20.00") };

    await link(alice, goalId, body).expect(409);
    expect(await progress(goalId)).toBe("90.00");

    await link(alice, goalId, { ...body, confirmOverfund: true }).expect(201);
    expect(await progress(goalId)).toBe("110.00");
  });
});

describe("P2-8 the reversal response carries money with its currency", () => {
  it("returns amount and appliedDelta as MoneyDto", async () => {
    const goalId = await makeGoal({ current: "0.00" });
    const added = await as(alice).post(`/api/goals/${goalId}/contribute`, { amount: zmw("30.00") }).expect(201);
    const contributionId = (added.body.data.contribution as { id: string }).id;

    const reversed = await as(alice).post(`/api/goals/${goalId}/contributions/${contributionId}/reverse`, {}).expect(201);
    const correction = reversed.body.data.correction as Json;
    expect(correction.amount).toEqual(zmw("-30.00"));
    expect(correction.appliedDelta).toEqual(zmw("-30.00"));
    const [row] = await db.select().from(goalContributions)
      .where(and(eq(goalContributions.goalId, goalId), eq(goalContributions.kind, "correction")));
    expect(row.appliedDelta).toBe("-30.00");
  });
});

describe("Round 2 A: a source edit refolds every source, so no floor sticks to one link", () => {
  it("the review sequence: a later date-only edit leaves progress and the stored deltas in step", async () => {
    const goalId = await makeGoal({ current: "0.00" });
    const income = await makeTransaction("income", "100.00");
    const spend = await makeTransaction("expense", "80.00");
    await link(alice, goalId, { transactionId: income, linkType: "contribution" }).expect(201);
    await link(alice, goalId, { transactionId: spend, linkType: "spending" }).expect(201);
    await as(alice).put(`/api/transactions/${income}`, { amount: zmw("50.00") }).expect(200);
    expect(await progress(goalId)).toBe("0.00");
    // confirmOverfund: a source edit currently leaves an activity row that hides the goal's
    // progress from every member (reported separately), which forces the hidden-progress answer.
    await as(alice).post(`/api/goals/${goalId}/contribute`, { amount: zmw("40.00"), confirmOverfund: true }).expect(201);
    expect(await progress(goalId)).toBe("40.00");

    await as(alice).put(`/api/transactions/${income}`, { date: "2026-10-21" }).expect(200);
    expect(await progress(goalId)).toBe("40.00");
    expect(await storedDeltaCents(goalId)).toBe(4000);

    // Raising the income again is absorbed by the spend first, then restores the original effect.
    await as(alice).put(`/api/transactions/${income}`, { amount: zmw("60.00") }).expect(200);
    expect(await progress(goalId)).toBe("40.00");
    await as(alice).put(`/api/transactions/${income}`, { amount: zmw("100.00") }).expect(200);
    expect(await progress(goalId)).toBe("60.00");
    expect(await storedDeltaCents(goalId)).toBe(6000);
  });

  it("unlinking or deleting the income a spend drew on leaves no progress to manufacture later", async () => {
    for (const remove of ["unlink", "delete"] as const) {
      const goalId = await makeGoal({ current: "0.00" });
      const income = await makeTransaction("income", "100.00");
      const spend = await makeTransaction("expense", "80.00");
      await link(alice, goalId, { transactionId: income, linkType: "contribution" }).expect(201);
      await link(alice, goalId, { transactionId: spend, linkType: "spending" }).expect(201);

      const path = remove === "unlink" ? `/api/goals/${goalId}/transactions/${income}` : `/api/transactions/${income}`;
      await request(app).delete(path).set("Cookie", alice.cookie).expect(200);
      expect([remove, await progress(goalId), await storedDeltaCents(goalId)]).toEqual([remove, "0.00", 0]);

      await as(alice).put(`/api/transactions/${spend}`, { amount: zmw("10.00") }).expect(200);
      expect([remove, await progress(goalId), await storedDeltaCents(goalId)]).toEqual([remove, "0.00", 0]);
    }
  });
});

describe("Round 2 B: the overfund check decides hidden progress under the goal lock", () => {
  it("a private source that lands while the contribution waits gets the hidden-progress answer", async () => {
    const goalId = await makeGoal({ current: "0.00", target: "100.00" });
    const privateIncome = await makeTransaction("income", "70.00");
    await db.update(transactions).set({ isPrivate: true }).where(eq(transactions.id, privateIncome));

    const { result, queued, holder } = await raceBehindLock(
      async (tx) => {
        await transactionGoalLinkService.linkTransaction(
          goalId, householdId, alice.id, { transactionId: privateIncome, linkType: "contribution" }, tx,
        );
      },
      () => as(bob).post(`/api/goals/${goalId}/contribute`, { amount: zmw("40.00") }).then((response) => response),
    );

    expect([queued, holder]).toEqual([true, "committed"]);
    expect(result.status).toBe(409);
    const message = JSON.stringify(result.body);
    expect(message).toContain("sources you cannot see");
    expect(message).not.toContain("past its target");
    expect(await progress(goalId)).toBe("70.00");
  });
});

describe("#245 review P2-1: completing a goal decides hidden progress under the goal lock", () => {
  it("a private source that lands while Bob's complete waits gets the constant refusal, and the goal stays open", async () => {
    const goalId = await makeGoal({ current: "0.00", target: "100.00" });
    const privateIncome = await makeTransaction("income", "70.00");
    await db.update(transactions).set({ isPrivate: true }).where(eq(transactions.id, privateIncome));

    const { result, queued, holder } = await raceBehindLock(
      async (tx) => {
        await transactionGoalLinkService.linkTransaction(
          goalId, householdId, alice.id, { transactionId: privateIncome, linkType: "contribution" }, tx,
        );
      },
      () => as(bob).post(`/api/goals/${goalId}/complete`, {}).then((response) => response),
    );

    expect([queued, holder]).toEqual([true, "committed"]);
    expect([result.status, JSON.stringify(result.body)]).toEqual([409, expect.stringContaining("sources you cannot see")]);
    const [row] = await db.select({ isCompleted: goals.isCompleted }).from(goals).where(eq(goals.id, goalId));
    expect([row.isCompleted, await progress(goalId)]).toEqual([false, "70.00"]);
  });
});

describe("Round 2 C: the link response never discloses hidden progress", () => {
  it("redacts a spend's clamped delta for a member who cannot see all progress, and returns MoneyDto", async () => {
    const goalId = await makeGoal({ current: "0.00" });
    const privateIncome = await makeTransaction("income", "70.00");
    await db.update(transactions).set({ isPrivate: true }).where(eq(transactions.id, privateIncome));
    await link(alice, goalId, { transactionId: privateIncome, linkType: "contribution" }).expect(201);
    const spend = await makeTransaction("expense", "100.00");

    const linked = await link(bob, goalId, { transactionId: spend, linkType: "spending" }).expect(201);
    const body = linked.body.data.link as Json;
    expect(body.appliedDelta).toBeNull();
    expect(body.amount).toEqual(zmw("100.00"));
    expect(body.sourceAmount).toEqual(zmw("100.00"));
    expect(JSON.stringify(linked.body)).not.toContain("70.00");

    const own = await link(alice, await makeGoal({ current: "0.00" }), { transactionId: spend, linkType: "spending" }).expect(201);
    expect((own.body.data.link as Json).appliedDelta).toEqual(zmw("0.00"));
  });
});

describe("Round 2 D: a contribution rechecks the cited transaction's account under lock", () => {
  it("an account made private while the contribution waited makes the transaction not found", async () => {
    const goalId = await makeGoal({ current: "0.00" });
    const ownedAccount = randomUUID();
    await db.insert(accounts).values({
      id: ownedAccount, householdId, name: "Synthetic owned current", type: "checking", currency: "ZMW",
      initialBalance: "100.00", balance: "100.00", ownerUserId: alice.id,
    });
    const income = await makeTransaction("income", "30.00", ownedAccount);

    const { result, queued, holder } = await raceBehindLock(
      async (tx) => {
        await tx.select().from(transactions).where(eq(transactions.id, income)).for("update");
      },
      () => as(bob).post(`/api/goals/${goalId}/contribute`, { amount: zmw("20.00"), transactionId: income })
        .then((response) => response),
      async (tx) => {
        await tx.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, ownedAccount));
      },
    );

    expect([queued, holder]).toEqual([true, "committed"]);
    expect(result.status).toBe(400);
    expect(await progress(goalId)).toBe("0.00");
    expect(await db.select().from(goalContributions).where(eq(goalContributions.goalId, goalId))).toEqual([]);
  });
});

/** How many sessions are waiting, directly or behind another waiter, on backend `pid`. */
async function waitersBehind(pid: number): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(`WITH RECURSIVE blocked(pid) AS (
    SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))
    UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))
  ) SELECT count(*)::int AS count FROM blocked`, [pid]);
  return rows[0].count;
}

async function untilWaiters(pid: number, count: number): Promise<boolean> {
  for (let i = 0; i < 200; i++) {
    if (await waitersBehind(pid) >= count) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

describe("Round 3 1: a transaction counts toward a goal once", () => {
  it("refuses a contribution link when a manual contribution already cites the transaction, and the reverse", async () => {
    const goalId = await makeGoal({ current: "0.00" });
    const cited = await makeTransaction("income", "100.00");
    await as(alice).post(`/api/goals/${goalId}/contribute`, { amount: zmw("40.00"), transactionId: cited }).expect(201);
    await link(alice, goalId, { transactionId: cited, linkType: "contribution" }).expect(409);
    expect(await progress(goalId)).toBe("40.00");
    expect(await db.select().from(transactionGoalLinks).where(eq(transactionGoalLinks.goalId, goalId))).toEqual([]);

    const linked = await makeTransaction("income", "10.00");
    await link(alice, goalId, { transactionId: linked, linkType: "contribution" }).expect(201);
    await as(alice).post(`/api/goals/${goalId}/contribute`, { amount: zmw("5.00"), transactionId: linked }).expect(409);
    expect(await progress(goalId)).toBe("50.00");
    expect(await storedDeltaCents(goalId)).toBe(5000);
  });
});

describe("Round 3 2: a refold replays sources in the order they were applied", () => {
  it("two links in one database transaction keep their order through a later refold", async () => {
    // Same transaction start time for both links, as a rules batch would give them.
    for (let attempt = 0; attempt < 6; attempt++) {
      const goalId = await makeGoal({ current: "0.00" });
      const income = await makeTransaction("income", "100.00");
      const spend = await makeTransaction("expense", "100.00");
      await db.transaction(async (tx) => {
        await transactionGoalLinkService.linkTransaction(goalId, householdId, alice.id, { transactionId: income, linkType: "contribution" }, tx);
        await transactionGoalLinkService.linkTransaction(goalId, householdId, alice.id, { transactionId: spend, linkType: "spending" }, tx);
      });
      expect(await progress(goalId)).toBe("0.00");

      const zero = await makeTransaction("expense", "5.00");
      await link(alice, goalId, { transactionId: zero, linkType: "spending" }).expect(201);
      await request(app).delete(`/api/goals/${goalId}/transactions/${zero}`).set("Cookie", alice.cookie).expect(200);
      expect([attempt, await progress(goalId), await storedDeltaCents(goalId)]).toEqual([attempt, "0.00", 0]);
    }
  });

  it("a source applied after another that started earlier keeps its place through a later refold", async () => {
    const goalId = await makeGoal({ current: "0.00" });
    const cited = await makeTransaction("income", "1.00");
    const spend = await makeTransaction("expense", "50.00");
    let contribution: Promise<request.Response> | undefined;
    let spendLink: Promise<request.Response> | undefined;
    let queued = [false, false];

    await db.transaction(async (tx) => {
      await tx.select().from(transactions).where(eq(transactions.id, cited)).for("update");
      await tx.select().from(goals).where(eq(goals.id, goalId)).for("update");
      const pid = (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
      // The contribution starts first but waits on the cited transaction; the spend then queues on the goal.
      contribution = as(alice).post(`/api/goals/${goalId}/contribute`, { amount: zmw("100.00"), transactionId: cited })
        .then((response) => response);
      queued = [await untilWaiters(pid, 1), false];
      spendLink = link(alice, goalId, { transactionId: spend, linkType: "spending" }).then((response) => response);
      queued = [queued[0], await untilWaiters(pid, 2)];
    });

    expect(queued).toEqual([true, true]);
    expect([(await spendLink!).status, (await contribution!).status]).toEqual([201, 201]);
    // The spend found nothing to take, then the contribution added 100.
    expect(await progress(goalId)).toBe("100.00");

    const other = await makeTransaction("income", "1.00");
    await link(alice, goalId, { transactionId: other, linkType: "contribution" }).expect(201);
    await request(app).delete(`/api/goals/${goalId}/transactions/${other}`).set("Cookie", alice.cookie).expect(200);
    expect(await progress(goalId)).toBe("100.00");
    expect(await storedDeltaCents(goalId)).toBe(10000);
  });
});

describe("Round 3 3: reads of links and contributions never disclose hidden progress", () => {
  it("both link listings and the contribution list redact deltas for a member who cannot see all progress", async () => {
    const goalId = await makeGoal({ current: "0.00" });
    const privateIncome = await makeTransaction("income", "70.00");
    await db.update(transactions).set({ isPrivate: true }).where(eq(transactions.id, privateIncome));
    await link(alice, goalId, { transactionId: privateIncome, linkType: "contribution" }).expect(201);
    const spend = await makeTransaction("expense", "100.00");
    await link(bob, goalId, { transactionId: spend, linkType: "spending" }).expect(201);
    const manual = await as(alice).post(`/api/goals/${goalId}/contribute`, { amount: zmw("30.00") }).expect(201);
    const manualId = (manual.body.data.contribution as { id: string }).id;
    const privateSpend = await makeTransaction("expense", "20.00");
    await db.update(transactions).set({ isPrivate: true }).where(eq(transactions.id, privateSpend));
    await link(alice, goalId, { transactionId: privateSpend, linkType: "spending" }).expect(201);
    await as(alice).post(`/api/goals/${goalId}/contributions/${manualId}/reverse`, {}).expect(201);

    const goalLinks = await request(app).get(`/api/goals/${goalId}/transactions`).set("Cookie", bob.cookie).expect(200);
    const visibleLink = (goalLinks.body.data as Json[]).find((row) => row.transactionId === spend)!;
    expect(visibleLink.appliedDelta).toBeNull();
    expect(visibleLink.amount).toEqual(zmw("100.00"));

    const transactionLinks = await request(app).get(`/api/transactions/${spend}/goals`).set("Cookie", bob.cookie).expect(200);
    expect((transactionLinks.body.data as Json[])[0].appliedDelta).toBeNull();

    const contributions = await request(app).get(`/api/goals/${goalId}/contributions`).set("Cookie", bob.cookie).expect(200);
    const correction = (contributions.body.data as Json[]).find((row) => row.kind === "correction")!;
    expect(correction.appliedDelta).toBeNull();
    expect(JSON.stringify([goalLinks.body, transactionLinks.body, contributions.body])).not.toMatch(/"-?(70|10)\.00"/);

    const own = await request(app).get(`/api/goals/${goalId}/transactions`).set("Cookie", alice.cookie).expect(200);
    expect((own.body.data as Json[]).find((row) => row.transactionId === spend)!.appliedDelta).toEqual(zmw("-70.00"));
  });
});

describe("Round 4 P1: progress that no source explains keeps its place in the replay order", () => {
  const transfer = (fromGoalId: string, toGoalId: string, amount: string) =>
    as(alice).post("/api/goals/transfers", { fromGoalId, toGoalId, amount: zmw(amount) }).expect(201);
  const unlink = (goalId: string, transactionId: string) =>
    request(app).delete(`/api/goals/${goalId}/transactions/${transactionId}`).set("Cookie", alice.cookie).expect(200);

  it("a transfer in after a spend is not taken by that spend when an earlier source is unlinked or edited", async () => {
    for (const change of ["unlink", "edit"] as const) {
      const goalId = await makeGoal({ current: "0.00" });
      const otherGoal = await makeGoal({ current: "100.00" });
      const income = await makeTransaction("income", "10.00");
      await link(alice, goalId, { transactionId: income, linkType: "contribution" }).expect(201);
      const spend = await makeTransaction("expense", "100.00");
      await link(alice, goalId, { transactionId: spend, linkType: "spending" }).expect(201);
      expect(await progress(goalId)).toBe("0.00");
      await transfer(otherGoal, goalId, "100.00");
      expect(await progress(goalId)).toBe("100.00");

      if (change === "unlink") await unlink(goalId, income);
      else await as(alice).put(`/api/transactions/${income}`, { amount: zmw("5.00") }).expect(200);
      // The spend came before the transfer, so it never saw the transferred 100.
      expect([change, await progress(goalId)]).toEqual([change, "100.00"]);
    }
  });

  it("a transfer out is a fixed debit: removing the source it drew on is refused and both goals keep their progress", async () => {
    const goalId = await makeGoal({ current: "0.00" });
    const otherGoal = await makeGoal({ current: "0.00" });
    const income = await makeTransaction("income", "100.00");
    await link(alice, goalId, { transactionId: income, linkType: "contribution" }).expect(201);
    await transfer(goalId, otherGoal, "100.00");
    await as(alice).post(`/api/goals/${goalId}/contribute`, { amount: zmw("50.00") }).expect(201);
    expect([await progress(goalId), await progress(otherGoal)]).toEqual(["50.00", "100.00"]);

    // Without the income the goal never had the 100 it sent to the other goal.
    const unlinked = await request(app).delete(`/api/goals/${goalId}/transactions/${income}`).set("Cookie", alice.cookie);
    expect(unlinked.status).toBe(409);
    const refusal = (unlinked.body.error as { message: string }).message;
    expect(refusal).toMatch(/short for a later transfer or assignment/);
    expect(refusal).not.toMatch(/\d/);
    await as(alice).put(`/api/transactions/${income}`, { amount: zmw("60.00") }).expect(409);
    // The 100 that moved is counted once, on the receiving goal.
    expect([await progress(goalId), await progress(otherGoal)]).toEqual(["50.00", "100.00"]);
    expect(await db.select().from(transactionGoalLinks).where(eq(transactionGoalLinks.transactionId, income))).toHaveLength(1);

    // An edit that still covers the transfer goes through, and replays it at its place.
    await as(alice).put(`/api/transactions/${income}`, { amount: zmw("120.00") }).expect(200);
    expect([await progress(goalId), await progress(otherGoal)]).toEqual(["70.00", "100.00"]);
  });

  it("a partial-balance assignment after a spend is not taken by that spend when an earlier source is unlinked", async () => {
    const goalId = await makeGoal({ current: "0.00" });
    const income = await makeTransaction("income", "10.00");
    await link(alice, goalId, { transactionId: income, linkType: "contribution" }).expect(201);
    const spend = await makeTransaction("expense", "100.00");
    await link(alice, goalId, { transactionId: spend, linkType: "spending" }).expect(201);
    const accountId = randomUUID();
    await db.insert(accounts).values({
      id: accountId, householdId, name: "Synthetic reserve", type: "savings", currency: "ZMW", initialBalance: "300.00", balance: "300.00",
    });
    await as(alice).post(`/api/goals/${goalId}/assign-account`, {
      accountId, assignmentType: "partial_balance", partialAmount: zmw("100.00"),
    }).expect(201);
    expect(await progress(goalId)).toBe("100.00");

    await unlink(goalId, income);
    expect(await progress(goalId)).toBe("100.00");
  });
});

describe("Round 4 P1: transfers are fixed amounts; an assignment release takes what progress holds", () => {
  const reserve = async () => {
    const accountId = randomUUID();
    await db.insert(accounts).values({
      id: accountId, householdId, name: "Synthetic reserve", type: "savings", currency: "ZMW", initialBalance: "300.00", balance: "300.00",
    });
    return accountId;
  };

  it("the two goals of a transfer still sum to their sources after an earlier source on either side is edited", async () => {
    const sender = await makeGoal({ current: "0.00" });
    const receiver = await makeGoal({ current: "0.00" });
    const sent = await makeTransaction("income", "100.00");
    await link(alice, sender, { transactionId: sent, linkType: "contribution" }).expect(201);
    const received = await makeTransaction("income", "10.00");
    await link(alice, receiver, { transactionId: received, linkType: "contribution" }).expect(201);
    await as(alice).post("/api/goals/transfers", { fromGoalId: sender, toGoalId: receiver, amount: zmw("100.00") }).expect(201);
    const pair = async () => [await progress(sender), await progress(receiver)];
    expect(await pair()).toEqual(["0.00", "110.00"]);

    await as(alice).put(`/api/transactions/${received}`, { amount: zmw("30.00") }).expect(200);
    expect(await pair()).toEqual(["0.00", "130.00"]);
    await as(alice).put(`/api/transactions/${sent}`, { amount: zmw("150.00") }).expect(200);
    // 150 + 30 of sources, with the 100 counted once: on the receiver.
    expect(await pair()).toEqual(["50.00", "130.00"]);
  });

  // #235 M3: a refused release told a member who cannot see all of the progress how much it holds.
  it("removing a partial assignment whose amount progress no longer holds lands at zero", async () => {
    const goalId = await makeGoal({ current: "0.00" });
    const accountId = await reserve();
    await as(alice).post(`/api/goals/${goalId}/assign-account`, {
      accountId, assignmentType: "partial_balance", partialAmount: zmw("100.00"),
    }).expect(201);
    const spend = await makeTransaction("expense", "80.00");
    await link(alice, goalId, { transactionId: spend, linkType: "spending" }).expect(201);
    expect(await progress(goalId)).toBe("20.00");

    const removed = await request(app).delete(`/api/goals/${goalId}/accounts/${accountId}`).set("Cookie", alice.cookie);
    expect(removed.status).toBe(200);
    expect(await progress(goalId)).toBe("0.00");
    expect(await db.select().from(goalAccountAssignments).where(eq(goalAccountAssignments.goalId, goalId))).toHaveLength(0);
  });
});

describe("Round 4 P2: contribution rows a link or a citation writes", () => {
  it("a contribution link's mirror row takes the link's place", async () => {
    const goalId = await makeGoal({ current: "0.00" });
    const income = await makeTransaction("income", "10.00");
    await link(alice, goalId, { transactionId: income, linkType: "contribution" }).expect(201);
    const { rows } = await pool.query<{ same: boolean }>(`SELECT l.linked_at = c.created_at AS same
      FROM transaction_goal_links l JOIN goal_contributions c ON c.goal_id = l.goal_id AND c.transaction_id = l.transaction_id
      WHERE l.goal_id = $1`, [goalId]);
    expect(rows).toEqual([{ same: true }]);
  });

  it("a manual contribution citing a transaction that is not linked can be reversed", async () => {
    const goalId = await makeGoal({ current: "0.00" });
    const cited = await makeTransaction("income", "100.00");
    const manual = await as(alice).post(`/api/goals/${goalId}/contribute`, { amount: zmw("40.00"), transactionId: cited }).expect(201);
    const manualId = (manual.body.data.contribution as { id: string }).id;
    await as(alice).post(`/api/goals/${goalId}/contributions/${manualId}/reverse`, {}).expect(201);
    expect(await progress(goalId)).toBe("0.00");
    expect(await storedDeltaCents(goalId)).toBe(0);
  });
});
