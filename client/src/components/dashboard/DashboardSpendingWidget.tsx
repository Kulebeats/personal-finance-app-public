import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { Loader2 } from "lucide-react";
import { useFormatters } from "@/contexts/SettingsContext";
import {
  useReportsSpendingTrend,
  useCurrentMonthRange,
  useLastNMonthsRange,
  useCurrentYearRange,
} from "@/hooks/use-reports";
import { toMoneyNumber } from "@/lib/money";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { WidgetErrorState } from "./WidgetErrorState";

export default function DashboardSpendingWidget() {
  const { formatCurrency } = useFormatters();
  const { from: monthFrom, to: monthTo } = useCurrentMonthRange();
  const { from: last3From, to: last3To } = useLastNMonthsRange(3);
  const { from: yearFrom, to: yearTo, year } = useCurrentYearRange();
  const [rangeKey, setRangeKey] = useState<"month" | "last3" | "ytd">("month");
  const [compareKey, setCompareKey] = useState<"previous" | "none">(
    "previous"
  );

  const rangeOptions = {
    month: {
      label: "This month",
      from: monthFrom,
      to: monthTo,
      interval: "day" as const,
    },
    last3: {
      label: "Last 3 months",
      from: last3From,
      to: last3To,
      interval: "week" as const,
    },
    ytd: {
      label: `YTD ${year}`,
      from: yearFrom,
      to: yearTo,
      interval: "month" as const,
    },
  };

  const selectedRange = rangeOptions[rangeKey];
  const compare =
    compareKey === "previous" ? ("previous_period" as const) : undefined;
  const showCompare = compareKey === "previous";

  const { data: trendData, isLoading, error, refetch } = useReportsSpendingTrend({
    from: selectedRange.from,
    to: selectedRange.to,
    interval: selectedRange.interval,
    compare,
  });

  const parseLocalDate = (value: string): Date => {
    if (value.includes("T")) {
      return new Date(value);
    }
    const [yearValue, monthValue, dayValue] = value
      .split("-")
      .map(Number);
    if (!yearValue || !monthValue || !dayValue) {
      return new Date(value);
    }
    return new Date(yearValue, monthValue - 1, dayValue);
  };

  const formatTickLabel = (value: string) => {
    const date = parseLocalDate(value);
    if (selectedRange.interval === "month") {
      return date.toLocaleDateString(undefined, { month: "short" });
    }
    if (selectedRange.interval === "week") {
      return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    }
    return date.toLocaleDateString(undefined, { day: "numeric" });
  };

  const chartData =
    trendData?.series.map((item) => ({
      day: formatTickLabel(item.date),
      current: toMoneyNumber(item.current),
      previous: showCompare ? toMoneyNumber(item.previous ?? 0) : 0,
    })) ?? [];

  const currentTotal = toMoneyNumber(trendData?.totals.current ?? 0);

  if (isLoading) {
    return (
      <Card className="shadow-sm border-border/50 bg-card h-full flex flex-col justify-center items-center p-6">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (error) {
    return (
      <WidgetErrorState
        title="Unable to load spending trend"
        message="We couldn't fetch this report."
        onRetry={() => refetch()}
        className="shadow-sm border-border/50 h-full"
      />
    );
  }

  return (
    <Card className="shadow-sm border-border/50 bg-card h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between pb-6 space-y-0 flex-shrink-0">
        <div className="flex items-baseline gap-2">
          <CardTitle className="text-lg font-bold text-foreground">
            Spending
          </CardTitle>
          <span className="text-lg text-foreground font-normal">
            {formatCurrency(currentTotal)}
          </span>
          <span className="text-sm text-muted-foreground">
            {selectedRange.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={rangeKey}
            onValueChange={(value) =>
              setRangeKey(value as "month" | "last3" | "ytd")
            }
          >
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">This month</SelectItem>
              <SelectItem value="last3">Last 3 months</SelectItem>
              <SelectItem value="ytd">YTD</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={compareKey}
            onValueChange={(value) =>
              setCompareKey(value as "previous" | "none")
            }
          >
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="previous">Compare: previous</SelectItem>
              <SelectItem value="none">No comparison</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 w-full min-h-0">
          {chartData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No spending data for this period.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorCurrent" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="hsl(var(--chart-5))"
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="95%"
                      stopColor="hsl(var(--chart-5))"
                      stopOpacity={0}
                    />
                  </linearGradient>
                  <linearGradient id="colorPrevious" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="hsl(var(--chart-neutral))"
                      stopOpacity={0.1}
                    />
                    <stop
                      offset="95%"
                      stopColor="hsl(var(--chart-neutral))"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="hsl(var(--border))"
                  opacity={0.4}
                />
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  dy={10}
                  interval="preserveStartEnd"
                  minTickGap={30}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  tickFormatter={(value) => formatCurrency(value)}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: "var(--radius)",
                    boxShadow: "var(--shadow-md)",
                  }}
                  itemStyle={{ color: "hsl(var(--foreground))" }}
                  formatter={(value: number) => [formatCurrency(value), ""]}
                  labelFormatter={(label) => {
                    if (selectedRange.interval === "month") {
                      return label;
                    }
                    if (selectedRange.interval === "week") {
                      return `Week of ${label}`;
                    }
                    return `Day ${label}`;
                  }}
                />
                {showCompare && (
                  <Area
                    type="monotone"
                    dataKey="previous"
                    stroke="hsl(var(--chart-neutral))"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorPrevious)"
                    name="Previous period"
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="current"
                  stroke="hsl(var(--chart-5))"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorCurrent)"
                  name="Selected period"
                  activeDot={{
                    r: 6,
                    strokeWidth: 0,
                    fill: "hsl(var(--chart-5))",
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="flex justify-center gap-6 mt-4">
          {showCompare && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div
                className="w-3 h-1 rounded-full"
                style={{ backgroundColor: "hsl(var(--chart-neutral))" }}
              ></div>
              Previous period
            </div>
          )}
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <div
              className="w-3 h-1 rounded-full"
              style={{ backgroundColor: "hsl(var(--chart-5))" }}
            ></div>
            Selected period
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
