/**
 * NetWorthSection Component
 *
 * Displays net worth growth as an area chart
 */

import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import { Loader2 } from "lucide-react";
import { NET_WORTH_COLOR } from "../utils/chartTheme";
import { formatAxisValue, formatCurrency } from "../utils/reportFormatters";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

interface NetWorthDataPoint {
  x: string;
  y: number;
}

interface NetWorthSectionProps {
  data: Array<{ id: string; data: NetWorthDataPoint[] }>;
  isLoading: boolean;
  /** The report's base currency (the series values are in it); null until it is known. */
  currency: string | null;
}

export function NetWorthSection({ data, isLoading, currency }: NetWorthSectionProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No net worth data for this period.
      </div>
    );
  }

  const chartConfig = data.reduce((acc, series) => {
    acc[series.id] = { label: series.id, color: NET_WORTH_COLOR };
    return acc;
  }, {} as ChartConfig);

  const xs = Array.from(
    new Set(data.flatMap((s) => s.data.map((p) => String(p.x)))),
  );
  const rows = xs.map((x) => {
    const row: Record<string, string | number> = { x };
    for (const s of data) {
      row[s.id] = s.data.find((p) => String(p.x) === x)?.y ?? 0;
    }
    return row;
  });

  return (
    <ChartContainer config={chartConfig} className="h-full w-full">
      <AreaChart
        data={rows}
        margin={{ top: 50, right: 110, bottom: 50, left: 80 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis dataKey="x" tickLine={false} axisLine={false} />
        <YAxis
          tickFormatter={(value) => formatAxisValue(Number(value))}
          tickLine={false}
          axisLine={false}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => formatCurrency(Number(value), currency)}
            />
          }
        />
        {data.map((series) => (
          <Area
            key={series.id}
            dataKey={series.id}
            stroke={NET_WORTH_COLOR}
            fill={NET_WORTH_COLOR}
            fillOpacity={0.1}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}
