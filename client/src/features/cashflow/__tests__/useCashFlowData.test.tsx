import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useCashFlowData } from "../hooks/useCashFlowData";
import { useReportsCashflow, useReportsSankey } from "@/hooks/use-reports";

const money = (value: number, currency: string = "USD") => ({
  amount: value.toFixed(2),
  currency,
});

// Mock the hooks
vi.mock("@/hooks/use-reports", () => ({
  useReportsCashflow: vi.fn(),
  useReportsSankey: vi.fn(),
  useCurrentYearRange: vi.fn(() => ({ from: "2024-01-01", to: "2024-12-31" })),
}));

describe("useCashFlowData", () => {
  const mockFilters = {
    from: "2024-01-01",
    to: "2024-06-30",
    interval: "month" as const,
    scope: "household" as const,
    includePending: false,
    includeTransfers: false,
    includeForecast: false,
    forecastMonths: 3,
  };

  const mockCashflowData = {
    series: [
      {
        periodStart: "2024-01-01",
        income: money(5000),
        expenses: money(3000),
        savings: money(2000),
        debt: money(0),
        savingsRate: 40,
      },
      {
        periodStart: "2024-02-01",
        income: money(5500),
        expenses: money(3500),
        savings: money(2000),
        debt: money(0),
        savingsRate: 36.36,
      },
    ],
    totals: {
      income: money(10500),
      expenses: money(6500),
      savings: money(4000),
      debt: money(0),
      savingsRate: 38.09,
    },
  };

  const mockSankeyData = {
    sankey: {
      nodes: [
        { id: "synthetic:income", label: "Income" },
        { id: "categoryGroup:expenses", label: "Expenses" },
      ],
      links: [
        {
          source: "synthetic:income",
          target: "categoryGroup:expenses",
          value: money(100),
        },
      ],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns cashflow data correctly for bar view", () => {
    (useReportsCashflow as any).mockReturnValue({
      data: mockCashflowData,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    (useReportsSankey as any).mockReturnValue({
      data: undefined,
      isLoading: false,
    });

    const { result } = renderHook(() => useCashFlowData(mockFilters, "bar"));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.barChartData).toHaveLength(2);
    expect(result.current.barChartData[0]).toEqual({
      month: "Jan",
      income: 5000,
      expenses: 3000,
      savings: 2000,
      periodStart: "2024-01-01",
      isForecast: false,
    });
    expect(result.current.totals).toEqual({
      income: 10500,
      expenses: 6500,
      savings: 4000,
      savingsRate: 38.09,
    });
  });

  it("handles loading state for bar view", () => {
    (useReportsCashflow as any).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    const { result } = renderHook(() => useCashFlowData(mockFilters, "bar"));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.barChartData).toEqual([]);
  });

  it("returns sankey data correctly for sankey view", () => {
    (useReportsCashflow as any).mockReturnValue({
      data: mockCashflowData,
      isLoading: false,
    });

    (useReportsSankey as any).mockReturnValue({
      data: mockSankeyData,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useCashFlowData(mockFilters, "sankey"));

    expect(result.current.isLoading).toBe(false); // view is sankey
    expect(result.current.sankeyChartData).toEqual({
      nodes: mockSankeyData.sankey.nodes,
      links: [
        {
          source: "synthetic:income",
          target: "categoryGroup:expenses",
          value: 100,
        },
      ],
    });
  });

  it("handles error state", () => {
    (useReportsCashflow as any).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Failed"),
    });

    const { result } = renderHook(() => useCashFlowData(mockFilters, "bar"));
    expect(result.current.error).toBeTruthy();
  });

  describe("interval-specific labels", () => {
    const weeklyFilters = { ...mockFilters, interval: "week" as const };
    const dailyFilters = { ...mockFilters, interval: "day" as const };

    const weeklyData = {
      series: [
        {
          periodStart: "2024-01-01",
          income: money(1000),
          expenses: money(500),
          savings: money(500),
          debt: money(0),
          savingsRate: 50,
        },
        {
          periodStart: "2024-01-08",
          income: money(1200),
          expenses: money(600),
          savings: money(600),
          debt: money(0),
          savingsRate: 50,
        },
      ],
      totals: mockCashflowData.totals,
    };

    beforeEach(() => {
      (useReportsSankey as any).mockReturnValue({
        data: undefined,
        isLoading: false,
      });
    });

    it("generates weekly labels as date ranges", () => {
      (useReportsCashflow as any).mockReturnValue({
        data: weeklyData,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      const { result } = renderHook(() => useCashFlowData(weeklyFilters, "bar"));

      expect(result.current.periodLabel).toBe("Weekly");
      // Week starting Jan 1 ends Jan 7 (same month)
      expect(result.current.barChartData[0].month).toBe("Jan 1 - 7");
      // Week starting Jan 8 ends Jan 14
      expect(result.current.barChartData[1].month).toBe("Jan 8 - 14");
    });

    it("generates daily labels with day numbers", () => {
      const dailyData = {
        series: [
          {
            periodStart: "2024-01-15",
            income: money(100),
            expenses: money(50),
            savings: money(50),
            debt: money(0),
            savingsRate: 50,
          },
        ],
        totals: mockCashflowData.totals,
      };

      (useReportsCashflow as any).mockReturnValue({
        data: dailyData,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      const { result } = renderHook(() => useCashFlowData(dailyFilters, "bar"));

      expect(result.current.periodLabel).toBe("Daily");
      expect(result.current.barChartData[0].month).toBe("Jan 15");
    });

    it("includes year in labels for multi-year ranges", () => {
      const multiYearFilters = {
        ...mockFilters,
        from: "2024-12-01",
        to: "2025-02-28",
      };

      const multiYearData = {
        series: [
          {
            periodStart: "2024-12-01",
            income: money(5000),
            expenses: money(3000),
            savings: money(2000),
            debt: money(0),
            savingsRate: 40,
          },
          {
            periodStart: "2025-01-01",
            income: money(5500),
            expenses: money(3500),
            savings: money(2000),
            debt: money(0),
            savingsRate: 36.36,
          },
        ],
        totals: mockCashflowData.totals,
      };

      (useReportsCashflow as any).mockReturnValue({
        data: multiYearData,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      const { result } = renderHook(() => useCashFlowData(multiYearFilters, "bar"));

      // Should include year for multi-year ranges
      expect(result.current.barChartData[0].month).toMatch(/Dec.*24/);
      expect(result.current.barChartData[1].month).toMatch(/Jan.*25/);
    });

    it("includes year in weekly labels for multi-year ranges", () => {
      const multiYearWeeklyFilters = {
        ...mockFilters,
        interval: "week" as const,
        from: "2024-12-01",
        to: "2025-01-31",
      };

      const multiYearWeeklyData = {
        series: [
          {
            periodStart: "2024-12-02",
            income: money(1000),
            expenses: money(500),
            savings: money(500),
            debt: money(0),
            savingsRate: 50,
          },
          {
            periodStart: "2025-01-06",
            income: money(1200),
            expenses: money(600),
            savings: money(600),
            debt: money(0),
            savingsRate: 50,
          },
        ],
        totals: mockCashflowData.totals,
      };

      (useReportsCashflow as any).mockReturnValue({
        data: multiYearWeeklyData,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      const { result } = renderHook(() => useCashFlowData(multiYearWeeklyFilters, "bar"));

      // Should include year for multi-year weekly ranges
      expect(result.current.barChartData[0].month).toMatch(/Dec.*2.*-.*8.*'24/);
      expect(result.current.barChartData[1].month).toMatch(/Jan.*6.*-.*12.*'25/);
    });

    it("includes year in daily labels for multi-year ranges", () => {
      const multiYearDailyFilters = {
        ...mockFilters,
        interval: "day" as const,
        from: "2024-12-31",
        to: "2025-01-02",
      };

      const multiYearDailyData = {
        series: [
          {
            periodStart: "2024-12-31",
            income: money(100),
            expenses: money(50),
            savings: money(50),
            debt: money(0),
            savingsRate: 50,
          },
          {
            periodStart: "2025-01-01",
            income: money(100),
            expenses: money(50),
            savings: money(50),
            debt: money(0),
            savingsRate: 50,
          },
        ],
        totals: mockCashflowData.totals,
      };

      (useReportsCashflow as any).mockReturnValue({
        data: multiYearDailyData,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      const { result } = renderHook(() => useCashFlowData(multiYearDailyFilters, "bar"));

      // Should include year for multi-year daily ranges
      expect(result.current.barChartData[0].month).toMatch(/Dec.*31.*24/);
      expect(result.current.barChartData[1].month).toMatch(/Jan.*1.*25/);
    });

    it("handles weekly labels that cross year boundaries", () => {
      // Week starting Dec 30 ends Jan 5 (crosses year boundary)
      const crossYearWeeklyFilters = {
        ...mockFilters,
        interval: "week" as const,
        from: "2024-12-01",
        to: "2025-01-31",
      };

      const crossYearWeeklyData = {
        series: [
          {
            periodStart: "2024-12-30", // Mon Dec 30 - Sun Jan 5
            income: money(1000),
            expenses: money(500),
            savings: money(500),
            debt: money(0),
            savingsRate: 50,
          },
        ],
        totals: mockCashflowData.totals,
      };

      (useReportsCashflow as any).mockReturnValue({
        data: crossYearWeeklyData,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      const { result } = renderHook(() => useCashFlowData(crossYearWeeklyFilters, "bar"));

      // Week crossing year boundary should show both years
      // Dec 30, '24 - Jan 5, '25
      expect(result.current.barChartData[0].month).toMatch(/Dec.*30.*'24.*-.*Jan.*5.*'25/);
    });
  });

  describe("table vs chart loading separation", () => {
    it("returns separate tableIsLoading independent of sankey loading", () => {
      (useReportsCashflow as any).mockReturnValue({
        data: mockCashflowData,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      (useReportsSankey as any).mockReturnValue({
        data: undefined,
        isLoading: true, // sankey still loading
        error: null,
        refetch: vi.fn(),
      });

      const { result } = renderHook(() => useCashFlowData(mockFilters, "sankey"));

      // Chart is loading (sankey view, sankey loading)
      expect(result.current.isLoading).toBe(true);
      // Table should NOT be loading (cashflow is ready)
      expect(result.current.tableIsLoading).toBe(false);
    });

    it("returns separate tableError independent of sankey error", () => {
      (useReportsCashflow as any).mockReturnValue({
        data: mockCashflowData,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      (useReportsSankey as any).mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error("Sankey failed"),
        refetch: vi.fn(),
      });

      const { result } = renderHook(() => useCashFlowData(mockFilters, "sankey"));

      // Chart error (sankey view)
      expect(result.current.error).toBeTruthy();
      // Table should NOT have error (cashflow succeeded)
      expect(result.current.tableError).toBeNull();
    });
  });

  // NEW-34: a year view to 31 December must not average over months that have not started.
  it("averages over the periods that have started, not the whole range", () => {
    // Months that have not started can already hold rows (a salary recorded ahead).
    const future = (periodStart: string) => ({
      periodStart, income: money(1000), expenses: money(0), savings: money(1000), debt: money(0), savingsRate: 100,
    });
    vi.mocked(useReportsCashflow).mockReturnValue({
      data: {
        ...mockCashflowData,
        range: { from: "2024-01-01", to: "2024-04-30", interval: "month", baseCurrency: "USD", elapsedPeriods: 2 },
        series: [...mockCashflowData.series, future("2024-03-01"), future("2024-04-01")],
        totals: { ...mockCashflowData.totals, savings: money(6000) },
        elapsedTotals: { income: money(10500), expenses: money(6500), savings: money(4000) },
      },
      isLoading: false, error: null, refetch: vi.fn(),
    } as unknown as ReturnType<typeof useReportsCashflow>);
    vi.mocked(useReportsSankey).mockReturnValue({ data: undefined, isLoading: false } as unknown as ReturnType<typeof useReportsSankey>);

    const { result } = renderHook(() => useCashFlowData(mockFilters, "bar"));

    expect(result.current.actualPeriods).toBe(2);
    // The started months' 4000 over 2 months, not the whole range's 6000.
    expect(result.current.averageSavings).toBe(2000);
  });

  it("shows no average when the response counts elapsed periods but carries no elapsed totals", () => {
    // Two started months saved 4000 and two future ones 2000: dividing the 6000 total by 2 would show 3000.
    const future = (periodStart: string) => ({
      periodStart, income: money(1000), expenses: money(0), savings: money(1000), debt: money(0), savingsRate: 100,
    });
    vi.mocked(useReportsCashflow).mockReturnValue({
      data: {
        ...mockCashflowData,
        range: { from: "2024-01-01", to: "2024-04-30", interval: "month", baseCurrency: "USD", elapsedPeriods: 2 },
        series: [...mockCashflowData.series, future("2024-03-01"), future("2024-04-01")],
        totals: { ...mockCashflowData.totals, savings: money(6000) },
      },
      isLoading: false, error: null, refetch: vi.fn(),
    } as unknown as ReturnType<typeof useReportsCashflow>);
    vi.mocked(useReportsSankey).mockReturnValue({ data: undefined, isLoading: false } as unknown as ReturnType<typeof useReportsSankey>);

    const { result } = renderHook(() => useCashFlowData(mockFilters, "bar"));

    expect(result.current.averageSavings).toBeNull();
  });

  it("divides the savings average in decimal and rounds half up to the cent", () => {
    // 1.15 / 10 is 0.115 in decimal; as a JS float it is 0.11499..., which shows 0.11.
    vi.mocked(useReportsCashflow).mockReturnValue({
      data: {
        ...mockCashflowData,
        range: { from: "2024-01-01", to: "2024-10-31", interval: "month", baseCurrency: "USD", elapsedPeriods: 10 },
        elapsedTotals: { income: { amount: "1.15", currency: "USD" }, expenses: { amount: "0.00", currency: "USD" },
          savings: { amount: "1.15", currency: "USD" } },
      },
      isLoading: false, error: null, refetch: vi.fn(),
    } as unknown as ReturnType<typeof useReportsCashflow>);
    vi.mocked(useReportsSankey).mockReturnValue({ data: undefined, isLoading: false } as unknown as ReturnType<typeof useReportsSankey>);

    const { result } = renderHook(() => useCashFlowData(mockFilters, "bar"));

    expect(result.current.averageSavings).toBe(0.12);
  });
});
