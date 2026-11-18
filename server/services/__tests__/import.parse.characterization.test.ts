/**
 * Characterization tests for ImportService's CSV parsing helpers.
 *
 * WHY: these pin the exact current behaviour of the money/date parsers ahead of
 * the ImportService split (LOC burn-down). They are written against the
 * pre-split implementation and must pass UNCHANGED against the extracted
 * `services/import/parse.ts` — that equivalence is the proof the refactor is
 * behaviour-preserving. This is CSV import of real financial data, so silent
 * drift in `parseImportAmount` would corrupt imported ledgers.
 *
 * Originally these reached the private methods on the ImportService class; they
 * now target the extracted pure module and pass with every assertion unchanged.
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
    expect(result.error?.reason).toBe("Invalid money amount");
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

  it("falls back to dd/MM/yyyy only when the native parse fails", () => {
    // 25/12/2026 is unparseable natively (month 25), so the dd/MM fallback
    // resolves it to 25 December.
    const result = parseDate("25/12/2026");
    expect(result.error).toBeUndefined();
    expect(result.date?.getMonth()).toBe(11);
    expect(result.date?.getDate()).toBe(25);
  });

  it("lets the native parser win on ambiguous slash dates (MM/dd wins)", () => {
    // Pinning the known ambiguity: "01/02/2026" is natively valid as 2 January,
    // so the dd/MM fallback never runs. Documented, not endorsed.
    const result = parseDate("01/02/2026");
    expect(result.error).toBeUndefined();
    expect(result.date?.getMonth()).toBe(0);
    expect(result.date?.getDate()).toBe(2);
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
    expect(result.error?.reason).toBe("Invalid date");
  });
});
