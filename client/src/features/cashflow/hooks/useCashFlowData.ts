import { useMemo } from "react";
import { useReportsCashflow, useReportsSankey } from "@/hooks/use-reports";
import { type CashFlowFiltersState } from "../types";
import { averageMoneyValue, toMoneyNumber } from "@/lib/money";

export function parseLocalDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Get the end date of a week (6 days after start)
 */
export function getWeekEndDate(startDate: Date): Date {
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  return endDate;
}

/**
 * Format a date range for weekly labels (e.g., "Jan 1 - Jan 7" or "Jan 1 - Jan 7, '26")
 * Handles cross-year weeks (e.g., "Dec 30, '24 - Jan 5, '25")
 */
function formatWeekRange(startDate: Date, includeYear: boolean): string {
  const endDate = getWeekEndDate(startDate);
  const startMonth = startDate.toLocaleDateString("en-US", { month: "short" });
  const endMonth = endDate.toLocaleDateString("en-US", { month: "short" });
  const startDay = startDate.getDate();
  const endDay = endDate.getDate();
  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();
  const crossesYearBoundary = endYear > startYear;

  if (crossesYearBoundary) {
    // Week crosses year boundary: "Dec 30, '24 - Jan 5, '25"
    return `${startMonth} ${startDay}, '${startYear.toString().slice(-2)} - ${endMonth} ${endDay}, '${endYear.toString().slice(-2)}`;
  }

  if (startMonth === endMonth) {
    // Same month: "Jan 1 - 7" or "Jan 1 - 7, '26"
    return includeYear
      ? `${startMonth} ${startDay} - ${endDay}, '${startYear.toString().slice(-2)}`
      : `${startMonth} ${startDay} - ${endDay}`;
  } else {
    // Different months, same year: "Jan 28 - Feb 3" or "Jan 28 - Feb 3, '26"
    return includeYear
      ? `${startMonth} ${startDay} - ${endMonth} ${endDay}, '${startYear.toString().slice(-2)}`
      : `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
  }
}

export function useCashFlowData(
  filters: CashFlowFiltersState,
  view: "bar" | "sankey"
) {
  // Fetch Cashflow Data (with optional forecast)
  const {
    data: cashflowData,
    isLoading: cashflowLoading,
    error: cashflowError,
    refetch: refetchCashflow,
  } = useReportsCashflow({
    from: filters.from,
    to: filters.to,
    interval: filters.interval,
    scope: filters.scope,
    includePending: filters.includePending,
    includeTransfers: filters.includeTransfers,
    includeForecast: filters.includeForecast,
    forecastMonths: filters.forecastMonths,
  });

  // Fetch Sankey Data (gated)
  const {
    data: sankeyData,
    isLoading: sankeyLoading,
    error: sankeyError,
    refetch: refetchSankey,
  } = useReportsSankey(
    {
      from: filters.from,
      to: filters.to,
      mode: "income_to_expense_groups",
      includeSavingsNode: true,
      scope: filters.scope,
      includePending: filters.includePending,
      includeTransfers: filters.includeTransfers,
    },
    { enabled: view === "sankey" }
  );

  const rangeSpansMultipleYears = useMemo(() => {
    const fromYear = parseLocalDate(filters.from).getFullYear();
    const toYear = parseLocalDate(filters.to).getFullYear();
    return toYear > fromYear;
  }, [filters.from, filters.to]);

  const barChartData = useMemo(() => {
    if (!cashflowData?.series) return [];
    const interval = filters.interval;
    return cashflowData.series.map((item) => {
      const date = parseLocalDate(item.periodStart);
      // Dynamic label based on interval - include year for multi-year ranges
      let label: string;
      if (interval === "day") {
        label = rangeSpansMultipleYears
          ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })
          : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      } else if (interval === "week") {
        label = formatWeekRange(date, rangeSpansMultipleYears);
      } else {
        // month
        label = rangeSpansMultipleYears
          ? date.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
          : date.toLocaleDateString("en-US", { month: "short" });
      }
      return {
        month: label,
        income: toMoneyNumber(item.income),
        expenses: Math.abs(toMoneyNumber(item.expenses)),
        savings: toMoneyNumber(item.savings),
        periodStart: item.periodStart,
        isForecast: item.isForecast ?? false,
      };
    });
  }, [cashflowData, rangeSpansMultipleYears, filters.interval]);

  // Forecast metadata
  const forecastConfig = cashflowData?.metadata?.forecastConfig;
  const hasForecast = forecastConfig?.enabled ?? false;

  const sankeyChartData = useMemo(() => {
    if (!sankeyData?.sankey) return { nodes: [], links: [] };
    return {
      nodes: sankeyData.sankey.nodes,
      links: sankeyData.sankey.links.map((link) => ({
        ...link,
        value: toMoneyNumber(link.value),
      })),
    };
  }, [sankeyData]);

  const totals = cashflowData?.totals ?? {
    income: 0,
    expenses: 0,
    savings: 0,
    savingsRate: 0,
  };
  const numericTotals = {
    income: toMoneyNumber(totals.income),
    expenses: toMoneyNumber(totals.expenses),
    savings: toMoneyNumber(totals.savings),
    savingsRate: totals.savingsRate,
  };

  // NEW-34: average over the periods that have started on the household
  // calendar; the server counts them, older responses fall back to every row.
  const actualPeriods = Math.max(cashflowData?.range?.elapsedPeriods ?? cashflowData?.series?.length ?? 0, 1);
  // ...and adds only those periods' savings, never amounts already recorded for later ones:
  // without the server's elapsed totals there is no honest average to show (null).
  // Divided in decimal, rounded half up to the cent (1.15 over 10 periods is 0.12, not a float's 0.11).
  const elapsedSavings = cashflowData?.elapsedTotals?.savings;
  const averageSavings = elapsedSavings ? averageMoneyValue(elapsedSavings, actualPeriods) : null;

  // Period label for UI (e.g., "Monthly", "Weekly", "Daily")
  const getPeriodLabel = (interval: string) => {
    if (interval === "day") return "Daily";
    if (interval === "week") return "Weekly";
    return "Monthly";
  };
  const periodLabel = getPeriodLabel(filters.interval);

  return {
    cashflowData,
    sankeyData,
    // Chart loading: depends on view (bar uses cashflow, sankey uses sankey)
    isLoading: view === "bar" ? cashflowLoading : sankeyLoading,
    // Table loading: always tied to cashflow only
    tableIsLoading: cashflowLoading,
    // Chart error: depends on view
    error: view === "bar" ? cashflowError : sankeyError,
    // Table error: always tied to cashflow only
    tableError: cashflowError,
    refetch: view === "bar" ? refetchCashflow : refetchSankey,
    barChartData,
    sankeyChartData,
    totals: numericTotals,
    actualPeriods,
    averageSavings,
    periodLabel,
    interval: filters.interval,
    // Forecast metadata
    hasForecast,
    forecastConfig,
    // Metadata for currency warnings
    metadata: cashflowData?.metadata,
  };
}
