/**
 * NEW-34 (RC-14): net-worth history says what it is built from — REAL DB.
 *
 * Without snapshots, `/reports/net-worth` answers with one point valued from
 * today's balances, and `/reports/net-worth/changes` then reported a total
 * change of 0.00 as if the year had been flat. Both now say whether the
 * history is recorded snapshots or today's value only, and the changes view
 * says it lacks the history to compare. The current-only point is dated on
 * the household calendar, not the UTC day.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { accounts, householdMembers, households, netWorthSnapshots, users } from "@shared/schema";
import { db } from "../../db";
import { calendarClock } from "../../services/householdCalendarToday";
import { netWorthReportRepository } from "../reports/NetWorthReportRepository";
import { createTestUser } from "../../__tests__/fixtures";

const RANGE = { from: "2026-01-01", to: "2026-12-31", interval: "month" as const, scope: "household" as const };
// 23:30 UTC on 31 October is already 1 November in Lusaka.
const HOUSEHOLD_NOW = new Date("2026-10-31T23:30:00Z");

describe("NEW-34 net-worth history coverage — real DB", () => {
  const currentOnlyId = randomUUID();
  const recordedId = randomUUID();
  const interiorGapId = randomUUID();
  const edgeGapId = randomUUID();
  const householdIds = [currentOnlyId, recordedId, interiorGapId, edgeGapId];
  const userIds: string[] = [];
  const realNow = calendarClock.now;

  async function seedHousehold(householdId: string): Promise<string> {
    const user = createTestUser({ email: `new34-nw-${randomUUID().slice(0, 8)}@example.com`, username: `n34nw-${randomUUID().slice(0, 12)}` });
    userIds.push(user.id);
    await db.insert(households).values({ id: householdId, name: "Net worth HH", currency: "ZMW", timeZone: "Africa/Lusaka" });
    await db.insert(users).values({
      id: user.id, email: user.email, username: user.username, passwordHash: user.passwordHash, fullName: user.fullName, emailVerified: true,
    });
    await db.insert(householdMembers).values({ householdId, userId: user.id, role: "owner" });
    await db.insert(accounts).values({
      householdId, name: "Current", type: "checking", currency: "ZMW",
      initialBalance: "1250.00", balance: "1250.00", isAsset: true, isPrivate: false, ownerUserId: null,
    });
    return user.id;
  }

  let currentOnlyUser: string;
  let recordedUser: string;
  let interiorGapUser: string;
  let edgeGapUser: string;
  const snapshot = (householdId: string, date: string, netWorth: string) =>
    ({ householdId, date, currency: "ZMW", totalAssets: netWorth, totalLiabilities: "0.00", netWorth });

  beforeAll(async () => {
    calendarClock.now = () => HOUSEHOLD_NOW;
    currentOnlyUser = await seedHousehold(currentOnlyId);
    recordedUser = await seedHousehold(recordedId);
    interiorGapUser = await seedHousehold(interiorGapId);
    edgeGapUser = await seedHousehold(edgeGapId);
    await db.insert(netWorthSnapshots).values([
      snapshot(recordedId, "2026-09-30", "1000.00"),
      snapshot(recordedId, "2026-10-31", "1250.00"),
      // Latest captures determine each month endpoint. February has no snapshot.
      snapshot(interiorGapId, "2026-01-29", "910.00"),
      snapshot(interiorGapId, "2026-01-31", "1000.00"),
      snapshot(interiorGapId, "2026-03-30", "1320.00"),
      snapshot(interiorGapId, "2026-03-31", "1400.00"),
      // January, at the start of the range, has no snapshot.
      snapshot(edgeGapId, "2026-02-28", "1000.00"),
      snapshot(edgeGapId, "2026-03-31", "1100.00"),
    ]);
  });

  afterAll(async () => {
    calendarClock.now = realNow;
    await db.delete(netWorthSnapshots).where(inArray(netWorthSnapshots.householdId, householdIds));
    await db.delete(accounts).where(inArray(accounts.householdId, householdIds));
    await db.delete(householdMembers).where(inArray(householdMembers.householdId, householdIds));
    await db.delete(households).where(inArray(households.id, householdIds));
    await db.delete(users).where(inArray(users.id, userIds));
  });

  it("without snapshots, the history is today's value only, dated on the household calendar", async () => {
    const report = await netWorthReportRepository.getNetWorth(currentOnlyId, { ...RANGE, userId: currentOnlyUser });
    expect(report.historyCoverage).toBe("current_only");
    expect(report.latest.date).toBe("2026-11-01");
    expect(report.latest.netWorth.amount).toBe("1250.00");
  });

  it("without snapshots, the changes view says it has no history instead of a flat year", async () => {
    const changes = await netWorthReportRepository.getNetWorthChanges(currentOnlyId, { from: RANGE.from, to: RANGE.to, userId: currentOnlyUser });
    expect(changes.historyCoverage).toBe("current_only");
    expect(changes.insufficientHistory).toBe(true);
    expect(changes.periods).toEqual([]);
    expect(changes.avgMonthlyChange).toBeNull();
  });

  it("with recorded snapshots, the changes are measured between them", async () => {
    const report = await netWorthReportRepository.getNetWorth(recordedId, { ...RANGE, userId: recordedUser });
    expect(report.historyCoverage).toBe("snapshots");
    const changes = await netWorthReportRepository.getNetWorthChanges(recordedId, { from: RANGE.from, to: RANGE.to, userId: recordedUser });
    expect(changes).toMatchObject({ historyCoverage: "snapshots", insufficientHistory: false });
    expect(changes.totalChange.amount).toBe("250.00");
    expect(changes.periods.map((period) => period.change.amount)).toEqual(["250.00"]);
    expect(changes.periods[0]).toMatchObject({ startPeriod: "2026-09-30", spansGap: false });
    // January to August, and November (started in Lusaka), have no snapshot; December has not started.
    expect(changes.missingMonths).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-11",
    ]);
  });

  it("a change across a missing interior month is marked as spanning the gap", async () => {
    const changes = await netWorthReportRepository.getNetWorthChanges(interiorGapId, { from: "2026-01-01", to: "2026-03-31", userId: interiorGapUser });
    expect(changes).toMatchObject({ historyCoverage: "snapshots", insufficientHistory: false, missingMonths: ["2026-02"] });
    expect(changes.periods).toHaveLength(1);
    expect(changes.periods[0]).toMatchObject({ period: "2026-03-31", startPeriod: "2026-01-31", spansGap: true });
    expect(changes.periods[0].change.amount).toBe("400.00");
    expect(changes.totalChange).toEqual({ amount: "400.00", currency: "ZMW" });
    expect(changes.avgMonthlyChange).toEqual({ amount: "200.00", currency: "ZMW" });
  });

  it("a range that has not started yet lists no missing month", async () => {
    // It is 1 November in the household; 15-30 November has not begun.
    const changes = await netWorthReportRepository.getNetWorthChanges(interiorGapId, { from: "2026-11-15", to: "2026-11-30", userId: interiorGapUser });
    expect(changes.missingMonths).toEqual([]);
  });

  it("a missing month at the edge of the range is listed, and the recorded change is consecutive", async () => {
    const changes = await netWorthReportRepository.getNetWorthChanges(edgeGapId, { from: "2026-01-01", to: "2026-03-31", userId: edgeGapUser });
    expect(changes).toMatchObject({ historyCoverage: "snapshots", insufficientHistory: false, missingMonths: ["2026-01"] });
    expect(changes.periods).toHaveLength(1);
    expect(changes.periods[0]).toMatchObject({ period: "2026-03-31", startPeriod: "2026-02-28", spansGap: false });
    expect(changes.avgMonthlyChange).toEqual({ amount: "100.00", currency: "ZMW" });
  });
});
