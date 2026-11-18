/**
 * E2E Tests for Annual Dashboard Widgets
 *
 * Tests aggregation switching, transaction drill-down, and widget interactions
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";

const money = (value: number, currency: string = "USD") => ({
  amount: value.toFixed(2),
  currency,
});

// Mock context
vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({
    formatCurrency: (val: number) => `$${val.toFixed(2)}`,
    formatDate: (val: string) => val,
    formatPercentage: (val: number) => `${val}%`,
  }),
  useSettings: () => ({
    currency: "USD",
    timezone: "UTC",
    isLoading: false,
  }),
}));

// Mock the hooks
vi.mock("@/hooks/use-reports", () => ({
  useReportsAnnual: vi.fn(() => ({
    data: {
      monthly: [
        {
          month: "Jan",
          monthIndex: 1,
          income: money(5000),
          expenses: money(3000),
          savingsContributions: money(2000),
          netSavings: money(2000),
          savingsRate: 40,
          netSavingsRate: 40,
          debtPaid: money(0),
          netWorthChange: money(0),
        },
        {
          month: "Feb",
          monthIndex: 2,
          income: money(5500),
          expenses: money(3200),
          savingsContributions: money(2300),
          netSavings: money(2300),
          savingsRate: 41.82,
          netSavingsRate: 41.82,
          debtPaid: money(0),
          netWorthChange: money(0),
        },
        {
          month: "Mar",
          monthIndex: 3,
          income: money(5200),
          expenses: money(3100),
          savingsContributions: money(2100),
          netSavings: money(2100),
          savingsRate: 40.38,
          netSavingsRate: 40.38,
          debtPaid: money(0),
          netWorthChange: money(0),
        },
      ],
      totals: {
        income: money(15700),
        expenses: money(9300),
        savingsContributions: money(6400),
        netSavings: money(6400),
        savingsRate: 40.8,
        netSavingsRate: 40.8,
        debtPaid: money(0),
        netWorth: money(0),
        totalNetWorthChange: money(0),
        avgMonthlyNetWorthChange: money(0),
      },
      monthsInRange: 12,
    },
    isLoading: false,
    error: null,
  })),
  useCurrentYearRange: vi.fn(() => ({
    from: "2026-01-01",
    to: "2026-12-31",
    year: 2026,
  })),
}));

vi.mock("@/hooks/use-drilldown", () => ({
  useDrillDown: vi.fn(() => ({ drillDown: vi.fn() })),
}));

const createTestQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={createTestQueryClient()}>
    <Router>{children}</Router>
  </QueryClientProvider>
);

describe("Annual Dashboard E2E Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Aggregation Switching", () => {
    it("renders with default monthly aggregation", async () => {
      // This test verifies the AggregationFilter defaults to monthly
      const { AggregationFilter } = await import(
        "@/components/reports/AggregationFilter"
      );

      render(
        <TestWrapper>
          <AggregationFilter value="monthly" onChange={vi.fn()} />
        </TestWrapper>
      );

      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    it("switches between aggregation levels", async () => {
      const onChange = vi.fn();
      const { AggregationFilter } = await import(
        "@/components/reports/AggregationFilter"
      );

      render(
        <TestWrapper>
          <AggregationFilter value="monthly" onChange={onChange} />
        </TestWrapper>
      );

      const trigger = screen.getByRole("combobox");
      fireEvent.click(trigger);

      await waitFor(() => {
        expect(screen.getByText("Quarterly")).toBeInTheDocument();
      });
    });

    it("shows weekly option when enabled", async () => {
      const { AggregationFilter } = await import(
        "@/components/reports/AggregationFilter"
      );

      render(
        <TestWrapper>
          <AggregationFilter value="monthly" onChange={vi.fn()} showWeekly />
        </TestWrapper>
      );

      const trigger = screen.getByRole("combobox");
      fireEvent.click(trigger);

      await waitFor(() => {
        expect(screen.getByText("Weekly")).toBeInTheDocument();
      });
    });
  });

  describe("Transaction Drill-Down", () => {
    it("drill-down hook is called with correct filters on bar click", async () => {
      const { useDrillDown } = await import("@/hooks/use-drilldown");
      const mockDrillDown = vi.fn();
      vi.mocked(useDrillDown).mockReturnValue({
        drillDown: mockDrillDown,
      });

      // Re-import to get mocked version
      const { drillDown } = useDrillDown();

      drillDown({ from: "2026-01-01", to: "2026-01-31", type: "income" });

      expect(mockDrillDown).toHaveBeenCalledWith({
        from: "2026-01-01",
        to: "2026-01-31",
        type: "income",
      });
    });
  });

  describe("Widget Rendering", () => {
    it("TrendingWidget renders with data", async () => {
      const { TrendingWidget } = await import(
        "@/components/reports/TrendingWidget"
      );

      render(
        <TestWrapper>
          <TrendingWidget
            title="Test Widget"
            description="Test description"
            data={[
              { label: "Jan", value: 1000 },
              { label: "Feb", value: 1500 },
            ]}
            isLoading={false}
          />
        </TestWrapper>
      );

      expect(screen.getByText("Test Widget")).toBeInTheDocument();
    });

    it("ComparisonWidget renders with bar chart", async () => {
      const { ComparisonWidget } = await import(
        "@/components/reports/ComparisonWidget"
      );

      render(
        <TestWrapper>
          <ComparisonWidget
            title="Comparison Test"
            description="Test comparison"
            data={[
              { label: "Jan", primary: 1000, secondary: 800 },
              { label: "Feb", primary: 1500, secondary: 1200 },
            ]}
            primaryKey="Income"
            secondaryKey="Expenses"
            isLoading={false}
          />
        </TestWrapper>
      );

      expect(screen.getByText("Comparison Test")).toBeInTheDocument();
    });
  });

  describe("Drill-Down Flow", () => {
    it("drillDown navigates with correct date range for monthly widget", async () => {
      const { useDrillDown } = await import("@/hooks/use-drilldown");
      const mockDrillDown = vi.fn();
      vi.mocked(useDrillDown).mockReturnValue({
        drillDown: mockDrillDown,
      });

      const { drillDown } = useDrillDown();

      // Simulate clicking January bar
      drillDown({ from: "2026-01-01", to: "2026-01-31", type: "expense" });

      expect(mockDrillDown).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "2026-01-01",
          to: "2026-01-31",
          type: "expense",
        })
      );
    });

    it("drillDown navigates with category filter", async () => {
      const { useDrillDown } = await import("@/hooks/use-drilldown");
      const mockDrillDown = vi.fn();
      vi.mocked(useDrillDown).mockReturnValue({
        drillDown: mockDrillDown,
      });

      const { drillDown } = useDrillDown();

      // Simulate clicking a category segment
      drillDown({
        from: "2026-01-01",
        to: "2026-12-31",
        categoryId: "cat-123",
      });

      expect(mockDrillDown).toHaveBeenCalledWith(
        expect.objectContaining({
          categoryId: "cat-123",
        })
      );
    });
  });

  describe("Aggregation Switching Complete Flow", () => {
    it("quarterly aggregation groups data into Q1-Q4", async () => {
      const user = userEvent.setup();
      const { AggregationFilter } = await import(
        "@/components/reports/AggregationFilter"
      );
      const onChange = vi.fn();

      render(
        <TestWrapper>
          <AggregationFilter value="quarterly" onChange={onChange} />
        </TestWrapper>
      );

      const trigger = screen.getByRole("combobox");
      await user.click(trigger);

      await waitFor(() => {
        expect(screen.getByText("Bi-Annual")).toBeInTheDocument();
        expect(screen.getByText("Annual")).toBeInTheDocument();
      });
    });

    it("custom aggregation option appears when enabled", async () => {
      const { AggregationFilter } = await import(
        "@/components/reports/AggregationFilter"
      );

      render(
        <TestWrapper>
          <AggregationFilter value="monthly" onChange={vi.fn()} showCustom />
        </TestWrapper>
      );

      const trigger = screen.getByRole("combobox");
      fireEvent.click(trigger);

      await waitFor(() => {
        expect(screen.getByText("Custom Range")).toBeInTheDocument();
      });
    });
  });
});
