import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SpendingWidget from "../SpendingWidget";

// Mock the hooks
const mockRefetch = vi.fn();
vi.mock("@/hooks/use-reports", () => ({
  useCurrentMonthRange: () => ({
    from: "2026-01-01",
    to: "2026-01-31",
  }),
  useReportsSpendingBreakdown: vi.fn(() => ({
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
import { useReportsSpendingBreakdown } from "@/hooks/use-reports";
const mockedUseReportsSpendingBreakdown = vi.mocked(useReportsSpendingBreakdown);

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("SpendingWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state", () => {
    mockedUseReportsSpendingBreakdown.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsSpendingBreakdown>);

    render(<SpendingWidget />, { wrapper: createWrapper() });

    // Should show loading spinner
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("renders error state with retry button", () => {
    mockedUseReportsSpendingBreakdown.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Failed to fetch"),
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsSpendingBreakdown>);

    render(<SpendingWidget />, { wrapper: createWrapper() });

    // Should show error message
    expect(screen.getByText("Unable to load categories")).toBeInTheDocument();
    expect(screen.getByText("Failed to fetch spending breakdown.")).toBeInTheDocument();

    // Should have retry button
    const retryButton = screen.getByRole("button", { name: /try again/i });
    expect(retryButton).toBeInTheDocument();

    // Click retry should call refetch
    fireEvent.click(retryButton);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("renders spending breakdown data correctly", () => {
    const mockData = {
      total: 2500,
      items: [
        { label: "Groceries", value: 800, color: "#3b82f6" },
        { label: "Transportation", value: 500, color: "#10b981" },
        { label: "Entertainment", value: 400, color: "#f59e0b" },
        { label: "Utilities", value: 300, color: "#8b5cf6" },
        { label: "Other", value: 500, color: "#64748b" },
      ],
    };

    mockedUseReportsSpendingBreakdown.mockReturnValue({
      data: mockData,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsSpendingBreakdown>);

    render(<SpendingWidget />, { wrapper: createWrapper() });

    // Should display title
    expect(screen.getByText("Top Categories")).toBeInTheDocument();

    // Should display total spending
    expect(screen.getByText("$2,500")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();

    // Should display top 3 categories in legend
    expect(screen.getByText("Groceries")).toBeInTheDocument();
    expect(screen.getByText("Transportation")).toBeInTheDocument();
    expect(screen.getByText("Entertainment")).toBeInTheDocument();

    // Should display formatted amounts
    expect(screen.getByText("$800")).toBeInTheDocument();
    expect(screen.getByText("$500")).toBeInTheDocument();
    expect(screen.getByText("$400")).toBeInTheDocument();
  });

  it("handles empty data gracefully", () => {
    const mockData = {
      total: 0,
      items: [],
    };

    mockedUseReportsSpendingBreakdown.mockReturnValue({
      data: mockData,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsSpendingBreakdown>);

    render(<SpendingWidget />, { wrapper: createWrapper() });

    // Should display zero total
    expect(screen.getByText("$0")).toBeInTheDocument();
  });

  it("uses fallback colors when item color is not provided", () => {
    const mockData = {
      total: 1000,
      items: [
        { label: "Category A", value: 500 }, // No color provided
        { label: "Category B", value: 500 }, // No color provided
      ],
    };

    mockedUseReportsSpendingBreakdown.mockReturnValue({
      data: mockData,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useReportsSpendingBreakdown>);

    render(<SpendingWidget />, { wrapper: createWrapper() });

    // Should render without errors using fallback colors
    expect(screen.getByText("Category A")).toBeInTheDocument();
    expect(screen.getByText("Category B")).toBeInTheDocument();
  });
});
