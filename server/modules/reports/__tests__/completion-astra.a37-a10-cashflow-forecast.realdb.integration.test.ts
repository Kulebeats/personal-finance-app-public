/**
 * A-37 and A-10 (Astra full-depth pass): the cash-flow forecast, over real
 * HTTP against real Postgres.
 *
 * - A-37: a recurring rule counts only from the month of its next due date. A
 *   rule first due in month three adds nothing to months one and two. The
 *   inclusive end-month behaviour (R14) is unchanged.
 * - A-10: a rule's amount is in its proven unit, not in whatever the
 *   household currency is now. After the household switches from ZMW to USD,
 *   a ZMW 100.00 rule is converted once at the household's dated rate, and
 *   the export carries the same unit. With no rate the forecast fails closed
 *   (422 MISSING_FX_RATE), never USD 100.00.
 *
 * Synthetic data only. The fixture household has no time zone, so its
 * calendar is UTC.
 */
import request from "supertest";
import { parse } from "csv-parse/sync";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dataExports, householdFxRateOverrides, households, recurringTransactions } from "@shared/schema";
import { db } from "../../../db";
import { a, actors, app, ids, resetAccountsAndMembership, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

type Actor = "owner" | "member";
type ForecastPoint = { periodStart: string; isForecast?: boolean; expenses: { amount: string; currency: string } };

const DAY_MS = 86_400_000;
const utcDay = (offset: number) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
const nextMonthStart = (offset: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1 + offset, 1)).toISOString().slice(0, 10);
};
const withDay = (monthStart: string, day: number) => `${monthStart.slice(0, 8)}${String(day).padStart(2, "0")}`;
const range = { from: utcDay(-30), to: utcDay(0) };

function signed(method: "get" | "post" | "put", path: string, who: Actor = "member") {
  const actor = actors.get(who)!;
  return request(app)[method](path).set("Cookie", actor.cookie)
    .set("X-Capital-Subject", actor.id).set("X-Capital-Household", a);
}

async function createRule(body: { name: string; amount: string; nextDueDate: string; endDate?: string }) {
  const response = await signed("post", "/api/recurring").send({
    accountId: ids.sharedAccount, type: "expense", frequency: "monthly", ...body,
    amount: { amount: body.amount, currency: "ZMW" },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data.id as string;
}

const forecastResponse = (months: number) => signed("get", "/api/reports/cashflow").query({
  ...range, interval: "month", includeForecast: "true", forecastMonths: String(months),
});

/** Forecast expenses per forecast month: "amount currency". */
async function forecastExpenses(months: number): Promise<Record<string, string>> {
  const response = await forecastResponse(months);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const points = response.body.data.series as ForecastPoint[];
  return Object.fromEntries(points.filter(point => point.isForecast)
    .map(point => [point.periodStart, `${point.expenses.amount} ${point.expenses.currency}`]));
}

const exportCashflow = (months: number, who: Actor) => signed("post", "/api/reports/exports", who).send({
  reportType: "cashflow", format: "csv", startDate: range.from, endDate: range.to, scope: "household",
  interval: "month", includeForecast: true, forecastMonths: months,
});

/** Forecast rows of the cash-flow CSV export: "expenses currency" per period. */
async function exportedForecastExpenses(months: number): Promise<Record<string, string>> {
  const created = await exportCashflow(months, "owner");
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  const download = await signed("get", `/api/reports/exports/${created.body.data.id}?download=true`, "owner").expect(200);
  const rows = parse(download.text, { columns: true, skip_empty_lines: true, record_delimiter: "\n" }) as Array<Record<string, string>>;
  return Object.fromEntries(rows.filter(row => row.dataType === "forecast")
    .map(row => [row.periodStart, `${row.expenses} ${row.currency}`]));
}

async function switchHouseholdTo(currency: string) {
  const response = await signed("put", "/api/household/general", "owner").send({ currency });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}

describe("A-37 / A-10: the cash-flow forecast counts a rule from its first due month, in its own unit", () => {
  beforeAll(start, 20_000);
  beforeEach(resetAccountsAndMembership);
  afterEach(async () => {
    await db.delete(recurringTransactions).where(eq(recurringTransactions.householdId, a));
    await db.delete(householdFxRateOverrides).where(eq(householdFxRateOverrides.householdId, a));
    await db.delete(dataExports).where(eq(dataExports.householdId, a));
    await db.update(households).set({ currency: "ZMW" }).where(eq(households.id, a));
  });
  afterAll(stop);

  it("A-37: a rule first due in month three adds nothing to months one and two; the end month is unchanged", async () => {
    const [m1, m2, m3, m4] = [0, 1, 2, 3].map(nextMonthStart);
    await createRule({ name: "A-37 starts in month three", amount: "30.00", nextDueDate: withDay(m3, 10) });
    // R14 control: due in month one, ends in month two, so months one and two count it and three and four do not.
    await createRule({ name: "A-37 ends in month two", amount: "7.00", nextDueDate: withDay(m1, 5), endDate: withDay(m2, 20) });

    expect(await forecastExpenses(4)).toEqual({
      [m1]: "7.00 ZMW", [m2]: "7.00 ZMW", [m3]: "30.00 ZMW", [m4]: "30.00 ZMW",
    });
  });

  it("refuses an ordinary member's household forecast export without creating an export", async () => {
    const response = await exportCashflow(2, "member");
    expect(response.status, JSON.stringify(response.body)).toBe(403);
    expect(response.body.error).toMatchObject({ code: "FORBIDDEN" });
    const exports = await db.select({ id: dataExports.id }).from(dataExports).where(eq(dataExports.householdId, a));
    expect(exports).toEqual([]);
  });

  it("A-10: after a switch to USD, a ZMW rule is converted once at the dated rate, on screen and in the export", async () => {
    const [m1, m2] = [0, 1].map(nextMonthStart);
    await createRule({ name: "A-10 ZMW rent", amount: "100.00", nextDueDate: withDay(m1, 3) });
    // Positive control: in the rule's own unit nothing converts.
    expect(await forecastExpenses(2)).toEqual({ [m1]: "100.00 ZMW", [m2]: "100.00 ZMW" });

    await switchHouseholdTo("USD");
    await db.insert(householdFxRateOverrides).values({
      householdId: a, actorUserId: actors.get("owner")!.id, fromCurrency: "ZMW", toCurrency: "USD",
      effectiveDate: utcDay(-1), validThrough: utcDay(60), rate: "0.05",
    });

    const expected = { [m1]: "5.00 USD", [m2]: "5.00 USD" };
    expect(await forecastExpenses(2)).toEqual(expected);
    expect(await exportedForecastExpenses(2)).toEqual(expected);
  });

  it("A-10: with no ZMW to USD rate the forecast fails closed and never shows USD 100.00", async () => {
    await createRule({ name: "A-10 ZMW rent unrated", amount: "100.00", nextDueDate: withDay(nextMonthStart(0), 3) });
    await switchHouseholdTo("USD");

    for (const response of [await forecastResponse(2), await exportCashflow(2, "owner")]) {
      expect(response.status, JSON.stringify(response.body)).toBe(422);
      expect(response.body.error).toMatchObject({ code: "MISSING_FX_RATE", details: { from: "ZMW", to: "USD" } });
      expect(JSON.stringify(response.body)).not.toContain("100.00");
    }
  });
});
