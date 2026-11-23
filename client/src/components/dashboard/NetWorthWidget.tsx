import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useCurrentYearRange, useReportsNetWorth } from "@/hooks/use-reports";
import { useFormatters } from "@/contexts/SettingsContext";
import { Loader2 } from "lucide-react";
import { toMoneyNumber } from "@/lib/money";
import { shortMonthLabel } from "@/features/reports/chartSeries";
import { WidgetErrorState } from "./WidgetErrorState";
import { LastUpdated } from "./LastUpdated";
import { NetWorthIncompleteNotice } from "./NetWorthIncompleteNotice";

export default function NetWorthWidget() {
  const { formatCurrency } = useFormatters();
  const { from, to } = useCurrentYearRange();

  const { data: netWorthData, isLoading, error, refetch, isFetching, dataUpdatedAt } = useReportsNetWorth({
    from,
    to,
    interval: "month",
  });

  if (isLoading) {
    return (
      <Card className="col-span-3 shadow-sm border-border/50 bg-card hover:shadow-md transition-shadow duration-300 flex flex-col justify-center items-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (error) {
    return (
      <WidgetErrorState
        title="Unable to load net worth"
        message="Failed to fetch your net worth data."
        onRetry={() => refetch()}
        className="col-span-3 shadow-sm border-border/50"
      />
    );
  }

  const currentNetWorth = toMoneyNumber(netWorthData?.latest?.netWorth ?? 0);

  // Flatten series data for Recharts
  // netWorthData.series is Array<{ id: "Net Worth", data: Array<{ x: string; y: number }> }>
  const chartData =
    netWorthData?.series[0]?.data.map((item) => ({
      date: shortMonthLabel(item.x),
      value: toMoneyNumber(item.y),
    })) ?? [];

  // Calculate percentage change if we have at least 2 data points
  const firstValue = chartData.length > 0 ? chartData[0].value : 0;

  const percentChange =
    firstValue !== 0 && currentNetWorth !== 0
      ? (((currentNetWorth - firstValue) / Math.abs(firstValue)) * 100).toFixed(
          1
        )
      : "0.0";

  const isPositive = Number(percentChange) >= 0;

  return (
    <Card className="col-span-3 shadow-sm border-border/50 bg-card hover:shadow-md transition-shadow duration-300">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Net Worth
          </CardTitle>
          <LastUpdated
            timestamp={dataUpdatedAt}
            onRefresh={() => refetch()}
            isRefreshing={isFetching}
          />
        </div>
        <span
          className={`text-xs font-bold px-2 py-1 rounded-full border ${
            isPositive
              ? "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 border-emerald-100 dark:border-emerald-800"
              : "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/30 border-rose-100 dark:border-rose-800"
          }`}
        >
          {isPositive ? "+" : ""}
          {percentChange}%
        </span>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold mb-4 text-foreground tracking-tight">
          {formatCurrency(currentNetWorth)}
        </div>
        <NetWorthIncompleteNotice
          incomplete={netWorthData?.incomplete}
          omittedValuations={netWorthData?.omittedValuations}
        />
        <div className="h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="hsl(var(--primary))"
                    stopOpacity={0.2}
                  />
                  <stop
                    offset="95%"
                    stopColor="hsl(var(--primary))"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                dy={10}
              />
              <YAxis hide={true} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  borderColor: "hsl(var(--border))",
                  borderRadius: "var(--radius)",
                  boxShadow: "var(--shadow-md)",
                }}
                itemStyle={{ color: "hsl(var(--foreground))" }}
                formatter={(value: number) => [
                  formatCurrency(value),
                  "Net Worth",
                ]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorValue)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
