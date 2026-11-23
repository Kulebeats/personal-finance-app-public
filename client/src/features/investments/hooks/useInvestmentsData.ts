import { useState, useMemo } from "react";
import {
  useHoldings,
  usePortfolioSummary,
  useInvestmentPerformance,
} from "@/hooks/useInvestments";
import { useFormat } from "@/hooks/use-format";
import Decimal from "decimal.js";
import { parseMoneyString, toMoneyNumber } from "@/lib/money";

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

  const { data: portfolioSummary, isLoading: summaryLoading, isError: summaryError } =
    usePortfolioSummary(displayCurrency);

  const { data: performanceHistory = [] } = useInvestmentPerformance(timeframe);

  const isLoading = holdingsLoading || summaryLoading;
  const holdingsCurrency = holdings.find(holding => holding.baseCurrency)?.baseCurrency ?? displayCurrency;
  const summaryCurrency = portfolioSummary?.baseCurrency ?? displayCurrency;
  const summaryState: "loading" | "unavailable" | "ready" = summaryLoading ? "loading"
    : summaryError || !portfolioSummary ? "unavailable" : "ready";
  // MoneyDto from the server; the summary components receive display numbers.
  const totalValue = portfolioSummary ? toMoneyNumber(portfolioSummary.totalValue) : 0;
  const totalGainLoss = portfolioSummary?.totalGainLoss ? toMoneyNumber(portfolioSummary.totalGainLoss) : null;
  const totalGainLossPercent = portfolioSummary?.totalGainLossPercent ?? null;

  // Compute allocation from real holdings
  const allocationData = useMemo(() => {
    if (holdings.length === 0) return [];

    // Group holdings by security type, summed exactly from the MoneyDto strings
    const byType = holdings.reduce<Record<string, Decimal>>((acc, h) => {
      const type = h.security?.type || "other";
      return { ...acc, [type]: (acc[type] ?? new Decimal(0)).plus(parseMoneyString(h.currentValue?.amount)) };
    }, {});
    const total = Object.values(byType).reduce((sum, value) => sum.plus(value), new Decimal(0));

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
        value: total.greaterThan(0)
          ? value.div(total).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_CEIL).toNumber()
          : 0,
        amount: value.toNumber(),
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
    holdingsLoading,
    holdingsCurrency,
    summaryCurrency,
    summaryState,

    // Data
    holdings,
    portfolioSummary,
    performanceHistory,
    allocationData,
    totalValue,
    totalGainLoss,
    totalGainLossPercent,

    // Actions
    formatCurrency,
  };
}
