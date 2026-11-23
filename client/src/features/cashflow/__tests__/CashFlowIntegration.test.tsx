/**
 * CashFlow Module - End-to-End Integration Tests
 * Tests the complete flow from forecast to budget comparison to export
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

// Mock wouter
vi.mock("wouter", () => ({
  useLocation: () => ["/cashflow", vi.fn()],
}));

// Mock Layout
vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

// Mock formatters
vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({
    formatCurrency: (val: number) => `$${val.toFixed(2)}`,
    currency: "USD",
  }),
}));

// Mock mobile hook
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

// Mock toast
const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

// Mock cashflow hooks
const mockCashflowData = vi.fn();
const mockSankeyData = vi.fn();
const mockBudgetComparison = vi.fn();
const mockExportMutation = vi.fn();

// Mock fetch delegate: apiCall's CSRF token fetch is served transparently by
// the global.fetch wrapper installed in beforeEach; real requests land here.
const mockFetch = vi.fn();
const downloadFetch = vi.fn();
const downloadClick = vi.fn();

// Spread the real module first so requestReportExport (the export path under
// test, which attaches x-csrf-token via apiCall) stays genuine; the entries
// below override only the hooks.
vi.mock("@/hooks/use-reports", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-reports")>()),
  useReportsCashflow: () => mockCashflowData(),
  useReportsSankey: () => mockSankeyData(),
  useReportsBudgetComparison: () => mockBudgetComparison(),
  useReportsExport: () => ({
    mutate: mockExportMutation(),
    isPending: false,
  }),
  // CashFlow.tsx also consumes these from use-reports; they must be present on
  // the mock or the page crashes on render. IncomeBreakdown/ExpenseBreakdown are
  // rendered unmocked and call useReportsSpendingBreakdown.
  useCurrentYearRange: () => ({ from: "2026-01-01", to: "2026-12-31" }),
  getReportsExportDownloadUrl: (id: string) =>
    `/api/reports/exports/${id}/download`,
  useReportsSpendingBreakdown: () => ({
    data: { items: [] },
    isLoading: false,
    error: null,
  }),
}));

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

const renderWithProviders = (ui: React.ReactElement) => {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
};

describe("CashFlow Integration Tests", () => {
  let user: ReturnType<typeof userEvent.setup>;
  let originalLocation: Location;

  beforeEach(() => {
    user = userEvent.setup();
    vi.clearAllMocks();

    // Store original location
    originalLocation = window.location;
    installMockLocation(originalLocation);
    downloadFetch.mockReset().mockImplementation(async () => new Response("date,amount", { headers: { "Content-Disposition": 'attachment; filename="cashflow.csv"' } }));
    downloadClick.mockReset();
    vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:cashflow"); static revokeObjectURL = vi.fn(); });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloadClick({ href: this.href, filename: this.download }); });

    // Mock fetch for export. Serve apiCall's CSRF token fetch transparently so
    // it neither consumes per-test once-mocks nor shows up in assertions;
    // everything else delegates to mockFetch.
    mockFetch.mockReset();
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/csrf-token")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ csrfToken: "test-csrf" }),
        } as unknown as Response);
      }
      if (String(input).endsWith("/download")) return downloadFetch(input, init);
      return mockFetch(input, init);
    }) as unknown as typeof fetch;

    // Default mock responses
    mockCashflowData.mockReturnValue({
      data: {
        range: { from: "2026-01-01", to: "2026-12-31", interval: "month", baseCurrency: "USD" },
        series: [
          {
            period: "Jan 2026",
            periodStart: "2026-01-01",
            income: { amount: "5000", currency: "USD" },
            expenses: { amount: "3000", currency: "USD" },
            savings: { amount: "2000", currency: "USD" },
            savingsRate: 40,
          },
          {
            period: "Feb 2026",
            periodStart: "2026-02-01",
            income: { amount: "5000", currency: "USD" },
            expenses: { amount: "3200", currency: "USD" },
            savings: { amount: "1800", currency: "USD" },
            savingsRate: 36,
          },
        ],
        totals: {
          income: { amount: "10000", currency: "USD" },
          expenses: { amount: "6200", currency: "USD" },
          savings: { amount: "3800", currency: "USD" },
          savingsRate: 38,
        },
        metadata: {
          currencyMode: "household",
          baseCurrency: "USD",
          generatedAt: new Date().toISOString(),
        },
      },
      isLoading: false,
      error: null,
    });

    mockSankeyData.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });

    mockBudgetComparison.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });

    mockExportMutation.mockReturnValue(vi.fn());
  });

  afterEach(() => {
    restoreLocation(originalLocation);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("Forecast to Budget Comparison Flow", () => {
    it("should enable forecast, display forecast data, then switch to budget view", async () => {
      // Step 1: Render page with default (no forecast)
      renderWithProviders(<CashFlow />);

      // Verify initial state shows only actual data
      await waitFor(() => {
        expect(screen.getByText("Jan 2026")).toBeInTheDocument();
      });

      // Step 2: Open filters and enable forecast
      const filtersButton = screen.getByRole("button", { name: /^filter$/i });
      await user.click(filtersButton);

      // Wait for filter modal to open
      await waitFor(() => {
        expect(screen.getByText(/group by/i)).toBeInTheDocument();
      });

      // Find and toggle forecast switch
      const forecastToggle = screen.getByRole("switch", { name: /include forecast/i });
      await user.click(forecastToggle);

      // Verify forecast horizon selector appears
      await waitFor(() => {
        expect(screen.getByText(/forecast horizon/i)).toBeInTheDocument();
      });

      // Apply filters
      const applyButton = screen.getByRole("button", { name: /apply filters/i });
      await user.click(applyButton);

      // Step 3: Mock forecast data response
      mockCashflowData.mockReturnValue({
        data: {
          range: { from: "2026-01-01", to: "2026-12-31", interval: "month", baseCurrency: "USD" },
          series: [
            // Actual periods
            {
              period: "Jan 2026",
              periodStart: "2026-01-01",
              income: { amount: "5000", currency: "USD" },
              expenses: { amount: "3000", currency: "USD" },
              savings: { amount: "2000", currency: "USD" },
              savingsRate: 40,
            },
            // Forecast periods
            {
              period: "Feb 2026",
              periodStart: "2026-02-01",
              income: { amount: "5100", currency: "USD" },
              expenses: { amount: "3100", currency: "USD" },
              savings: { amount: "2000", currency: "USD" },
              savingsRate: 39.2,
              isForecast: true,
            },
          ],
          totals: {
            income: { amount: "10100", currency: "USD" },
            expenses: { amount: "6100", currency: "USD" },
            savings: { amount: "4000", currency: "USD" },
            savingsRate: 39.6,
          },
          metadata: {
            currencyMode: "household",
            baseCurrency: "USD",
            generatedAt: new Date().toISOString(),
            forecastConfig: {
              enabled: true,
              months: 3,
              method: "recurring_rules",
              confidence: "medium",
            },
          },
        },
        isLoading: false,
        error: null,
      });

      // Verify forecast data appears. "Forecast" shows both as the always-present
      // view-toggle button and as the chart legend once forecast data is loaded,
      // so allow multiple matches.
      await waitFor(() => {
        expect(screen.getAllByText(/forecast/i).length).toBeGreaterThan(0);
      });

      // Mock budget comparison data (shape matches BudgetComparisonData:
      // comparison[] with categoryName/budgeted/actual/variance/status + summary).
      // Set before switching views so the budget view renders populated on its
      // first paint (the mocked hook has no internal state to re-trigger render).
      mockBudgetComparison.mockReturnValue({
        data: {
          comparison: [
            {
              period: "2026-01",
              categoryId: "cat1",
              categoryName: "Groceries",
              budgeted: { amount: "500", currency: "USD" },
              actual: { amount: "450", currency: "USD" },
              variance: { amount: "50", currency: "USD" },
              variancePercent: 10,
              status: "under" as const,
            },
            {
              period: "2026-01",
              categoryId: "cat2",
              categoryName: "Rent",
              budgeted: { amount: "1500", currency: "USD" },
              actual: { amount: "1500", currency: "USD" },
              variance: { amount: "0", currency: "USD" },
              variancePercent: 0,
              status: "on_track" as const,
            },
          ],
          summary: {
            totalActual: { amount: "1950", currency: "USD" },
            totalBudgeted: { amount: "2000", currency: "USD" },
            totalVariance: { amount: "50", currency: "USD" },
            categoriesOverBudget: 0,
            categoriesUnderBudget: 1,
          },
          metadata: {
            budgetsCovered: 2,
            categoriesWithoutBudget: [],
            periodNormalization: "full" as const,
          },
        },
        isLoading: false,
        error: null,
      });

      // Step 4: Switch to Budget view
      const budgetButton = screen.getByRole("button", { name: /budget/i });
      await user.click(budgetButton);

      // Verify budget comparison category details appear. BudgetComparison
      // renders each category name twice (chart axis label + details list), so
      // assert presence with getAllByText rather than a single-match query.
      await waitFor(() => {
        expect(screen.getAllByText("Groceries").length).toBeGreaterThan(0);
        expect(screen.getAllByText("Rent").length).toBeGreaterThan(0);
      });

      // Verify per-category status (variance) indicators are displayed
      expect(screen.getByText("Under")).toBeInTheDocument(); // Groceries under budget
      expect(screen.getByText("On Track")).toBeInTheDocument(); // Rent on track
    });

    it("should handle forecast disabled for non-monthly intervals", async () => {
      renderWithProviders(<CashFlow />);

      // Open filters
      const filtersButton = screen.getByRole("button", { name: /^filter$/i });
      await user.click(filtersButton);

      // Wait for modal
      await waitFor(() => {
        expect(screen.getByText(/group by/i)).toBeInTheDocument();
      });

      // Forecast switch is available while the interval is monthly.
      expect(
        screen.getByRole("switch", { name: /include forecast/i })
      ).toBeInTheDocument();

      // Change the "Group By" interval to Week. The Radix Select trigger has no
      // accessible name in jsdom, so locate it via its section label.
      const groupByLabel = screen.getByText("Group By");
      const groupBySection = groupByLabel.closest("div");
      if (!groupBySection) throw new Error("Group By section not found");
      const intervalSelect = within(groupBySection).getByRole("combobox");
      await user.click(intervalSelect);

      const weeklyOption = screen.getByRole("option", { name: /week/i });
      await user.click(weeklyOption);

      // For non-monthly intervals the component hides the forecast switch
      // entirely (forecast is only supported for monthly grouping).
      expect(
        screen.queryByRole("switch", { name: /include forecast/i })
      ).not.toBeInTheDocument();
    });

    it("should persist forecast settings when switching between views", async () => {
      renderWithProviders(<CashFlow />);

      // Enable forecast
      const filtersButton = screen.getByRole("button", { name: /^filter$/i });
      await user.click(filtersButton);

      await waitFor(() => {
        expect(screen.getByRole("switch", { name: /include forecast/i })).toBeInTheDocument();
      });

      const forecastToggle = screen.getByRole("switch", { name: /include forecast/i });
      await user.click(forecastToggle);

      const applyButton = screen.getByRole("button", { name: /apply filters/i });
      await user.click(applyButton);

      // Switch to Sankey view
      const sankeyButton = screen.getByRole("button", { name: /sankey/i });
      await user.click(sankeyButton);

      // Wait for Sankey render
      await waitFor(() => {
        expect(screen.queryByTestId("bar-chart")).not.toBeInTheDocument();
      });

      // Switch back to Trends
      const trendsButton = screen.getByRole("button", { name: /trends/i });
      await user.click(trendsButton);

      // Forecast should still be enabled (check for forecast label)
      await waitFor(() => {
        expect(screen.getByText(/forecast/i)).toBeInTheDocument();
      });
    });
  });

  describe("Export Flow with Filter Combinations", () => {
    it("should export data-affecting filters but exclude chart-only forecast", async () => {
      renderWithProviders(<CashFlow />);

      // Set up complex filter state
      const filtersButton = screen.getByRole("button", { name: /^filter$/i });
      await user.click(filtersButton);

      await waitFor(() => {
        expect(screen.getByText(/group by/i)).toBeInTheDocument();
      });

      // Enable forecast
      const forecastToggle = screen.getByRole("switch", { name: /include forecast/i });
      await user.click(forecastToggle);

      // Enable include pending
      const pendingToggle = screen.getByRole("switch", { name: /include pending/i });
      await user.click(pendingToggle);

      // Enable include transfers
      const transfersToggle = screen.getByRole("switch", { name: /include transfers/i });
      await user.click(transfersToggle);

      const applyButton = screen.getByRole("button", { name: /apply filters/i });
      await user.click(applyButton);

      // Mock successful export
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: "export-123" } }),
      });

      // Click export
      const exportButton = screen.getByRole("button", { name: /export/i });
      await user.click(exportButton);

      // Verify fetch was called with the export filter params. The CSV export
      // body carries the data-affecting filters (includePending, includeTransfers,
      // scope, interval). Forecast is chart-only: even though the user enabled it
      // above, it is deliberately NOT sent so the CSV never mixes projected
      // periods into exported history.
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/reports/exports",
          expect.objectContaining({
            method: "POST",
            headers: expect.objectContaining({
              "Content-Type": "application/json",
              "x-csrf-token": "test-csrf",
            }),
            body: expect.stringContaining("includePending"),
          })
        );
      });
      const exportBody = JSON.parse(
        mockFetch.mock.calls[0][1]
          .body as string
      );
      expect(exportBody).toMatchObject({
        reportType: "cashflow",
        includePending: true,
        includeTransfers: true,
      });
      // Forecast stays out of the export, regardless of the chart toggle.
      expect(exportBody).not.toHaveProperty("includeForecast");
      expect(exportBody).not.toHaveProperty("forecastMonths");

      // Preserve the genuine guarded binary download after export generation.
      await waitFor(() => {
        expect(downloadFetch).toHaveBeenCalledWith("/api/reports/exports/export-123/download", expect.objectContaining({ credentials: "include" }));
        expect(downloadClick).toHaveBeenCalledWith({ href: "blob:cashflow", filename: "cashflow.csv" });
      });

      // Verify success toast
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Export complete",
        })
      );
    });

    it("should export budget comparison data", async () => {
      // Mock budget data (BudgetComparisonData shape) up front so the budget
      // view renders populated on first paint. The mocked hook ignores its
      // `enabled` arg and has no internal state, so there is no second render to
      // pick up a value set after the view switch.
      mockBudgetComparison.mockReturnValue({
        data: {
          comparison: [
            {
              period: "2026-01",
              categoryId: "cat1",
              categoryName: "Groceries",
              budgeted: { amount: "500", currency: "USD" },
              actual: { amount: "450", currency: "USD" },
              variance: { amount: "50", currency: "USD" },
              variancePercent: 10,
              status: "under" as const,
            },
          ],
          summary: {
            totalActual: { amount: "450", currency: "USD" },
            totalBudgeted: { amount: "500", currency: "USD" },
            totalVariance: { amount: "50", currency: "USD" },
            categoriesOverBudget: 0,
            categoriesUnderBudget: 1,
          },
          metadata: {
            budgetsCovered: 1,
            categoriesWithoutBudget: [],
            periodNormalization: "full" as const,
          },
        },
        isLoading: false,
        error: null,
      });

      renderWithProviders(<CashFlow />);

      // Switch to Budget view
      const budgetButton = screen.getByRole("button", { name: /budget/i });
      await user.click(budgetButton);

      await waitFor(() => {
        // Category name appears in both the chart axis and the details list.
        expect(screen.getAllByText("Groceries").length).toBeGreaterThan(0);
      });

      // Mock export
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: "export-budget-456" } }),
      });

      // Click export
      const exportButton = screen.getByRole("button", { name: /export/i });
      await user.click(exportButton);

      // Verify the export posts a budget-comparison export while in the budget
      // view (reportType: "budget"), not a cashflow export.
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/reports/exports",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining("budget"),
          })
        );
      });
      const budgetExportBody = JSON.parse(
        mockFetch.mock.calls[0][1]
          .body as string
      );
      expect(budgetExportBody).toMatchObject({ reportType: "budget" });
    });

    it("should handle export failure gracefully", async () => {
      renderWithProviders(<CashFlow />);

      // Mock failed export
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const exportButton = screen.getByRole("button", { name: /export/i });
      await user.click(exportButton);

      // Verify error toast (matches CashFlow.tsx handleExport failure toast)
      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Export failed",
            variant: "destructive",
          })
        );
      });

      // Verify no redirect happened
      expect(window.location.href).toBe("");
    });
  });

  describe("Multi-Currency Warning Integration", () => {
    it("should display warning when mixed currencies detected", async () => {
      // Mock multi-currency data
      mockCashflowData.mockReturnValue({
        data: {
          range: { from: "2026-01-01", to: "2026-12-31", interval: "month", baseCurrency: "USD" },
          series: [
            {
              period: "Jan 2026",
              periodStart: "2026-01-01",
              income: { amount: "5000", currency: "USD" },
              expenses: { amount: "3000", currency: "USD" },
              savings: { amount: "2000", currency: "USD" },
              savingsRate: 40,
            },
          ],
          totals: {
            income: { amount: "5000", currency: "USD" },
            expenses: { amount: "3000", currency: "USD" },
            savings: { amount: "2000", currency: "USD" },
            savingsRate: 40,
          },
          metadata: {
            currencyMode: "mixed", // Mixed currencies flag
            baseCurrency: "USD",
            generatedAt: new Date().toISOString(),
          },
        },
        isLoading: false,
        error: null,
      });

      renderWithProviders(<CashFlow />);

      // Verify warning banner appears
      await waitFor(() => {
        expect(screen.getByText("Multi-Currency Data Aggregated")).toBeInTheDocument();
      });

      // Verify warning describes base currency
      expect(screen.getByText(/converted to USD/i)).toBeInTheDocument();
    });

    it("should not display warning for single-currency households", async () => {
      // Default mock has currencyMode: "household"
      renderWithProviders(<CashFlow />);

      await waitFor(() => {
        expect(screen.getByText("Jan 2026")).toBeInTheDocument();
      });

      // Verify warning banner does NOT appear
      expect(screen.queryByText("Multi-Currency Data Aggregated")).not.toBeInTheDocument();
    });
  });

  describe("Complete User Journey", () => {
    it("should complete full flow: filters → forecast → budget → export", async () => {
      renderWithProviders(<CashFlow />);

      // Step 1: View initial cashflow
      await waitFor(() => {
        expect(screen.getByText("Jan 2026")).toBeInTheDocument();
      });

      // Step 2: Open filters and enable forecast
      const filtersButton = screen.getByRole("button", { name: /^filter$/i });
      await user.click(filtersButton);

      await waitFor(() => {
        const forecastToggle = screen.getByRole("switch", { name: /include forecast/i });
        expect(forecastToggle).toBeInTheDocument();
      });

      const forecastToggle = screen.getByRole("switch", { name: /include forecast/i });
      await user.click(forecastToggle);

      const applyButton = screen.getByRole("button", { name: /apply filters/i });
      await user.click(applyButton);

      // Update mock to include forecast
      mockCashflowData.mockReturnValue({
        data: {
          range: { from: "2026-01-01", to: "2026-12-31", interval: "month", baseCurrency: "USD" },
          series: [
            {
              period: "Jan 2026",
              periodStart: "2026-01-01",
              income: { amount: "5000", currency: "USD" },
              expenses: { amount: "3000", currency: "USD" },
              savings: { amount: "2000", currency: "USD" },
              savingsRate: 40,
            },
            {
              period: "Feb 2026",
              periodStart: "2026-02-01",
              income: { amount: "5100", currency: "USD" },
              expenses: { amount: "3100", currency: "USD" },
              savings: { amount: "2000", currency: "USD" },
              savingsRate: 39.2,
              isForecast: true,
            },
          ],
          totals: {
            income: { amount: "10100", currency: "USD" },
            expenses: { amount: "6100", currency: "USD" },
            savings: { amount: "4000", currency: "USD" },
            savingsRate: 39.6,
          },
          metadata: {
            currencyMode: "household",
            baseCurrency: "USD",
            generatedAt: new Date().toISOString(),
            forecastConfig: {
              enabled: true,
              months: 1,
              method: "recurring_rules",
              confidence: "medium",
            },
          },
        },
        isLoading: false,
        error: null,
      });

      // Step 3: Verify forecast appears. "Forecast" matches both the view-toggle
      // button and the chart legend once forecast data loads.
      await waitFor(() => {
        expect(screen.getAllByText(/forecast/i).length).toBeGreaterThan(0);
      });

      // Mock budget data before switching views so the budget view renders
      // populated on its first paint (mocked hook has no state to re-trigger).
      mockBudgetComparison.mockReturnValue({
        data: {
          comparison: [
            {
              period: "2026-01",
              categoryId: "cat1",
              categoryName: "Groceries",
              budgeted: { amount: "500", currency: "USD" },
              actual: { amount: "450", currency: "USD" },
              variance: { amount: "50", currency: "USD" },
              variancePercent: 10,
              status: "under" as const,
            },
          ],
          summary: {
            totalActual: { amount: "450", currency: "USD" },
            totalBudgeted: { amount: "500", currency: "USD" },
            totalVariance: { amount: "50", currency: "USD" },
            categoriesOverBudget: 0,
            categoriesUnderBudget: 1,
          },
          metadata: {
            budgetsCovered: 1,
            categoriesWithoutBudget: [],
            periodNormalization: "full" as const,
          },
        },
        isLoading: false,
        error: null,
      });

      // Step 4: Switch to Budget view
      const budgetButton = screen.getByRole("button", { name: /budget/i });
      await user.click(budgetButton);

      // Step 5: Verify budget table (category name renders in chart + list)
      await waitFor(() => {
        expect(screen.getAllByText("Groceries").length).toBeGreaterThan(0);
      });

      // Step 6: Export
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: "export-final" } }),
      });

      const exportButton = screen.getByRole("button", { name: /export/i });
      await user.click(exportButton);

      // Step 7: Verify successful export
      await waitFor(() => {
        expect(downloadFetch).toHaveBeenCalledWith("/api/reports/exports/export-final/download", expect.objectContaining({ credentials: "include" }));
        expect(downloadClick).toHaveBeenCalledWith({ href: "blob:cashflow", filename: "cashflow.csv" });
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Export complete",
        })
      );
    });
  });
});
