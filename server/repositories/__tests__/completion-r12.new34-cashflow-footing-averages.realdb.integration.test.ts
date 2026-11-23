/**
 * NEW-34: cash-flow totals foot to their rows, and averages skip future months — REAL DB.
 *
 * Fixture (Lusaka household, base ZMW): ZMW 1000.00 income and SZL 1.25
 * spending in each of September and October 2026, with SZL→ZMW at 24.33. Each
 * month's spending converts to 30.4125. November and December, which have not
 * started, already hold ZMW 1000.00 income each (salaries recorded ahead).
 *
 * - Footing (RC-11): each month shows 30.41, but the total was the rounded
 *   unrounded sum, 60.825 → 60.83, a cent more than its rows; income minus
 *   expenses then disagreed with savings.
 * - Averages (F-CF-01): a year view to 31 December counted November and
 *   December, which have not happened yet, as months. Dividing by the started
 *   months alone is not enough: their numerator must also leave out the rows
 *   already recorded for later months (4000 / 2 = 2000 a month, not 1000).
 * - Buckets (Astra 6.2): a custom range that starts mid-month is stepped from
 *   the SQL bucket start (1 September), not from the 15th, and month keys are
 *   UTC calendar days, so a server in Europe/London does not slide April to
 *   31 March across the spring clock change. A ZMW 700.00 April 2026 salary
 *   is in the fixture for that.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { accounts, fxRates, householdMembers, households, transactions, users } from "@shared/schema";
import { db } from "../../db";
import { Money } from "../../core/money";
import { calendarClock } from "../../services/householdCalendarToday";
import { cashflowReportRepository } from "../reports/CashflowReportRepository";
import { analyticsReportRepository } from "../reports/AnalyticsReportRepository";
import { createTestUser } from "../../__tests__/fixtures";

const FOREIGN = "SZL";
const RANGE = { from: "2026-09-01", to: "2026-12-31", interval: "month" as const, scope: "household" as const };
// 20 October 2026 in Lusaka: September and October have started, November and December have not.
const HOUSEHOLD_NOW = new Date("2026-10-20T10:00:00Z");

describe("NEW-34 cash-flow footing and elapsed-month averages — real DB", () => {
  const householdId = randomUUID();
  const zmwAccountId = randomUUID();
  const foreignAccountId = randomUUID();
  const rateId = randomUUID();
  let userId: string;
  const realNow = calendarClock.now;

  beforeAll(async () => {
    calendarClock.now = () => HOUSEHOLD_NOW;
    const user = createTestUser({ email: `new34-${randomUUID().slice(0, 8)}@example.com`, username: `n34-${randomUUID().slice(0, 12)}` });
    userId = user.id;
    await db.insert(households).values({ id: householdId, name: "Footing HH", currency: "ZMW", timeZone: "Africa/Lusaka" });
    await db.insert(users).values({
      id: user.id, email: user.email, username: user.username, passwordHash: user.passwordHash, fullName: user.fullName, emailVerified: true,
    });
    await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
    await db.insert(accounts).values([
      { id: zmwAccountId, householdId, name: "Salary", type: "checking", currency: "ZMW",
        initialBalance: "0.00", balance: "0.00", isPrivate: false, ownerUserId: null },
      { id: foreignAccountId, householdId, name: "Mbabane card", type: "checking", currency: FOREIGN,
        initialBalance: "0.00", balance: "0.00", isPrivate: false, ownerUserId: null },
    ]);
    await db.insert(fxRates).values({ id: rateId, fromCurrency: FOREIGN, toCurrency: "ZMW", rate: "24.3300", date: "2026-01-01", source: "manual" });
    const row = (accountId: string, type: "income" | "expense", currency: string, date: string, amount: string, name: string) =>
      ({ householdId, accountId, type, currency, date, amount, name, isPrivate: false, ownerUserId: null });
    await db.insert(transactions).values([
      row(zmwAccountId, "income", "ZMW", "2026-09-10", "1000.00", "September salary"),
      row(foreignAccountId, "expense", FOREIGN, "2026-09-12", "1.25", "September coffee"),
      row(zmwAccountId, "income", "ZMW", "2026-10-10", "1000.00", "October salary"),
      row(foreignAccountId, "expense", FOREIGN, "2026-10-12", "1.25", "October coffee"),
      // Already recorded for months that have not started: they must not enter the averages.
      row(zmwAccountId, "income", "ZMW", "2026-11-10", "1000.00", "November salary"),
      row(zmwAccountId, "income", "ZMW", "2026-12-10", "1000.00", "December salary"),
      row(zmwAccountId, "income", "ZMW", "2026-04-10", "700.00", "April salary"),
    ]);
  });

  afterAll(async () => {
    calendarClock.now = realNow;
    await db.delete(transactions).where(eq(transactions.householdId, householdId));
    await db.delete(fxRates).where(and(eq(fxRates.id, rateId), eq(fxRates.fromCurrency, FOREIGN)));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    await db.delete(users).where(inArray(users.id, [userId]));
  });

  const zmw = (value: string) => new Money(value, "ZMW");

  it("totals are the sum of the rounded months, and income minus expenses is savings", async () => {
    const report = await cashflowReportRepository.getCashflow(householdId, { ...RANGE, userId });
    const months = report.series.filter((point) => point.periodStart <= "2026-10-01");
    expect(months.map((point) => point.expenses.amount)).toEqual(["30.41", "30.41"]);
    expect(report.totals.expenses.amount).toBe("60.82");
    expect(report.totals.income.amount).toBe("4000.00");
    expect(report.totals.savings.amount).toBe("3939.18");

    const sumOf = (field: "income" | "expenses" | "savings") => report.series
      .reduce((sum, point) => sum.add(zmw(point[field].amount)), Money.zero("ZMW")).toString();
    expect(sumOf("expenses")).toBe(report.totals.expenses.amount);
    expect(sumOf("savings")).toBe(report.totals.savings.amount);
    expect(zmw(report.totals.income.amount).subtract(zmw(report.totals.expenses.amount)).toString())
      .toBe(report.totals.savings.amount);
  });

  it("reports how many months of the range have started on the household calendar", async () => {
    const report = await cashflowReportRepository.getCashflow(householdId, { ...RANGE, userId });
    expect(report.series).toHaveLength(4);
    expect(report.range.elapsedPeriods).toBe(2);
    // The averages' numerator: only the started months, whatever is recorded later in the range.
    expect(report.elapsedTotals).toEqual({
      income: { amount: "2000.00", currency: "ZMW" },
      expenses: { amount: "60.82", currency: "ZMW" },
      savings: { amount: "1939.18", currency: "ZMW" },
    });
  });

  it("a range starting mid-month is bucketed from the month's start: nothing dropped, every started month counted", async () => {
    // 10 October: September and October have started, though the range starts on the 15th.
    calendarClock.now = () => new Date("2026-10-10T10:00:00Z");
    try {
      const report = await cashflowReportRepository.getCashflow(householdId, {
        ...RANGE, from: "2026-09-15", to: "2026-10-31", userId,
      });
      expect(report.series.map((point) => point.periodStart)).toEqual(["2026-09-01", "2026-10-01"]);
      expect(report.series.map((point) => point.income.amount)).toEqual(["0.00", "1000.00"]);
      expect(report.totals.income.amount).toBe("1000.00");
      expect(report.totals.expenses.amount).toBe("30.41");
      expect(report.range.elapsedPeriods).toBe(2);
    } finally {
      calendarClock.now = () => HOUSEHOLD_NOW;
    }
  });

  it("a range wholly in the future has no elapsed months, even when its month has started", async () => {
    // 1 November: the month has started, but 5-30 November has not; November's salary (the 10th) is already entered.
    calendarClock.now = () => new Date("2026-11-01T10:00:00Z");
    try {
      const report = await cashflowReportRepository.getCashflow(householdId, {
        ...RANGE, from: "2026-11-05", to: "2026-11-30", userId,
      });
      expect(report.series.map((point) => point.income.amount)).toEqual(["1000.00"]);
      expect(report.range.elapsedPeriods).toBe(0);
      expect(report.elapsedTotals?.income.amount).toBe("0.00");
      const ratios = await analyticsReportRepository.getFinancialRatios(householdId, { from: "2026-11-05", to: "2026-11-30", userId });
      expect(ratios.ratios.dti.monthlyIncome.amount).toBe("0.00");
    } finally {
      calendarClock.now = () => HOUSEHOLD_NOW;
    }
  });

  it("month buckets are UTC calendar days on a Europe/London server, across the spring clock change", async () => {
    const hostZone = process.env.TZ;
    process.env.TZ = "Europe/London";
    try {
      const report = await cashflowReportRepository.getCashflow(householdId, {
        ...RANGE, from: "2026-02-01", to: "2026-04-30", userId,
      });
      expect(report.series.map((point) => point.periodStart)).toEqual(["2026-02-01", "2026-03-01", "2026-04-01"]);
      expect(report.series.map((point) => point.label)).toEqual(["Feb 2026", "Mar 2026", "Apr 2026"]);
      expect(report.series.map((point) => point.income.amount)).toEqual(["0.00", "0.00", "700.00"]);
    } finally {
      if (hostZone === undefined) delete process.env.TZ;
      else process.env.TZ = hostZone;
    }
  });

  it("monthly ratio averages divide by the months that have started", async () => {
    const ratios = await analyticsReportRepository.getFinancialRatios(householdId, { from: RANGE.from, to: RANGE.to, userId });
    expect(ratios.ratios.dti.monthlyIncome.amount).toBe("1000.00");
    expect(ratios.ratios.emergencyFund.monthlyExpenses.amount).toBe("30.41");
  });
});
