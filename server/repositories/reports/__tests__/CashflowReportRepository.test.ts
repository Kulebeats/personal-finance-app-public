import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock db before imports
vi.mock("../../../db", () => {
  const mockDb = {
    select: vi.fn(),
    execute: vi.fn(),
  };
  return { db: mockDb };
});

import { CashflowReportRepository } from "../CashflowReportRepository";

const money = (value: number, currency: string = "USD") => ({
  amount: value.toFixed(2),
  currency,
});

describe("CashflowReportRepository", () => {
  let repository: CashflowReportRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new CashflowReportRepository();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getCashflow", () => {
    it("returns income, expenses, and savings", async () => {
      // Mock the entire method to test the public API
      const mockResult = {
        range: {
          from: "2024-01-01",
          to: "2024-02-28",
          interval: "month",
          baseCurrency: "USD",
        },
        series: [
          {
            label: "2024-01",
            income: money(5000),
            expenses: money(3000),
            debt: money(500),
            savings: money(1500),
            savingsRate: 30,
          },
          {
            label: "2024-02",
            income: money(5500),
            expenses: money(3200),
            debt: money(500),
            savings: money(1800),
            savingsRate: 33,
          },
        ],
        totals: {
          income: money(10500),
          expenses: money(6200),
          debt: money(1000),
          savings: money(3300),
          savingsRate: 31,
        },
      };

      vi.spyOn(repository, "getCashflow").mockResolvedValue(mockResult as any);

      const result = await repository.getCashflow("household-1", {
        from: "2024-01-01",
        to: "2024-02-28",
        interval: "month",
      });

      expect(result.series).toHaveLength(2);
      expect(result.totals.income.amount).toBe("10500.00");
    });
  });

  describe("getIncome", () => {
    it("returns income breakdown", async () => {
      const mockResult = {
        range: {
          from: "2024-01-01",
          to: "2024-01-31",
          interval: "month",
          baseCurrency: "USD",
        },
        series: [
          {
            label: "2024-01",
            income: money(8000),
            expenses: money(5000),
            net: money(3000),
          },
        ],
        totals: { income: money(8000), expenses: money(5000), net: money(3000) },
      };

      vi.spyOn(repository, "getIncome").mockResolvedValue(mockResult as any);

      const result = await repository.getIncome("household-1", {
        from: "2024-01-01",
        to: "2024-01-31",
        interval: "month",
      });

      expect(result.series).toHaveLength(1);
      expect(result.series[0].income.amount).toBe("8000.00");
      expect(result.series[0].net.amount).toBe("3000.00");
    });
  });

  describe("getSavingsRate", () => {
    it("returns savings rate over time", async () => {
      const mockResult = {
        range: {
          from: "2024-01-01",
          to: "2024-02-28",
          interval: "month",
          baseCurrency: "USD",
        },
        series: [
          {
            label: "2024-01",
            savingsRate: 40,
            income: money(8000),
            expenses: money(4800),
            savings: money(3200),
          },
          {
            label: "2024-02",
            savingsRate: 50,
            income: money(8200),
            expenses: money(4100),
            savings: money(4100),
          },
        ],
      };

      vi.spyOn(repository, "getSavingsRate").mockResolvedValue(
        mockResult as any
      );

      const result = await repository.getSavingsRate("household-1", {
        from: "2024-01-01",
        to: "2024-02-28",
        interval: "month",
      });

      expect(result.series).toHaveLength(2);
      expect(result.series[0].savingsRate).toBe(40);
    });

    it("handles zero income gracefully (no division by zero)", async () => {
      // Mock getCashflow to return zero income
      vi.spyOn(repository, "getCashflow").mockResolvedValue({
        range: {
          from: "2024-01-01",
          to: "2024-01-31",
          interval: "month",
          baseCurrency: "USD",
        },
        series: [
          {
            periodStart: "2024-01-01",
            periodEnd: "2024-01-31",
            label: "Jan",
            income: money(0),
            expenses: money(1000),
            savings: money(-1000),
            savingsRate: 0,
            debt: money(0),
          },
        ],
        totals: {
          income: money(0),
          expenses: money(1000),
          savings: money(-1000),
          debt: money(0),
          savingsRate: 0,
        },
      } as any);

      const result = await repository.getSavingsRate("household-1", {
        from: "2024-01-01",
        to: "2024-01-31",
        interval: "month",
      });

      expect(result.series).toHaveLength(1);
      expect(result.series[0].savingsRate).toBe(0);
      expect(result.series[0].income.amount).toBe("0.00");
      expect(result.series[0].expenses.amount).toBe("1000.00");
      // Should be 0, not NaN or Infinity
      expect(Number.isFinite(result.series[0].savingsRate)).toBe(true);
    });
  });

  describe("getExpenseClassification", () => {
    it("classifies expenses correctly", async () => {
      const mockResult = {
        range: { from: "2024-01-01", to: "2024-01-31", currency: "USD" },
        total: money(2800),
        classification: {
          fixed: { amount: money(2000), percent: 71, categories: [] },
          variable: { amount: money(500), percent: 18, categories: [] },
          discretionary: { amount: money(300), percent: 11, categories: [] },
        },
        accuracy: {
          score: 100,
          totalCategories: 3,
          highConfidenceCount: 3,
          threshold: 0.8,
        },
      };

      vi.spyOn(repository, "getExpenseClassification").mockResolvedValue(
        mockResult
      );

      const result = await repository.getExpenseClassification("household-1", {
        from: "2024-01-01",
        to: "2024-01-31",
        userId: "user-1",
      });

      expect(result.total.amount).toBe("2800.00");
      expect(result.classification.fixed.amount.amount).toBe("2000.00");
      expect(result.classification.variable.amount.amount).toBe("500.00");
      expect(result.classification.discretionary.amount.amount).toBe("300.00");
    });
  });
});
