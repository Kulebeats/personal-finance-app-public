/**
 * transactionFilterParams Tests
 *
 * Verifies the URL <-> TransactionFilters contract (R8): parse/serialize
 * round-trip for every supported filter, default omission, invalid-value
 * fallback, and the buildTransactionsUrl convenience helper used by
 * cross-section deep-links (CommandPalette, AccountDetail, useDrillDown).
 */
import { describe, it, expect } from "vitest";
import {
  TRANSACTION_FILTER_PARAM_KEYS,
  buildTransactionsUrl,
  parseTransactionFilterParams,
  serializeTransactionFilterParams,
} from "../transactionFilterParams";
import { defaultFilters, type TransactionFilters } from "../types";

const FULL_FILTERS: TransactionFilters = {
  search: "coffee",
  accountId: "acc-1",
  categoryId: "cat-2",
  tagIds: ["tag-a", "tag-b"],
  startDate: new Date(2024, 0, 1),
  endDate: new Date(2024, 0, 31),
  amountMin: 10,
  amountMax: 500,
  type: "expense",
  reviewed: "unreviewed",
  owner: "mine",
};

describe("transactionFilterParams", () => {
  describe("TRANSACTION_FILTER_PARAM_KEYS", () => {
    it("defines a stable, human-readable key for every filter field", () => {
      expect(TRANSACTION_FILTER_PARAM_KEYS).toEqual({
        search: "q",
        accountId: "accountId",
        categoryId: "categoryId",
        tagIds: "tags",
        startDate: "from",
        endDate: "to",
        amountMin: "amountMin",
        amountMax: "amountMax",
        type: "type",
        reviewed: "reviewed",
        owner: "owner",
      });
    });
  });

  describe("serializeTransactionFilterParams", () => {
    it("produces no params for default filters", () => {
      const params = serializeTransactionFilterParams(defaultFilters);
      expect(params.toString()).toBe("");
    });

    it("produces no params for an empty partial filter object", () => {
      const params = serializeTransactionFilterParams({});
      expect(params.toString()).toBe("");
    });

    it("serializes search text under q", () => {
      const params = serializeTransactionFilterParams({ search: "grocery" });
      expect(params.get("q")).toBe("grocery");
    });

    it("serializes accountId and categoryId", () => {
      const params = serializeTransactionFilterParams({
        accountId: "acc-9",
        categoryId: "cat-9",
      });
      expect(params.get("accountId")).toBe("acc-9");
      expect(params.get("categoryId")).toBe("cat-9");
    });

    it("serializes tagIds as a comma-separated list under tags", () => {
      const params = serializeTransactionFilterParams({
        tagIds: ["t1", "t2", "t3"],
      });
      expect(params.get("tags")).toBe("t1,t2,t3");
    });

    it("omits tags when tagIds is empty", () => {
      const params = serializeTransactionFilterParams({ tagIds: [] });
      expect(params.has("tags")).toBe(false);
    });

    it("serializes startDate/endDate as YYYY-MM-DD under from/to", () => {
      const params = serializeTransactionFilterParams({
        startDate: new Date(2024, 2, 5),
        endDate: new Date(2024, 2, 15),
      });
      expect(params.get("from")).toBe("2024-03-05");
      expect(params.get("to")).toBe("2024-03-15");
    });

    it("serializes amountMin/amountMax as plain numbers", () => {
      const params = serializeTransactionFilterParams({
        amountMin: 10,
        amountMax: 250.5,
      });
      expect(params.get("amountMin")).toBe("10");
      expect(params.get("amountMax")).toBe("250.5");
    });

    it("serializes type/reviewed/owner when set to a non-default value", () => {
      const params = serializeTransactionFilterParams({
        type: "income",
        reviewed: "reviewed",
        owner: "shared",
      });
      expect(params.get("type")).toBe("income");
      expect(params.get("reviewed")).toBe("reviewed");
      expect(params.get("owner")).toBe("shared");
    });

    it("omits type/reviewed/owner when equal to 'all' (the default)", () => {
      const params = serializeTransactionFilterParams({
        type: "all",
        reviewed: "all",
        owner: "all",
      });
      expect(params.has("type")).toBe(false);
      expect(params.has("reviewed")).toBe(false);
      expect(params.has("owner")).toBe(false);
    });
  });

  describe("parseTransactionFilterParams", () => {
    it("returns defaultFilters when given an empty search string", () => {
      expect(parseTransactionFilterParams("")).toEqual(defaultFilters);
    });

    it("returns defaultFilters when given an empty URLSearchParams", () => {
      expect(parseTransactionFilterParams(new URLSearchParams())).toEqual(
        defaultFilters,
      );
    });

    it("parses q into search", () => {
      expect(parseTransactionFilterParams("q=coffee").search).toBe("coffee");
    });

    it("parses accountId and categoryId", () => {
      const parsed = parseTransactionFilterParams(
        "accountId=acc-1&categoryId=cat-2",
      );
      expect(parsed.accountId).toBe("acc-1");
      expect(parsed.categoryId).toBe("cat-2");
    });

    it("parses tags into a tagIds array, trimming and dropping blanks", () => {
      const parsed = parseTransactionFilterParams("tags=t1, t2,,t3");
      expect(parsed.tagIds).toEqual(["t1", "t2", "t3"]);
    });

    it("parses from/to into Date objects at local midnight", () => {
      const parsed = parseTransactionFilterParams("from=2024-01-01&to=2024-01-31");
      expect(parsed.startDate).toEqual(new Date(2024, 0, 1));
      expect(parsed.endDate).toEqual(new Date(2024, 0, 31));
    });

    it("falls back to null for a malformed date string", () => {
      expect(parseTransactionFilterParams("from=not-a-date").startDate).toBeNull();
    });

    it("falls back to null for a calendar date that doesn't exist", () => {
      // 2024 is a leap year but has no Feb 30
      expect(parseTransactionFilterParams("from=2024-02-30").startDate).toBeNull();
    });

    it("parses amountMin/amountMax via the strict money parser", () => {
      const parsed = parseTransactionFilterParams("amountMin=10&amountMax=250.5");
      expect(parsed.amountMin).toBe(10);
      expect(parsed.amountMax).toBe(250.5);
    });

    it("falls back to null for a garbage amount", () => {
      expect(parseTransactionFilterParams("amountMin=12abc").amountMin).toBeNull();
    });

    it("parses a valid type/reviewed/owner value", () => {
      const parsed = parseTransactionFilterParams(
        "type=income&reviewed=reviewed&owner=mine",
      );
      expect(parsed.type).toBe("income");
      expect(parsed.reviewed).toBe("reviewed");
      expect(parsed.owner).toBe("mine");
    });

    it("falls back to the default for an invalid type/reviewed/owner value", () => {
      const parsed = parseTransactionFilterParams(
        "type=bogus&reviewed=bogus&owner=bogus",
      );
      expect(parsed.type).toBe("all");
      expect(parsed.reviewed).toBe("all");
      expect(parsed.owner).toBe("all");
    });
  });

  describe("round-trip (parse . serialize == identity)", () => {
    it("is lossless for a fully populated filter set", () => {
      const params = serializeTransactionFilterParams(FULL_FILTERS);
      const roundTripped = parseTransactionFilterParams(params);
      expect(roundTripped).toEqual(FULL_FILTERS);
    });

    it("is lossless through a raw query string", () => {
      const qs = serializeTransactionFilterParams(FULL_FILTERS).toString();
      const roundTripped = parseTransactionFilterParams(qs);
      expect(roundTripped).toEqual(FULL_FILTERS);
    });

    it("is lossless for default filters", () => {
      const qs = serializeTransactionFilterParams(defaultFilters).toString();
      expect(parseTransactionFilterParams(qs)).toEqual(defaultFilters);
    });
  });

  describe("buildTransactionsUrl", () => {
    it("returns the bare path when no filters are set", () => {
      expect(buildTransactionsUrl({})).toBe("/transactions");
    });

    it("appends a query string for the given filters", () => {
      expect(buildTransactionsUrl({ categoryId: "cat-1", type: "expense" })).toBe(
        "/transactions?categoryId=cat-1&type=expense",
      );
    });

    it("matches the param names existing callers already emit (drill-down / CommandPalette compat)", () => {
      // client/src/hooks/use-drilldown.ts and CommandPalette already build
      // links with these exact keys - this pins the compatibility contract.
      const url = buildTransactionsUrl({
        accountId: "acc-1",
        categoryId: "cat-1",
        type: "income",
        startDate: new Date(2026, 0, 1),
        endDate: new Date(2026, 0, 31),
      });
      const params = new URLSearchParams(url.split("?")[1]);
      expect(params.get("accountId")).toBe("acc-1");
      expect(params.get("categoryId")).toBe("cat-1");
      expect(params.get("type")).toBe("income");
      expect(params.get("from")).toBe("2026-01-01");
      expect(params.get("to")).toBe("2026-01-31");
    });
  });
});
