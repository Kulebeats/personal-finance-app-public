/**
 * ExpenseClassificationWidget - Core widget showing fixed vs variable vs discretionary expenses
 *
 * Uses coefficient of variation algorithm to classify expenses
 */

import React from "react";
import {
  WidgetCard,
  WidgetEmptyState,
  type ChartType,
} from "./shared/WidgetCard";
import {
  useReportsExpenseClassification,
  useCurrentYearRange,
} from "@/hooks/use-reports";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";
import { Layers } from "lucide-react";
import { toMoneyNumber } from "@/lib/money";
import { useFormatters } from "@/contexts/SettingsContext";

// ============================================================================
// CHART COLORS
// ============================================================================

const COLORS = {
  fixed: "hsl(var(--chart-1))",
  variable: "hsl(var(--chart-2))",
  discretionary: "hsl(var(--chart-3))",
};

const LABELS = {
  fixed: "Fixed",
  variable: "Variable",
  discretionary: "Discretionary",
};

// ============================================================================
// CHART CONFIG
// ============================================================================

const chartConfig = {
  fixed: {
    label: "Fixed",
    color: COLORS.fixed,
  },
  variable: {
    label: "Variable",
    color: COLORS.variable,
  },
  discretionary: {
    label: "Discretionary",
    color: COLORS.discretionary,
  },
};

// ============================================================================
// MAIN WIDGET
// ============================================================================

export function ExpenseClassificationWidget({
  className,
  chartType = "donut",
  onChartTypeChange,
  onHide,
}: {
  className?: string;
  chartType?: ChartType;
  onChartTypeChange?: (type: ChartType) => void;
  onHide?: () => void;
}) {
  const yearRange = useCurrentYearRange();
  const { data, isLoading, error } = useReportsExpenseClassification(yearRange);
  const { currency } = useFormatters();

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);

  const chartData = data
    ? [
        {
          name: "Fixed",
          value: toMoneyNumber(data.classification.fixed.amount),
          percent: data.classification.fixed.percent,
          fill: COLORS.fixed,
        },
        {
          name: "Variable",
          value: toMoneyNumber(data.classification.variable.amount),
          percent: data.classification.variable.percent,
          fill: COLORS.variable,
        },
        {
          name: "Discretionary",
          value: toMoneyNumber(data.classification.discretionary.amount),
          percent: data.classification.discretionary.percent,
          fill: COLORS.discretionary,
        },
      ]
    : [];
  const totalValue = toMoneyNumber(data?.total ?? 0);

  return (
    <WidgetCard
      title="Expense Types"
      description="Fixed vs Variable spending"
      icon={<Layers className="h-4 w-4 text-primary" />}
      isLoading={isLoading}
      error={error}
      className={className}
      chartType={chartType}
      availableChartTypes={["donut", "bar"]}
      onChartTypeChange={onChartTypeChange}
      onHide={onHide}
    >
      {data && totalValue > 0 ? (
        <div className="space-y-4">
          <ChartContainer config={chartConfig} className="h-[180px] w-full">
            {chartType === "bar" ? (
              <BarChart
                data={chartData}
                layout="vertical"
                width={320}
                height={180}
              >
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={80}
                  tick={{ fontSize: 12 }}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            ) : (
              <PieChart width={320} height={180}>
                <ChartTooltip content={<ChartTooltipContent />} />
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={70}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
              </PieChart>
            )}
          </ChartContainer>

          {/* Legend */}
          <div className="grid grid-cols-3 gap-2 text-center">
            {chartData.map((item) => (
              <div key={item.name} className="space-y-1">
                <div className="flex items-center justify-center gap-1">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: item.fill }}
                  />
                  <span className="text-xs text-muted-foreground">
                    {item.name}
                  </span>
                </div>
                <p className="text-sm font-medium">
                  {item.percent.toFixed(0)}%
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(item.value)}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <WidgetEmptyState
          title="No expense data"
          description="Add expense transactions or extend the date range"
        />
      )}
    </WidgetCard>
  );
}
