import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock db before imports
vi.mock("../../../db", () => {
  const mockDb = {
    select: vi.fn(),
    execute: vi.fn(),
  };
  return { db: mockDb };
});
// The household's today is a DB read; these unit tests pin it past every fixture date.
vi.mock("../../../services/householdCalendarToday", () => ({ householdToday: vi.fn(async () => "2024-12-31") }));

import { NetWorthReportRepository } from "../NetWorthReportRepository";
import { householdToday } from "../../../services/householdCalendarToday";
import type { ReportsNetWorthResponse } from "@shared/reports";

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
    function captureHistory(points: Array<[date: string, amount: number, currency?: string]>) {
      const [date, amount] = points.at(-1)!;
      const report: ReportsNetWorthResponse = {
        range: { baseCurrency: "USD", from: "2024-01-01", to: "2024-03-31", interval: "month" },
        latest: { date, netWorth: money(amount), assets: money(amount), liabilities: money(0) },
        series: [{ id: "Net Worth", data: points.map(([x, value, unit]) => ({ x, y: money(value, unit) })) }],
        historyCoverage: "snapshots",
      };
      vi.spyOn(repository, "getNetWorth").mockResolvedValue(report);
    }

    it("uses the latest capture in each month and divides a gap by elapsed months", async () => {
      captureHistory([
        ["2024-01-29", 950], ["2024-01-30", 975], ["2024-01-31", 1000],
        ["2024-03-29", 1300], ["2024-03-30", 1350], ["2024-03-31", 1400],
      ]);
      const result = await repository.getNetWorthChanges("household-1", {
        from: "2024-01-01", to: "2024-03-31", userId: "reader",
      });
      expect(result).toMatchObject({
        totalChange: money(400), avgMonthlyChange: money(200), missingMonths: ["2024-02"], insufficientHistory: false,
        periods: [{ startPeriod: "2024-01-31", period: "2024-03-31", spansGap: true, change: money(400) }],
      });
    });

    it("has no monthly average when daily captures all belong to one month", async () => {
      captureHistory([["2024-01-12", 1000], ["2024-01-13", 1050], ["2024-01-31", 1400]]);
      const result = await repository.getNetWorthChanges("household-1", { from: "2024-01-01", to: "2024-01-31" });
      expect(result).toMatchObject({ avgMonthlyChange: null, missingMonths: [], insufficientHistory: true, periods: [] });
    });

    it("does not manufacture monthly changes when an endpoint's unit is unknown", async () => {
      captureHistory([["2024-01-31", 1000], ["2024-02-29", 1200, ""], ["2024-03-31", 1400]]);
      const result = await repository.getNetWorthChanges("household-1", { from: "2024-01-01", to: "2024-03-31" });
      expect(result).toMatchObject({ avgMonthlyChange: null, insufficientHistory: true, periods: [] });
    });

    it("keeps a UTC-dated capture in the requested range even when the household is still in the previous month", async () => {
      vi.mocked(householdToday).mockResolvedValueOnce("2024-01-31");
      captureHistory([["2024-01-31", 1000], ["2024-02-01", 1200], ["2024-02-02", 1900]]);
      const result = await repository.getNetWorthChanges("household-1", { from: "2024-01-01", to: "2024-02-01" });
      expect(result).toMatchObject({
        avgMonthlyChange: money(200), missingMonths: [],
        periods: [{ startPeriod: "2024-01-31", period: "2024-02-01", change: money(200) }],
      });
    });

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
      expect(result.avgMonthlyChange).toBeNull();
    });
  });
});
