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
import { useFormatters } from "@/contexts/SettingsContext";

// ============================================================================
// CHART CONFIG
// ============================================================================

const chartConfig = {
  change: {
    label: "Change",
    color: "hsl(var(--chart-1))",
  },
};

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
  const { currency } = useFormatters();

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);

  const chartData =
    data?.periods.map((p) => ({
      period: p.period,
      change: toMoneyNumber(p.change),
      isPositive: toMoneyNumber(p.change) >= 0,
    })) || [];

  const totalChangeValue = toMoneyNumber(data?.totalChange ?? 0);
  const avgMonthlyChangeValue = toMoneyNumber(data?.avgMonthlyChange ?? 0);
  const isPositiveOverall = data && totalChangeValue >= 0;

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
                  avgMonthlyChangeValue >= 0
                    ? "text-emerald-500"
                    : "text-red-500"
                )}
              >
                {avgMonthlyChangeValue >= 0 ? "+" : ""}
                {formatCurrency(avgMonthlyChangeValue)}
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
              <XAxis
                dataKey="period"
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => v.slice(5, 7)}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => formatCurrency(v)}
                width={55}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
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
        </div>
      ) : (
        <WidgetEmptyState
          title="No net worth changes"
          description="Add account balances or extend the date range"
        />
      )}
    </WidgetCard>
  );
}
