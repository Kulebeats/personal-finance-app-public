/**
 * NEW-15 (register recheck 2026-11-22, defect 5): goal forecasts count real
 * calendar months from the household's own calendar date, in Money, and a
 * forecast that needs a missing rate or price is "unavailable", never a number.
 *
 * The saved forecast (goals.monthly_projection, goals.projected_completion_date)
 * and GET /api/goals/:id/projection are checked against golden values. The
 * household calendar clock (calendarClock, the one instant source for household
 * dates) is pinned; the global Date is not, because the session store compares
 * expiry with the database clock. The household is in Africa/Lusaka (UTC+2).
 * REAL HTTP against real Postgres, synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  accounts, auditLogs, fxRates, goals, holdings, householdMembers, households, notifications, outboxEvents,
  securities, users,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../../core/calculations";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { calendarClock } from "../../../services/householdCalendarToday";
import { runGoalStatusRecalculation } from "../../../jobs/goalStatusWorker";

const password = "SyntheticNew15Forecast123!";
const ZONE = "Africa/Lusaka";
// No household or provider rate to ZMW exists for this currency (asserted below).
const UNRATED = "ISK";
let app: Awaited<ReturnType<typeof getTestApp>>;
let householdId: string;
let userId: string;
let cookie: string;
const securityIds: string[] = [];

const post = (path: string) => request(app).post(path).set("Cookie", cookie);
const get = (path: string) => request(app).get(path).set("Cookie", cookie);

const realNow = calendarClock.now;

/** Pins the household calendar clock to `instant`. */
function pinClock(instant: string) {
  calendarClock.now = () => new Date(instant);
}

async function createSaveUp(targetAmount: string, targetDate: string): Promise<string> {
  const response = await post("/api/goals").send({
    name: "NEW-15 synthetic savings", type: "save_up", goalType: "other",
    targetAmount: { amount: targetAmount, currency: "ZMW" }, targetDate,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data.id as string;
}

async function savedForecast(goalId: string) {
  const [row] = await db.select({
    startDate: goals.startDate, monthlyProjection: goals.monthlyProjection, projectedCompletionDate: goals.projectedCompletionDate,
  }).from(goals).where(eq(goals.id, goalId));
  return row;
}

beforeAll(async () => {
  app = await getTestApp();
  // The server sets the FX service at startup; the test app does not.
  setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates)));
  const provider = await pool.query("select 1 from fx_rates where from_currency = $1 and to_currency = 'ZMW'", [UNRATED]);
  expect(provider.rows, `a provider ${UNRATED} rate would make the missing-rate test meaningless`).toEqual([]);

  householdId = randomUUID();
  userId = randomUUID();
  const email = `new15-forecast-${userId}@example.invalid`;
  await db.insert(households).values({ id: householdId, name: "Synthetic NEW-15 forecast", currency: "ZMW", timeZone: ZONE });
  await db.insert(users).values({ id: userId, email, username: `new15-forecast-${userId}`,
    passwordHash: await hashPassword(password), emailVerified: true });
  await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
}, 60_000);

afterEach(async () => {
  calendarClock.now = realNow;
  await db.delete(goals).where(eq(goals.householdId, householdId));
});

afterAll(async () => {
  await db.delete(outboxEvents).where(eq(outboxEvents.householdId, householdId));
  await db.delete(notifications).where(eq(notifications.userId, userId));
  await db.delete(holdings).where(eq(holdings.householdId, householdId));
  if (securityIds.length) await db.delete(securities).where(inArray(securities.id, securityIds));
  await db.delete(accounts).where(eq(accounts.householdId, householdId));
  await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
  await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
  await db.delete(households).where(eq(households.id, householdId));
  await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [userId]);
  await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [userId]);
  await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
});

describe("NEW-15: goal forecasts in calendar months on the household's date", () => {
  it("a goal starting 31 Jan completes on 28 Feb, one calendar month on, not 30 days later", async () => {
    pinClock("2026-01-31T10:00:00Z");
    const id = await createSaveUp("1000.00", "2026-02-28");
    expect(await savedForecast(id)).toEqual({
      startDate: "2026-01-31", monthlyProjection: "1000.00", projectedCompletionDate: "2026-02-28",
    });
  });

  it("a goal starting 31 Jan of a leap year completes on 29 Feb", async () => {
    pinClock("2028-01-31T10:00:00Z");
    const id = await createSaveUp("1000.00", "2028-02-29");
    expect(await savedForecast(id)).toEqual({
      startDate: "2028-01-31", monthlyProjection: "1000.00", projectedCompletionDate: "2028-02-29",
    });
  });

  it("counts from the household's date when it is already 1 April there and still 31 March in UTC", async () => {
    pinClock("2026-03-31T22:30:00Z");
    const id = await createSaveUp("3000.00", "2026-06-30");
    // Two whole months (1 Apr to 1 Jun) remain before 30 Jun on the household calendar.
    expect(await savedForecast(id)).toEqual({
      startDate: "2026-04-01", monthlyProjection: "1500.00", projectedCompletionDate: "2026-06-01",
    });

    const projection = await get(`/api/goals/${id}/projection`).expect(200);
    expect(projection.body.data).toEqual({
      availability: "available", status: expect.any(String), monthsRemaining: 2,
      monthlyProjection: { amount: "1500.00", currency: "ZMW" }, projectedCompletionDate: "2026-06-01",
    });

    // A contribution re-saves the forecast from the same household date: 1500.00 left over two months.
    await post(`/api/goals/${id}/contribute`).send({ amount: { amount: "1500.00", currency: "ZMW" } }).expect(201);
    expect(await savedForecast(id)).toEqual({
      startDate: "2026-04-01", monthlyProjection: "750.00", projectedCompletionDate: "2026-06-01",
    });
  });

  it("a reversed contribution's correction row is dated on the household's date, not the UTC day", async () => {
    pinClock("2026-03-31T22:30:00Z");
    const id = await createSaveUp("3000.00", "2026-06-30");
    const contributed = await post(`/api/goals/${id}/contribute`).send({ amount: { amount: "100.00", currency: "ZMW" } }).expect(201);
    const contributionId = contributed.body.data.contribution.id as string;
    await post(`/api/goals/${id}/contributions/${contributionId}/reverse`).send({ reason: "Synthetic mistake" }).expect(201);

    const { rows } = await pool.query(
      "select to_char(date, 'YYYY-MM-DD') as date from goal_contributions where corrects_contribution_id = $1", [contributionId]);
    expect(rows).toEqual([{ date: "2026-04-01" }]);
  });

  it("the goals.status job keeps the household-date forecast; it does not re-save it on the UTC date", async () => {
    pinClock("2026-03-31T22:30:00Z");
    const id = await createSaveUp("3000.00", "2026-06-30");
    const saved = { startDate: "2026-04-01", monthlyProjection: "1500.00", projectedCompletionDate: "2026-06-01" };
    expect(await savedForecast(id)).toEqual(saved);

    // On the UTC date (31 Mar) three whole months remain, which would save 1000.00 completing 30 Jun.
    await runGoalStatusRecalculation();
    expect(await savedForecast(id)).toEqual(saved);
  });
});

describe("NEW-15: a forecast that needs a missing rate is unavailable", () => {
  it("reads a visible holdings goal priced in an unrated currency as unavailable, with no forecast number", async () => {
    pinClock("2026-01-31T10:00:00Z");
    const accountId = randomUUID();
    const securityId = randomUUID();
    const goalId = randomUUID();
    securityIds.push(securityId);
    await db.insert(accounts).values({ id: accountId, householdId, ownerUserId: userId, name: "Synthetic broker",
      type: "investment", currency: "ZMW", initialBalance: "0.00", balance: "0.00", isPrivate: false });
    await db.insert(securities).values({ id: securityId, symbol: `NF${securityId.slice(0, 8)}`, name: "Synthetic instrument",
      type: "stock", currency: UNRATED, currentPrice: "10.0000" });
    await db.insert(holdings).values({ householdId, accountId, securityId, quantity: "10", costBasis: "0" });
    await db.insert(goals).values({ id: goalId, householdId, name: "Synthetic holdings goal", type: "investment",
      goalType: "retirement", currency: "ZMW", targetAmount: "10000.00", currentAmount: "250.00", progressSource: "holdings",
      linkedAccountId: accountId, startDate: "2026-01-01", targetDate: "2026-12-31",
      monthlyProjection: "886.36", projectedCompletionDate: "2026-12-31" });

    const detail = await get(`/api/goals/${goalId}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.data).toMatchObject({ id: goalId, progressAvailability: "unavailable",
      currentAmount: null, monthlyProjection: null, projectedCompletionDate: null });

    const projection = await get(`/api/goals/${goalId}/projection`);
    expect(projection.status, JSON.stringify(projection.body)).toBe(200);
    expect(projection.body.data).toEqual({ availability: "unavailable", status: null, monthsRemaining: null,
      monthlyProjection: null, projectedCompletionDate: null });
  });
});
