/**
 * R11: a preset's stored JSON is read through the URL filter contract, so it
 * can only produce values the plain Transactions filter accepts.
 */
import { describe, expect, it } from "vitest";
import { defaultFilters } from "../types";
import { presetToTransactionFilters, transactionFiltersToPreset } from "../filterPresetFilters";

describe("preset filters JSON", () => {
  it("round-trips filters, keeping dates as local calendar days", () => {
    const filters = {
      ...defaultFilters, categoryId: "cat-1", tagIds: ["tag-1", "tag-2"], startDate: new Date(2026, 10, 1),
      endDate: new Date(2026, 10, 30), amountMin: 10.5, type: "expense" as const, owner: "mine" as const,
    };
    const stored = JSON.parse(JSON.stringify(transactionFiltersToPreset(filters)));
    expect(stored).toMatchObject({ startDate: "2026-11-01", endDate: "2026-11-30" });
    expect(presetToTransactionFilters(stored)).toEqual(filters);
  });

  it("drops values the plain filter would reject and reads an older ISO date", () => {
    const iso = new Date(2026, 1, 3).toISOString();
    expect(presetToTransactionFilters({
      type: "everything", owner: "someone-else", reviewed: 7, tagIds: ["tag-1", 9], startDate: iso,
      endDate: "2026-02-30", amountMax: "lots", accountId: { id: "acc-1" }, unknownField: "x",
    })).toEqual({ ...defaultFilters, tagIds: ["tag-1"], startDate: new Date(2026, 1, 3) });
    expect(presetToTransactionFilters(null)).toEqual(defaultFilters);
    expect(presetToTransactionFilters(["not", "an", "object"])).toEqual(defaultFilters);
  });
});
