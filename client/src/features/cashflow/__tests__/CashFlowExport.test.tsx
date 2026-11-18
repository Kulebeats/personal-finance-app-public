/**
 * CashFlow Export Flow Tests
 *
 * Tests the export functionality for cashflow reports
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CashFlow from "@/pages/CashFlow";

type MockLocation = Location & { href: string };

function installMockLocation(originalLocation: Location): MockLocation {
  const mockLocation = {
    ...originalLocation,
    href: "",
  } as MockLocation;

  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: mockLocation,
  });

  return mockLocation;
}

function restoreLocation(originalLocation: Location) {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
}

// Create mockToast outside to reference in vi.mock
const mockToast = vi.fn();

// Mock dependencies
vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({
    formatCurrency: (val: number) => `$${val.toLocaleString()}`,
  }),
  useSettings: () => ({
    settings: { currency: "USD" },
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

// Mock fetch delegate: apiCall's CSRF token fetch is served transparently by
// the global.fetch wrapper installed in beforeEach; real requests land here.
const mockFetch = vi.fn();

// Mock use-reports hooks. Spread the real module first so requestReportExport
// (the export path under test, which attaches x-csrf-token via apiCall) stays
// genuine; the entries below override only the data hooks.
vi.mock("@/hooks/use-reports", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-reports")>()),
  useCurrentYearRange: () => ({
    from: "2024-01-01",
    to: "2024-12-31",
  }),
  getReportsExportDownloadUrl: (id: string) => `/api/reports/exports/${id}/download`,
  useReportsCashflow: () => ({
    data: {
      range: { from: "2024-01-01", to: "2024-12-31", interval: "month", baseCurrency: "USD" },
      series: [],
      totals: {
        income: { amount: "10000.00", currency: "USD" },
        expenses: { amount: "4000.00", currency: "USD" },
        savings: { amount: "6000.00", currency: "USD" },
        savingsRate: 60,
        debt: { amount: "0.00", currency: "USD" },
      },
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useReportsSankey: () => ({
    data: { sankey: { nodes: [], links: [] }, totals: {} },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useReportsSpendingBreakdown: () => ({
    data: { items: [] },
    isLoading: false,
    error: null,
  }),
  useReportsBudgetComparison: () => ({
    data: undefined,
    isLoading: false,
    error: null,
  }),
}));

// Mock the remaining Nivo Sankey chart.
vi.mock("@nivo/sankey", () => ({
  ResponsiveSankey: () => <div data-testid="sankey-chart">Sankey Chart</div>,
}));

// Mock cashflow components
vi.mock("@/features/cashflow/components/CashFlowFilters", () => ({
  CashFlowFilters: () => <div data-testid="cashflow-filters">Filters</div>,
}));

vi.mock("@/features/cashflow/hooks/useCashFlowData", () => ({
  useCashFlowData: () => ({
    isLoading: false,
    error: null,
    tableIsLoading: false,
    tableError: null,
    refetch: vi.fn(),
    barChartData: [],
    sankeyChartData: { nodes: [], links: [] },
    totals: {
      income: { amount: "10000.00", currency: "USD" },
      expenses: { amount: "4000.00", currency: "USD" },
      savings: { amount: "6000.00", currency: "USD" },
      savingsRate: 60,
    },
    actualPeriods: 12,
    periodLabel: "month",
    cashflowData: { range: {}, series: [] },
    interval: "month",
    hasForecast: false,
  }),
}));

vi.mock("@/features/cashflow/components/CashFlowSummary", () => ({
  CashFlowSummary: () => <div data-testid="cashflow-summary">Summary</div>,
}));

vi.mock("@/features/cashflow/components/CashFlowChart", () => ({
  CashFlowChart: () => <div data-testid="cashflow-chart">Chart</div>,
}));

vi.mock("@/features/cashflow/components/CashFlowTable", () => ({
  CashFlowTable: () => <div data-testid="cashflow-table">Table</div>,
}));

vi.mock("@/features/cashflow/components/IncomeBreakdown", () => ({
  IncomeBreakdown: () => <div data-testid="income-breakdown">Income</div>,
}));

vi.mock("@/features/cashflow/components/ExpenseBreakdown", () => ({
  ExpenseBreakdown: () => <div data-testid="expense-breakdown">Expense</div>,
}));

vi.mock("@/features/cashflow/components/BudgetComparison", () => ({
  BudgetComparison: () => <div data-testid="budget-comparison">Budget</div>,
}));

describe("CashFlow Export", () => {
  let queryClient: QueryClient;
  const originalLocation = window.location;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    installMockLocation(originalLocation);

    // Mock fetch. Serve apiCall's CSRF token fetch transparently so it neither
    // consumes per-test once-mocks nor shows up in assertions; everything else
    // delegates to mockFetch.
    mockFetch.mockReset();
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/csrf-token")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ csrfToken: "test-csrf" }),
        } as unknown as Response);
      }
      return mockFetch(input, init);
    }) as unknown as typeof fetch;

    // Clear toast mock
    mockToast.mockClear();
  });

  afterEach(() => {
    restoreLocation(originalLocation);
    vi.clearAllMocks();
  });

  it("successfully exports cashflow data", async () => {
    const user = userEvent.setup();
    const mockExportId = "export-123";

    // Mock successful export API response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { id: mockExportId },
      }),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    // Wait for component to load
    await waitFor(() => {
      expect(screen.getByText("Cash Flow")).toBeInTheDocument();
    });

    // Find and click export button
    const exportButton = screen.getByRole("button", { name: /export/i });
    await user.click(exportButton);

    // Verify API was called with correct parameters
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/reports/exports",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "x-csrf-token": "test-csrf",
          }),
          credentials: "include",
          body: expect.stringContaining("cashflow"),
        })
      );
    });

    // Verify request body
    const fetchCall = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody).toMatchObject({
      reportType: "cashflow",
      format: "csv",
      startDate: "2024-01-01",
      endDate: "2024-12-31",
      interval: "month",
    });

    // Verify redirect to download URL
    await waitFor(() => {
      expect(window.location.href).toBe(`/api/reports/exports/${mockExportId}/download`);
    });

    // Verify success toast
    expect(mockToast).toHaveBeenCalledWith({
      title: "Export complete",
      description: "Your cash flow data has been downloaded.",
    });
  });

  it("handles export failure with error toast", async () => {
    const user = userEvent.setup();

    // Mock failed export API response
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        success: false,
        error: { message: "Export failed" },
      }),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    // Wait for component to load
    await waitFor(() => {
      expect(screen.getByText("Cash Flow")).toBeInTheDocument();
    });

    // Find and click export button
    const exportButton = screen.getByRole("button", { name: /export/i });
    await user.click(exportButton);

    // Verify error toast is shown
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: "Export failed",
        description: "There was an error exporting your data. Please try again.",
        variant: "destructive",
      });
    });

    // Verify no redirect happened
    expect(window.location.href).toBe("");
  });

  it("handles network error during export", async () => {
    const user = userEvent.setup();

    // Mock network error
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    // Wait for component to load
    await waitFor(() => {
      expect(screen.getByText("Cash Flow")).toBeInTheDocument();
    });

    // Find and click export button
    const exportButton = screen.getByRole("button", { name: /export/i });
    await user.click(exportButton);

    // Verify error toast is shown
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: "Export failed",
        description: "There was an error exporting your data. Please try again.",
        variant: "destructive",
      });
    });
  });

  it("includes filter parameters in export request", async () => {
    const user = userEvent.setup();
    const mockExportId = "export-456";

    // Mock successful export
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { id: mockExportId },
      }),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    // Wait for component to load
    await waitFor(() => {
      expect(screen.getByText("Cash Flow")).toBeInTheDocument();
    });

    // Click export button
    const exportButton = screen.getByRole("button", { name: /export/i });
    await user.click(exportButton);

    // Verify all filter parameters are included
    await waitFor(() => {
      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);

      expect(requestBody).toMatchObject({
        reportType: "cashflow",
        format: "csv",
        startDate: expect.any(String),
        endDate: expect.any(String),
        interval: expect.any(String),
        includePending: expect.any(Boolean),
        includeTransfers: expect.any(Boolean),
        scope: expect.any(String),
      });
    });
  });

  it("disables export button while exporting", async () => {
    const user = userEvent.setup();

    // Mock slow export response
    mockFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: async () => ({
                  success: true,
                  data: { id: "export-789" },
                }),
              }),
            100
          )
        )
    );

    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    // Wait for component to load
    await waitFor(() => {
      expect(screen.getByText("Cash Flow")).toBeInTheDocument();
    });

    // Click export button
    const exportButton = screen.getByRole("button", { name: /export/i });
    await user.click(exportButton);

    // Button should be disabled immediately
    expect(exportButton).toBeDisabled();

    // Wait for export to complete
    await waitFor(
      () => {
        expect(exportButton).not.toBeDisabled();
      },
      { timeout: 200 }
    );
  });
});
