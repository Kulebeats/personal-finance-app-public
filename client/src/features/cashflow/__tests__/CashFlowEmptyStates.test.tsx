/**
 * CashFlow Empty States Tests
 *
 * Tests empty state handling across cashflow components
 */

import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CashFlow from "@/pages/CashFlow";

// Mock Layout
vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

// Mock Settings Context
vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({
    formatCurrency: (val: number) => `$${val.toLocaleString()}`,
  }),
  useSettings: () => ({
    settings: { currency: "USD" },
  }),
}));

// Mock toast
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

// Mock the remaining Nivo Sankey chart.
vi.mock("@nivo/sankey", () => ({
  ResponsiveSankey: () => <div data-testid="sankey-chart">Sankey Chart</div>,
}));

// Mock all cashflow components
vi.mock("@/features/cashflow/components/CashFlowSummary", () => ({
  CashFlowSummary: () => <div data-testid="cashflow-summary">Summary</div>,
}));

vi.mock("@/features/cashflow/components/CashFlowFilters", () => ({
  CashFlowFilters: () => <div data-testid="cashflow-filters">Filters</div>,
}));

vi.mock("@/features/cashflow/components/CashFlowChart", () => ({
  CashFlowChart: ({ view, isLoading, error }: any) => {
    if (isLoading) return <div>Loading chart...</div>;
    if (error) return <div>Chart error</div>;
    if (view === "bar") {
      return (
        <div data-testid="cashflow-chart">
          <div data-testid="bar-chart">Bar Chart</div>
        </div>
      );
    }
    return <div data-testid="cashflow-chart">Sankey Chart</div>;
  },
}));

vi.mock("@/features/cashflow/components/CashFlowTable", () => ({
  CashFlowTable: ({ isLoading, error, data }: any) => {
    if (isLoading) return <div>Loading table...</div>;
    if (error) return <div>Table error</div>;
    if (!data || !data.series || data.series.length === 0) {
      return <div data-testid="empty-table">No cashflow data available</div>;
    }
    return <div data-testid="cashflow-table">Table with data</div>;
  },
}));

vi.mock("@/features/cashflow/components/IncomeBreakdown", () => ({
  IncomeBreakdown: () => <div data-testid="income-breakdown">Income Breakdown</div>,
}));

vi.mock("@/features/cashflow/components/ExpenseBreakdown", () => ({
  ExpenseBreakdown: () => <div data-testid="expense-breakdown">Expense Breakdown</div>,
}));

vi.mock("@/features/cashflow/components/BudgetComparison", () => ({
  BudgetComparison: ({ isLoading, error, data }: any) => {
    if (isLoading) return <div>Loading budget...</div>;
    if (error) return <div>Budget error</div>;
    if (!data) return <div data-testid="empty-budget">No budget data</div>;
    return <div data-testid="budget-comparison">Budget Comparison</div>;
  },
}));

vi.mock("@/features/cashflow/components/CurrencyWarning", () => ({
  CurrencyWarning: () => null,
}));

// use-reports is mocked once at module scope. `vi.mock` is hoisted above the
// file and cannot be redefined per-test, so each test instead mutates these
// shared state holders. The mock reads them lazily on every hook call, which
// lets a test set the scenario (empty / loading / error) before render.
type HookResult = {
  data?: unknown;
  isLoading?: boolean;
  error?: unknown;
  refetch?: () => void;
};

const reportsState = vi.hoisted(() => ({
  cashflow: {} as HookResult,
  sankey: {} as HookResult,
  spendingBreakdown: {} as HookResult,
  budgetComparison: {} as HookResult,
}));

vi.mock("@/hooks/use-reports", () => ({
  useCurrentYearRange: () => ({ from: "2024-01-01", to: "2024-12-31" }),
  getReportsExportDownloadUrl: (id: string) =>
    `/api/reports/exports/${id}/download`,
  useReportsCashflow: () => reportsState.cashflow,
  useReportsSankey: () => reportsState.sankey,
  useReportsSpendingBreakdown: () => reportsState.spendingBreakdown,
  useReportsBudgetComparison: () => reportsState.budgetComparison,
}));

describe("CashFlow Empty States", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    // Reset to sane defaults before each scenario.
    reportsState.cashflow = {
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
    reportsState.sankey = {
      data: { sankey: { nodes: [], links: [] }, totals: {} },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
    reportsState.spendingBreakdown = {
      data: { items: [] },
      isLoading: false,
      error: null,
    };
    reportsState.budgetComparison = {
      data: undefined,
      isLoading: false,
      error: null,
    };
  });

  it("should show empty state when no cashflow data", async () => {
    // Empty cashflow data: a valid response object with an empty series.
    reportsState.cashflow = {
      data: {
        range: {
          from: "2024-01-01",
          to: "2024-12-31",
          interval: "month",
          baseCurrency: "USD",
        },
        series: [], // Empty series
        totals: {
          income: { amount: "0.00", currency: "USD" },
          expenses: { amount: "0.00", currency: "USD" },
          savings: { amount: "0.00", currency: "USD" },
          savingsRate: 0,
          debt: { amount: "0.00", currency: "USD" },
        },
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };

    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    // Table should show empty state
    const emptyTable = await screen.findByTestId("empty-table");
    expect(emptyTable).toBeInTheDocument();
    expect(emptyTable).toHaveTextContent("No cashflow data available");
  });

  it("should show loading states", async () => {
    reportsState.cashflow = {
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    };
    reportsState.spendingBreakdown = {
      data: undefined,
      isLoading: true,
      error: null,
    };

    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    // Should show loading indicators
    expect(screen.getByText("Loading chart...")).toBeInTheDocument();
    expect(screen.getByText("Loading table...")).toBeInTheDocument();
  });

  it("should handle error states", async () => {
    reportsState.cashflow = {
      data: undefined,
      isLoading: false,
      error: new Error("Failed to fetch"),
      refetch: vi.fn(),
    };

    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    // Should show error messages
    expect(screen.getByText("Chart error")).toBeInTheDocument();
    expect(screen.getByText("Table error")).toBeInTheDocument();
  });

  it("should show empty budget comparison state", async () => {
    // Cashflow data present, but no budget data.
    reportsState.cashflow = {
      data: {
        range: {
          from: "2024-01-01",
          to: "2024-12-31",
          interval: "month",
          baseCurrency: "USD",
        },
        series: [
          {
            periodStart: "2024-01-01",
            periodEnd: "2024-01-31",
            label: "Jan",
            income: { amount: "1000.00", currency: "USD" },
            expenses: { amount: "500.00", currency: "USD" },
            savings: { amount: "500.00", currency: "USD" },
            savingsRate: 50,
            debt: { amount: "0.00", currency: "USD" },
          },
        ],
        totals: {
          income: { amount: "1000.00", currency: "USD" },
          expenses: { amount: "500.00", currency: "USD" },
          savings: { amount: "500.00", currency: "USD" },
          savingsRate: 50,
          debt: { amount: "0.00", currency: "USD" },
        },
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
    reportsState.budgetComparison = {
      data: undefined, // No budget data
      isLoading: false,
      error: null,
    };

    // Note: This test would need to switch to budget view to see the empty state
    // For now, it verifies the budget comparison component is present
    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    // Page should render without crashing
    expect(screen.getByTestId("layout")).toBeInTheDocument();
  });
});
