import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import Reports from "@/pages/Reports";

const money = (value: number, currency: string = "USD") => ({
  amount: value.toFixed(2),
  currency,
});

// Mock all the hooks used by Reports page
vi.mock("@/hooks/use-reports", () => ({
  useReportsSankey: vi.fn(() => ({ data: null, isLoading: false })),
  useReportsSpendingBreakdown: vi.fn(() => ({
    data: {
      items: [
        {
          id: "1",
          label: "Food",
          value: money(500),
          percent: 71.43,
          entityType: "category",
          entityId: "1",
        },
        {
          id: "2",
          label: "Transport",
          value: money(200),
          percent: 28.57,
          entityType: "category",
          entityId: "2",
        },
      ],
      total: money(700),
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
    data: { series: [{ data: [] }] },
    isLoading: false,
  })),
  useReportsSavingsRate: vi.fn(() => ({
    data: { series: [] },
    isLoading: false,
  })),
  useReportsExports: vi.fn(() => ({
    data: { exports: [] },
    isLoading: false,
  })),
  useReportsSpendingTrend: vi.fn(() => ({ data: null, isLoading: false })),
  useCurrentYearRange: vi.fn(() => ({
    from: "2026-01-01",
    to: "2026-12-31",
    year: 2026,
  })),
  useCurrentMonthRange: vi.fn(() => ({
    from: "2026-01-01",
    to: "2026-01-31",
  })),
  useLastNMonthsRange: vi.fn(() => ({
    from: "2025-10-01",
    to: "2026-01-31",
  })),
  getReportsExportDownloadUrl: vi.fn(
    (id) => `/api/reports/exports/${id}?download=true`
  ),
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
    data: {
      coreWidgets: { summaryCards: { enabled: true, order: 0 } },
      optionalWidgets: {},
    },
    isLoading: false,
  })),
}));

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

vi.mock("@/components/reports/AnnualDashboard", () => ({
  default: () => <div data-testid="annual-dashboard">Annual Dashboard</div>,
}));

vi.mock("@/components/reports/WidgetGalleryModal", () => ({
  WidgetGalleryModal: () => null,
}));

vi.mock("@/components/reports/WidgetOnboardingModal", () => ({
  WidgetOnboardingModal: () => null,
}));

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={createTestQueryClient()}>
    <Router>{children}</Router>
  </QueryClientProvider>
);

describe("Reports Page Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render the Reports page with header", () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>
    );

    expect(screen.getByText("Reports")).toBeDefined();
  });

  it("should render all tab buttons", () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>
    );

    expect(screen.getAllByText("Annual Dashboard").length).toBeGreaterThan(0);
    expect(screen.getByText("Cash Flow")).toBeDefined();
    expect(screen.getByText("Spending")).toBeDefined();
    expect(screen.getByText("Merchants")).toBeDefined();
    expect(screen.getByText("Income")).toBeDefined();
    expect(screen.getByText("Net Worth")).toBeDefined();
    expect(screen.getByText("Savings")).toBeDefined();
  });

  it("should show Annual Dashboard by default", () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>
    );

    expect(screen.getByTestId("annual-dashboard")).toBeDefined();
  });

  it("should switch to Spending tab when clicked", async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText("Spending"));

    // Annual dashboard should not be visible when on spending tab
    await waitFor(() => {
      expect(screen.queryByTestId("annual-dashboard")).toBeNull();
    });
  });

  it("should show summary cards on non-annual tabs", async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText("Income"));

    await waitFor(() => {
      expect(screen.getByText("Total Income")).toBeDefined();
      expect(screen.getByText("Total Expenses")).toBeDefined();
      expect(screen.getByText("Total Net Income")).toBeDefined();
      expect(screen.getByText("Savings Rate")).toBeDefined();
    });
  });

  it("should display correctly formatted currency values", async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText("Income"));

    await waitFor(() => {
      expect(screen.getByText("$10,500")).toBeDefined(); // Total income
      expect(screen.getByText("$6,200")).toBeDefined(); // Total expenses
    });
  });

  it("should have Customize and Export buttons", () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>
    );

    expect(screen.getByText("Customize")).toBeDefined();
    expect(screen.getByText("Export")).toBeDefined();
  });

  it("should highlight active tab", () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>
    );

    const annualTabs = screen.getAllByText("Annual Dashboard");
    // Tab button should have the active styling
    const tabButton = annualTabs.find((el) => el.className?.includes("px-4"));
    expect(tabButton?.className).toContain("bg-orange-500");
  });

  it("should switch tab highlight when new tab is clicked", async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>
    );

    const spendingTab = screen.getByText("Spending");
    fireEvent.click(spendingTab);

    await waitFor(() => {
      expect(spendingTab.className).toContain("bg-orange-500");
    });
  });
});
