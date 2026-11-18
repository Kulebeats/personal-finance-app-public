/**
 * Reports Chart Drill-Down Tests
 *
 * Verifies the Reports page's chart segments navigate to a correctly
 * filtered Transactions view (audit v2 finding B3: the Sankey drill-down was
 * a non-functional "Click to view transaction details." stub; the
 * spending-by-category and income/expense charts had no drill-down wired at
 * all). `CashFlowSection`/`SpendingSection`/`IncomeSection` are stubbed with
 * a button that fires their real onClick/onNodeClick/onSegmentClick prop so
 * this test exercises Reports.tsx's own wiring rather than re-testing the
 * third-party chart libraries (nivo/recharts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import Reports from "@/pages/Reports";

const money = (value: number, currency: string = "USD") => ({
  amount: value.toFixed(2),
  currency,
});

const mockDrillDown = vi.fn();
vi.mock("@/hooks/use-drilldown", () => ({
  useDrillDown: () => ({ drillDown: mockDrillDown }),
}));

vi.mock("@/hooks/use-reports", () => ({
  useReportsSankey: vi.fn(() => ({ data: null, isLoading: false })),
  useReportsSpendingBreakdown: vi.fn(() => ({
    data: {
      items: [
        { id: "cat-1", label: "Groceries", value: money(500), percent: 100 },
      ],
      total: money(500),
      range: { baseCurrency: "USD" },
      groupBy: "category",
    },
    isLoading: false,
  })),
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
      ],
      totals: {
        income: money(5000),
        expenses: money(3000),
        savings: money(2000),
        debt: money(0),
        savingsRate: 40,
      },
      range: { baseCurrency: "USD" },
    },
    isLoading: false,
  })),
  useReportsNetWorth: vi.fn(() => ({
    data: { series: [{ data: [] }] },
    isLoading: false,
  })),
  useReportsSavingsRate: vi.fn(() => ({ data: { series: [] }, isLoading: false })),
  useReportsExports: vi.fn(() => ({ data: { exports: [] }, isLoading: false })),
  useReportsSpendingTrend: vi.fn(() => ({ data: null, isLoading: false })),
  useCurrentYearRange: vi.fn(() => ({
    from: "2026-01-01",
    to: "2026-12-31",
    year: 2026,
  })),
  useCurrentMonthRange: vi.fn(() => ({ from: "2026-01-01", to: "2026-01-31" })),
  useLastNMonthsRange: vi.fn(() => ({ from: "2025-10-01", to: "2026-01-31" })),
  getReportsExportDownloadUrl: vi.fn((id) => `/api/reports/exports/${id}?download=true`),
}));

vi.mock("@/hooks/use-settings", () => ({
  useMerchants: vi.fn(() => ({ data: [] })),
}));

vi.mock("@/hooks/use-report-widget-preferences", () => ({
  useWidgetOnboarding: vi.fn(() => ({
    hasCompletedSetup: true,
    completeOnboarding: vi.fn(),
    isLoading: false,
  })),
  useReportWidgetPreferences: vi.fn(() => ({
    data: { coreWidgets: {}, optionalWidgets: {} },
    isLoading: false,
  })),
}));

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/reports/AnnualDashboard", () => ({
  default: () => <div>Annual Dashboard</div>,
}));

vi.mock("@/components/reports/WidgetGalleryModal", () => ({
  WidgetGalleryModal: () => null,
}));

vi.mock("@/components/reports/WidgetOnboardingModal", () => ({
  WidgetOnboardingModal: () => null,
}));

// Stub the lazy-loaded Sankey chart with a button that fires the real
// onNodeClick prop Reports.tsx passes in, simulating a click on a
// server-provided "category" node without depending on nivo's SVG rendering.
vi.mock("@/features/reports/components/CashFlowSection", () => ({
  CashFlowSection: ({
    onNodeClick,
  }: {
    onNodeClick?: (node: { id: string; label: string; entityType: string; entityId: string }) => void;
  }) => (
    <button
      onClick={() =>
        onNodeClick?.({
          id: "category:cat-1",
          label: "Groceries",
          entityType: "category",
          entityId: "cat-1",
        })
      }
    >
      simulate-sankey-node-click
    </button>
  ),
}));

// Stub Spending/Income while keeping the rest of the barrel real (ReportHeader,
// SummaryCards, CashFlowDrilldownPanel, ...).
vi.mock("@/features/reports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/reports")>();
  return {
    ...actual,
    SpendingSection: ({
      onClick,
    }: {
      onClick?: (entry: { id: string; label: string; value: number; color: string }) => void;
    }) => (
      <button
        onClick={() =>
          onClick?.({ id: "cat-1", label: "Groceries", value: 500, color: "#fff" })
        }
      >
        simulate-pie-slice-click
      </button>
    ),
    IncomeSection: ({
      onSegmentClick,
    }: {
      onSegmentClick?: (type: "income" | "expense") => void;
    }) => (
      <div>
        <button onClick={() => onSegmentClick?.("income")}>simulate-income-bar-click</button>
        <button onClick={() => onSegmentClick?.("expense")}>simulate-expense-bar-click</button>
      </div>
    ),
  };
});

const renderReports = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <Reports />
      </Router>
    </QueryClientProvider>,
  );
};

describe("Reports chart drill-down", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    mockDrillDown.mockClear();
  });

  it("navigates to filtered transactions when a Sankey category node is clicked and confirmed", async () => {
    renderReports();

    await user.click(screen.getByText("Cash Flow"));
    await waitFor(() => {
      expect(screen.getByText("simulate-sankey-node-click")).toBeInTheDocument();
    });

    // No longer shows the old dead-end placeholder before a node is selected.
    expect(screen.queryByText(/Click to view transaction details/i)).not.toBeInTheDocument();

    await user.click(screen.getByText("simulate-sankey-node-click"));

    const viewTransactionsButton = await screen.findByRole("button", {
      name: /view transactions/i,
    });
    await user.click(viewTransactionsButton);

    expect(mockDrillDown).toHaveBeenCalledWith({
      categoryId: "cat-1",
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("navigates filtered by type=expense when a spending slice is clicked (default grouping is categoryGroup - no categoryGroupId filter exists yet)", async () => {
    renderReports();

    await user.click(screen.getByText("Spending"));
    await waitFor(() => {
      expect(screen.getByText("simulate-pie-slice-click")).toBeInTheDocument();
    });

    await user.click(screen.getByText("simulate-pie-slice-click"));

    expect(mockDrillDown).toHaveBeenCalledWith({
      type: "expense",
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("navigates filtered by type=income when the income bar is clicked", async () => {
    renderReports();

    await user.click(screen.getByText("Income"));
    await waitFor(() => {
      expect(screen.getByText("simulate-income-bar-click")).toBeInTheDocument();
    });

    await user.click(screen.getByText("simulate-income-bar-click"));

    expect(mockDrillDown).toHaveBeenCalledWith({
      type: "income",
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("navigates filtered by type=expense when the expense bar is clicked", async () => {
    renderReports();

    await user.click(screen.getByText("Income"));
    await waitFor(() => {
      expect(screen.getByText("simulate-expense-bar-click")).toBeInTheDocument();
    });

    await user.click(screen.getByText("simulate-expense-bar-click"));

    expect(mockDrillDown).toHaveBeenCalledWith({
      type: "expense",
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });
});
