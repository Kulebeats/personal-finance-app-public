import { Card } from "@/components/ui/card";
import { Loader2, AlertCircle, TrendingUp } from "lucide-react";
import { PieChart, Pie, Cell } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useReportsSpendingBreakdown } from "@/hooks/use-reports";
import { useFormatters } from "@/contexts/SettingsContext";
import { toMoneyNumber } from "@/lib/money";
import { type CashFlowFiltersState } from "../types";
import { useState, useEffect } from "react";
import { CASH_FLOW_CHART_COLORS } from "./chartTokens";

interface ExpenseBreakdownProps {
  filters: CashFlowFiltersState;
}

export function ExpenseBreakdown({ filters }: ExpenseBreakdownProps) {
  const { formatCurrency } = useFormatters();
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const { data, isLoading, error } = useReportsSpendingBreakdown({
    from: filters.from,
    to: filters.to,
    scope: filters.scope,
    groupBy: "categoryGroup",
    limit: 5,
    type: "expense",
    includePending: filters.includePending,
    includeTransfers: filters.includeTransfers,
  });

  const chartData =
    data?.items.map((g) => ({
      id: g.label,
      label: g.label,
      value: Math.abs(toMoneyNumber(g.value)),
      color: g.color || CASH_FLOW_CHART_COLORS.neutral,
    })) ?? [];

  const chartConfig = chartData.reduce((acc, item) => {
    acc[item.id] = { label: item.label, color: item.color };
    return acc;
  }, {} as ChartConfig);

  return (
    <Card className="p-6 border-border shadow-sm flex flex-col h-[400px]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-lg">Expense Breakdown</h3>
      </div>

      <div className="flex-1 min-h-0 w-full">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <AlertCircle className="w-12 h-12 text-destructive" />
            <p className="text-sm text-muted-foreground">Failed to load data</p>
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <TrendingUp className="w-12 h-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No expenses found</p>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="w-full h-full">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="id"
                innerRadius={isMobile ? 50 : 60}
                outerRadius={isMobile ? 80 : 95}
                paddingAngle={2}
                cornerRadius={3}
                strokeWidth={2}
              >
                {chartData.map((d) => (
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
              <ChartLegend
                content={<ChartLegendContent nameKey="id" />}
                layout={isMobile ? "horizontal" : "vertical"}
                align={isMobile ? "center" : "right"}
                verticalAlign={isMobile ? "bottom" : "middle"}
              />
            </PieChart>
          </ChartContainer>
        )}
      </div>
    </Card>
  );
}
