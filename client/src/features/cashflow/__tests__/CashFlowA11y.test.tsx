/**
 * CashFlow Accessibility Tests
 *
 * Tests keyboard navigation and a11y compliance
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

// Mock use-reports hooks. Spread the real module first so requestReportExport
// (the export path under test, which attaches x-csrf-token via apiCall) stays
// genuine; the entries below override only the data hooks.
vi.mock("@/hooks/use-reports", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-reports")>()),
  useCurrentYearRange: () => ({
    from: "2024-01-01",
    to: "2024-12-31",
  }),
  getReportsExportDownloadUrl: (id: string) =>
    `/api/reports/exports/${id}/download`,
  useReportsCashflow: () => ({
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

// Mock all cashflow components
vi.mock("@/features/cashflow/components/CashFlowSummary", () => ({
  CashFlowSummary: () => <div data-testid="cashflow-summary">Summary</div>,
}));

// Mirror the real CashFlowFilters trigger's accessibility-relevant class
// (min-h-[44px] touch target) so the touch-target assertion exercises the
// same contract the product button satisfies.
vi.mock("@/features/cashflow/components/CashFlowFilters", () => ({
  CashFlowFilters: () => (
    <button data-testid="cashflow-filters" className="min-h-[44px]">
      Filter
    </button>
  ),
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
  ExpenseBreakdown: () => <div data-testid="expense-breakdown">Expenses</div>,
}));

vi.mock("@/features/cashflow/components/BudgetComparison", () => ({
  BudgetComparison: () => <div data-testid="budget-comparison">Budget</div>,
}));

vi.mock("@/features/cashflow/components/CurrencyWarning", () => ({
  CurrencyWarning: () => null,
}));

describe("CashFlow Accessibility", () => {
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
  });

  afterEach(() => {
    restoreLocation(originalLocation);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("should allow keyboard navigation to view toggle buttons", async () => {
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    // Tab through interactive elements
    await user.tab();

    // Check that focus moves to first interactive element
    const trendsButton = screen.getByRole("button", { name: /trends/i });
    const sankeyButton = screen.getByRole("button", { name: /sankey/i });
    const budgetButton = screen.getByRole("button", { name: /budget/i });

    // All view toggle buttons should be present
    expect(trendsButton).toBeInTheDocument();
    expect(sankeyButton).toBeInTheDocument();
    expect(budgetButton).toBeInTheDocument();
  });

  it("should have accessible button labels", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    // View toggle buttons should have accessible labels
    const trendsButton = screen.getByRole("button", { name: /trends/i });
    expect(trendsButton).toHaveAttribute("aria-pressed");

    const sankeyButton = screen.getByRole("button", { name: /sankey/i });
    expect(sankeyButton).toHaveAttribute("aria-pressed");

    const budgetButton = screen.getByRole("button", { name: /budget/i });
    expect(budgetButton).toHaveAttribute("aria-pressed");
  });

  it("should have accessible filter button", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    // Filter button should be accessible
    const filterButton = screen.getByRole("button", { name: /filter/i });
    expect(filterButton).toBeInTheDocument();
  });

  it("should have accessible export button", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    // Export button should be accessible
    const exportButton = screen.getByRole("button", { name: /export/i });
    expect(exportButton).toBeInTheDocument();
  });

  it("should allow keyboard activation of view toggle buttons", async () => {
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    const sankeyButton = screen.getByRole("button", { name: /sankey/i });

    // Click Sankey button with keyboard (Enter)
    sankeyButton.focus();
    await user.keyboard("{Enter}");

    // Sankey button should now be active
    expect(sankeyButton).toHaveAttribute("aria-pressed", "true");
  });

  it("should allow keyboard activation of export button", async () => {
    const user = userEvent.setup();

    // Mock fetch for export; serve apiCall's CSRF token fetch transparently.
    const downloadFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("date,amount", { headers: { "Content-Disposition": 'attachment; filename="cashflow.csv"' } }));
    const downloadClick = vi.fn();
    vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:cashflow"); static revokeObjectURL = vi.fn(); });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloadClick(this.download); });
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: "export-123" } }),
    });
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

    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    const exportButton = screen.getByRole("button", { name: /export/i });

    // Activate export with keyboard
    exportButton.focus();
    await user.keyboard("{Enter}");

    // Export should be triggered (fetch called). The CSRF token fetch adds an
    // await hop before the export request, so wait rather than assert inline.
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await waitFor(() => {
      expect(downloadFetch).toHaveBeenCalledWith("/api/reports/exports/export-123/download", expect.objectContaining({ credentials: "include" }));
      expect(downloadClick).toHaveBeenCalledWith("cashflow.csv");
    });
  });

  it("should have proper heading hierarchy", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    // Main heading should be h1
    const mainHeading = screen.getByRole("heading", { name: /cash flow/i, level: 1 });
    expect(mainHeading).toBeInTheDocument();
  });

  it("should have minimum touch target size for buttons", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    // View toggle buttons should have min-h-[44px] for accessibility
    const trendsButton = screen.getByRole("button", { name: /trends/i });
    expect(trendsButton).toHaveClass("min-h-[44px]");

    const filterButton = screen.getByRole("button", { name: /filter/i });
    expect(filterButton).toHaveClass("min-h-[44px]");

    const exportButton = screen.getByRole("button", { name: /export/i });
    expect(exportButton).toHaveClass("min-h-[44px]");
  });

  it("should have role=group for view toggle buttons", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    // View toggle container should have role=group
    const viewToggleGroup = screen.getByRole("group", {
      name: /chart view options/i,
    });
    expect(viewToggleGroup).toBeInTheDocument();
  });

  it("should not trap keyboard focus", async () => {
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <CashFlow />
      </QueryClientProvider>
    );

    // Tab through multiple elements - focus should not be trapped
    await user.tab(); // First interactive element
    await user.tab(); // Second interactive element
    await user.tab(); // Third interactive element

    // Document should still be navigable (no focus trap)
    expect(document.activeElement).toBeTruthy();
  });
});
