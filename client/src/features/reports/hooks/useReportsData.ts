/**
 * useReportsData Hook
 *
 * Centralizes data fetching and transformation for all report tabs
 */

import { useMemo } from "react";
import {
  useReportsSankey,
  useReportsSpendingBreakdown,
  useReportsCashflow,
  useReportsNetWorth,
  useReportsSavingsRate,
  useReportsExports,
} from "@/hooks/use-reports";
import { toMoneyNumber } from "@/lib/money";
import { CHART_COLORS } from "../constants";
import { toCashflowBars, toNetWorthPoints, toSavingsRateBars } from "../chartSeries";
import { ReportTab } from "../types";

interface UseReportsDataOptions {
  activeTab: ReportTab;
  dateRange: { from: string; to: string };
  spendingGroupBy: "categoryGroup" | "category" | "merchant";
  showExportHistory: boolean;
}

export function useReportsData({
  activeTab,
  dateRange,
  spendingGroupBy,
  showExportHistory,
}: UseReportsDataOptions) {
  const { from, to } = dateRange;

  // Sankey data (cash-flow tab)
  const {
    data: sankeyData,
    isLoading: sankeyLoading,
    error: sankeyError,
    refetch: refetchSankey,
  } = useReportsSankey(
    { from, to, mode: "income_to_expense_groups", includeSavingsNode: true },
    { enabled: activeTab === "cash-flow" },
  );

  // Spending breakdown (spending tab)
  const {
    data: spendingData,
    isLoading: spendingLoading,
    error: spendingError,
    refetch: refetchSpending,
  } = useReportsSpendingBreakdown(
    { from, to, groupBy: spendingGroupBy, limit: 10 },
    { enabled: activeTab === "spending" },
  );

  // Cashflow data (multiple tabs)
  const {
    data: cashflowData,
    isLoading: cashflowLoading,
    error: cashflowError,
    refetch: refetchCashflow,
  } = useReportsCashflow(
    { from, to, interval: "month" },
    { enabled: activeTab !== "annual" && activeTab !== "merchants" },
  );

  // Net worth data
  const {
    data: netWorthData,
    isLoading: netWorthLoading,
    error: netWorthError,
    refetch: refetchNetWorth,
  } = useReportsNetWorth(
    { from, to, interval: "month" },
    { enabled: activeTab === "net-worth" },
  );

  // Savings rate data
  const {
    data: savingsData,
    isLoading: savingsLoading,
    error: savingsError,
    refetch: refetchSavings,
  } = useReportsSavingsRate(
    { from, to, interval: "month" },
    { enabled: activeTab === "savings" },
  );

  // Export history
  const {
    data: exportHistory,
    isLoading: exportHistoryLoading,
    error: exportHistoryError,
    refetch: refetchExportHistory,
  } = useReportsExports({ limit: 25 }, { enabled: showExportHistory });

  // Transform spending data for pie chart
  const pieData = useMemo(() => {
    if (!spendingData?.items) return [];
    return spendingData.items.map((item, i) => ({
      id: item.id,
      label: item.label,
      value: toMoneyNumber(item.value),
      color: item.color || CHART_COLORS[i % CHART_COLORS.length],
    }));
  }, [spendingData]);

  // Transform cashflow data for bar chart
  const barData = useMemo(() => {
    if (!cashflowData?.series) return [];
    return toCashflowBars(cashflowData.series);
  }, [cashflowData]);

  // Transform net worth data for line chart
  const netWorthLineData = useMemo(() => {
    if (!netWorthData?.series?.[0]?.data) return [];
    return [
      {
        id: "Net Worth",
        data: toNetWorthPoints(netWorthData.series[0].data),
      },
    ];
  }, [netWorthData]);

  // Transform savings data for bar chart
  const savingsRateData = useMemo(() => {
    if (!savingsData?.series) return [];
    return toSavingsRateBars(savingsData.series);
  }, [savingsData]);

  // Totals and currency come only from the server. Until a report arrives
  // neither is known (null): the page shows that, never a guessed currency.
  const totals = cashflowData?.totals ?? null;
  const currency =
    spendingData?.range?.baseCurrency ??
    cashflowData?.range?.baseCurrency ??
    null;

  return {
    // Raw data
    sankeyData,
    spendingData,
    cashflowData,
    netWorthData,
    savingsData,
    exportHistory,
    // Transformed data
    pieData,
    barData,
    netWorthLineData,
    savingsRateData,
    // Aggregates
    totals,
    currency,
    // Loading states
    isLoading: {
      sankey: sankeyLoading,
      spending: spendingLoading,
      cashflow: cashflowLoading,
      netWorth: netWorthLoading,
      savings: savingsLoading,
      exportHistory: exportHistoryLoading,
    },
    // Query error states. Previously discarded entirely: a failed report
    // query just rendered an empty chart with no visible error and no retry
    // (audit v2 finding). Reports.tsx surfaces these per the active tab.
    error: {
      sankey: sankeyError,
      spending: spendingError,
      cashflow: cashflowError,
      netWorth: netWorthError,
      savings: savingsError,
      exportHistory: exportHistoryError,
    },
    refetch: {
      sankey: refetchSankey,
      spending: refetchSpending,
      cashflow: refetchCashflow,
      netWorth: refetchNetWorth,
      savings: refetchSavings,
      exportHistory: refetchExportHistory,
    },
  };
}
