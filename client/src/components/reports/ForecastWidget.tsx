import { useState, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, TrendingUp } from "lucide-react";
import {
  useReportsForecast,
  useReportsCashflow,
  useReportsNetWorth,
  useLastNMonthsRange,
} from "@/hooks/use-reports";
import { WidgetCard } from "./shared/WidgetCard";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useFormatters } from "@/contexts/SettingsContext";
import { startOfMonth, subMonths, format } from "date-fns";
import { toMoneyNumber } from "@/lib/money";

type MetricType = "net-worth" | "net-savings" | "income" | "expenses";

import { AggregationLevel } from "./AggregationFilter";

interface ForecastWidgetProps {
  className?: string;
  onHide?: () => void;
  aggregation?: AggregationLevel;
}

export function ForecastWidget({ onHide, className }: ForecastWidgetProps) {
  const [metric, setMetric] = useState<MetricType>("net-worth");
  const [projectionMonths, setProjectionMonths] = useState(6);
  const { formatCurrency } = useFormatters();

  // History range: Last 12 months for context
  const historyRange = useLastNMonthsRange(12);

  // Fetch Forecast
  const { data: forecastData, isLoading: forecastLoading } = useReportsForecast(
    {
      metric,
      projectionMonths,
      baselineMonths: 12,
    }
  );

  // Fetch History (conditionally based on metric)
  const { data: netWorthData, isLoading: netWorthLoading } = useReportsNetWorth(
    { ...historyRange, interval: "month" },
    { enabled: metric === "net-worth" }
  );

  const { data: cashflowData, isLoading: cashflowLoading } = useReportsCashflow(
    { ...historyRange, interval: "month" },
    { enabled: metric !== "net-worth" }
  );

  const isLoading =
    forecastLoading ||
    (metric === "net-worth" ? netWorthLoading : cashflowLoading);

  // Transform Data
  const chartData = useMemo(() => {
    if (isLoading) return [];

    // 1. Get Historical Points
    let historyPoints: { x: string; y: number }[] = [];

    if (metric === "net-worth" && netWorthData?.series?.[0]?.data) {
      historyPoints = netWorthData.series[0].data.map((d) => ({
        x: d.x.split("T")[0].substring(0, 7), // YYYY-MM
        y: toMoneyNumber(d.y),
      }));
    } else if (metric !== "net-worth" && cashflowData?.series) {
      historyPoints = cashflowData.series.map((s) => {
        let val = 0;
        if (metric === "income") val = toMoneyNumber(s.income);
        if (metric === "expenses") val = toMoneyNumber(s.expenses);
        if (metric === "net-savings") val = toMoneyNumber(s.savings);
        return {
          x: s.periodStart.substring(0, 7),
          y: val,
        };
      });
    }

    // 2. Get Forecast Points
    const projectionPoints =
      forecastData?.projection?.map((p) => ({
        x: p.month,
        y: p.predicted,
        lower: p.lowerBound,
        upper: p.upperBound,
      })) || [];

    // Create Series (color preserved from original nivo colors callback)
    const historySeries = {
      id: "History",
      color: "hsl(var(--primary))",
      data: historyPoints,
    };

    const forecastSeries = {
      id: "Forecast",
      color: "hsl(var(--chart-1))",
      data: projectionPoints.map((p) => ({ x: p.x, y: p.y })),
    };

    const lowerSeries = {
      id: "Lower Bound",
      color: "hsl(var(--muted-foreground))",
      data: projectionPoints.map((p) => ({ x: p.x, y: p.lower })),
    };
    const upperSeries = {
      id: "Upper Bound",
      color: "hsl(var(--muted-foreground))",
      data: projectionPoints.map((p) => ({ x: p.x, y: p.upper })),
    };

    return [historySeries, forecastSeries, lowerSeries, upperSeries];
  }, [isLoading, metric, netWorthData, cashflowData, forecastData]);

  // Pivot series-shaped data into flat rows for recharts
  const chartConfig = useMemo(
    () =>
      chartData.reduce((acc, series) => {
        acc[series.id] = { label: series.id, color: series.color };
        return acc;
      }, {} as ChartConfig),
    [chartData]
  );

  const chartRows = useMemo(() => {
    const xs = Array.from(
      new Set(chartData.flatMap((s) => s.data.map((p) => String(p.x))))
    );
    return xs.map((x) => {
      const row: Record<string, string | number> = { x };
      for (const s of chartData) {
        row[s.id] = s.data.find((p) => String(p.x) === x)?.y ?? 0;
      }
      return row;
    });
  }, [chartData]);

  // Determine labels
  const getMetricLabel = (m: MetricType) => {
    switch (m) {
      case "net-worth":
        return "Net Worth";
      case "net-savings":
        return "Net Savings";
      case "income":
        return "Income";
      case "expenses":
        return "Expenses";
    }
  };

  return (
    <WidgetCard
      title="Forecast"
      description={`Projected ${getMetricLabel(
        metric
      )} (Next ${projectionMonths} Months)`}
      icon={<TrendingUp className="h-5 w-5" />}
      onHide={onHide}
      className={className}
      action={
        <div className="flex items-center gap-2">
          <Select
            value={metric}
            onValueChange={(v) => setMetric(v as MetricType)}
          >
            <SelectTrigger className="h-8 w-[120px]">
              <SelectValue placeholder="Metric" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="net-worth">Net Worth</SelectItem>
              <SelectItem value="net-savings">Net Savings</SelectItem>
              <SelectItem value="income">Income</SelectItem>
              <SelectItem value="expenses">Expenses</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={String(projectionMonths)}
            onValueChange={(v) => setProjectionMonths(Number(v))}
          >
            <SelectTrigger className="h-8 w-[80px]">
              <SelectValue placeholder="Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3m</SelectItem>
              <SelectItem value="6">6m</SelectItem>
              <SelectItem value="12">12m</SelectItem>
            </SelectContent>
          </Select>
        </div>
      }
    >
      {isLoading ? (
        <div className="h-[300px] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <ChartContainer
          config={chartConfig}
          className="w-full"
          style={{ height: 300 }}
        >
          <LineChart
            data={chartRows}
            margin={{ top: 20, right: 20, bottom: 20, left: 10 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="x"
              tickLine={false}
              axisLine={false}
              angle={-45}
              textAnchor="end"
              height={50}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) =>
                new Intl.NumberFormat("en-US", {
                  notation: "compact",
                  compactDisplay: "short",
                }).format(Number(value))
              }
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => formatCurrency(Number(value))}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            {chartData.map((series) => (
              <Line
                key={series.id}
                dataKey={series.id}
                stroke={series.color}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ChartContainer>
      )}
    </WidgetCard>
  );
}
