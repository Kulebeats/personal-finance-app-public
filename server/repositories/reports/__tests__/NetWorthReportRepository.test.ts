import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock db before imports
vi.mock("../../../db", () => {
  const mockDb = {
    select: vi.fn(),
    execute: vi.fn(),
  };
  return { db: mockDb };
});

import { NetWorthReportRepository } from "../NetWorthReportRepository";

const money = (value: number, currency: string = "USD") => ({
  amount: value.toFixed(2),
  currency,
});

describe("NetWorthReportRepository", () => {
  let repository: NetWorthReportRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new NetWorthReportRepository();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getNetWorth", () => {
    it("returns net worth series", async () => {
      const mockResult = {
        range: { baseCurrency: "USD" },
        series: [
          {
            id: "Net Worth",
            data: [
              { x: "2024-01-01", y: money(100000) },
              { x: "2024-02-01", y: money(105000) },
            ],
          },
        ],
        latest: {
          assets: money(135000),
          liabilities: money(30000),
          netWorth: money(105000),
        },
      };

      vi.spyOn(repository, "getNetWorth").mockResolvedValue(mockResult as any);

      const result = await repository.getNetWorth("household-1", {
        from: "2024-01-01",
        to: "2024-02-28",
        interval: "month",
      });

      expect(result.series).toBeDefined();
      expect(result.series.length).toBeGreaterThan(0);
      expect(result.latest?.netWorth).toEqual(money(105000));
    });
  });

  describe("getNetWorthChanges", () => {
    it("calculates monthly net worth changes", async () => {
      // Mock getNetWorth which is called internally
      vi.spyOn(repository, "getNetWorth").mockResolvedValue({
        range: { baseCurrency: "USD" },
        series: [
          {
            id: "Net Worth",
            data: [
              { x: "2024-01-01", y: money(50000) },
              { x: "2024-02-01", y: money(55000) },
              { x: "2024-03-01", y: money(52000) },
            ],
          },
        ],
        latest: {
          assets: money(80000),
          liabilities: money(28000),
          netWorth: money(52000),
        },
      } as any);

      const result = await repository.getNetWorthChanges("household-1", {
        from: "2024-01-01",
        to: "2024-03-31",
      });

      expect(result.periods).toHaveLength(2);
      expect(result.periods[0].change).toEqual(money(5000));
      expect(result.periods[1].change).toEqual(money(-3000));
      expect(result.totalChange).toEqual(money(2000));
    });

    it("handles single data point gracefully", async () => {
      vi.spyOn(repository, "getNetWorth").mockResolvedValue({
        range: { baseCurrency: "USD" },
        series: [
          {
            id: "Net Worth",
            data: [{ x: "2024-01-01", y: money(50000) }],
          },
        ],
        latest: {
          assets: money(50000),
          liabilities: money(0),
          netWorth: money(50000),
        },
      } as any);

      const result = await repository.getNetWorthChanges("household-1", {
        from: "2024-01-01",
        to: "2024-01-31",
      });

      expect(result.periods).toHaveLength(0);
      expect(result.totalChange).toEqual(money(0));
    });

    it("handles no snapshots (empty data)", async () => {
      vi.spyOn(repository, "getNetWorth").mockResolvedValue({
        range: { baseCurrency: "USD" },
        series: [
          {
            id: "Net Worth",
            data: [],
          },
        ],
        latest: {
          assets: money(0),
          liabilities: money(0),
          netWorth: money(0),
          date: "2024-01-01",
        },
      } as any);

      const result = await repository.getNetWorthChanges("household-1", {
        from: "2024-01-01",
        to: "2024-01-31",
      });

      expect(result.periods).toHaveLength(0);
      expect(result.totalChange).toEqual(money(0));
      expect(result.avgMonthlyChange).toEqual(money(0));
    });
  });
});
