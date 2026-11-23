/**
 * Merchant Spending Trend Chart
 */

import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { formatCurrency, toMoneyNumber, type MoneyValue } from "@/lib/money";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

interface TrendPoint {
  period: string;
  total: MoneyValue | number;
}

interface MerchantDetailChartProps {
  trend: TrendPoint[];
}

const SPEND_COLOR = "#f43f5e";

const chartConfig = {
  Spend: { label: "Spend", color: SPEND_COLOR },
} satisfies ChartConfig;

export function MerchantDetailChart({ trend }: MerchantDetailChartProps) {
  const rows = useMemo(() => {
    if (!trend?.length) return [];
    return trend.map((point) => ({
      x: point.period,
      Spend: toMoneyNumber(point.total),
    }));
  }, [trend]);
  // Every point is in the household base currency; a bare number carries none.
  const currency = useMemo(() => {
    const total = trend?.find((point) => typeof point.total === "object" && point.total !== null)?.total;
    return typeof total === "object" && total !== null ? total.currency ?? "" : "";
  }, [trend]);

  if (!rows.length) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No trend data for this range.
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="h-full w-full">
      <LineChart
        data={rows}
        margin={{ top: 20, right: 30, bottom: 40, left: 10 }}
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
          tickFormatter={(value) => `${Number(value) / 1000}k`}
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
        <Line
          dataKey="Spend"
          stroke={SPEND_COLOR}
          strokeWidth={2}
          dot={{ r: 3, fill: SPEND_COLOR }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ChartContainer>
  );
}
