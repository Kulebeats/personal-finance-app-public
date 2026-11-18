/**
 * CashFlow Error Handling Tests
 *
 * Tests error boundary and error state handling
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
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
const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
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
  CashFlowChart: ({ view, isLoading, error, refetch }: any) => {
    if (isLoading) return <div>Loading chart...</div>;
    if (error) {
      return (
        <div data-testid="chart-error">
          <div className="text-center">
            <p>Failed to load data</p>
            <p>There was an error loading your cash flow data.</p>
            <button onClick={refetch}>Try Again</button>
          </div>
        </div>
      );
    }
    return <div data-testid="cashflow-chart">Chart loaded</div>;
  },
}));

vi.mock("@/features/cashflow/components/CashFlowTable", () => ({
  CashFlowTable: ({ isLoading, error, data }: any) => {
    if (isLoading) return <div>Loading table...</div>;
    if (error) {
      return (
        <div data-testid="table-error">
          <p>Failed to load table data</p>
        </div>
      );
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
  BudgetComparison: ({ isLoading, error }: any) => {
    if (isLoading) return <div>Loading budget...</div>;
    if (error) {
      return (
        <div data-testid="budget-error">
          <p>Failed to load budget data</p>
        </div>
      );
    }
    return <div data-testid="budget-comparison">Budget Comparison</div>;
  },
}));

vi.mock("@/features/cashflow/components/CurrencyWarning", () => ({
  CurrencyWarning: () => null,
}));

// use-reports is mocked once at module scope. `vi.mock` is hoisted above the
// file and cannot be redefined per-test, so each test mutates these shared
// state holders. The mock reads them lazily on every hook call, letting a test
// set the scenario (error / success) before render. `mockRefetch` is declared
// in `vi.hoisted` so it is available both to the hoisted factory's default
// state and to the test bodies that assert on it.
type HookResult = {
  data?: unknown;
  isLoading?: boolean;
  error?: unknown;
  refetch?: () => void;
};

const hoisted = vi.hoisted(() => ({
  mockRefetch: vi.fn(),
  state: {
    cashflow: {} as HookResult,
    sankey: {} as HookResult,
    spendingBreakdown: {} as HookResult,
    budgetComparison: {} as HookResult,
  },
}));

const { mockRefetch } = hoisted;
const reportsState = hoisted.state;

vi.mock("@/hooks/use-reports", () => ({
  useCurrentYearRange: () => ({ from: "2024-01-01", to: "2024-12-31" }),
  getReportsExportDownloadUrl: (id: string) =>
    `/api/reports/exports/${id}/download`,
  useReportsCashflow: () => reportsState.cashflow,
  useReportsSankey: () => reportsState.sankey,
  useReportsSpendingBreakdown: () => reportsState.spendingBreakdown,
  useReportsBudgetComparison: () => reportsState.budgetComparison,
}));

describe("CashFlow Error Handling", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    mockRefetch.mockClear();
    mockToast.mockClear();

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

  it("should display error message when cashflow fetch fails", async () => {
    reportsState.cashflow = {
      data: undefined,
      isLoading: false,
      error: new Error("Failed to fetch cashflow data"),
      refetch: mockRefetch,
    };

    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    // Should show error UI
    const chartError = await screen.findByTestId("chart-error");
    expect(chartError).toBeInTheDocument();
    expect(chartError).toHaveTextContent("Failed to load data");
    expect(chartError).toHaveTextContent(
      "There was an error loading your cash flow data"
    );

    // Should show retry button
    const retryButton = screen.getByRole("button", { name: /try again/i });
    expect(retryButton).toBeInTheDocument();
  });

  it("should allow user to retry after error", async () => {
    const user = userEvent.setup();

    reportsState.cashflow = {
      data: undefined,
      isLoading: false,
      error: new Error("Network error"),
      refetch: mockRefetch,
    };

    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    // Click retry button
    const retryButton = await screen.findByRole("button", { name: /try again/i });
    await user.click(retryButton);

    // refetch should be called
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("should handle export errors gracefully", async () => {
    const user = userEvent.setup();

    // Successful cashflow, but the export request below fails.
    reportsState.cashflow = {
      data: {
        range: {
          from: "2024-01-01",
          to: "2024-12-31",
          interval: "month",
          baseCurrency: "USD",
        },
        series: [],
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

    // Mock failed fetch for export
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: { message: "Server error" } }),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    // Find and click export button
    const exportButton = screen.getByRole("button", { name: /export/i });
    await user.click(exportButton);

    // Should show error toast
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: "Export failed",
        description: "There was an error exporting your data. Please try again.",
        variant: "destructive",
      });
    });
  });

  it("should handle multiple simultaneous errors", async () => {
    // Every report source errors at once.
    reportsState.cashflow = {
      data: undefined,
      isLoading: false,
      error: new Error("Cashflow error"),
      refetch: vi.fn(),
    };
    reportsState.sankey = {
      data: undefined,
      isLoading: false,
      error: new Error("Sankey error"),
      refetch: vi.fn(),
    };
    reportsState.spendingBreakdown = {
      data: undefined,
      isLoading: false,
      error: new Error("Spending error"),
    };
    reportsState.budgetComparison = {
      data: undefined,
      isLoading: false,
      error: new Error("Budget error"),
    };

    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    // Should show multiple error states
    expect(await screen.findByTestId("chart-error")).toBeInTheDocument();
    expect(await screen.findByTestId("table-error")).toBeInTheDocument();

    // Page should remain functional
    expect(screen.getByTestId("layout")).toBeInTheDocument();
  });
});
