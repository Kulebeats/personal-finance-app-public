import { describe, expect, it } from "vitest";
import { groupByPeriod, monthEnd, monthRangeOf, sumField } from "../annualPeriods";

const zmw = (amount: string) => ({ amount, currency: "ZMW" });
// Twelve months of 2026; amounts chosen so float addition would drift (0.10 + 0.20).
const months = Array.from({ length: 12 }, (_, index) => ({
  periodStart: `2026-${String(index + 1).padStart(2, "0")}-01`,
  month: "label is never parsed",
  income: zmw(`${index + 1}00.10`),
  expenses: zmw("0.20"),
}));

describe("annual period adapter (R12.3)", () => {
  it("puts April in Q2 and every month in the quarter its periodStart names", () => {
    const quarters = groupByPeriod(months, "quarterly");
    expect(quarters.map((q) => [q.label, q.periodStart, q.periodEnd, q.rows.map((r) => r.periodStart.slice(5, 7))])).toEqual([
      ["Q1", "2026-01-01", "2026-03-31", ["01", "02", "03"]],
      ["Q2", "2026-04-01", "2026-06-30", ["04", "05", "06"]],
      ["Q3", "2026-07-01", "2026-09-30", ["07", "08", "09"]],
      ["Q4", "2026-10-01", "2026-12-31", ["10", "11", "12"]],
    ]);
  });

  it("makes each quarter equal the exact sum of its months, and the year the sum of its quarters", () => {
    const quarters = groupByPeriod(months, "quarterly");
    expect(quarters.map((q) => sumField(q, (m) => m.income))).toEqual([zmw("600.30"), zmw("1500.30"), zmw("2400.30"), zmw("3300.30")]);
    expect(quarters.map((q) => sumField(q, (m) => m.expenses))).toEqual([zmw("0.60"), zmw("0.60"), zmw("0.60"), zmw("0.60")]);
    const [year] = groupByPeriod(months, "annual");
    expect(year.label).toBe("2026");
    expect(sumField(year, (m) => m.income)).toEqual(zmw("7801.20"));
  });

  it("keeps twelve distinct months and groups halves by calendar month, whatever the input order", () => {
    const shuffled = [...months].reverse();
    expect(groupByPeriod(shuffled, "monthly").map((m) => m.label)).toEqual(
      ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
    expect(groupByPeriod(shuffled, "biannual").map((h) => [h.label, h.periodStart, h.periodEnd, h.rows.length])).toEqual([
      ["H1", "2026-01-01", "2026-06-30", 6], ["H2", "2026-07-01", "2026-12-31", 6]]);
  });

  it("gives month drill-down dates without a time-zone shift, leap years included", () => {
    expect(monthRangeOf("2026-01-01")).toEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(monthRangeOf("2026-04-01")).toEqual({ from: "2026-04-01", to: "2026-04-30" });
    expect(monthEnd(2028, 2)).toBe("2028-02-29");
  });

  it("refuses a periodStart that is not the first of a real month", () => {
    expect(() => groupByPeriod([{ periodStart: "Apr 2026" }], "quarterly")).toThrow("Invalid month periodStart");
    expect(() => monthRangeOf("2026-13-01")).toThrow("Invalid month periodStart");
  });
});
