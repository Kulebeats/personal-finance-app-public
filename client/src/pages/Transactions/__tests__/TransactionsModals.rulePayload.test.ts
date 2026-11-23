import { describe, expect, it } from "vitest";
import * as TransactionsModalsModule from "../TransactionsModals";

type Selection = {
  merchant: string;
  categoryId: string | null;
  tagIds: string[];
  matchType?: "exact" | "contains";
  applyToExisting?: boolean;
};
const build = Reflect.get(TransactionsModalsModule, "buildTransactionRulePayload") as (selection: Selection) => unknown;

describe("transaction modal rule payload", () => {
  it("emits server-authorized IDs from a labeled category and existing tag selection", () => {
    const categoryId = "11111111-1111-4111-8111-111111111111";
    const tagId = "22222222-2222-4222-8222-222222222222";
    expect(build({ merchant: "Shoprite", categoryId, tagIds: [tagId], matchType: "exact", applyToExisting: true }))
      .toEqual({
        name: "Auto: Shoprite",
        conditions: [{ type: "merchant_name", operator: "equals", value: "Shoprite" }],
        actions: [{ type: "categorize", value: categoryId }, { type: "add_tags", value: [tagId] }],
        applyToPast: true,
      });
  });

  it("creates a tag-only rule when the transaction has no category", () => {
    const tagId = "22222222-2222-4222-8222-222222222222";
    expect(build({ merchant: "Market", categoryId: null, tagIds: [tagId], matchType: "contains", applyToExisting: false }))
      .toEqual({
        name: "Auto: Market",
        conditions: [{ type: "merchant_name", operator: "contains", value: "Market" }],
        actions: [{ type: "add_tags", value: [tagId] }],
        applyToPast: false,
      });
  });
});
