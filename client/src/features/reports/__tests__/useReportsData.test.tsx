import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useReportsData } from "../hooks/useReportsData";
import { useReportsCashflow, useReportsSpendingBreakdown } from "@/hooks/use-reports";

const money = (value: number, currency: string = "USD") => ({
  amount: value.toFixed(2),
  currency,
});

// Mock the use-reports hooks
vi.mock("@/hooks/use-reports", () => ({
  useReportsSankey: vi.fn(() => ({ data: null, isLoading: false })),
  useReportsSpendingBreakdown: vi.fn(() => ({ data: null, isLoading: false })),
  useReportsCashflow: vi.fn(() => ({
    data: {
      series: [
        {
          periodStart: "2026-01-01",
          periodEnd: "2026-01-31",
          label: "Jan",
          income: money(5000),
          expenses: money(3000),
          savings: money(2000),
          debt: money(0),
          savingsRate: 40,
        },
        {
          periodStart: "2026-02-01",
          periodEnd: "2026-02-28",
          label: "Feb",
          income: money(5500),
          expenses: money(3200),
          savings: money(2300),
          debt: money(0),
          savingsRate: 41.82,
        },
      ],
      totals: {
        income: money(10500),
        expenses: money(6200),
        savings: money(4300),
        debt: money(0),
        savingsRate: 41,
      },
      range: { baseCurrency: "USD" },
    },
    isLoading: false,
  })),
  useReportsNetWorth: vi.fn(() => ({
    data: {
      series: [
        {
          data: [
            { x: "2026-01-01", y: money(50000) },
            { x: "2026-02-01", y: money(55000) },
          ],
        },
      ],
    },
    isLoading: false,
  })),
  useReportsSavingsRate: vi.fn(() => ({
    data: {
      series: [
        {
          periodStart: "2026-01-01",
          periodEnd: "2026-01-31",
          label: "2026-01-01",
          savingsRate: 40,
          income: money(5000),
          expenses: money(3000),
          savings: money(2000),
        },
        {
          periodStart: "2026-02-01",
          periodEnd: "2026-02-28",
          label: "2026-02-01",
          savingsRate: 42,
          income: money(5500),
          expenses: money(3200),
          savings: money(2300),
        },
      ],
    },
    isLoading: false,
  })),
  useReportsExports: vi.fn(() => ({
    data: { exports: [] },
    isLoading: false,
  })),
}));

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={createTestQueryClient()}>
    {children}
  </QueryClientProvider>
);

describe("useReportsData", () => {
  it("should return loading states", () => {
    const { result } = renderHook(
      () =>
        useReportsData({
          activeTab: "cash-flow",
          dateRange: { from: "2026-01-01", to: "2026-12-31" },
          spendingGroupBy: "categoryGroup",
          showExportHistory: false,
        }),
      { wrapper }
    );

    expect(result.current.isLoading).toBeDefined();
    expect(result.current.isLoading.sankey).toBe(false);
    expect(result.current.isLoading.cashflow).toBe(false);
  });

  it("should transform cashflow data into barData", () => {
    const { result } = renderHook(
      () =>
        useReportsData({
          activeTab: "income",
          dateRange: { from: "2026-01-01", to: "2026-12-31" },
          spendingGroupBy: "categoryGroup",
          showExportHistory: false,
        }),
      { wrapper }
    );

    expect(result.current.barData.length).toBe(2);
    expect(result.current.barData[0]).toHaveProperty("month");
    expect(result.current.barData[0]).toHaveProperty("income", 5000);
    expect(result.current.barData[0]).toHaveProperty("expenses", 3000);
  });

  it("should return totals from cashflow data", () => {
    const { result } = renderHook(
      () =>
        useReportsData({
          activeTab: "income",
          dateRange: { from: "2026-01-01", to: "2026-12-31" },
          spendingGroupBy: "categoryGroup",
          showExportHistory: false,
        }),
      { wrapper }
    );

    expect(result.current.totals?.income).toEqual(money(10500));
    expect(result.current.totals?.expenses).toEqual(money(6200));
    expect(result.current.totals?.savings).toEqual(money(4300));
    expect(result.current.totals?.savingsRate).toBe(41);
  });

  it("should return currency from data", () => {
    const { result } = renderHook(
      () =>
        useReportsData({
          activeTab: "income",
          dateRange: { from: "2026-01-01", to: "2026-12-31" },
          spendingGroupBy: "categoryGroup",
          showExportHistory: false,
        }),
      { wrapper }
    );

    expect(result.current.currency).toBe("USD");
  });

  it("knows no currency and no totals while the reports load, and guesses none", () => {
    const cashflow = vi.mocked(useReportsCashflow), spending = vi.mocked(useReportsSpendingBreakdown);
    const cashflowImpl = cashflow.getMockImplementation(), spendingImpl = spending.getMockImplementation();
    cashflow.mockImplementation(() => ({ data: undefined, isLoading: true }) as unknown as ReturnType<typeof useReportsCashflow>);
    spending.mockImplementation(() => ({ data: undefined, isLoading: true }) as unknown as ReturnType<typeof useReportsSpendingBreakdown>);
    try {
      const { result } = renderHook(
        () =>
          useReportsData({
            activeTab: "income",
            dateRange: { from: "2026-01-01", to: "2026-12-31" },
            spendingGroupBy: "categoryGroup",
            showExportHistory: false,
          }),
        { wrapper }
      );

      expect(result.current.currency).toBeNull();
      expect(result.current.totals).toBeNull();
    } finally {
      if (cashflowImpl) cashflow.mockImplementation(cashflowImpl);
      if (spendingImpl) spending.mockImplementation(spendingImpl);
    }
  });

  it("should transform net worth data for line chart", () => {
    const { result } = renderHook(
      () =>
        useReportsData({
          activeTab: "net-worth",
          dateRange: { from: "2026-01-01", to: "2026-12-31" },
          spendingGroupBy: "categoryGroup",
          showExportHistory: false,
        }),
      { wrapper }
    );

    expect(result.current.netWorthLineData.length).toBe(1);
    expect(result.current.netWorthLineData[0].id).toBe("Net Worth");
    expect(result.current.netWorthLineData[0].data.length).toBe(2);
  });

  it("should transform savings data for bar chart", () => {
    const { result } = renderHook(
      () =>
        useReportsData({
          activeTab: "savings",
          dateRange: { from: "2026-01-01", to: "2026-12-31" },
          spendingGroupBy: "categoryGroup",
          showExportHistory: false,
        }),
      { wrapper }
    );

    expect(result.current.savingsRateData.length).toBe(2);
    expect(result.current.savingsRateData[0]).toHaveProperty("month");
    expect(result.current.savingsRateData[0]).toHaveProperty("rate", 40);
  });
});
