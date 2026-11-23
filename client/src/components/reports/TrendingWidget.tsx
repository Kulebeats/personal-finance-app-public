import React, { useMemo } from "react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { TrendingUp } from "lucide-react";
import { WidgetCard } from "./shared/WidgetCard";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useFormatters } from "@/contexts/SettingsContext";

// ============================================================================
// TYPES
// ============================================================================

export interface TrendingDataPoint {
  label: string;
  value: number;
  [key: string]: string | number;
}

interface TrendingWidgetProps {
  title: string;
  description: string;
  data: TrendingDataPoint[];
  isLoading?: boolean;
  error?: Error | null;
  color?: string | ((datum: TrendingDataPoint) => string);
  avgColor?: string;
  icon?: React.ReactNode;
  onHide?: () => void;
  className?: string;
  onBarClick?: (datum: TrendingDataPoint) => void;
  average?: { value: number; label: string } | null;
  formatValue?: (value: number) => string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function TrendingWidget({
  title,
  description,
  data,
  isLoading,
  error,
  color = "#3b82f6",
  avgColor = "#64748b", // Default to gray for avg line
  icon = <TrendingUp className="h-4 w-4 text-primary" />,
  onHide,
  className,
  onBarClick,
  average,
  formatValue,
}: TrendingWidgetProps) {
  const { formatCurrency } = useFormatters();
  const format = formatValue ?? formatCurrency;

  const reference = useMemo(() => {
    if (average !== undefined) return average;
    if (!data.length) return null;
    const sum = data.reduce((acc, curr) => acc + curr.value, 0);
    return { value: sum / data.length, label: "Avg" };
  }, [average, data]);

  const isEmpty = !isLoading && data.length === 0;

  const chartConfig: ChartConfig = {
    value: {
      label: title,
      color: typeof color === "string" ? color : "#3b82f6",
    },
  };

  const getBarColor = (datum: TrendingDataPoint): string =>
    typeof color === "string" ? color : color(datum);

  const handleBarClick = (barData: { payload?: TrendingDataPoint }): void => {
    if (onBarClick && barData?.payload) {
      onBarClick(barData.payload);
    }
  };

  return (
    <WidgetCard
      title={title}
      description={description}
      icon={icon}
      isLoading={isLoading}
      error={error}
      onHide={onHide}
      className={className}
    >
      <div className="h-[280px] w-full">
        {isEmpty ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No data for the selected period. Adjust filters or date range.
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="w-full h-full">
            <BarChart
              data={data}
              margin={{ top: 20, right: 20, bottom: 40, left: 60 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) =>
                  `${(Number(value) / 1000).toFixed(0)}k`
                }
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(v) => format(Number(v))}
                  />
                }
              />
              {reference && <ReferenceLine
                y={reference.value}
                stroke={avgColor}
                strokeWidth={2}
                strokeDasharray="4 4"
                label={{
                  value: `${reference.label}: ${format(reference.value)}`,
                  position: "insideTopRight",
                  fill: avgColor,
                  fontSize: 10,
                  fontWeight: "bold",
                }}
              />}
              <Bar
                dataKey="value"
                radius={4}
                onClick={handleBarClick}
                cursor={onBarClick ? "pointer" : undefined}
              >
                {data.map((datum) => (
                  <Cell key={datum.label} fill={getBarColor(datum)} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </div>
    </WidgetCard>
  );
}
