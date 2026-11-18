import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NetWorthWidget from "../NetWorthWidget";

// Mock the hooks
const mockRefetch = vi.fn();
vi.mock("@/hooks/use-reports", () => ({
  useCurrentYearRange: () => ({
    from: "2026-01-01",
    to: "2026-12-31",
  }),
  useReportsNetWorth: vi.fn(() => ({
    data: null,
    isLoading: true,
    error: null,
    refetch: mockRefetch,
  })),
}));

vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({
    formatCurrency: (val: number) => `$${val.toLocaleString()}`,
  }),
}));

// Get the mocked hook for manipulation in tests
import { useReportsNetWorth } from "@/hooks/use-reports";
const mockedUseReportsNetWorth = vi.mocked(useReportsNetWorth);

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("NetWorthWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state", () => {
    mockedUseReportsNetWorth.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: mockRefetch,
      isFetching: false,
      dataUpdatedAt: 0,
    } as unknown as ReturnType<typeof useReportsNetWorth>);

    render(<NetWorthWidget />, { wrapper: createWrapper() });

    // Should show loading spinner
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("renders error state with retry button", async () => {
    mockedUseReportsNetWorth.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Failed to fetch"),
      refetch: mockRefetch,
      isFetching: false,
      dataUpdatedAt: 0,
    } as unknown as ReturnType<typeof useReportsNetWorth>);

    render(<NetWorthWidget />, { wrapper: createWrapper() });

    // Should show error message
    expect(screen.getByText("Unable to load net worth")).toBeInTheDocument();
    expect(screen.getByText("Failed to fetch your net worth data.")).toBeInTheDocument();

    // Should have retry button
    const retryButton = screen.getByRole("button", { name: /try again/i });
    expect(retryButton).toBeInTheDocument();

    // Click retry should call refetch
    fireEvent.click(retryButton);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("renders net worth data correctly", () => {
    const mockData = {
      latest: { netWorth: 50000 },
      series: [
        {
          id: "Net Worth",
          data: [
            { x: "2026-01-01", y: 40000 },
            { x: "2026-02-01", y: 45000 },
            { x: "2026-03-01", y: 50000 },
          ],
        },
      ],
    };

    mockedUseReportsNetWorth.mockReturnValue({
      data: mockData,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      isFetching: false,
      dataUpdatedAt: Date.now(),
    } as unknown as ReturnType<typeof useReportsNetWorth>);

    render(<NetWorthWidget />, { wrapper: createWrapper() });

    // Should display net worth title
    expect(screen.getByText("Net Worth")).toBeInTheDocument();

    // Should display current net worth value
    expect(screen.getByText("$50,000")).toBeInTheDocument();

    // Should display percentage change (positive)
    // (50000 - 40000) / 40000 * 100 = 25%
    expect(screen.getByText("+25.0%")).toBeInTheDocument();
  });

  it("shows negative percentage for declining net worth", () => {
    const mockData = {
      latest: { netWorth: 30000 },
      series: [
        {
          id: "Net Worth",
          data: [
            { x: "2026-01-01", y: 40000 },
            { x: "2026-02-01", y: 35000 },
            { x: "2026-03-01", y: 30000 },
          ],
        },
      ],
    };

    mockedUseReportsNetWorth.mockReturnValue({
      data: mockData,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      isFetching: false,
      dataUpdatedAt: Date.now(),
    } as unknown as ReturnType<typeof useReportsNetWorth>);

    render(<NetWorthWidget />, { wrapper: createWrapper() });

    // Should display negative percentage
    // (30000 - 40000) / 40000 * 100 = -25%
    expect(screen.getByText("-25.0%")).toBeInTheDocument();
  });

  it("handles empty data gracefully", () => {
    const mockData = {
      latest: { netWorth: 0 },
      series: [],
    };

    mockedUseReportsNetWorth.mockReturnValue({
      data: mockData,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      isFetching: false,
      dataUpdatedAt: Date.now(),
    } as unknown as ReturnType<typeof useReportsNetWorth>);

    render(<NetWorthWidget />, { wrapper: createWrapper() });

    // Should display zero
    expect(screen.getByText("$0")).toBeInTheDocument();
  });
});
