import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock db before imports
vi.mock("../../../db", () => {
  const mockDb = {
    select: vi.fn(),
    execute: vi.fn(),
  };
  return { db: mockDb };
});

// Mock forecasting utility
vi.mock("../../../utils/forecasting", () => ({
  generateForecast: vi.fn().mockReturnValue({
    baseline: { months: 12, average: 52000, trend: 1000 },
    projection: [
      {
        month: "2024-06",
        predicted: 55000,
        lowerBound: 52000,
        upperBound: 58000,
      },
      {
        month: "2024-07",
        predicted: 56000,
        lowerBound: 52500,
        upperBound: 59500,
      },
    ],
  }),
}));

import { db } from "../../../db";
import { AnalyticsReportRepository } from "../AnalyticsReportRepository";
import { SpendingReportRepository } from "../SpendingReportRepository";
import { CashflowReportRepository } from "../CashflowReportRepository";
import { NetWorthReportRepository } from "../NetWorthReportRepository";

const money = (value: number, currency: string = "USD") => ({
  amount: value.toFixed(2),
  currency,
});

function createSelectResult<T>(result: T[]) {
  const chain: any = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    then: (resolve: (value: T[]) => void) =>
      Promise.resolve(result).then(resolve),
  };
  return chain;
}

describe("AnalyticsReportRepository", () => {
  let repository: AnalyticsReportRepository;
  let mockSpending: SpendingReportRepository;
  let mockCashflow: CashflowReportRepository;
  let mockNetWorth: NetWorthReportRepository;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSpending = new SpendingReportRepository();
    mockCashflow = new CashflowReportRepository();
    mockNetWorth = new NetWorthReportRepository();

    repository = new AnalyticsReportRepository(
      mockSpending,
      mockCashflow,
      mockNetWorth
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getFinancialRatios", () => {
    it("calculates DTI, emergency fund, and liquidity ratios", async () => {
      vi.spyOn(repository, "getHouseholdCurrency" as any).mockResolvedValue(
        "USD"
      );

      vi.spyOn(mockCashflow, "getCashflow").mockResolvedValue({
        totals: {
          income: money(10000),
          expenses: money(6000),
          debt: money(1000),
          savings: money(3000),
        },
        series: [
          {
            label: "Jan",
            income: money(10000),
            expenses: money(6000),
            debt: money(1000),
            savings: money(3000),
            savingsRate: 30,
          },
        ],
      } as any);

      // Liquid accounts
      (db.select as any)
        .mockReturnValueOnce(createSelectResult([{ balance: "20000" }]))
        // Liability accounts
        .mockReturnValueOnce(createSelectResult([{ balance: "5000" }]));

      const result = await repository.getFinancialRatios("household-1", {
        from: "2024-01-01",
        to: "2024-01-31",
      });

      expect(result.ratios.savingsRate).toBeDefined();
      expect(result.ratios.dti).toBeDefined();
      expect(result.ratios.emergencyFund).toBeDefined();
      expect(result.ratios.liquidityRatio).toBeDefined();
    });
  });

  describe("getDebtAnalysis", () => {
    it("returns debt breakdown by type", async () => {
      vi.spyOn(repository, "getHouseholdCurrency" as any).mockResolvedValue(
        "USD"
      );

      (db.select as any).mockReturnValueOnce(
        createSelectResult([
          { id: "acc-1", name: "Credit Card", type: "credit", balance: "2000" },
          { id: "acc-2", name: "Car Loan", type: "loan", balance: "15000" },
        ])
      );

      vi.spyOn(mockCashflow, "getCashflow").mockResolvedValue({
        series: [
          {
            label: "Jan",
            income: money(5000),
            expenses: money(3000),
            debt: money(500),
            savings: money(1500),
            savingsRate: 30,
          },
        ],
      } as any);

      const result = await repository.getDebtAnalysis("household-1", {
        from: "2024-01-01",
        to: "2024-01-31",
      });

      expect(result.totalDebt).toEqual(money(17000));
      expect(result.debtByType).toHaveLength(2);
      expect(result.paymentTrend).toHaveLength(1);
    });
  });

  describe("getGoalsProgress", () => {
    it("returns goals with progress calculations", async () => {
      vi.spyOn(repository, "getHouseholdCurrency" as any).mockResolvedValue(
        "USD"
      );

      (db.select as any).mockReturnValueOnce(
        createSelectResult([
          {
            id: "goal-1",
            name: "Emergency Fund",
            type: "save_up",
            targetAmount: "10000",
            currentAmount: "5000",
            targetDate: "2024-12-31",
            status: "on_track",
          },
          {
            id: "goal-2",
            name: "Vacation",
            type: "save_up",
            targetAmount: "3000",
            currentAmount: "3000",
            targetDate: "2024-06-01",
            status: "completed",
          },
        ])
      );

      const result = await repository.getGoalsProgress("household-1", {});

      expect(result.goals).toHaveLength(2);
      expect(result.goals[0].progress).toBe(50);
      expect(result.goals[1].progress).toBe(100);
      expect(result.summary.completedCount).toBe(1);
      expect(result.summary.onTrackCount).toBe(2); // Both on_track and completed
    });
  });

  describe("getForecast", () => {
    it("generates forecast based on net worth history", async () => {
      vi.spyOn(repository, "getHouseholdCurrency" as any).mockResolvedValue(
        "USD"
      );
      vi.spyOn(mockNetWorth, "getNetWorth").mockResolvedValue({
        range: { baseCurrency: "USD" },
        series: [
          {
            id: "Net Worth",
            data: [
              { x: "Jan", y: money(50000) },
              { x: "Feb", y: money(52000) },
              { x: "Mar", y: money(54000) },
            ],
          },
        ],
        latest: { assets: money(54000), liabilities: money(0), netWorth: money(54000) },
      } as any);

      const result = await repository.getForecast("household-1", {
        metric: "net-worth",
        projectionMonths: 6,
      });

      expect(result.metric).toBe("net-worth");
      expect(result.projection).toBeDefined();
      expect(result.projection.length).toBeGreaterThan(0);
    });

    it("generates forecast based on expenses history", async () => {
      vi.spyOn(repository, "getHouseholdCurrency" as any).mockResolvedValue(
        "USD"
      );
      vi.spyOn(mockCashflow, "getCashflow").mockResolvedValue({
        series: [
          {
            label: "Jan",
            income: money(5000),
            expenses: money(3000),
            debt: money(0),
            savings: money(2000),
            savingsRate: 40,
          },
          {
            label: "Feb",
            income: money(5000),
            expenses: money(3200),
            debt: money(0),
            savings: money(1800),
            savingsRate: 36,
          },
        ],
      } as any);

      const result = await repository.getForecast("household-1", {
        metric: "expenses",
        projectionMonths: 3,
      });

      expect(result.metric).toBe("expenses");
      expect(result.projection).toBeDefined();
    });
  });

  describe("executeCustomChart", () => {
    it("executes custom chart with time series data", async () => {
      vi.spyOn(repository, "getHouseholdCurrency" as any).mockResolvedValue(
        "USD"
      );
      vi.spyOn(mockCashflow, "getCashflow").mockResolvedValue({
        series: [
          {
            label: "Jan",
            income: money(5000),
            expenses: money(3000),
            debt: money(0),
            savings: money(2000),
            savingsRate: 40,
          },
          {
            label: "Feb",
            income: money(5500),
            expenses: money(3200),
            debt: money(0),
            savings: money(2300),
            savingsRate: 42,
          },
        ],
      } as any);

      const result = await repository.executeCustomChart("household-1", {
        config: {
          name: "Monthly Income",
          chartType: "line",
          primaryMetric: "income",
        },
        from: "2024-01-01",
        to: "2024-02-28",
      });

      expect(result.data).toHaveLength(2);
      expect(result.data[0].primary).toBe(5000);
      expect(result.totals.primary).toBe(10500);
    });

    it("executes custom chart with grouped data", async () => {
      vi.spyOn(repository, "getHouseholdCurrency" as any).mockResolvedValue(
        "USD"
      );
      vi.spyOn(mockSpending, "getSpendingBreakdown").mockResolvedValue({
        range: { from: "2024-01-01", to: "2024-01-31", baseCurrency: "USD" },
        groupBy: "category",
        total: money(3000),
        items: [
          {
            id: "cat-1",
            entityId: "cat-1",
            label: "Food",
            value: money(1500),
            percent: 50,
            color: "#fff",
          },
          {
            id: "cat-2",
            entityId: "cat-2",
            label: "Transport",
            value: money(1000),
            percent: 33,
            color: "#fff",
          },
          {
            id: "cat-3",
            entityId: "cat-3",
            label: "Entertainment",
            value: money(500),
            percent: 17,
            color: "#fff",
          },
        ],
      } as any);

      const result = await repository.executeCustomChart("household-1", {
        config: {
          name: "Expense Breakdown",
          chartType: "pie",
          primaryMetric: "expenses",
          groupBy: "category",
        },
        from: "2024-01-01",
        to: "2024-01-31",
      });

      expect(result.data).toHaveLength(3);
      expect(result.totals.primary).toBe(3000);
    });

    it("enforces 36-month time window limit", async () => {
      vi.spyOn(repository, "getHouseholdCurrency" as any).mockResolvedValue(
        "USD"
      );
      await expect(
        repository.executeCustomChart("household-1", {
          config: {
            name: "Long Range Chart",
            chartType: "line",
            primaryMetric: "income",
          },
          from: "2020-01-01",
          to: "2024-01-31", // More than 36 months
        })
      ).rejects.toThrow("Custom chart time window cannot exceed 36 months");
    });
  });
});
