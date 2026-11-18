/**
 * DebtAnalysisWidget - Widget showing debt breakdown and payment trends
 */

import React from "react";
import { WidgetCard, WidgetEmptyState } from "./shared/WidgetCard";
import { useReportsDebt, useCurrentYearRange } from "@/hooks/use-reports";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";
import { toMoneyNumber } from "@/lib/money";
import { useFormatters } from "@/contexts/SettingsContext";

// ============================================================================
// CHART COLORS
// ============================================================================

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

// ============================================================================
// CHART CONFIG
// ============================================================================

const chartConfig = {
  debt: {
    label: "Debt",
    color: "hsl(var(--chart-1))",
  },
};

// ============================================================================
// MAIN WIDGET
// ============================================================================

export function DebtAnalysisWidget({
  className,
  onHide,
}: {
  className?: string;
  onHide?: () => void;
}) {
  const yearRange = useCurrentYearRange();
  const { data, isLoading, error } = useReportsDebt(yearRange);
  const { currency } = useFormatters();

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);

  const pieData =
    data?.debtByType.map((item, i) => ({
      name: item.type,
      value: toMoneyNumber(item.balance),
      fill: COLORS[i % COLORS.length],
    })) || [];
  const totalDebtValue = toMoneyNumber(data?.totalDebt ?? 0);

  return (
    <WidgetCard
      title="Debt Overview"
      description="By account type"
      icon={<CreditCard className="h-4 w-4 text-primary" />}
      isLoading={isLoading}
      error={error}
      className={className}
      onHide={onHide}
    >
      {data && totalDebtValue > 0 ? (
        <div className="space-y-4">
          {/* Total Debt */}
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Total Debt</p>
            <p className="text-2xl font-bold text-destructive">
              {formatCurrency(totalDebtValue)}
            </p>
          </div>

          {/* Pie Chart */}
          <ChartContainer config={chartConfig} className="h-[140px] w-full">
            <PieChart width={249} height={140}>
              <ChartTooltip content={<ChartTooltipContent />} />
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={35}
                outerRadius={60}
                paddingAngle={2}
                dataKey="value"
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>

          {/* Legend */}
          <div className="flex flex-wrap justify-center gap-3">
            {pieData.map((item) => (
              <div key={item.name} className="flex items-center gap-1">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: item.fill }}
                />
                <span className="text-xs capitalize">{item.name}</span>
                <span className="text-xs text-muted-foreground">
                  ({formatCurrency(item.value)})
                </span>
              </div>
            ))}
          </div>

          {/* Top Debt Accounts */}
          {data.topDebtAccounts.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Top Accounts</p>
              {data.topDebtAccounts.slice(0, 3).map((account) => (
                <div key={account.id} className="flex justify-between text-sm">
                  <span className="truncate">{account.name}</span>
                  <span className="font-medium text-destructive">
                    {formatCurrency(toMoneyNumber(account.balance))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <WidgetEmptyState
          title="No debt accounts"
          description="Add liability accounts to see debt analysis"
          icon={<CreditCard className="h-8 w-8" />}
        />
      )}
    </WidgetCard>
  );
}
