/**
 * ReDoS (catastrophic backtracking) hardening for rule regex conditions.
 *
 * The vulnerability: `evaluateCondition` built `new RegExp(String(value), "i")`
 * straight from a user-supplied rule condition. The try/catch around it only
 * caught INVALID syntax; a VALID-but-pathological pattern such as `(a+)+$` or
 * `(a|a)*$` against a non-matching subject backtracks exponentially. Node is
 * single-threaded, so one such match blocks the entire event loop and denies
 * service to every household - not just the attacker's. Any authenticated
 * member can create a rule, and it executes on rule preview (up to 200
 * transactions), apply-to-past (unbounded), and live evaluation.
 *
 * These tests use an elapsed-time assertion rather than letting the match run
 * to completion, so a regression fails fast instead of hanging CI.
 */
import { describe, it, expect } from "vitest";
import type { Transaction } from "@shared/schema";
import { evaluateCondition } from "../matching";
import type { MerchantCache, RuleCondition } from "../types";

/**
 * Subject length for the exponential-blowup probe.
 *
 * `(a+)+$` against "aaa...a!" forces the engine to try every partition of the
 * run of 'a's: ~2^N backtracking steps. At N=25 that is ~33M steps, which takes
 * the unpatched matcher hundreds of milliseconds to seconds - far above the
 * 100ms budget asserted below - while the patched matcher rejects the pattern
 * in microseconds without ever running it.
 */
const BLOWUP_LENGTH = 25;
const EVIL_SUBJECT = `${"a".repeat(BLOWUP_LENGTH)}!`;

/** A match must never take longer than this. Patched code returns in ~0ms. */
const TIME_BUDGET_MS = 100;

function buildTransaction(name: string): Transaction {
  // Only `name` is read for a merchant_name condition; the rest of the row is
  // irrelevant to matching. Cast is confined to this test helper.
  return { name } as unknown as Transaction;
}

async function timeMatch(pattern: string, subject: string) {
  const condition: RuleCondition = {
    type: "merchant_name",
    operator: "regex",
    value: pattern,
  };
  const cache: MerchantCache = new Map();
  const startedAt = process.hrtime.bigint();
  const matched = await evaluateCondition(
    condition,
    buildTransaction(subject),
    "household-1",
    cache,
  );
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  return { matched, elapsedMs };
}

describe("rule regex conditions are ReDoS-safe", () => {
  it("does not hang on a nested-quantifier pattern", async () => {
    const { matched, elapsedMs } = await timeMatch("(a+)+$", EVIL_SUBJECT);

    expect(elapsedMs).toBeLessThan(TIME_BUDGET_MS);
    expect(matched).toBe(false);
  });

  it("does not hang on an overlapping-alternation pattern", async () => {
    const { matched, elapsedMs } = await timeMatch("(a|a)*$", EVIL_SUBJECT);

    expect(elapsedMs).toBeLessThan(TIME_BUDGET_MS);
    expect(matched).toBe(false);
  });

  it("does not hang on a quantified group of quantified alternation", async () => {
    const { matched, elapsedMs } = await timeMatch(
      "^(\\w+\\s?)*$",
      `${"x".repeat(BLOWUP_LENGTH)}!`,
    );

    expect(elapsedMs).toBeLessThan(TIME_BUDGET_MS);
    expect(matched).toBe(false);
  });

  it("does not hang on a double-wrapped nested quantifier", async () => {
    // The bypass a security review found against the first version of the
    // checker: one extra pair of parentheses around `(a+)`.
    const { matched, elapsedMs } = await timeMatch("((a+))+$", EVIL_SUBJECT);

    expect(elapsedMs).toBeLessThan(TIME_BUDGET_MS);
    expect(matched).toBe(false);
  });

  it("does not hang on a non-capturing double-wrapped alternation", async () => {
    const { matched, elapsedMs } = await timeMatch("(?:(a|a))+$", EVIL_SUBJECT);

    expect(elapsedMs).toBeLessThan(TIME_BUDGET_MS);
    expect(matched).toBe(false);
  });

  it("still matches ordinary user patterns", async () => {
    const { matched } = await timeMatch("^shop.*rite$", "Shop and Rite");
    expect(matched).toBe(true);
  });

  it("still returns false for a non-matching ordinary pattern", async () => {
    const { matched } = await timeMatch("^grocer", "Fuel Station");
    expect(matched).toBe(false);
  });

  it("still returns false for an invalid pattern instead of throwing", async () => {
    const { matched } = await timeMatch("([unclosed", "anything");
    expect(matched).toBe(false);
  });
});
