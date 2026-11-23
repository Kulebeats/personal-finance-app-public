/**
 * NEW-15 (goal part): the goal summary's "days away" for the next milestone
 * counted 30-day months. It now counts real calendar months from the
 * household's today. The clock is pinned to 2026-01-30T23:30Z, which is
 * already 31 Jan in Lusaka (the household zone) while UTC is still 30 Jan, so
 * the expected day counts differ from both 30-day months and the UTC date.
 * Real HTTP against real Postgres; nothing is mocked.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { auditLogs, goals, householdMembers, households, users } from "@shared/schema";
import { db, pool } from "../../../db";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { calendarClock } from "../../../services/householdCalendarToday";
import { calendarDaysForMonths } from "../../../services/goal/goalCalendarDays";

const password = "SyntheticGoalCalendar123!";
const householdId = randomUUID();
const PINNED_NOW = new Date("2026-01-30T23:30:00Z"); // Lusaka 31 Jan 01:30
const realNow = calendarClock.now;
let app: Awaited<ReturnType<typeof getTestApp>>;
let user: { id: string; cookie: string };

type Milestone = { goalId: string; milestone: string; daysAway: number };

async function milestoneFor(goalId: string): Promise<Milestone | undefined> {
  const response = await request(app).get("/api/goals/summary").set("Cookie", user.cookie).expect(200);
  return (response.body.data.upcomingMilestones as Milestone[]).find((item) => item.goalId === goalId);
}

describe("NEW-15 goal milestone days count household calendar months", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values({ id: householdId, name: "Synthetic calendar household", currency: "ZMW", timeZone: "Africa/Lusaka" });
    const id = randomUUID();
    const email = `goal-calendar-${id}@example.invalid`;
    await db.insert(users).values({ id, email, username: `goal-calendar-${id}`, passwordHash: await hashPassword(password), emailVerified: true });
    await db.insert(householdMembers).values({ householdId, userId: id, role: "owner" });
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    user = { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") };
    calendarClock.now = () => PINNED_NOW;
  }, 30_000);
  beforeEach(async () => { await db.delete(goals).where(eq(goals.householdId, householdId)); });
  afterAll(async () => {
    calendarClock.now = realNow;
    await db.delete(goals).where(eq(goals.householdId, householdId));
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    if (user) {
      await db.delete(auditLogs).where(eq(auditLogs.userId, user.id));
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [user.id]);
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("a save-up milestone 2.5 months away is 31 Jan → 31 Mar plus half of April: 74 days", async () => {
    const id = randomUUID();
    await db.insert(goals).values({ id, householdId, name: "Synthetic save-up", type: "save_up", goalType: "other",
      currency: "ZMW", targetAmount: "1000.00", currentAmount: "0.00", monthlyProjection: "100.00" });
    // 25% of 1000 at 100 a month is 2.5 months. 30-day months gave 75; the UTC date (30 Jan) also gives 75.
    expect(await milestoneFor(id)).toMatchObject({ milestone: "25%", daysAway: 74 });
  });

  it("a pay-down milestone three payments away is 31 Jan → 30 Apr: 89 days", async () => {
    const id = randomUUID();
    await db.insert(goals).values({ id, householdId, name: "Synthetic pay-down", type: "pay_down", goalType: "other",
      currency: "ZMW", targetAmount: "1000.00", currentAmount: "1000.00", monthlyPayment: "100.00", interestRate: "0" });
    // The balance reaches 750 or less after the third payment. 30-day months gave 90; the UTC date gives 90.
    expect(await milestoneFor(id)).toMatchObject({ milestone: "25%", daysAway: 89 });
  });
});

describe("calendarDaysForMonths", () => {
  it.each([
    ["2026-01-31", 1, 28], // clamps to 28 Feb
    ["2024-01-31", 1, 29], // leap year
    ["2026-01-15", 12, 365],
    ["2026-01-31", 2.5, 74],
    ["2026-03-01", 0.5, 16], // half of 31 March days, rounded up
    ["2026-03-01", 2.9999999999, 92], // float noise is not an extra day
    ["2026-03-01", 0, 0],
  ] as const)("%s + %s months is %s days", (today, months, days) => {
    expect(calendarDaysForMonths(today, months)).toBe(days);
  });
});
