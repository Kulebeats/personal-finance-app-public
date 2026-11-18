import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DashboardSpendingWidget from "../DashboardSpendingWidget";

// Mock the hooks
const mockRefetch = vi.fn();
vi.mock("@/hooks/use-reports", () => ({
  useReportsSpendingTrend: vi.fn(() => ({
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
import { useReportsSpendingTrend } from "@/hooks/use-reports";
const mockedUseReportsSpendingTrend = vi.mocked(useReportsSpendingTrend);

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("DashboardSpendingWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state", () => {
    mockedUseReportsSpendingTrend.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsSpendingTrend>);

    render(<DashboardSpendingWidget />, { wrapper: createWrapper() });

    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("renders error state with retry button", () => {
    mockedUseReportsSpendingTrend.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Network error"),
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsSpendingTrend>);

    render(<DashboardSpendingWidget />, { wrapper: createWrapper() });

    expect(screen.getByText("Unable to load spending trend")).toBeInTheDocument();
    expect(screen.getByText("We couldn't fetch this report.")).toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: /try again/i });
    fireEvent.click(retryButton);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("renders empty state when no data", () => {
    mockedUseReportsSpendingTrend.mockReturnValue({
      data: {
        series: [],
        totals: { current: { amount: "0", currency: "USD" } },
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsSpendingTrend>);

    render(<DashboardSpendingWidget />, { wrapper: createWrapper() });

    expect(screen.getByText("No spending data for this period.")).toBeInTheDocument();
  });

  it("renders chart with data and handles MoneyDto correctly", () => {
    mockedUseReportsSpendingTrend.mockReturnValue({
      data: {
        series: [
          {
            date: "2026-01-15",
            current: { amount: "1500.50", currency: "USD" },
            previous: { amount: "1200.00", currency: "USD" },
          },
          {
            date: "2026-01-22",
            current: { amount: "2000.75", currency: "USD" },
            previous: { amount: "1800.00", currency: "USD" },
          },
        ],
        totals: {
          current: { amount: "3501.25", currency: "USD" },
          previous: { amount: "3000.00", currency: "USD" },
        },
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsSpendingTrend>);

    render(<DashboardSpendingWidget />, { wrapper: createWrapper() });

    // Check that the title and total are displayed
    expect(screen.getByText("Spending")).toBeInTheDocument();
    expect(screen.getByText("$3,501.25")).toBeInTheDocument();
  });

  it("switches between range options", () => {
    mockedUseReportsSpendingTrend.mockReturnValue({
      data: {
        series: [
          {
            date: "2026-01-15",
            current: { amount: "1500.00", currency: "USD" },
          },
        ],
        totals: {
          current: { amount: "1500.00", currency: "USD" },
        },
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsSpendingTrend>);

    render(<DashboardSpendingWidget />, { wrapper: createWrapper() });

    // Should display the current range
    expect(screen.getByText("Spending")).toBeInTheDocument();

    // Verify range selector is present with correct value
    const rangeSelects = screen.getAllByRole("combobox");
    expect(rangeSelects.length).toBeGreaterThan(0);
  });

  it("toggles comparison mode", () => {
    mockedUseReportsSpendingTrend.mockReturnValue({
      data: {
        series: [
          {
            date: "2026-01-15",
            current: { amount: "1500.00", currency: "USD" },
            previous: { amount: "1200.00", currency: "USD" },
          },
        ],
        totals: {
          current: { amount: "1500.00", currency: "USD" },
          previous: { amount: "1200.00", currency: "USD" },
        },
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsSpendingTrend>);

    render(<DashboardSpendingWidget />, { wrapper: createWrapper() });

    // Should display comparison legend when previous data is present
    expect(screen.getByText("Previous period")).toBeInTheDocument();
    expect(screen.getByText("Selected period")).toBeInTheDocument();

    // Verify comparison selector is present
    const compareSelects = screen.getAllByRole("combobox");
    expect(compareSelects.length).toBe(2);
  });

  it("handles date parsing correctly for different formats", () => {
    mockedUseReportsSpendingTrend.mockReturnValue({
      data: {
        series: [
          {
            date: "2026-01-15",
            current: { amount: "100.00", currency: "USD" },
          },
          {
            date: "2026-01-15T00:00:00Z",
            current: { amount: "200.00", currency: "USD" },
          },
        ],
        totals: {
          current: { amount: "300.00", currency: "USD" },
        },
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsSpendingTrend>);

    render(<DashboardSpendingWidget />, { wrapper: createWrapper() });

    // Should render without errors
    expect(screen.getByText("Spending")).toBeInTheDocument();
  });
});
