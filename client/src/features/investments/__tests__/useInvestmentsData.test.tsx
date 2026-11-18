import { renderHook, act } from "@testing-library/react";
import { useInvestmentsData } from "../hooks/useInvestmentsData";
import { TestWrapper } from "@/test/test-utils";
import * as investmentHooks from "@/hooks/useInvestments";

// Mock the underlying hooks
vi.mock("@/hooks/useInvestments", () => ({
  useHoldings: vi.fn(),
  usePortfolioSummary: vi.fn(),
  useInvestmentPerformance: vi.fn(),
  useRefreshMarketData: vi.fn(),
}));

// Mock use-format
vi.mock("@/hooks/use-format", () => ({
  useFormat: () => ({
    formatCurrency: (amount: number, currency: string) =>
      `${currency} ${amount.toFixed(2)}`,
  }),
}));

describe("useInvestmentsData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return default state", () => {
    (investmentHooks.useHoldings as any).mockReturnValue({
      data: [],
      isLoading: false,
    });
    (investmentHooks.usePortfolioSummary as any).mockReturnValue({
      data: null,
      isLoading: false,
    });
    (investmentHooks.useInvestmentPerformance as any).mockReturnValue({
      data: [],
    });
    (investmentHooks.useRefreshMarketData as any).mockReturnValue({
      mutate: vi.fn(),
    });

    const { result } = renderHook(() => useInvestmentsData(), {
      wrapper: TestWrapper,
    });

    expect(result.current.displayCurrency).toBe("ZMW");
    expect(result.current.timeframe).toBe("1M");
    expect(result.current.holdings).toEqual([]);
    expect(result.current.allocationData).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("should compute allocation data correctly", () => {
    const mockHoldings = [
      {
        id: "1",
        currentValue: 1000,
        security: { type: "stock", symbol: "A" },
      },
      {
        id: "2",
        currentValue: 500,
        security: { type: "bond", symbol: "B" },
      },
      {
        id: "3",
        currentValue: 500,
        security: { type: "stock", symbol: "C" },
      },
    ];

    (investmentHooks.useHoldings as any).mockReturnValue({
      data: mockHoldings,
      isLoading: false,
    });
    (investmentHooks.usePortfolioSummary as any).mockReturnValue({
      data: { totalValue: 2000 },
      isLoading: false,
    });
    (investmentHooks.useInvestmentPerformance as any).mockReturnValue({
      data: [],
    });

    const { result } = renderHook(() => useInvestmentsData(), {
      wrapper: TestWrapper,
    });

    expect(result.current.allocationData).toHaveLength(2);
    // Stocks: 1500 total (75%)
    expect(result.current.allocationData[0].name).toBe("Stocks");
    expect(result.current.allocationData[0].value).toBe(75);
    // Bonds: 500 total (25%)
    expect(result.current.allocationData[1].name).toBe("Bonds");
    expect(result.current.allocationData[1].value).toBe(25);
  });
});
