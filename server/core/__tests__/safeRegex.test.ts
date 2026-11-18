/**
 * Structural ReDoS screening for user-supplied regex patterns.
 *
 * The checker is deliberately conservative: it rejects the two shapes that make
 * backtracking exponential - an unbounded repetition nested inside another, and
 * a repeated group containing alternation - even in cases where a given
 * instance might have been harmless.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_REGEX_PATTERN_LENGTH,
  checkRegexSafety,
  compileSafeRegex,
} from "../safeRegex";

describe("checkRegexSafety", () => {
  const dangerous = [
    ["nested plus", "(a+)+$"],
    ["nested star", "(a*)*$"],
    ["star over plus", "(a+)*"],
    ["overlapping alternation", "(a|a)*$"],
    ["alternation under plus", "(foo|foobar)+"],
    ["quantified group of quantified atoms", "^(\\w+\\s?)*$"],
    ["nested bounded repetition", "(a{2,})+"],
    ["nesting behind a non-capturing group", "(?:a+)+"],
    ["nesting one level deeper", "((b|c+)*)"],
    ["character class under nested repetition", "([a-z]+)+"],
    // Security review, 2026-07-20: an extra layer of grouping defeated the
    // first version of this checker, because a closing group only propagated
    // its flags to the parent when that group was itself quantified. Each of
    // these was measured hanging (>3s at n=22) while reporting `safe: true`.
    ["double-wrapped nested plus", "((a+))+$"],
    ["triple-wrapped nested plus", "(((a+)))+$"],
    ["double-wrapped behind non-capturing group", "(?:(a+))+$"],
    ["double-wrapped behind named group", "(?<g>(a+))+$"],
    ["double-wrapped overlapping alternation", "((a|a))+$"],
    ["non-capturing wrapped alternation", "(?:(a|a))+$"],
    ["danger buried beside a sibling atom", "((a+)b)+$"],
  ] as const;

  it.each(dangerous)("rejects %s", (_label, pattern) => {
    const result = checkRegexSafety(pattern);
    expect(result.safe).toBe(false);
  });

  const benign = [
    ["plain literal", "grocery"],
    ["anchored prefix", "^shoprite"],
    ["wildcards around a literal", ".*grocery.*"],
    ["date shape", "^\\d{4}-\\d{2}-\\d{2}$"],
    ["unrepeated alternation", "(shoprite|pick n pay)"],
    ["repetition beside repetition, not nested", "\\w+\\s+\\d+"],
    ["optional group, bounded", "(inc)?"],
    ["repeated group with no inner repetition", "(ab)+"],
    ["character class repetition", "[a-z]+@[a-z]+"],
    ["escaped literal that looks like a quantifier", "price\\+\\+"],
    // An exact count is deterministic - it gives the engine no choice - so it
    // must not be mistaken for an open-ended repetition. Rejecting these was a
    // false positive found in security review on 2026-07-20.
    ["repeated group of exact-count digits", "(\\d{4})+"],
    ["exact repetition nested in exact repetition", "(a{100}){100}"],
    ["five exact-count groups (reference number)", "^\\d{4}-\\d{4}-\\d{4}-\\d{4}-\\d{4}$"],
    ["card-number shape", "^\\d{4}\\s?\\d{4}\\s?\\d{4}\\s?\\d{4}$"],
    ["realistic ATM narration", "^ATM WDL \\d{4}$"],
    ["realistic merchant alternation", "^(SHOPRITE|PICK N PAY)"],
    ["realistic reference shape", "^REF[A-Z0-9]{6,10}$"],
  ] as const;

  it.each(benign)("accepts %s", (_label, pattern) => {
    const result = checkRegexSafety(pattern);
    expect(result.safe).toBe(true);
  });

  it("rejects a pattern over the length cap", () => {
    const result = checkRegexSafety("a".repeat(MAX_REGEX_PATTERN_LENGTH + 1));
    expect(result.safe).toBe(false);
    expect(result.safe === false && result.reason).toContain(
      String(MAX_REGEX_PATTERN_LENGTH),
    );
  });

  it("accepts a pattern exactly at the length cap", () => {
    expect(checkRegexSafety("a".repeat(MAX_REGEX_PATTERN_LENGTH)).safe).toBe(true);
  });

  it("rejects a pile of sibling open-ended repetitions (polynomial blowup)", () => {
    const result = checkRegexSafety("^\\d+\\d+\\d+\\d+\\d+\\d+\\d+\\d+!$");
    expect(result.safe).toBe(false);
    expect(result.safe === false && result.reason).toMatch(/open-ended/i);
  });

  it("allows a pattern at the sibling-repetition cap", () => {
    expect(checkRegexSafety(".*a.*b.*c.*").safe).toBe(true);
  });

  it("correctly skips lookbehind prefixes without desyncing", () => {
    expect(checkRegexSafety("(?<=USD )\\d+").safe).toBe(true);
    expect(checkRegexSafety("(?<!USD )\\d+").safe).toBe(true);
    expect(checkRegexSafety("(?<amount>\\d+)").safe).toBe(true);
  });

  it("rejects invalid syntax with a distinct reason", () => {
    const result = checkRegexSafety("([unclosed");
    expect(result.safe).toBe(false);
    expect(result.safe === false && result.reason).toMatch(/valid regular expression/i);
  });

  it("explains why a nested-quantifier pattern was rejected", () => {
    const result = checkRegexSafety("(a+)+$");
    expect(result.safe === false && result.reason).toMatch(/exponential/i);
  });
});

describe("compileSafeRegex", () => {
  it("returns a working RegExp for a safe pattern", () => {
    const regex = compileSafeRegex("^shop", "i");
    expect(regex).not.toBeNull();
    expect(regex?.test("Shoprite")).toBe(true);
  });

  it("applies the flags it is given", () => {
    expect(compileSafeRegex("^shop", "i")?.test("SHOP")).toBe(true);
    expect(compileSafeRegex("^shop", "")?.test("SHOP")).toBe(false);
  });

  it("returns null rather than throwing for an unsafe pattern", () => {
    expect(compileSafeRegex("(a+)+$", "i")).toBeNull();
  });

  it("returns null rather than throwing for invalid syntax", () => {
    expect(compileSafeRegex("([unclosed", "i")).toBeNull();
  });
});
