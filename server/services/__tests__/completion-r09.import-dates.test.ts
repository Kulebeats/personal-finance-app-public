import { describe, it, expect } from "vitest";
import { parseImportDate, parseRows } from "../import/parse";
import { transactionImportSchema } from "../../modules/accounts/accounts.validation";

describe("FIN-15 actual import parser", () => {
  it.each([
    ["DD/MM/YYYY", "2026-02-01"],
    ["MM/DD/YYYY", "2026-01-02"],
  ] as const)("applies explicit %s", (dateFormat, expected) => {
    const parsed = parseRows([{ Date: "01/02/2026", Amount: "12.00" }],
      { date: "Date", amount: "Amount" }, dateFormat);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]?.dateString).toBe(expected);
    expect(parsed.rows[0]?.date.toISOString()).toBe(`${expected}T00:00:00.000Z`);
  });

  it("never produces writer rows for impossible or unresolved dates", () => {
    const parsed = parseRows([
      { Date: "2026-02-30", Amount: "12.00" },
      { Date: "01/02/2026", Amount: "12.00" },
      { Date: "2028-02-29", Amount: "12.00" },
    ], { date: "Date", amount: "Amount" });
    expect(parsed.rows.map(row => row.dateString)).toEqual(["2028-02-29"]);
    expect(parsed.errors).toMatchObject([
      { rowIndex: 1, field: "date", value: "2026-02-30" },
      { rowIndex: 2, field: "date", value: "01/02/2026" },
    ]);
  });

  it.each([
    ["2026-03-14", "2026-03-14"], ["25/12/2026", "2026-12-25"],
    ["12/25/2026", "2026-12-25"], ["2026/12/25", "2026-12-25"],
    ["March 14, 2026", "2026-03-14"], ["14 Mar 2026", "2026-03-14"],
    ["2000-02-29", "2000-02-29"], ["0099-12-31", "0099-12-31"],
    ["2026-03-14T00:30:00+14:00", "2026-03-14"],
    ["2026-03-14T23:30:00-11:00", "2026-03-14"],
  ])("keeps unambiguous %s", (raw, expected) => {
    const parsed = parseRows([{ d: raw, a: "1" }], { date: "d", amount: "a" });
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]?.dateString).toBe(expected);
    expect(parseImportDate(raw, 1).date?.toISOString()).toBe(`${expected}T00:00:00.000Z`);
  });

  it.each(["2026-02-30T12:00:00Z", "February 30, 2026", "2026-03-14T25:00:00Z",
    "2026-03-14T12:70:00Z", "2026-03-14T12:00:00+24:00"])("rejects malformed %s", raw => {
    expect(parseImportDate(raw, 3).error).toMatchObject({ rowIndex: 3, field: "date", value: raw });
  });

  it.each(["2026-02-30", "01/02/2026", "2026-2-1", "2026-03-14T00:00:00Z"])(
    "account request schema rejects noncanonical %s with field path (UNIT)", date => {
      const result = transactionImportSchema.safeParse({ transactions: [{ date, merchant: "Shop", amount: "1" }] });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].path).toEqual(["transactions", 0, "date"]);
    },
  );
});
