/**
 * NEW-15: cash-flow buckets are calendar days — REAL DB.
 *
 * `transactions.date` is a `date` column, already a calendar day. The query
 * bucketed it as `date_trunc(i, (t.date::timestamp AT TIME ZONE tz))::date`:
 * `AT TIME ZONE` turns the day into an instant at local midnight, and
 * date_trunc and ::date then run in the session zone. On a UTC session a
 * Lusaka (UTC+2) household's transaction on 1 October landed in September
 * and every daily bucket moved back a day.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { accounts, householdMembers, households, transactions, users } from "@shared/schema";
import { db } from "../../db";
import { cashflowReportRepository } from "../reports/CashflowReportRepository";
import { createTestUser } from "../../__tests__/fixtures";

const LUSAKA = "Africa/Lusaka";

describe("NEW-15 cash-flow buckets for a Lusaka household — real DB", () => {
  const householdId = randomUUID();
  const accountId = randomUUID();
  let userId: string;

  beforeAll(async () => {
    const user = createTestUser({ email: `new15-cf-${randomUUID().slice(0, 8)}@example.com`, username: `n15cf-${randomUUID().slice(0, 12)}` });
    userId = user.id;
    await db.insert(households).values({ id: householdId, name: "Cashflow clock HH", currency: "ZMW" });
    await db.insert(users).values({
      id: user.id, email: user.email, username: user.username, passwordHash: user.passwordHash, fullName: user.fullName, emailVerified: true,
    });
    await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
    await db.insert(accounts).values({
      id: accountId, householdId, name: "Shared current", type: "checking", currency: "ZMW",
      initialBalance: "0.00", balance: "0.00", isPrivate: false, ownerUserId: null,
    });
    await db.insert(transactions).values({
      householdId, accountId, type: "expense", currency: "ZMW", date: "2026-10-01", amount: "100.00",
      name: "First-of-month rent", isPrivate: false, ownerUserId: null,
    });
  });

  afterAll(async () => {
    await db.delete(transactions).where(eq(transactions.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    await db.delete(users).where(inArray(users.id, [userId]));
  });

  const expensesIn = (series: Array<{ periodStart: string; expenses: { amount: string } }>, periodStart: string) =>
    series.find((point) => point.periodStart === periodStart)?.expenses.amount ?? "0.00";

  it("a transaction on 1 October is in the October month bucket", async () => {
    const report = await cashflowReportRepository.getCashflow(householdId, {
      from: "2026-09-01", to: "2026-10-31", interval: "month", timezone: LUSAKA, scope: "household", userId,
    });
    expect(expensesIn(report.series, "2026-10-01")).toBe("100.00");
    expect(expensesIn(report.series, "2026-09-01")).toBe("0.00");
  });

  it("a transaction on 1 October is in the 1 October day bucket", async () => {
    const report = await cashflowReportRepository.getCashflow(householdId, {
      from: "2026-09-30", to: "2026-10-02", interval: "day", timezone: LUSAKA, scope: "household", userId,
    });
    expect(expensesIn(report.series, "2026-10-01")).toBe("100.00");
    expect(expensesIn(report.series, "2026-09-30")).toBe("0.00");
  });
});
