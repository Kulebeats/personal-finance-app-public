import { describe, expect, it } from "vitest";
import { restoreCsvFormulaText } from "@shared/csv-formula";
import { CsvDecimal, csvMoney, neutralizeCsvFormula, sanitizeCsvRow } from "../csv";

const prefixes = ["=", "+", "-", "@", "\t", "\r"];

describe("neutralizeCsvFormula", () => {
  it.each(prefixes)("neutralizes text starting with %j and keeps the original text", prefix => {
    expect(neutralizeCsvFormula(`${prefix}1+1`)).toBe(`'${prefix}1+1`);
  });

  it.each(["=", "+", "-", "@"].flatMap(prefix => [` ${prefix}1+1`, `\t${prefix}1+1`, `  ${prefix}1+1`]))(
    "neutralizes %j where whitespace precedes a formula character", text => {
      expect(neutralizeCsvFormula(text)).toBe(`'${text}`);
    });

  // A tab or CR after a space is only more leading whitespace; what follows it
  // ("1+1") is not a formula, so the cell stays as written.
  it.each([" \t1+1", " \r1+1", "  \t1+1"])("leaves %j unchanged: no formula character after the whitespace", text => {
    expect(neutralizeCsvFormula(text)).toBe(text);
  });

  it.each(["Groceries", " Groceries", "1+1", "", "a=b", "Comma, Control"])("leaves benign text %j unchanged", text => {
    expect(neutralizeCsvFormula(text)).toBe(text);
  });

  // P2-3 (#367 review): the account importer removes one apostrophe before formula-like text, so text
  // that already starts that way must get its own prefix or it loses the apostrophe on the way back.
  it.each(["'=x", "'-refund", "'@home"])("prefixes %j, which already starts with an apostrophe before a formula", text => {
    expect(neutralizeCsvFormula(text)).toBe(`'${text}`);
  });

  it.each(["'=x", "'-refund", "''=x", "'tis", "=1+1", " -2", "Groceries", ""])("round-trips %j through export and import", text => {
    expect(restoreCsvFormulaText(neutralizeCsvFormula(text))).toBe(text);
  });
});

describe("csvMoney", () => {
  it.each([["12.5", "12.50"], ["-25.5", "-25.50"], ["0", "0.00"], ["100.00", "100.00"], ["1234567.891", "1234567.89"]])(
    "writes %s as the fixed two-decimal cell %s", (amount, expected) => {
      expect(csvMoney({ amount, currency: "ZMW" }).text).toBe(expected);
    });

  it("writes an absent amount as 0.00", () => {
    expect(csvMoney(undefined).text).toBe("0.00");
  });

  it("throws on a malformed amount instead of writing zero", () => {
    expect(() => csvMoney({ amount: "not-a-number", currency: "ZMW" })).toThrow();
    expect(() => new CsvDecimal("12.5")).toThrow();
  });
});

describe("sanitizeCsvRow", () => {
  it("writes a negative CsvDecimal amount as a number and still neutralizes negative-looking text", () => {
    expect(sanitizeCsvRow(["Groceries", new CsvDecimal("-58.12"), "-58.12"])).toBe("Groceries,-58.12,'-58.12");
  });
});
