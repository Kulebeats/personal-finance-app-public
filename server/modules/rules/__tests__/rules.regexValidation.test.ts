/**
 * Rule create/update must refuse a ReDoS-prone regex condition at the write
 * path, so a pathological pattern is never persisted in the first place.
 *
 * The execution-path guard in `services/rule/matching.ts` stays as defence in
 * depth for rules stored before this validation existed.
 */
import { describe, it, expect } from "vitest";
import { createRuleSchema, updateRuleSchema } from "../rules.validation";

function ruleWithCondition(value: string, operator = "regex") {
  return {
    name: "Pathological rule",
    conditions: [{ type: "merchant_name", operator, value }],
    actions: [{ type: "mark_reviewed" }],
  };
}

describe("createRuleSchema regex safety", () => {
  it("rejects a nested-quantifier pattern", () => {
    const result = createRuleSchema.safeParse(ruleWithCondition("(a+)+$"));

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0].message).toMatch(
      /exponential/i,
    );
  });

  it("rejects an overlapping-alternation pattern", () => {
    expect(createRuleSchema.safeParse(ruleWithCondition("(a|a)*$")).success).toBe(
      false,
    );
  });

  it("rejects an over-long pattern", () => {
    expect(
      createRuleSchema.safeParse(ruleWithCondition("a".repeat(500))).success,
    ).toBe(false);
  });

  it("rejects an invalid pattern", () => {
    expect(
      createRuleSchema.safeParse(ruleWithCondition("([unclosed")).success,
    ).toBe(false);
  });

  it("points the validation error at the offending condition value", () => {
    const result = createRuleSchema.safeParse(ruleWithCondition("(a+)+$"));

    expect(result.success === false && result.error.issues[0].path).toEqual([
      "conditions",
      0,
      "value",
    ]);
  });

  it("accepts an ordinary pattern", () => {
    expect(
      createRuleSchema.safeParse(ruleWithCondition("^shoprite")).success,
    ).toBe(true);
  });

  it("leaves non-regex operators alone", () => {
    expect(
      createRuleSchema.safeParse(ruleWithCondition("(a+)+$", "contains")).success,
    ).toBe(true);
  });

  it("rejects a regex condition whose value is not a single string", () => {
    const result = createRuleSchema.safeParse({
      name: "Array value",
      conditions: [
        { type: "merchant_name", operator: "regex", value: ["a", "b"] },
      ],
      actions: [{ type: "mark_reviewed" }],
    });

    expect(result.success).toBe(false);
  });
});

describe("updateRuleSchema regex safety", () => {
  it("rejects a pathological pattern on update too", () => {
    const result = updateRuleSchema.safeParse({
      conditions: [{ type: "merchant_name", operator: "regex", value: "(a+)+$" }],
    });

    expect(result.success).toBe(false);
  });

  it("accepts an ordinary pattern on update", () => {
    const result = updateRuleSchema.safeParse({
      conditions: [{ type: "merchant_name", operator: "regex", value: "^shop" }],
    });

    expect(result.success).toBe(true);
  });
});
