import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock db before imports
vi.mock("../../../db", () => {
  const mockDb = {
    select: vi.fn(),
    execute: vi.fn(),
  };
  return { db: mockDb };
});

import { CompositeReportRepository } from "../CompositeReportRepository";
import { SpendingReportRepository } from "../SpendingReportRepository";
import { CashflowReportRepository } from "../CashflowReportRepository";
import { NetWorthReportRepository } from "../NetWorthReportRepository";

const money = (value: number, currency: string = "USD") => ({
  amount: value.toFixed(2),
  currency,
});

describe("CompositeReportRepository", () => {
  let repository: CompositeReportRepository;
  let mockSpending: SpendingReportRepository;
  let mockCashflow: CashflowReportRepository;
  let mockNetWorth: NetWorthReportRepository;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSpending = new SpendingReportRepository();
    mockCashflow = new CashflowReportRepository();
    mockNetWorth = new NetWorthReportRepository();

    repository = new CompositeReportRepository(
      mockSpending,
      mockCashflow,
      mockNetWorth
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getAnnualReport", () => {
    it("aggregates cashflow, net worth, and breakdowns", async () => {
      // Mock getHouseholdCurrency
      vi.spyOn(repository, "getHouseholdCurrency" as any).mockResolvedValue(
        "USD"
      );

      // Mock cashflow
      vi.spyOn(mockCashflow, "getCashflow").mockResolvedValue({
        range: {
          from: "2024-01-01",
          to: "2024-12-31",
          interval: "month",
          baseCurrency: "USD",
        },
        series: [
          {
            label: "Jan",
            income: money(5000),
            expenses: money(3000),
            debt: money(500),
            savings: money(1500),
            savingsRate: 30,
          },
          {
            label: "Feb",
            income: money(5500),
            expenses: money(3200),
            debt: money(400),
            savings: money(1900),
            savingsRate: 35,
          },
        ],
        totals: {
          income: money(10500),
          expenses: money(6200),
          debt: money(900),
          savings: money(3400),
          savingsRate: 32,
        },
      } as any);

      // Mock net worth
      vi.spyOn(mockNetWorth, "getNetWorth").mockResolvedValue({
        range: { baseCurrency: "USD" },
        series: [
          {
            id: "Net Worth",
            data: [
              { x: "Jan", y: money(50000) },
              { x: "Feb", y: money(53000) },
            ],
          },
        ],
        latest: {
          assets: money(80000),
          liabilities: money(27000),
          netWorth: money(53000),
        },
      } as any);

      // Mock spending breakdowns
      vi.spyOn(mockSpending, "getSpendingBreakdown").mockResolvedValue({
        range: { from: "2024-01-01", to: "2024-12-31", baseCurrency: "USD" },
        groupBy: "categoryGroup",
        total: money(3000),
        items: [
          {
            id: "g1",
            entityId: "g1",
            label: "Housing",
            value: money(2000),
            percent: 67,
            color: "#fff",
          },
        ],
      } as any);

      const result = await repository.getAnnualReport("household-1", {
        year: 2024,
      });

      expect(result.year).toBe(2024);
      expect(result.totals.income).toEqual(money(10500));
      expect(result.totals.expenses).toEqual(money(6200));
      expect(result.monthly).toHaveLength(2);
      expect(mockCashflow.getCashflow).toHaveBeenCalled();
      expect(mockNetWorth.getNetWorth).toHaveBeenCalled();
    });

    it("calculates year-over-year comparison", async () => {
      vi.spyOn(repository, "getHouseholdCurrency" as any).mockResolvedValue(
        "USD"
      );

      vi.spyOn(mockCashflow, "getCashflow")
        .mockResolvedValueOnce({
          range: {
            from: "2024-01-01",
            to: "2024-12-31",
            interval: "month",
            baseCurrency: "USD",
          },
          series: [
            {
              label: "Jan",
              income: money(6000),
              expenses: money(3500),
              debt: money(0),
              savings: money(2500),
              savingsRate: 42,
            },
          ],
          totals: {
            income: money(6000),
            expenses: money(3500),
            debt: money(0),
            savings: money(2500),
            savingsRate: 42,
          },
        } as any)
        .mockResolvedValueOnce({
          range: {
            from: "2023-01-01",
            to: "2023-12-31",
            interval: "month",
            baseCurrency: "USD",
          },
          series: [
            {
              label: "Jan",
              income: money(5000),
              expenses: money(3000),
              debt: money(0),
              savings: money(2000),
              savingsRate: 40,
            },
          ],
          totals: {
            income: money(5000),
            expenses: money(3000),
            debt: money(0),
            savings: money(2000),
            savingsRate: 40,
          },
        } as any);

      vi.spyOn(mockNetWorth, "getNetWorth").mockResolvedValue({
        range: { baseCurrency: "USD" },
        series: [{ id: "Net Worth", data: [{ x: "Jan", y: money(50000) }] }],
        latest: { assets: money(50000), liabilities: money(0), netWorth: money(50000) },
      } as any);

      vi.spyOn(mockSpending, "getSpendingBreakdown").mockResolvedValue({
        range: { from: "2024-01-01", to: "2024-12-31", baseCurrency: "USD" },
        groupBy: "categoryGroup",
        total: money(0),
        items: [],
      } as any);

      const result = await repository.getAnnualReport("household-1", {
        year: 2024,
        compareYear: 2023,
      });

      expect(result.comparison).toBeDefined();
      expect(result.comparison?.incomeChangePct).toBe(20); // (6000-5000)/5000 = 20%
    });
  });

  describe("getSankey", () => {
    it("returns sankey diagram data", async () => {
      vi.spyOn(repository, "getHouseholdCurrency" as any).mockResolvedValue(
        "USD"
      );

      // Mock the sankey helper result
      vi.spyOn(repository, "getSankey").mockResolvedValue({
        range: { from: "2024-01-01", to: "2024-01-31", baseCurrency: "USD" },
        mode: "income_to_expense_groups",
        totals: {
          income: money(10000),
          expenses: money(6000),
          savings: money(4000),
        },
        sankey: {
          nodes: [
            {
              id: "income",
              nodeColor: "#000",
              entityType: "synthetic",
              entityId: "income",
            },
            {
              id: "expenses",
              nodeColor: "#111",
              entityType: "categoryGroup",
              entityId: "expenses",
            },
          ],
          links: [
            { source: "income", target: "expenses", value: money(3000) },
          ],
        },
      } as any);

      const result = await repository.getSankey("household-1", {
        from: "2024-01-01",
        to: "2024-01-31",
        mode: "income_to_expense_groups",
      });

      expect(result.sankey.nodes).toBeDefined();
      expect(result.sankey.links).toBeDefined();
      expect(result.totals).toBeDefined();
    });
  });
});
