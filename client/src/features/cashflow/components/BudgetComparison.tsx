import { Card } from "@/components/ui/card";
import { Loader2, AlertCircle, Target, TrendingDown, TrendingUp, CheckCircle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useFormatters } from "@/contexts/SettingsContext";
import { toMoneyNumber } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { MoneyDto } from "@shared/money";
import { CASH_FLOW_CHART_COLORS } from "./chartTokens";

const chartConfig = {
  budgeted: { label: "Budget", color: CASH_FLOW_CHART_COLORS.budget },
  actual: { label: "Actual", color: CASH_FLOW_CHART_COLORS.actual },
} satisfies ChartConfig;

interface BudgetComparisonItem {
  period: string;
  categoryId: string;
  categoryName: string;
  actual: MoneyDto;
  budgeted: MoneyDto;
  variance: MoneyDto;
  variancePercent: number;
  status: "under" | "on_track" | "over" | "unbudgeted";
}

interface BudgetComparisonSummary {
  totalActual: MoneyDto;
  totalBudgeted: MoneyDto;
  totalVariance: MoneyDto;
  categoriesOverBudget: number;
  categoriesUnderBudget: number;
}

interface BudgetComparisonData {
  comparison: BudgetComparisonItem[];
  summary: BudgetComparisonSummary;
  metadata: {
    budgetsCovered: number;
    categoriesWithoutBudget: string[];
    periodNormalization: "prorated" | "full";
  };
}

interface BudgetComparisonProps {
  data: BudgetComparisonData | undefined;
  isLoading: boolean;
  error: Error | null;
}

function StatusBadge({ status }: { status: BudgetComparisonItem["status"] }) {
  switch (status) {
    case "over":
      return (
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
          <TrendingUp className="w-3 h-3" />
          Over
        </span>
      );
    case "under":
      return (
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <TrendingDown className="w-3 h-3" />
          Under
        </span>
      );
    case "on_track":
      return (
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400">
          <CheckCircle className="w-3 h-3" />
          On Track
        </span>
      );
    default:
      return (
        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
          No Budget
        </span>
      );
  }
}

export function BudgetComparison({ data, isLoading, error }: BudgetComparisonProps) {
  const { formatCurrency } = useFormatters();

  if (isLoading) {
    return (
      <Card className="p-6 border-border shadow-sm">
        <div className="flex items-center justify-center h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6 border-border shadow-sm">
        <div className="flex flex-col items-center justify-center h-[400px] gap-4">
          <AlertCircle className="w-12 h-12 text-destructive" />
          <div className="text-center">
            <p className="font-medium text-foreground">Failed to load budget comparison</p>
            <p className="text-sm text-muted-foreground">Please try again later.</p>
          </div>
        </div>
      </Card>
    );
  }

  if (!data || data.comparison.length === 0) {
    return (
      <Card className="p-6 border-border shadow-sm">
        <div className="flex flex-col items-center justify-center h-[400px] gap-4">
          <Target className="w-12 h-12 text-muted-foreground" />
          <div className="text-center">
            <p className="font-medium text-foreground">No budget data</p>
            <p className="text-sm text-muted-foreground">
              Set up budgets to compare your spending against your targets.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const { comparison, summary } = data;

  // Filter out unbudgeted and prepare chart data
  const budgetedItems = comparison.filter((item) => item.status !== "unbudgeted");
  const chartData = budgetedItems.slice(0, 10).map((item) => ({
    category: item.categoryName.length > 15
      ? item.categoryName.slice(0, 15) + "..."
      : item.categoryName,
    fullName: item.categoryName,
    budgeted: toMoneyNumber(item.budgeted),
    actual: toMoneyNumber(item.actual),
    status: item.status,
  }));

  const varianceAmount = toMoneyNumber(summary.totalVariance);
  const isOverBudget = varianceAmount < 0;

  return (
    <Card className="p-6 border-border shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-semibold text-lg">Budget vs Actual</h3>
        <div className="text-sm text-muted-foreground">
          {summary.categoriesOverBudget > 0 && (
            <span className="text-destructive font-medium">
              {summary.categoriesOverBudget} over budget
            </span>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
          <p className="text-sm text-muted-foreground mb-1">Total Budgeted</p>
          <p className="text-xl font-semibold text-foreground">
            {formatCurrency(toMoneyNumber(summary.totalBudgeted))}
          </p>
        </div>
        <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
          <p className="text-sm text-muted-foreground mb-1">Total Spent</p>
          <p className="text-xl font-semibold text-foreground">
            {formatCurrency(toMoneyNumber(summary.totalActual))}
          </p>
        </div>
        <div className={cn(
          "p-4 rounded-lg border",
          isOverBudget
            ? "bg-destructive/5 border-destructive/20"
            : "bg-emerald-500/5 border-emerald-500/20"
        )}>
          <p className="text-sm text-muted-foreground mb-1">Variance</p>
          <p className={cn(
            "text-xl font-semibold",
            isOverBudget ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
          )}>
            {isOverBudget ? "-" : "+"}{formatCurrency(Math.abs(varianceAmount))}
          </p>
        </div>
      </div>

      {/* Comparison Chart */}
      {chartData.length > 0 && (
        <ChartContainer config={chartConfig} className="w-full" style={{ height: 300 }}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 20, right: 120, bottom: 30, left: 100 }}
          >
            <CartesianGrid horizontal={false} />
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => formatCurrency(Number(value))}
            />
            <YAxis
              type="category"
              dataKey="category"
              tickLine={false}
              axisLine={false}
              width={100}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelKey="fullName"
                  formatter={(value) => formatCurrency(Number(value))}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar
              dataKey="budgeted"
              fill={CASH_FLOW_CHART_COLORS.budget}
              radius={4}
            />
            <Bar
              dataKey="actual"
              fill={CASH_FLOW_CHART_COLORS.actual}
              radius={4}
            />
          </BarChart>
        </ChartContainer>
      )}

      {/* Category Details */}
      <div className="mt-6 space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground mb-3">Category Details</h4>
        <div className="space-y-2 max-h-[200px] overflow-y-auto">
          {comparison.slice(0, 10).map((item) => (
            <div
              key={item.categoryId}
              className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="font-medium text-sm">{item.categoryName}</span>
                <StatusBadge status={item.status} />
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-muted-foreground">
                  Budget: {formatCurrency(toMoneyNumber(item.budgeted))}
                </span>
                <span className="font-medium">
                  Actual: {formatCurrency(toMoneyNumber(item.actual))}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
