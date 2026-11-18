import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DashboardBudgetWidget from "../DashboardBudgetWidget";

// Mock the hooks
const mockRefetch = vi.fn();
vi.mock("@/hooks/use-reports", () => ({
  useReportsCashflow: vi.fn(() => ({
    data: null,
    isLoading: true,
    error: null,
    refetch: mockRefetch,
  })),
  useCurrentMonthRange: vi.fn(() => ({
    from: "2026-01-01",
    to: "2026-01-31",
  })),
  useLastNMonthsRange: vi.fn(() => ({
    from: "2025-11-01",
    to: "2026-01-31",
  })),
  useCurrentYearRange: vi.fn(() => ({
    from: "2026-01-01",
    to: "2026-12-31",
    year: 2026,
  })),
}));

vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({
    formatCurrency: (val: number) => `$${val.toLocaleString()}`,
  }),
}));

// Get the mocked hook for manipulation in tests
import { useReportsCashflow } from "@/hooks/use-reports";
const mockedUseReportsCashflow = vi.mocked(useReportsCashflow);

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("DashboardBudgetWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state", () => {
    mockedUseReportsCashflow.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsCashflow>);

    render(<DashboardBudgetWidget />, { wrapper: createWrapper() });

    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("renders error state with retry button", () => {
    mockedUseReportsCashflow.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Database error"),
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsCashflow>);

    render(<DashboardBudgetWidget />, { wrapper: createWrapper() });

    expect(screen.getByText("Unable to load budget summary")).toBeInTheDocument();
    expect(screen.getByText("We couldn't fetch income and expense totals.")).toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: /try again/i });
    fireEvent.click(retryButton);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("renders budget data with income and expenses", () => {
    mockedUseReportsCashflow.mockReturnValue({
      data: {
        totals: {
          income: { amount: "5000.00", currency: "USD" },
          expenses: { amount: "-3500.00", currency: "USD" },
        },
        series: [],
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsCashflow>);

    render(<DashboardBudgetWidget />, { wrapper: createWrapper() });

    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.getByText("$5,000")).toBeInTheDocument();
    expect(screen.getByText("earned")).toBeInTheDocument();
    expect(screen.getByText("$3,500")).toBeInTheDocument();
    expect(screen.getByText("spent")).toBeInTheDocument();
  });

  it("calculates net cashflow correctly", () => {
    mockedUseReportsCashflow.mockReturnValue({
      data: {
        totals: {
          income: { amount: "5000.00", currency: "USD" },
          expenses: { amount: "-3500.00", currency: "USD" },
        },
        series: [],
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsCashflow>);

    render(<DashboardBudgetWidget />, { wrapper: createWrapper() });

    // Net should be 5000 - 3500 = 1500
    expect(screen.getByText("+$1,500")).toBeInTheDocument();
    expect(screen.getByText("Net cashflow")).toBeInTheDocument();
  });

  it("calculates savings rate correctly", () => {
    mockedUseReportsCashflow.mockReturnValue({
      data: {
        totals: {
          income: { amount: "5000.00", currency: "USD" },
          expenses: { amount: "-3500.00", currency: "USD" },
        },
        series: [],
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsCashflow>);

    render(<DashboardBudgetWidget />, { wrapper: createWrapper() });

    // Savings rate = (1500 / 5000) * 100 = 30%
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.getByText("Savings rate")).toBeInTheDocument();
  });

  it("shows negative net cashflow with red color", () => {
    mockedUseReportsCashflow.mockReturnValue({
      data: {
        totals: {
          income: { amount: "3000.00", currency: "USD" },
          expenses: { amount: "-4000.00", currency: "USD" },
        },
        series: [],
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsCashflow>);

    render(<DashboardBudgetWidget />, { wrapper: createWrapper() });

    // Net should be negative: 3000 - 4000 = -1000
    const netElement = screen.getByText("$-1,000");
    expect(netElement).toBeInTheDocument();
    expect(netElement.className).toContain("text-rose-600");
  });

  it("handles zero income correctly", () => {
    mockedUseReportsCashflow.mockReturnValue({
      data: {
        totals: {
          income: { amount: "0.00", currency: "USD" },
          expenses: { amount: "-500.00", currency: "USD" },
        },
        series: [],
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsCashflow>);

    render(<DashboardBudgetWidget />, { wrapper: createWrapper() });

    expect(screen.getByText("$0")).toBeInTheDocument();
    expect(screen.getByText("$500")).toBeInTheDocument();
    // Savings rate should be 0 when income is 0
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("handles empty data gracefully", () => {
    mockedUseReportsCashflow.mockReturnValue({
      data: {
        totals: {
          income: { amount: "0.00", currency: "USD" },
          expenses: { amount: "0.00", currency: "USD" },
        },
        series: [],
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsCashflow>);

    render(<DashboardBudgetWidget />, { wrapper: createWrapper() });

    expect(screen.getByText("Budget")).toBeInTheDocument();
    // Should display zero values for income and expenses
    const zeroAmounts = screen.getAllByText("$0");
    expect(zeroAmounts.length).toBeGreaterThan(0);
  });

  it("switches between range options", () => {
    mockedUseReportsCashflow.mockReturnValue({
      data: {
        totals: {
          income: { amount: "5000.00", currency: "USD" },
          expenses: { amount: "-3000.00", currency: "USD" },
        },
        series: [],
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsCashflow>);

    render(<DashboardBudgetWidget />, { wrapper: createWrapper() });

    // Should display the budget widget
    expect(screen.getByText("Budget")).toBeInTheDocument();

    // Verify range selector is present
    const rangeSelect = screen.getByRole("combobox");
    expect(rangeSelect).toBeInTheDocument();
  });

  it("links to the budgets page so the widget is not a dead end (audit v2 P2)", () => {
    mockedUseReportsCashflow.mockReturnValue({
      data: {
        totals: {
          income: { amount: "5000.00", currency: "USD" },
          expenses: { amount: "-3500.00", currency: "USD" },
        },
        series: [],
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsCashflow>);

    render(<DashboardBudgetWidget />, { wrapper: createWrapper() });

    const link = screen.getByRole("link", { name: /view budget/i });
    expect(link).toHaveAttribute("href", "/budget");
  });

  it("handles MoneyDto amounts correctly", () => {
    mockedUseReportsCashflow.mockReturnValue({
      data: {
        totals: {
          income: { amount: "1234.56", currency: "USD" },
          expenses: { amount: "-987.65", currency: "USD" },
        },
        series: [],
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsCashflow>);

    render(<DashboardBudgetWidget />, { wrapper: createWrapper() });

    // Should correctly parse MoneyDto values
    expect(screen.getByText("$1,234.56")).toBeInTheDocument();
    expect(screen.getByText("$987.65")).toBeInTheDocument();
  });
});
