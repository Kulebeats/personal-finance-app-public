import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { useReportsAnnual, useCurrentYearRange } from "@/hooks/use-reports";
import { formatCurrency, toMoneyNumber } from "@/lib/money";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";

function parseLocalDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export default function CumulativeGrowthWidget() {
  const { year } = useCurrentYearRange();
  const { data, isLoading } = useReportsAnnual({ year });

  const cumulativeData =
    data?.cumulativeSeries.map((series) => ({
      id: series.id,
      color: series.id === "Income" ? "#10b981" : "#f43f5e",
      data: series.data.map((point) => {
        const date = parseLocalDate(point.x);
        return {
          x: date.toLocaleDateString("en-US", { month: "short" }),
          y: toMoneyNumber(point.y),
        };
      }),
    })) ?? [];

  const chartConfig = cumulativeData.reduce((acc, series) => {
    acc[series.id] = { label: series.id, color: series.color };
    return acc;
  }, {} as ChartConfig);

  const xs = Array.from(
    new Set(cumulativeData.flatMap((s) => s.data.map((p) => String(p.x)))),
  );
  const rows = xs.map((x) => {
    const row: Record<string, string | number> = { x };
    for (const s of cumulativeData) {
      row[s.id] = s.data.find((p) => String(p.x) === x)?.y ?? 0;
    }
    return row;
  });

  return (
    <Card className="shadow-sm border-border/50 bg-card h-[400px]">
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Cumulative Growth
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[340px]">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : cumulativeData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No data for this year. Add transactions or change the year.
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-full w-full">
            <AreaChart
              data={rows}
              margin={{ top: 20, right: 30, bottom: 20, left: 10 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis dataKey="x" tickLine={false} axisLine={false} />
              <YAxis
                tickFormatter={(value) => `${(Number(value) / 1000).toFixed(0)}k`}
                tickLine={false}
                axisLine={false}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => formatCurrency(Number(value), data?.baseCurrency ?? "")}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              {cumulativeData.map((series) => (
                <Area
                  key={series.id}
                  dataKey={series.id}
                  stroke={series.color}
                  fill={series.color}
                  fillOpacity={0.1}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
