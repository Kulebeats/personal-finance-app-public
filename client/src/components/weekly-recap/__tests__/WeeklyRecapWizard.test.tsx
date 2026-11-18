/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock the weekly recap data hook
vi.mock("../hooks/useWeeklyRecapData", () => ({
  useWeeklyRecapData: vi.fn(() => ({
    data: {
      weekStart: "2026-01-20",
      weekEnd: "2026-01-26",
      netWorth: {
        current: 50000,
        previous: 48000,
        change: 2000,
        changePercent: 4.17,
        series: [],
        trend: "up",
      },
      spending: {
        total: 1500,
        topCategories: [],
        hasData: true,
      },
      recurring: {
        upcoming: [],
        count: 0,
        totalAmount: 0,
      },
    },
    isLoading: false,
    error: null,
  })),
  useWeeklyRecapFeedback: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

// Import after mocks
import WeeklyRecapWizard from "../WeeklyRecapWizard";
import { useWeeklyRecapData } from "../hooks/useWeeklyRecapData";
import { SettingsProvider } from "@/contexts/SettingsContext";
const mockedUseWeeklyRecapData = vi.mocked(useWeeklyRecapData);

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>{children}</SettingsProvider>
    </QueryClientProvider>
  );
};

describe("WeeklyRecapWizard", () => {
  const mockOnOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when open is false", () => {
    render(
      <WeeklyRecapWizard open={false} onOpenChange={mockOnOpenChange} />,
      { wrapper: createWrapper() }
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows loading state when data is loading", () => {
    mockedUseWeeklyRecapData.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as unknown as ReturnType<typeof useWeeklyRecapData>);

    render(
      <WeeklyRecapWizard open={true} onOpenChange={mockOnOpenChange} />,
      { wrapper: createWrapper() }
    );

    // Should show loading spinner
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });
});
