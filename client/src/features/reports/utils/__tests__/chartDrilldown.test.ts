/**
 * Reports Chart Drill-Down Mapping Tests
 *
 * Verifies the mapping from clicked Reports chart segments (Cash Flow
 * Sankey nodes with server-provided `entityType`/`entityId` - see
 * server/repositories/reports/SankeyNodes.ts and
 * shared/reports.ts#ReportsSankeyResponse - and spending-breakdown pie
 * slices) to the filters `client/src/hooks/use-drilldown.ts#DrillDownFilters`
 * needs to build a correctly filtered `/transactions?...` link (audit v2
 * finding B3: the Sankey drill-down was a non-functional "Click to view
 * transaction details." stub, and the spending pie chart had no drill-down
 * wired at all).
 */
import { describe, it, expect } from "vitest";
import {
  sankeyNodeToDrillDownFilters,
  spendingItemToDrillDownFilters,
} from "../chartDrilldown";

describe("sankeyNodeToDrillDownFilters", () => {
  it("maps a category node to categoryId", () => {
    expect(
      sankeyNodeToDrillDownFilters({
        entityType: "category",
        entityId: "cat-123",
      }),
    ).toEqual({ categoryId: "cat-123" });
  });

  it("maps an account node to accountId", () => {
    expect(
      sankeyNodeToDrillDownFilters({
        entityType: "account",
        entityId: "acc-456",
      }),
    ).toEqual({ accountId: "acc-456" });
  });

  it("maps a categoryGroup node to type=expense (no categoryGroupId filter exists yet)", () => {
    expect(
      sankeyNodeToDrillDownFilters({
        entityType: "categoryGroup",
        entityId: "grp-789",
      }),
    ).toEqual({ type: "expense" });
  });

  it("maps the synthetic income node to type=income", () => {
    expect(
      sankeyNodeToDrillDownFilters({
        entityType: "synthetic",
        entityId: "income",
      }),
    ).toEqual({ type: "income" });
  });

  it("returns null for the synthetic savings node (not a transaction type)", () => {
    expect(
      sankeyNodeToDrillDownFilters({
        entityType: "synthetic",
        entityId: "savings",
      }),
    ).toBeNull();
  });

  it("returns null for the synthetic refunds node", () => {
    expect(
      sankeyNodeToDrillDownFilters({
        entityType: "synthetic",
        entityId: "refunds",
      }),
    ).toBeNull();
  });

  it("returns null for a category/account node missing entityId", () => {
    expect(sankeyNodeToDrillDownFilters({ entityType: "category" })).toBeNull();
    expect(sankeyNodeToDrillDownFilters({ entityType: "account" })).toBeNull();
  });

  it("returns null when entityType is missing entirely", () => {
    expect(sankeyNodeToDrillDownFilters({})).toBeNull();
  });

  it("returns null for an unrecognized entityType (merchant - not wired for Sankey yet)", () => {
    expect(
      sankeyNodeToDrillDownFilters({
        entityType: "merchant",
        entityId: "m-1",
      }),
    ).toBeNull();
  });
});

describe("spendingItemToDrillDownFilters", () => {
  it("maps a category-grouped slice to categoryId", () => {
    expect(spendingItemToDrillDownFilters("category", "cat-1")).toEqual({
      categoryId: "cat-1",
    });
  });

  it("maps a categoryGroup-grouped slice to type=expense (spending breakdown is always expense-type; no categoryGroupId filter exists yet)", () => {
    expect(spendingItemToDrillDownFilters("categoryGroup", "grp-1")).toEqual({
      type: "expense",
    });
  });

  it("returns null for a merchant-grouped slice (no merchant filter exists yet)", () => {
    expect(spendingItemToDrillDownFilters("merchant", "merch-1")).toBeNull();
  });

  // The server's synthetic buckets are not uuids, and the transactions API
  // has no "missing category/merchant" filter: categoryId=uncategorized
  // fails transactionQuerySchema's uuid check.
  it.each(["category", "categoryGroup", "merchant"] as const)(
    "does not drill into the synthetic Uncategorized / No merchant / Untagged slices (grouped by %s)",
    (groupBy) => {
      for (const id of ["uncategorized", "no-merchant", "untagged"]) {
        expect(spendingItemToDrillDownFilters(groupBy, id)).toBeNull();
      }
    },
  );
});

describe("sankeyNodeToDrillDownFilters synthetic buckets", () => {
  it("does not drill into the Uncategorized category or group node", () => {
    expect(
      sankeyNodeToDrillDownFilters({ entityType: "category", entityId: "uncategorized" }),
    ).toBeNull();
    expect(
      sankeyNodeToDrillDownFilters({ entityType: "categoryGroup", entityId: "uncategorized" }),
    ).toBeNull();
  });
});
