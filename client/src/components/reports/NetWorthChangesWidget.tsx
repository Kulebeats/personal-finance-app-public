/**
 * NetWorthChangesWidget - Widget showing net worth changes over time
 */

import React from "react";
import { WidgetCard, WidgetEmptyState } from "./shared/WidgetCard";
import {
  useReportsNetWorthChanges,
  useCurrentYearRange,
} from "@/hooks/use-reports";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { toMoneyNumber } from "@/lib/money";
import type { ReportsNetWorthChangesResponse } from "@shared/reports";
import { formatNetWorthChange, netWorthChangeLabel } from "./netWorthChangePresentation";

// ============================================================================
// CHART CONFIG
// ============================================================================

const chartConfig = {
  change: {
    label: "Change",
    color: "hsl(var(--chart-1))",
  },
};

/** Why there is nothing to chart (NEW-34): no snapshots at all, one snapshot, or no data. */
function emptyDescription(data: ReportsNetWorthChangesResponse | undefined): string {
  if (data?.historyCoverage === "current_only") {
    return "No snapshots were recorded in this range.";
  }
  if (data?.insufficientHistory) {
    return "Snapshots with comparable values from two different months are needed to show a monthly change.";
  }
  return "Add account balances or extend the date range";
}

// ============================================================================
// MAIN WIDGET
// ============================================================================

export function NetWorthChangesWidget({
  className,
  onHide,
}: {
  className?: string;
  onHide?: () => void;
}) {
  const yearRange = useCurrentYearRange();
  const { data, isLoading, error } = useReportsNetWorthChanges(yearRange);
  const formatCurrency = (amount: number) => formatNetWorthChange(amount, data?.range?.currency);

  const chartData =
    data?.periods.map((p) => ({
      period: p.period,
      startPeriod: p.startPeriod,
      spansGap: p.spansGap ?? false,
      label: netWorthChangeLabel(p),
      change: toMoneyNumber(p.change),
      isPositive: toMoneyNumber(p.change) >= 0,
    })) || [];

  const totalChangeValue = toMoneyNumber(data?.totalChange ?? 0);
  const avgMonthlyChangeValue = data?.avgMonthlyChange ? toMoneyNumber(data.avgMonthlyChange) : null;
  const isPositiveOverall = data && totalChangeValue >= 0;
  const missingCount = data?.missingMonths?.length ?? 0;

  return (
    <WidgetCard
      title="Net Worth Changes"
      description="Monthly changes"
      icon={<Activity className="h-4 w-4 text-primary" />}
      isLoading={isLoading}
      error={error}
      className={className}
      onHide={onHide}
    >
      {data && chartData.length > 0 ? (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <p className="text-xs text-muted-foreground">Total Change</p>
              <p
                className={cn(
                  "text-lg font-semibold flex items-center justify-center gap-1",
                  isPositiveOverall ? "text-emerald-500" : "text-red-500"
                )}
              >
                {isPositiveOverall ? (
                  <TrendingUp className="h-4 w-4" />
                ) : (
                  <TrendingDown className="h-4 w-4" />
                )}
                {formatCurrency(Math.abs(totalChangeValue))}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Avg/Month</p>
              <p
                className={cn(
                  "text-lg font-semibold",
                  avgMonthlyChangeValue !== null && (avgMonthlyChangeValue >= 0 ? "text-emerald-500" : "text-red-500"),
                )}
              >
                {avgMonthlyChangeValue === null ? "Unavailable" :
                  `${avgMonthlyChangeValue >= 0 ? "+" : ""}${formatCurrency(avgMonthlyChangeValue)}`}
              </p>
            </div>
          </div>

          {/* Chart */}
          <ChartContainer config={chartConfig} className="h-[140px] w-full">
            <BarChart data={chartData} width={249} height={140}>
              <CartesianGrid
                strokeDasharray="3 3"
                opacity={0.3}
                vertical={false}
              />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => formatCurrency(v)}
                width={55}
              />
              <ChartTooltip content={<ChartTooltipContent formatter={(value) => formatCurrency(Number(value))} />} />
              <Bar dataKey="change" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={
                      entry.isPositive
                        ? "hsl(var(--chart-1))"
                        : "hsl(var(--destructive))"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
          {missingCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {missingCount === 1 ? "1 month has" : `${missingCount} months have`} no net worth snapshot; a change across
              {missingCount === 1 ? " it" : " them"} covers more than one month.
            </p>
          )}
        </div>
      ) : (
        <WidgetEmptyState
          title="No net worth changes"
          description={emptyDescription(data)}
        />
      )}
    </WidgetCard>
  );
}
