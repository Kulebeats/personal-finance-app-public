import { describe, it, expect } from "vitest";
import { buildCreateRulePayload } from "../components/QuickRuleBuilder";

/**
 * The quick rule builder draft has no condition-logic control, yet
 * CreateRuleData requires `conditionLogic`. buildCreateRulePayload is the
 * boundary that converts the loose UI draft into a typed CreateRuleData payload
 * and supplies the missing default. These tests lock in that contract.
 */
describe("buildCreateRulePayload", () => {
  const draft = {
    name: "Shoprite -> Groceries",
    conditions: [
      {
        type: "merchant_name",
        operator: "contains",
        value: "Shoprite",
        value2: "",
      },
    ],
    actions: [{ type: "categorize", value: "cat-groceries" }],
    enabled: true,
    applyToPast: false,
  };

  it("defaults conditionLogic to 'all' (the quick builder has no logic control)", () => {
    const payload = buildCreateRulePayload(draft);

    expect(payload.conditionLogic).toBe("all");
  });

  it("maps the draft into a complete CreateRuleData payload", () => {
    const payload = buildCreateRulePayload(draft);

    expect(payload).toEqual({
      name: "Shoprite -> Groceries",
      conditionLogic: "all",
      conditions: [
        { type: "merchant_name", operator: "contains", value: "Shoprite" },
      ],
      actions: [{ type: "categorize", value: "cat-groceries" }],
      enabled: true,
      applyToPast: false,
    });
  });

  it("preserves a meaningful condition value2 (e.g. amount range max)", () => {
    const rangeDraft = {
      name: "Big purchases",
      conditions: [
        { type: "amount", operator: "range", value: "100", value2: "500" },
      ],
      actions: [{ type: "categorize", value: "cat-1" }],
      enabled: true,
      applyToPast: false,
    };

    const payload = buildCreateRulePayload(rangeDraft);

    expect(payload.conditions[0]).toEqual({
      type: "amount",
      operator: "range",
      value: "100",
      value2: "500",
    });
  });
});
