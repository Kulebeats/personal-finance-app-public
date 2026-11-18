import { useState, useMemo } from "react";
import {
  useHoldings,
  usePortfolioSummary,
  useInvestmentPerformance,
  useRefreshMarketData,
} from "@/hooks/useInvestments";
import { useFormat } from "@/hooks/use-format";

export type Currency = "ZMW" | "USD";
export type Timeframe = "1M" | "3M" | "YTD" | "1Y" | "ALL";

// Allocation colors by security type - Using CSS variables for dark mode support
const ALLOCATION_COLORS: Record<string, string> = {
  stock: "hsl(var(--chart-1))", // Blue
  bond: "hsl(var(--chart-2))", // Purple
  tbill: "hsl(var(--chart-4))", // Light Purple
  etf: "hsl(var(--chart-income))", // Green
  mutual_fund: "hsl(var(--chart-3))", // Cyan
  unit_trust: "hsl(var(--chart-5))", // Amber
  other: "hsl(var(--chart-neutral))", // Gray
};

export function useInvestmentsData() {
  const [displayCurrency, setDisplayCurrency] = useState<Currency>("ZMW");
  const [timeframe, setTimeframe] = useState<Timeframe>("1M");

  const { formatCurrency } = useFormat();

  const {
    data: holdings = [],
    isLoading: holdingsLoading,
    error: holdingsError,
  } = useHoldings({ baseCurrency: displayCurrency });

  const { data: portfolioSummary, isLoading: summaryLoading } =
    usePortfolioSummary(displayCurrency);

  const { data: performanceHistory = [] } = useInvestmentPerformance(timeframe);

  const refreshMarketData = useRefreshMarketData();

  const isLoading = holdingsLoading || summaryLoading;
  const totalValue = portfolioSummary?.totalValue ?? 0;
  const totalGainLoss = portfolioSummary?.totalGainLoss ?? 0;
  const totalGainLossPercent = portfolioSummary?.totalGainLossPercent ?? 0;

  // Compute allocation from real holdings
  const allocationData = useMemo(() => {
    if (holdings.length === 0) return [];

    // Group holdings by security type
    const byType: Record<string, number> = {};
    let total = 0;

    for (const h of holdings) {
      const type = h.security?.type || "other";
      const value = h.currentValue ?? 0;
      byType[type] = (byType[type] || 0) + value;
      total += value;
    }

    // Convert to allocation data format
    const typeLabels: Record<string, string> = {
      stock: "Stocks",
      bond: "Bonds",
      tbill: "T-Bills",
      etf: "ETFs",
      mutual_fund: "Mutual Funds",
      unit_trust: "Unit Trusts",
      other: "Other",
    };

    return Object.entries(byType)
      .map(([type, value]) => ({
        name: typeLabels[type] || type,
        value: total > 0 ? Math.round((value / total) * 100) : 0,
        amount: value,
        color: ALLOCATION_COLORS[type] || ALLOCATION_COLORS.other,
      }))
      .sort((a, b) => b.value - a.value);
  }, [holdings]);

  return {
    // State
    displayCurrency,
    setDisplayCurrency,
    timeframe,
    setTimeframe,
    isLoading,

    // Data
    holdings,
    portfolioSummary,
    performanceHistory,
    allocationData,
    totalValue,
    totalGainLoss,
    totalGainLossPercent,

    // Actions
    refreshMarketData,
    formatCurrency,
  };
}
