/**
 * Custom chart totals are Money, not float sums — REAL DB.
 *
 * Fixture (Lusaka household, base ZMW): spending of ZMW 0.10, 0.20 and 0.30 in
 * January, February and March 2026, and the same amounts as income. Summed as
 * JavaScript numbers the total is 0.6000000000000001 and the monthly average
 * 0.20000000000000004; in Money they are 0.60 and 0.20.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { accounts, householdMembers, households, transactions, users } from "@shared/schema";
import { db } from "../../db";
import { calendarClock } from "../../services/householdCalendarToday";
import { analyticsReportRepository } from "../reports/AnalyticsReportRepository";
import { createTestUser } from "../../__tests__/fixtures";

// 15 April 2026 in Lusaka: January to March have all happened.
const HOUSEHOLD_NOW = new Date("2026-04-15T10:00:00Z");
const RANGE = { from: "2026-01-01", to: "2026-03-31" };

describe("custom chart totals in Money — real DB", () => {
  const householdId = randomUUID();
  const accountId = randomUUID();
  let userId: string;
  const realNow = calendarClock.now;

  beforeAll(async () => {
    calendarClock.now = () => HOUSEHOLD_NOW;
    const user = createTestUser({ email: `chart-${randomUUID().slice(0, 8)}@example.com`, username: `ch-${randomUUID().slice(0, 12)}` });
    userId = user.id;
    await db.insert(households).values({ id: householdId, name: "Chart HH", currency: "ZMW", timeZone: "Africa/Lusaka" });
    await db.insert(users).values({
      id: user.id, email: user.email, username: user.username, passwordHash: user.passwordHash, fullName: user.fullName, emailVerified: true,
    });
    await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
    await db.insert(accounts).values({ id: accountId, householdId, name: "Wallet", type: "checking", currency: "ZMW",
      initialBalance: "0.00", balance: "0.00", isPrivate: false, ownerUserId: null });
    const row = (type: "income" | "expense", date: string, amount: string) =>
      ({ householdId, accountId, type, currency: "ZMW", date, amount, name: `${type} ${date}`, isPrivate: false, ownerUserId: null });
    await db.insert(transactions).values([
      row("expense", "2026-01-12", "0.10"), row("expense", "2026-02-12", "0.20"), row("expense", "2026-03-12", "0.30"),
      row("income", "2026-01-10", "0.10"), row("income", "2026-02-10", "0.20"), row("income", "2026-03-10", "0.30"),
    ]);
  });

  afterAll(async () => {
    calendarClock.now = realNow;
    await db.delete(transactions).where(eq(transactions.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    await db.delete(users).where(inArray(users.id, [userId]));
  });

  it("sums and averages a monthly series to the ngwee", async () => {
    const chart = await analyticsReportRepository.executeCustomChart(householdId, {
      config: { name: "Spend", chartType: "bar", primaryMetric: "expenses", secondaryMetric: "income" },
      ...RANGE, userId,
    });
    expect(chart.data.map((point) => point.primary)).toEqual([0.1, 0.2, 0.3]);
    expect(chart.totals.primary).toBe(0.6);
    expect(chart.totals.secondary).toBe(0.6);
    expect(chart.totals.average).toBe(0.2);
  });
});
