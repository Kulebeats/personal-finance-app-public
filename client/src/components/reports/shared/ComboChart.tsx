/**
 * ComboChart - Combo chart component combining Bar and Line
 *
 * Used for visualizations that need primary bars with a secondary line overlay
 * (e.g., monthly values with average trend line)
 */

import React from "react";
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useFormatters } from "@/contexts/SettingsContext";
import { PRIMARY_CHART_COLOR, EXPENSE_COLOR } from "@/features/reports";

export interface ComboChartData {
  label: string;
  primary: number;
  secondary?: number;
}

interface ComboBarDatum {
  label: string;
  [key: string]: string | number;
}

interface ComboChartProps {
  data: ComboChartData[];
  primaryKey?: string;
  secondaryKey?: string;
  primaryColor?: string;
  secondaryColor?: string;
  height?: number;
  showAverage?: boolean;
  onClick?: (datum: ComboChartData) => void;
}

export function ComboChart({
  data,
  primaryKey = "Primary",
  secondaryKey = "Secondary",
  primaryColor = PRIMARY_CHART_COLOR,
  secondaryColor = EXPENSE_COLOR,
  height = 300,
  showAverage = true,
  onClick,
}: ComboChartProps) {
  const { formatCurrency } = useFormatters();

  // Calculate average for line overlay
  const primaryAvg =
    data.length > 0
      ? data.reduce((sum, d) => sum + d.primary, 0) / data.length
      : 0;

  // Transform data into recharts-friendly flat rows (already close to source shape)
  const barData: ComboBarDatum[] = data.map((d) => ({
    label: d.label,
    [primaryKey]: d.primary,
    ...(d.secondary !== undefined ? { [secondaryKey]: d.secondary } : {}),
  }));

  // Determine if we have secondary data
  const hasSecondary = data.some((d) => d.secondary !== undefined);
  const keys = hasSecondary ? [primaryKey, secondaryKey] : [primaryKey];
  const colors = [primaryColor, secondaryColor];

  const chartConfig: ChartConfig = keys.reduce((acc, key, i) => {
    acc[key] = { label: key, color: colors[i % colors.length] };
    return acc;
  }, {} as ChartConfig);

  return (
    <div
      tabIndex={0}
      role="img"
      aria-label={`Combo chart showing ${primaryKey} and ${secondaryKey}`}
      className="outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded-md"
    >
      <ChartContainer
        config={chartConfig}
        className="w-full"
        style={{ height }}
      >
        <ComposedChart
          data={barData}
          margin={{ top: 20, right: 30, bottom: 50, left: 60 }}
          onClick={(state) => {
            if (!onClick) return;
            const label = state?.activeLabel;
            if (label === undefined) return;
            const datum = data.find((d) => d.label === label);
            if (datum) onClick(datum);
          }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            angle={-45}
            textAnchor="end"
            height={50}
          />
          <YAxis
            tickFormatter={(v) => formatCurrency(Number(v))}
            tickLine={false}
            axisLine={false}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          {keys.length > 1 && (
            <ChartLegend content={<ChartLegendContent />} />
          )}
          {keys.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              fill={colors[i % colors.length]}
              radius={4}
            />
          ))}
          {showAverage && (
            <ReferenceLine
              y={primaryAvg}
              stroke={primaryColor}
              strokeWidth={2}
              strokeDasharray="6 4"
              strokeOpacity={0.7}
              label={{
                value: `Avg: ${formatCurrency(primaryAvg)}`,
                position: "insideTopRight",
                fontSize: 10,
                fill: primaryColor,
              }}
            />
          )}
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}

export default ComboChart;
