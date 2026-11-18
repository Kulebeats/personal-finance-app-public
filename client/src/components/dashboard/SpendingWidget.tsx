import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Loader2 } from "lucide-react";
import { useFormatters } from "@/contexts/SettingsContext";
import {
  useReportsSpendingBreakdown,
  useCurrentMonthRange,
} from "@/hooks/use-reports";
import { toMoneyNumber } from "@/lib/money";
import { WidgetErrorState } from "./WidgetErrorState";

// Theme-aware chart colors using CSS variables
const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-neutral))",
];

export default function SpendingWidget() {
  const { formatCurrency } = useFormatters();
  const { from, to } = useCurrentMonthRange();

  const { data: breakdownData, isLoading, error, refetch } = useReportsSpendingBreakdown({
    from,
    to,
    groupBy: "categoryGroup",
    limit: 5,
  });

  if (error) {
    return (
      <WidgetErrorState
        title="Unable to load categories"
        message="Failed to fetch spending breakdown."
        onRetry={() => refetch()}
        className="col-span-1 shadow-sm border-border/50"
      />
    );
  }

  const chartData =
    breakdownData?.items.map((item, index) => ({
      name: item.label,
      value: toMoneyNumber(item.value),
      color: item.color || COLORS[index % COLORS.length],
    })) ?? [];

  const totalSpending = toMoneyNumber(breakdownData?.total ?? 0);

  if (isLoading) {
    return (
      <Card className="col-span-1 shadow-sm border-border/50 bg-card hover:shadow-md transition-shadow duration-300 flex flex-col justify-center items-center p-6">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  return (
    <Card className="col-span-1 shadow-sm border-border/50 bg-card hover:shadow-md transition-shadow duration-300">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-foreground">
          Top Categories
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[200px] w-full relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
                stroke="none"
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  borderColor: "hsl(var(--border))",
                  borderRadius: "var(--radius)",
                  boxShadow: "var(--shadow-md)",
                }}
                itemStyle={{ color: "hsl(var(--foreground))" }}
                formatter={(value: number) => [formatCurrency(value), ""]}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex items-center justify-center flex-col pointer-events-none">
            <span className="text-2xl font-bold text-foreground">
              {formatCurrency(totalSpending)}
            </span>
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              Total
            </span>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {chartData.slice(0, 3).map((item) => (
            <div
              key={item.name}
              className="flex items-center justify-between text-sm"
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-muted-foreground">{item.name}</span>
              </div>
              <span className="font-medium text-foreground">
                {formatCurrency(item.value)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
