import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, TrendingUp, ArrowUpRight, ArrowDownRight, Wallet } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useCashFlowData } from "../hooks/useCashFlowData";
import { ForecastConfidenceIndicator } from "./ForecastConfidenceIndicator";
import { ForecastDataSources } from "./ForecastDataSources";
import type { CashFlowFiltersState } from "../types";
import { formatCurrency } from "@/lib/money";
import { CASH_FLOW_CHART_COLORS } from "./chartTokens";

interface ForecastTabProps {
  filters: CashFlowFiltersState;
}

/**
 * Derive confidence level from data sources.
 * High: has recurring + budgets or recurring + averages
 * Medium: has at least one data source
 * Low: no data sources
 */
function deriveConfidenceLevel(
  dataSources: Array<"recurring" | "budgets" | "averages">
): "high" | "medium" | "low" {
  const hasRecurring = dataSources.includes("recurring");
  const hasBudgets = dataSources.includes("budgets");
  const hasAverages = dataSources.includes("averages");

  if (hasRecurring && (hasBudgets || hasAverages)) {
    return "high";
  }
  if (hasRecurring || hasBudgets) {
    return "medium";
  }
  return "low";
}

export function ForecastTab({ filters }: ForecastTabProps) {
  // Fetch data with forecast enabled
  const forecastFilters: CashFlowFiltersState = {
    ...filters,
    includeForecast: true,
    forecastMonths: filters.forecastMonths || 6,
  };

  const {
    cashflowData,
    isLoading,
    error,
    refetch,
    barChartData,
    forecastConfig,
  } = useCashFlowData(forecastFilters, "bar");

  // Series definitions (id + color) for the area chart
  const series = useMemo(
    () => [
      { id: "Income", color: CASH_FLOW_CHART_COLORS.income },
      { id: "Expenses", color: CASH_FLOW_CHART_COLORS.expense },
    ],
    []
  );

  // Flat rows for recharts: one object per month with a key per series
  const chartRows = useMemo(() => {
    return barChartData.map((item) => ({
      x: item.month,
      Income: item.income,
      Expenses: item.expenses,
      isForecast: item.isForecast,
    }));
  }, [barChartData]);

  const chartConfig = useMemo(
    () =>
      series.reduce((acc, s) => {
        acc[s.id] = { label: s.id, color: s.color };
        return acc;
      }, {} as ChartConfig),
    [series]
  );

  // Calculate projected averages (forecast periods only)
  const forecastSummary = useMemo(() => {
    const forecastPeriods = barChartData.filter((p) => p.isForecast);
    if (forecastPeriods.length === 0) return null;

    const totalIncome = forecastPeriods.reduce((sum, p) => sum + p.income, 0);
    const totalExpenses = forecastPeriods.reduce((sum, p) => sum + p.expenses, 0);
    const avgIncome = totalIncome / forecastPeriods.length;
    const avgExpenses = totalExpenses / forecastPeriods.length;
    const avgSavings = avgIncome - avgExpenses;
    const savingsRate = avgIncome > 0 ? (avgSavings / avgIncome) * 100 : 0;

    return {
      avgIncome,
      avgExpenses,
      avgSavings,
      savingsRate,
      periodCount: forecastPeriods.length,
    };
  }, [barChartData]);

  // Extract metadata
  const dataSources = (forecastConfig?.dataSourcesUsed ?? []) as Array<"recurring" | "budgets" | "averages">;
  const confidenceLevel = deriveConfidenceLevel(dataSources);
  const currency = cashflowData?.metadata?.baseCurrency ?? "USD";

  // Create a map to identify forecast points for styling
  const forecastMap = useMemo(() => {
    const map = new Map<string, boolean>();
    barChartData.forEach((item) => {
      map.set(item.month, item.isForecast);
    });
    return map;
  }, [barChartData]);

  // Find the index where forecast starts
  const forecastStartIndex = useMemo(() => {
    const idx = barChartData.findIndex((p) => p.isForecast);
    return idx >= 0 ? idx : barChartData.length;
  }, [barChartData]);

  return (
    <div className="space-y-6">
      {/* Header with confidence indicator */}
      <Card className="p-6 border-border shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Cashflow Forecast</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Projected income and expenses for the next {forecastFilters.forecastMonths} months
            </p>
          </div>
          <ForecastConfidenceIndicator level={confidenceLevel} />
        </div>
        {dataSources.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground mb-2">Based on:</p>
            <ForecastDataSources sources={dataSources} />
          </div>
        )}
      </Card>

      {/* Chart */}
      <Card className="p-6 border-border shadow-sm h-[400px] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Projected Trends</h3>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 bg-emerald-500" />
              Income
            </span>
            <span className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 bg-rose-500" />
              Expenses
            </span>
            <span className="flex items-center gap-1.5 border-l pl-4 border-border">
              <div className="w-3 h-0.5 border-t-2 border-dashed border-muted-foreground" />
              Forecast
            </span>
          </div>
        </div>

        <div className="flex-1 min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <AlertCircle className="w-12 h-12 text-destructive" />
              <div className="text-center">
                <p className="font-medium text-foreground">Failed to load forecast</p>
                <p className="text-sm text-muted-foreground">
                  There was an error loading your forecast data.
                </p>
              </div>
              <Button variant="outline" onClick={() => refetch()}>
                Try Again
              </Button>
            </div>
          ) : barChartData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <TrendingUp className="w-12 h-12 text-muted-foreground" />
              <div className="text-center">
                <p className="font-medium text-foreground">No forecast data</p>
                <p className="text-sm text-muted-foreground">
                  Add recurring rules or budgets to generate projections.
                </p>
              </div>
            </div>
          ) : (
            <ChartContainer config={chartConfig} className="w-full h-full">
              <AreaChart
                data={chartRows}
                margin={{ top: 20, right: 30, bottom: 50, left: 10 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="x"
                  tickLine={false}
                  axisLine={false}
                  angle={-45}
                  textAnchor="end"
                  height={50}
                />
                <YAxis
                  tickFormatter={(value) => `${(Number(value) / 1000).toFixed(0)}k`}
                  tickLine={false}
                  axisLine={false}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => formatCurrency(Number(value), currency)}
                      labelFormatter={(label) =>
                        forecastMap.get(String(label))
                          ? `${label} (Projected)`
                          : String(label)
                      }
                    />
                  }
                />
                {forecastStartIndex > 0 &&
                  forecastStartIndex < barChartData.length && (
                    <ReferenceLine
                      x={barChartData[forecastStartIndex]?.month ?? ""}
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={1}
                      strokeDasharray="4 4"
                      label={{
                        value: "Forecast",
                        position: "insideTopRight",
                        fill: "hsl(var(--muted-foreground))",
                        fontSize: 11,
                      }}
                    />
                  )}
                {series.map((s) => (
                  <Area
                    key={s.id}
                    dataKey={s.id}
                    type="monotone"
                    stroke={s.color}
                    fill={s.color}
                    fillOpacity={0.1}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </AreaChart>
            </ChartContainer>
          )}
        </div>
      </Card>

      {/* Summary cards */}
      {forecastSummary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4 border-border shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                <ArrowUpRight className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg. Monthly Income</p>
                <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(forecastSummary.avgIncome, currency)}
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-4 border-border shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-rose-100 dark:bg-rose-900/30">
                <ArrowDownRight className="w-5 h-5 text-rose-600 dark:text-rose-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg. Monthly Expenses</p>
                <p className="text-lg font-semibold text-rose-600 dark:text-rose-400">
                  {formatCurrency(forecastSummary.avgExpenses, currency)}
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-4 border-border shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Wallet className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg. Monthly Savings</p>
                <p className={`text-lg font-semibold ${
                  forecastSummary.avgSavings >= 0
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-rose-600 dark:text-rose-400"
                }`}>
                  {formatCurrency(forecastSummary.avgSavings, currency)}
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-4 border-border shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-100 dark:bg-violet-900/30">
                <TrendingUp className="w-5 h-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Projected Savings Rate</p>
                <p className={`text-lg font-semibold ${
                  forecastSummary.savingsRate >= 0
                    ? "text-violet-600 dark:text-violet-400"
                    : "text-rose-600 dark:text-rose-400"
                }`}>
                  {forecastSummary.savingsRate.toFixed(1)}%
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
