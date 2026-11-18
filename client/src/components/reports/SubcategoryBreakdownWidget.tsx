import React, { useState, useMemo } from "react";
import { PieChart, Pie, Cell } from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Target,
  CreditCard,
  ChevronRight,
} from "lucide-react";
import {
  useReportsSubcategoryBreakdown,
  useCurrentYearRange,
} from "@/hooks/use-reports";
import { useCategories } from "@/hooks/use-settings";
import { formatCurrency } from "@/lib/utils";
import { toMoneyNumber } from "@/lib/money";
import { WidgetCard, ChartType } from "./shared/WidgetCard";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ============================================================================
// TYPES
// ============================================================================

export type SubcategoryMetric =
  | "income"
  | "expense"
  | "savingsContributions"
  | "debt";

interface SubcategoryBreakdownWidgetProps {
  onHide?: () => void;
  className?: string;
  metric: SubcategoryMetric;
  defaultChartType?: ChartType;
  title?: string;
  description?: string;
  groupId?: string; // Pre-filtered group ID
}

// ============================================================================
// COMPONENT
// ============================================================================

export function SubcategoryBreakdownWidget({
  onHide,
  className,
  metric,
  defaultChartType = "progressBars",
  title: propTitle,
  description: propDescription,
  groupId: propGroupId,
}: SubcategoryBreakdownWidgetProps) {
  const [chartType, setChartType] = useState<ChartType>(defaultChartType);
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>(
    propGroupId
  );
  const { from, to } = useCurrentYearRange();

  // Fetch Category Groups (for the selector)
  const { data: categoriesData } = useCategories({
    type:
      metric === "income"
        ? "income"
        : metric === "expense"
        ? "expenses"
        : undefined,
  });

  const categoryGroups = useMemo(() => {
    if (!categoriesData?.groups) return [];
    return categoriesData.groups.filter((g) => !g.isArchived);
  }, [categoriesData]);

  // Fetch Subcategory Breakdown
  const { data: breakdownData, isLoading } = useReportsSubcategoryBreakdown({
    from,
    to,
    type: metric,
    groupId: selectedGroupId,
  });

  // Transform for Nivo Pie/Donut
  const pieData = useMemo(() => {
    if (!breakdownData?.items) return [];
    return breakdownData.items.map((item) => ({
      id: item.id,
      label: item.label,
      value: toMoneyNumber(item.value),
      color: item.color || `hsl(${Math.random() * 360}, 70%, 50%)`,
    }));
  }, [breakdownData]);

  // Chart config derived from pie slices
  const chartConfig = useMemo(
    () =>
      pieData.reduce((acc, item) => {
        acc[item.id] = { label: item.label, color: item.color };
        return acc;
      }, {} as ChartConfig),
    [pieData]
  );

  // Determine Title & Icon
  const getMetadata = () => {
    switch (metric) {
      case "income":
        return {
          title: propTitle || "Income Subcategories",
          desc: propDescription || "Breakdown of income streams",
          icon: <TrendingUp className="h-5 w-5 text-emerald-500" />,
        };
      case "expense":
        return {
          title: propTitle || "Expense Subcategories",
          desc: propDescription || "Detailed spending by subcategory",
          icon: <TrendingDown className="h-5 w-5 text-rose-500" />,
        };
      case "savingsContributions":
        return {
          title: propTitle || "Savings Contributions",
          desc: propDescription || "Breakdown of savings target contributions",
          icon: <Target className="h-5 w-5 text-blue-500" />,
        };
      case "debt":
        return {
          title: propTitle || "Debt Breakdown",
          desc: propDescription || "Breakdown of debt payments and balances",
          icon: <CreditCard className="h-5 w-5 text-amber-500" />,
        };
    }
  };

  const metadata = getMetadata();

  return (
    <WidgetCard
      title={metadata.title}
      description={metadata.desc}
      icon={metadata.icon}
      onHide={onHide}
      className={className}
      isLoading={isLoading}
      chartType={chartType}
      availableChartTypes={["progressBars", "donut"]}
      onChartTypeChange={setChartType}
      action={
        metric === "expense" &&
        !propGroupId && (
          <Select
            value={selectedGroupId || "all"}
            onValueChange={(v) =>
              setSelectedGroupId(v === "all" ? undefined : v)
            }
          >
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="All Groups" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Groups</SelectItem>
              {categoryGroups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      }
    >
      <div className="min-h-[300px] flex flex-col justify-center">
        {!isLoading &&
        (!breakdownData?.items || breakdownData.items.length === 0) ? (
          <div className="flex flex-col items-center justify-center text-muted-foreground py-12">
            <p className="text-sm">
              No data for this period. Try a different group or date range.
            </p>
          </div>
        ) : chartType === "donut" || chartType === "pie" ? (
          <ChartContainer
            config={chartConfig}
            className="mx-auto w-full"
            style={{ height: 300 }}
          >
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="id"
                innerRadius={chartType === "donut" ? 60 : 0}
                outerRadius={100}
                paddingAngle={2}
                strokeWidth={2}
              >
                {pieData.map((d) => (
                  <Cell key={d.id} fill={d.color} />
                ))}
              </Pie>
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    nameKey="id"
                    formatter={(value) => formatCurrency(Number(value))}
                  />
                }
              />
            </PieChart>
          </ChartContainer>
        ) : (
          <div className="space-y-4 py-2">
            {breakdownData?.items.map((item) => (
              <div key={item.id} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="font-medium">{item.label}</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono">
                    <span>{formatCurrency(toMoneyNumber(item.value))}</span>
                    <span className="text-muted-foreground">
                      ({item.percent.toFixed(1)}%)
                    </span>
                  </div>
                </div>
                <Progress
                  value={item.percent}
                  className="h-1.5"
                  indicatorStyle={{ backgroundColor: item.color }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </WidgetCard>
  );
}
