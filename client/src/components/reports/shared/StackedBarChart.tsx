/**
 * StackedBarChart - Stacked bar chart component
 *
 * Used for part-to-whole comparisons showing how components sum to totals
 */

import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useFormatters } from "@/contexts/SettingsContext";

export interface StackedBarData {
  label: string;
  [key: string]: string | number;
}

interface StackedBarChartProps {
  data: StackedBarData[];
  keys: string[];
  colors?: string[];
  height?: number;
  layout?: "vertical" | "horizontal";
  onClick?: (datum: StackedBarData, key: string) => void;
}

const DEFAULT_COLORS = [
  "#3b82f6", // blue
  "#10b981", // green
  "#f59e0b", // amber
  "#8b5cf6", // purple
  "#f43f5e", // rose
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#ec4899", // pink
];

export function StackedBarChart({
  data,
  keys,
  colors = DEFAULT_COLORS,
  height = 300,
  layout = "vertical",
  onClick,
}: StackedBarChartProps) {
  const { formatCurrency } = useFormatters();

  const chartConfig = keys.reduce((acc, key, index) => {
    acc[key] = { label: key, color: colors[index % colors.length] };
    return acc;
  }, {} as ChartConfig);

  const isHorizontal = layout === "horizontal";

  const handleBarClick = (key: string) => (barData: { payload?: StackedBarData }) => {
    if (onClick && barData?.payload) {
      onClick(barData.payload, key);
    }
  };

  return (
    <ChartContainer config={chartConfig} className="w-full" style={{ height }}>
      <BarChart
        data={data}
        layout={isHorizontal ? "vertical" : "horizontal"}
        margin={{
          top: 20,
          right: isHorizontal ? 100 : 30,
          bottom: isHorizontal ? 30 : 50,
          left: isHorizontal ? 100 : 60,
        }}
      >
        <CartesianGrid vertical={false} />
        {isHorizontal ? (
          <>
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => formatCurrency(Number(value))}
            />
            <YAxis
              type="category"
              dataKey="label"
              tickLine={false}
              axisLine={false}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => formatCurrency(Number(value))}
            />
          </>
        )}
        <ChartTooltip content={<ChartTooltipContent />} />
        {keys.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
        {keys.map((key, index) => (
          <Bar
            key={key}
            dataKey={key}
            stackId="a"
            fill={colors[index % colors.length]}
            radius={4}
            onClick={handleBarClick(key)}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

export default StackedBarChart;
