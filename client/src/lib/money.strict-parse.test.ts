/**
 * Strict money-string validation (isParsableMoneyString).
 *
 * parseMoneyString coerces garbage to 0 for resilient display paths; import
 * and form validation must instead REJECT anything Decimal cannot parse,
 * including partial numerics that lenient float parsing silently truncates.
 */
import { describe, expect, it } from "vitest";
import {
  calculateMoneyProgressPercent,
  isParsableMoneyString,
  parseMoneyInputNumber,
  parseMoneyString,
} from "./money";

describe("isParsableMoneyString", () => {
  it("accepts plain and signed decimal strings", () => {
    expect(isParsableMoneyString("1250.75")).toBe(true);
    expect(isParsableMoneyString("-42")).toBe(true);
    expect(isParsableMoneyString("0")).toBe(true);
    expect(isParsableMoneyString(" 19.99 ")).toBe(true);
    expect(isParsableMoneyString(12.5)).toBe(true);
  });

  it("rejects partial numerics that lenient float parsing would accept", () => {
    expect(isParsableMoneyString("12abc")).toBe(false);
    expect(isParsableMoneyString("12.34.56")).toBe(false);
    expect(isParsableMoneyString("$50")).toBe(false);
  });

  it("rejects non-finite values Decimal would otherwise parse", () => {
    expect(isParsableMoneyString("NaN")).toBe(false);
    expect(isParsableMoneyString("Infinity")).toBe(false);
    expect(isParsableMoneyString("-Infinity")).toBe(false);
  });

  it("rejects empty and non-values", () => {
    expect(isParsableMoneyString("")).toBe(false);
    expect(isParsableMoneyString("   ")).toBe(false);
    expect(isParsableMoneyString(null)).toBe(false);
    expect(isParsableMoneyString(undefined)).toBe(false);
    expect(isParsableMoneyString("not a number")).toBe(false);
  });

  it("stays consistent with parseMoneyString on valid input", () => {
    expect(parseMoneyString("1250.75").toString()).toBe("1250.75");
  });
});

describe("parseMoneyInputNumber", () => {
  it("normalizes valid grouped input through Decimal parsing", () => {
    expect(parseMoneyInputNumber("1,234.56")).toBe(1234.56);
    expect(parseMoneyInputNumber("-1,234.56")).toBe(-1234.56);
  });

  it("rejects partial and malformed numeric strings instead of truncating them", () => {
    expect(parseMoneyInputNumber("12abc")).toBeNull();
    expect(parseMoneyInputNumber("12,34")).toBeNull();
    expect(parseMoneyInputNumber("Infinity")).toBeNull();
  });

  it("treats empty input as no amount", () => {
    expect(parseMoneyInputNumber("")).toBeNull();
    expect(parseMoneyInputNumber("   ")).toBeNull();
    expect(parseMoneyInputNumber(null)).toBeNull();
    expect(parseMoneyInputNumber(undefined)).toBeNull();
  });
});

describe("calculateMoneyProgressPercent", () => {
  it("calculates progress with Decimal arithmetic", () => {
    expect(calculateMoneyProgressPercent("0.30", "1.20")).toBe(25);
    expect(calculateMoneyProgressPercent("1,250.00", "5,000.00")).toBe(25);
  });

  it("returns zero when the target is absent, invalid, or not positive", () => {
    expect(calculateMoneyProgressPercent("100", "0")).toBe(0);
    expect(calculateMoneyProgressPercent("100", "")).toBe(0);
    expect(calculateMoneyProgressPercent("100", "not-a-number")).toBe(0);
  });
});
