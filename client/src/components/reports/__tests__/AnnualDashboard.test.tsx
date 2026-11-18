import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnnualDashboard } from "../AnnualDashboard";
import * as hooks from "@/hooks/use-report-widget-preferences";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock the hooks
vi.mock("@/hooks/use-report-widget-preferences", () => ({
  useReportWidgetPreferences: vi.fn(),
  useWidgetToggle: vi.fn(() => ({ toggleWidget: vi.fn() })),
  useWidgetOnboarding: vi.fn(() => ({ resetOnboarding: vi.fn() })),
  useCustomCharts: vi.fn(() => ({
    customCharts: [],
    addCustomChart: vi.fn(),
    updateCustomChart: vi.fn(),
    deleteCustomChart: vi.fn(),
  })),
  useUpdateReportWidgetPreferences: vi.fn(() => ({ mutate: vi.fn() })),
}));

vi.mock("@/hooks/use-reports", () => ({
  useReportsAnnual: vi.fn(() => ({ data: null, isLoading: false })),
  useCurrentYearRange: vi.fn(() => ({
    from: "2026-01-01",
    to: "2026-12-31",
    year: 2026,
  })),
  useReportsDebt: vi.fn(() => ({ data: null, isLoading: false })),
  useReportsNetWorthChanges: vi.fn(() => ({ data: null, isLoading: false })),
  useReportsNetWorth: vi.fn(() => ({ data: null, isLoading: false })),
  useReportsFinancialRatios: vi.fn(() => ({ data: null, isLoading: false })),
}));

vi.mock("@/hooks/use-drilldown", () => ({
  useDrillDown: vi.fn(() => ({ drillDown: vi.fn() })),
}));

// Mock the widgets to avoid complex rendering
vi.mock("../AnnualSummaryWidget", () => ({
  default: () => <div data-testid="summary-widget">Summary</div>,
}));
vi.mock("../GoalsProgressWidget", () => ({
  GoalsProgressWidget: () => <div data-testid="goals-widget">Goals</div>,
}));
vi.mock("../ExpenseClassificationWidget", () => ({
  ExpenseClassificationWidget: () => (
    <div data-testid="expense-widget">Expenses</div>
  ),
}));
vi.mock("../TrendingWidget", () => ({
  TrendingWidget: () => <div data-testid="trending-widget">Trending</div>,
}));
vi.mock("../ComparisonWidget", () => ({
  ComparisonWidget: () => <div data-testid="comparison-widget">Comparison</div>,
}));
vi.mock("../FinancialRatiosWidget", () => ({
  FinancialRatiosWidget: () => <div>Financial Ratios</div>,
}));
vi.mock("../ForecastWidget", () => ({
  ForecastWidget: () => <div>Forecast</div>,
}));
vi.mock("../NetWorthChangesWidget", () => ({
  NetWorthChangesWidget: () => <div>Net Worth Changes</div>,
}));
vi.mock("../DebtAnalysisWidget", () => ({
  DebtAnalysisWidget: () => <div>Debt Analysis</div>,
}));
vi.mock("../SubcategoryBreakdownWidget", () => ({
  SubcategoryBreakdownWidget: () => <div>Subcategory Breakdown</div>,
}));
vi.mock("../MonthlyTrendsWidget", () => ({
  default: () => <div>Monthly Trends</div>,
}));
vi.mock("../CumulativeGrowthWidget", () => ({
  default: () => <div>Cumulative Growth</div>,
}));
vi.mock("../CategoryBreakdownWidget", () => ({
  default: () => <div>Category Breakdown</div>,
}));
vi.mock("../CustomChartWidget", () => ({
  default: () => <div>Custom Chart</div>,
}));
vi.mock("../CustomizeDashboardModal", () => ({
  CustomizeDashboardModal: () => <div>Customize Modal</div>,
}));
vi.mock("../CustomChartBuilderModal", () => ({
  CustomChartBuilderModal: () => <div>Chart Builder</div>,
}));

const createTestQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={createTestQueryClient()}>
    {children}
  </QueryClientProvider>
);

describe("AnnualDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render loading skeleton when loading", () => {
    (hooks.useReportWidgetPreferences as any).mockReturnValue({
      data: null,
      isLoading: true,
    });

    const { container } = render(
      <TestWrapper>
        <AnnualDashboard />
      </TestWrapper>
    );
    expect(
      container.getElementsByClassName("animate-pulse").length
    ).toBeGreaterThan(0);
  });

  it("should render core widgets when enabled", () => {
    (hooks.useReportWidgetPreferences as any).mockReturnValue({
      data: {
        coreWidgets: {
          summaryCards: { enabled: true, order: 0 },
          goalProgress: { enabled: true, order: 1 },
          fixedVariableExpenses: { enabled: true, order: 2 },
        },
        optionalWidgets: {},
      },
      isLoading: false,
    });

    render(
      <TestWrapper>
        <AnnualDashboard />
      </TestWrapper>
    );

    expect(screen.getByTestId("summary-widget")).toBeDefined();
    expect(screen.getByTestId("goals-widget")).toBeDefined();
    expect(screen.getByTestId("expense-widget")).toBeDefined();
  });

  it("should not render hidden widgets", () => {
    (hooks.useReportWidgetPreferences as any).mockReturnValue({
      data: {
        coreWidgets: {
          summaryCards: { enabled: true, order: 0 },
          goalProgress: { enabled: false, order: 1 }, // Disabled
          fixedVariableExpenses: { enabled: true, order: 2 },
        },
        optionalWidgets: {},
      },
      isLoading: false,
    });

    render(
      <TestWrapper>
        <AnnualDashboard />
      </TestWrapper>
    );

    expect(screen.getByTestId("summary-widget")).toBeDefined();
    expect(screen.queryByTestId("goals-widget")).toBeNull();
    expect(screen.getByTestId("expense-widget")).toBeDefined();
  });

  it("should render empty state when all widgets disabled", () => {
    (hooks.useReportWidgetPreferences as any).mockReturnValue({
      data: {
        coreWidgets: {
          summaryCards: { enabled: false },
          goalProgress: { enabled: false },
          fixedVariableExpenses: { enabled: false },
        },
        optionalWidgets: {
          monthlyTrends: { enabled: false, order: 0 },
        },
      },
      isLoading: false,
    });

    render(
      <TestWrapper>
        <AnnualDashboard />
      </TestWrapper>
    );

    expect(screen.getByText(/All widgets are currently hidden/i)).toBeDefined();
  });
});
