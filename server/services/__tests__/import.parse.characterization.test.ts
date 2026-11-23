/**
 * Characterization tests for ImportService's CSV parsing helpers.
 *
 * Money forms retain the extraction characterization. FIN-15 deliberately
 * replaces native-date precedence and rollover with strict calendar validation
 * and an explicit choice for ambiguous slash ordering.
 */
import { describe, it, expect } from "vitest";
import {
  parseImportAmount as parseAmountFn,
  parseImportDate as parseDateFn,
} from "../import/parse";

const parseAmount = (raw: string | undefined, row = 0) =>
  parseAmountFn(raw, row);

const parseDate = (raw: string | undefined, row = 0) => parseDateFn(raw, row);

describe("parseImportAmount — accepted forms", () => {
  it("parses a plain decimal", () => {
    expect(parseAmount("12.34").amount?.toString()).toBe("12.34");
  });

  it("strips thousands separators", () => {
    expect(parseAmount("1,234.56").amount?.toString()).toBe("1234.56");
  });

  it("strips currency symbols and whitespace", () => {
    expect(parseAmount(" $1,000.00 ").amount?.toString()).toBe("1000.00");
    // Money.toString() normalizes to 2dp, so a bare "25" reads back "25.00".
    expect(parseAmount("£25").amount?.toString()).toBe("25.00");
    expect(parseAmount("€9.99").amount?.toString()).toBe("9.99");
  });

  it("treats parentheses as negative (accounting notation)", () => {
    expect(parseAmount("(50.00)").amount?.toString()).toBe("-50.00");
    expect(parseAmount("($1,250.75)").amount?.toString()).toBe("-1250.75");
  });

  it("accepts an explicit sign", () => {
    expect(parseAmount("-8.20").amount?.toString()).toBe("-8.20");
    expect(parseAmount("+8.20").amount?.toString()).toBe("8.20");
  });

  it("accepts a bare fractional amount", () => {
    expect(parseAmount(".50").amount?.toString()).toBe("0.50");
  });

  it("accepts an integer, normalizing to 2dp", () => {
    expect(parseAmount("42").amount?.toString()).toBe("42.00");
  });
});

describe("parseImportAmount — rejected forms", () => {
  it.each([undefined, "", "   "])("requires a value (%j)", (raw) => {
    const result = parseAmount(raw as string | undefined, 3);
    expect(result.amount).toBeUndefined();
    expect(result.error).toMatchObject({
      rowIndex: 3,
      field: "amount",
      reason: "Amount is required",
    });
  });

  it("rejects more than two decimal places rather than rounding", () => {
    // Silently rounding imported money would be a correctness bug, so the
    // parser must refuse the row instead.
    const result = parseAmount("1.234");
    expect(result.amount).toBeUndefined();
    expect(result.error?.reason).toMatch(/^Amount has more than 2 decimal places/);
  });

  it.each(["abc", "-", "1.2.3", "12-34", "1e5", "$", "()"])(
    "rejects malformed input (%s)",
    (raw) => {
      expect(parseAmount(raw).error?.reason).toBe("Invalid money amount");
    },
  );

  it("reports the trimmed original as the offending value", () => {
    expect(parseAmount("  abc  ").error?.value).toBe("abc");
  });

  it.each(["0", "0.00", "(0.00)", "-0.00"])(
    "rejects zero amounts (%s)",
    (raw) => {
      const result = parseAmount(raw);
      expect(result.amount).toBeUndefined();
      expect(result.error?.reason).toBe("Amount must be non-zero");
    },
  );
});

describe("parseImportDate", () => {
  it("parses an ISO date", () => {
    const result = parseDate("2026-03-14");
    expect(result.error).toBeUndefined();
    expect(result.date?.getUTCFullYear()).toBe(2026);
    expect(result.date?.getUTCMonth()).toBe(2);
    expect(result.date?.getUTCDate()).toBe(14);
  });

  it("accepts an unambiguous dd/MM/yyyy date", () => {
    const result = parseDate("25/12/2026");
    expect(result.error).toBeUndefined();
    expect(result.date?.getUTCMonth()).toBe(11);
    expect(result.date?.getUTCDate()).toBe(25);
  });

  it("requires explicit ordering for ambiguous slash dates", () => {
    const result = parseDate("01/02/2026");
    expect(result.date).toBeUndefined();
    expect(result.error?.reason).toMatch(/choose.*DD\/MM\/YYYY.*MM\/DD\/YYYY/i);
  });

  it.each([undefined, "", "   "])("requires a value (%j)", (raw) => {
    const result = parseDate(raw as string | undefined, 7);
    expect(result.date).toBeUndefined();
    expect(result.error).toMatchObject({
      rowIndex: 7,
      field: "date",
      reason: "Date is required",
    });
  });

  it.each(["not-a-date", "99/99/9999"])("rejects invalid dates (%s)", (raw) => {
    const result = parseDate(raw);
    expect(result.date).toBeUndefined();
    expect(result.error?.reason).toMatch(/^Invalid date/);
  });

  it.each(["2026-02-30", "2026-02-29", "1900-02-29", "04/31/2026"])(
    "rejects impossible calendar dates (%s)", (raw) => {
      expect(parseDate(raw, 4)).toMatchObject({
        error: { rowIndex: 4, field: "date", value: raw },
      });
      expect(parseDate(raw).date).toBeUndefined();
    },
  );
});
