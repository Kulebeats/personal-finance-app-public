/**
 * F6 (lane 3): a contribution into a holdings-tracked goal books a `transfer_in`
 * into the linked investment account. That row must carry the dated ZMW base
 * for the contribution date, through the same household-scoped dated FX path
 * as every other investment write. A missing rate is a 422 naming the pair,
 * never rate 1, and the whole contribution is refused with nothing written.
 *
 * Real HTTP against real Postgres. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  accounts, auditLogs, goalContributions, goals, householdFxRateOverrides, householdMembers, households,
  investmentTransactions, users,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { DATED_INVESTMENT_FX_POLICY } from "../../../core/money/investment-income";
import { calendarClock } from "../../../services/householdCalendarToday";

type Member = { id: string; cookie: string };

const password = "SyntheticGoalTransferBase123!";
const householdId = randomUUID();
const ids = { usdBroker: randomUUID(), zmwBroker: randomUUID() };
const RATE_WINDOW = { effectiveDate: "2026-10-01", validThrough: "2026-10-31" };
const CONTRIBUTION_DATE = "2026-10-15";
// No household rate covers this date, and the test checks that no provider row does.
const UNRATED_DATE = "2001-03-15";
let app: Awaited<ReturnType<typeof getTestApp>>;
let owner: Member;
let rateId: string;

async function addMember(): Promise<Member> {
  const id = randomUUID();
  const email = `goal-transfer-base-${id}@example.invalid`;
  await db.insert(users).values({ id, email, username: `goal-transfer-base-${id}`, passwordHash: await hashPassword(password), emailVerified: true });
  await db.insert(householdMembers).values({ householdId, userId: id, role: "owner" });
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") };
}

async function seed() {
  await db.insert(households).values({ id: householdId, name: "Synthetic goal transfer base household", currency: "ZMW" });
  owner = await addMember();
  await db.insert(accounts).values([
    { id: ids.usdBroker, householdId, name: "Synthetic USD broker", type: "investment", currency: "USD", initialBalance: "0.00", balance: "0.00" },
    { id: ids.zmwBroker, householdId, name: "Synthetic ZMW broker", type: "investment", currency: "ZMW", initialBalance: "0.00", balance: "0.00" },
  ]);
  const [rate] = await db.insert(householdFxRateOverrides).values({ householdId, actorUserId: owner.id,
    fromCurrency: "USD", toCurrency: "ZMW", ...RATE_WINDOW, rate: "26.5" }).returning();
  rateId = rate.id;
}

async function teardown() {
  await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
  await db.delete(goals).where(eq(goals.householdId, householdId));
  await pool.query("DELETE FROM investment_transactions WHERE household_id = $1", [householdId]);
  await db.delete(householdFxRateOverrides).where(eq(householdFxRateOverrides.householdId, householdId));
  await db.delete(accounts).where(eq(accounts.householdId, householdId));
  await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
  await db.delete(households).where(eq(households.id, householdId));
  if (owner) {
    await db.delete(auditLogs).where(eq(auditLogs.userId, owner.id));
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [owner.id]);
    await db.delete(users).where(eq(users.id, owner.id));
  }
}

async function holdingsGoal(currency: "USD" | "ZMW") {
  const id = randomUUID();
  await db.insert(goals).values({
    id, householdId, name: `Synthetic ${currency} retirement ${id.slice(0, 8)}`, type: "investment", goalType: "retirement",
    currency, targetAmount: "100000.00", currentAmount: "0.00", progressSource: "holdings",
    linkedAccountId: currency === "USD" ? ids.usdBroker : ids.zmwBroker,
  });
  return id;
}

const contribute = (goalId: string, currency: string, date?: string) => request(app)
  .post(`/api/goals/${goalId}/contribute`).set("Cookie", owner.cookie)
  .send({ amount: { amount: "40.00", currency }, ...(date ? { date } : {}), notes: "Synthetic broker top-up" });

async function transfers(accountId: string) {
  return db.select().from(investmentTransactions).where(and(
    eq(investmentTransactions.householdId, householdId), eq(investmentTransactions.accountId, accountId)));
}

async function contributionAudits(goalId: string) {
  return (await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "goal"), eq(auditLogs.entityId, goalId))))
    .filter(row => (row.details as Record<string, unknown> | null)?.operation === "addContribution");
}

beforeAll(async () => {
  app = await getTestApp();
  await seed();
}, 60_000);

afterAll(async () => {
  await teardown();
});

describe("F6: a holdings goal's transfer_in stores its dated ZMW base", () => {
  it("stores the contribution date's household rate and ZMW base, and names that rate row in the goal audit", async () => {
    const goalId = await holdingsGoal("USD");
    await contribute(goalId, "USD", CONTRIBUTION_DATE).expect(201);

    const [transfer, ...extra] = await transfers(ids.usdBroker);
    expect(extra).toEqual([]);
    expect(transfer).toMatchObject({ type: "transfer_in", amount: "40.00", currency: "USD",
      fxRate: "26.50000000", amountZmw: "1060.00", transactionDate: CONTRIBUTION_DATE });

    const [audit, ...moreAudits] = await contributionAudits(goalId);
    expect(moreAudits).toEqual([]);
    expect(audit).toMatchObject({ userId: owner.id, householdId, action: "UPDATE", entityType: "goal", entityId: goalId });
    expect(audit.details).toMatchObject({
      newValue: { amount: "40.00", currency: "USD", date: CONTRIBUTION_DATE, fxRate: "26.50000000", amountZmw: "1060.00" },
      investmentTransactionId: transfer.id,
      fxRateBasis: DATED_INVESTMENT_FX_POLICY,
      fxRateSource: { kind: "household", id: rateId, date: RATE_WINDOW.effectiveDate },
    });
  });

  it("refuses with a 422 naming the pair and date when no rate covers the contribution date, writing nothing", async () => {
    const provider = await pool.query("select 1 from fx_rates where from_currency='USD' and to_currency='ZMW' and date <= $1",
      [UNRATED_DATE]);
    expect(provider.rows, "a provider USD rate on or before the unrated date would make this test meaningless").toEqual([]);
    const goalId = await holdingsGoal("USD");
    const before = await transfers(ids.usdBroker);

    const refused = await contribute(goalId, "USD", UNRATED_DATE).expect(422);
    expect(refused.body).toMatchObject({ success: false,
      error: { code: "MISSING_FX_RATE", details: { from: "USD", to: "ZMW", date: UNRATED_DATE } } });

    expect(await transfers(ids.usdBroker)).toEqual(before);
    expect(await db.select().from(goalContributions).where(eq(goalContributions.goalId, goalId))).toEqual([]);
    expect(await contributionAudits(goalId)).toEqual([]);
    const [goal] = await db.select({ currentAmount: goals.currentAmount }).from(goals).where(eq(goals.id, goalId));
    expect(goal.currentAmount).toBe("0.00");
  });

  it("keeps a ZMW contribution native, with no typed base and no conversion in its audit", async () => {
    const goalId = await holdingsGoal("ZMW");
    await contribute(goalId, "ZMW", CONTRIBUTION_DATE).expect(201);

    const [transfer, ...extra] = await transfers(ids.zmwBroker);
    expect(extra).toEqual([]);
    expect(transfer).toMatchObject({ type: "transfer_in", amount: "40.00", currency: "ZMW", fxRate: null, amountZmw: null });
    const [audit] = await contributionAudits(goalId);
    expect(audit.details).toMatchObject({ investmentTransactionId: transfer.id });
    const details = audit.details as { newValue: Record<string, unknown> } & Record<string, unknown>;
    expect(details.newValue).not.toHaveProperty("fxRate");
    expect(details.newValue).not.toHaveProperty("amountZmw");
    expect(details).not.toHaveProperty("fxRateBasis");
    expect(details).not.toHaveProperty("fxRateSource");
  });
});

describe("F6 follow-up: an undated contribution is dated on the household calendar", () => {
  // Two household rates either side of a month end, so the date chosen shows in the stored base.
  const NOVEMBER = { effectiveDate: "2026-11-01", validThrough: "2026-11-30", rate: "27" };

  beforeAll(async () => {
    await db.insert(householdFxRateOverrides).values({ householdId, actorUserId: owner.id,
      fromCurrency: "USD", toCurrency: "ZMW", ...NOVEMBER });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.update(households).set({ timeZone: null }).where(eq(households.id, householdId));
  });

  it.each([
    // Lusaka (UTC+2) is already on 1 November while UTC is still on 31 October.
    { zone: "Africa/Lusaka", instant: "2026-10-31T22:30:00Z", date: "2026-11-01", fxRate: "27.00000000", amountZmw: "1080.00" },
    // Los Angeles (UTC-7) is still on 31 October while UTC is already on 1 November.
    { zone: "America/Los_Angeles", instant: "2026-11-01T05:00:00Z", date: "2026-10-31", fxRate: "26.50000000", amountZmw: "1060.00" },
  ])("in $zone at $instant it books $date and that date's rate, not the UTC day", async ({ zone, instant, date, fxRate, amountZmw }) => {
    await db.update(households).set({ timeZone: zone }).where(eq(households.id, householdId));
    vi.spyOn(calendarClock, "now").mockReturnValue(new Date(instant));
    expect(instant.slice(0, 10), "the pinned instant must straddle the household and UTC days").not.toBe(date);
    const goalId = await holdingsGoal("USD");
    const before = new Set((await transfers(ids.usdBroker)).map(row => row.id));

    await contribute(goalId, "USD").expect(201);

    const added = (await transfers(ids.usdBroker)).filter(row => !before.has(row.id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ type: "transfer_in", transactionDate: date, fxRate, amountZmw });
    const [contribution] = await db.select().from(goalContributions).where(eq(goalContributions.goalId, goalId));
    expect(contribution.date).toBe(date);
    const [audit] = await contributionAudits(goalId);
    expect(audit.details).toMatchObject({ newValue: { date, fxRate, amountZmw } });
  });
});
