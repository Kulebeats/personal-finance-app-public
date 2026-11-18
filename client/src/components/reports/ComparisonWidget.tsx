import React, { useMemo } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { TrendingUp } from "lucide-react";
import { WidgetCard, ChartType } from "./shared/WidgetCard";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useFormatters } from "@/contexts/SettingsContext";

// ============================================================================
// TYPES
// ============================================================================

export interface ComparisonDataPoint {
  label: string;
  primary: number;
  secondary: number;
  [key: string]: string | number;
}

interface ComparisonWidgetProps {
  title: string;
  description: string;
  data: ComparisonDataPoint[];
  primaryKey: string;
  secondaryKey: string;
  isLoading?: boolean;
  error?: Error | null;
  primaryColor?: string;
  secondaryColor?: string;
  icon?: React.ReactNode;
  onHide?: () => void;
  className?: string;
  defaultChartType?: ChartType;
  onBarClick?: (datum: ComparisonDataPoint) => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ComparisonWidget({
  title,
  description,
  data,
  primaryKey,
  secondaryKey,
  isLoading,
  error,
  primaryColor = "#10b981",
  secondaryColor = "#f43f5e",
  icon = <TrendingUp className="h-4 w-4 text-primary" />,
  onHide,
  className,
  defaultChartType = "bar",
  onBarClick,
}: ComparisonWidgetProps) {
  const { formatCurrency } = useFormatters();
  const [chartType, setChartType] = React.useState<ChartType>(defaultChartType);

  const isEmpty = !isLoading && data.length === 0;

  const chartConfig = useMemo<ChartConfig>(
    () => ({
      [primaryKey]: { label: primaryKey, color: primaryColor },
      [secondaryKey]: { label: secondaryKey, color: secondaryColor },
    }),
    [primaryKey, secondaryKey, primaryColor, secondaryColor],
  );

  const chartData = useMemo(
    () =>
      data.map((d) => ({
        label: d.label,
        [primaryKey]: d.primary,
        [secondaryKey]: d.secondary,
      })),
    [data, primaryKey, secondaryKey],
  );

  const handleBarClick = (payload: { payload?: ComparisonDataPoint }) => {
    if (onBarClick && payload?.payload) {
      const original = data.find((d) => d.label === payload.payload?.label);
      if (original) onBarClick(original);
    }
  };

  const renderChart = () => {
    if (chartType === "bar") {
      return (
        <ChartContainer config={chartConfig} className="h-full w-full">
          <BarChart
            data={chartData}
            margin={{ top: 20, right: 30, bottom: 50, left: 60 }}
          >
            <CartesianGrid vertical={false} />
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
              tickFormatter={(value) => `${(Number(value) / 1000).toFixed(0)}k`}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => formatCurrency(Number(value))}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar
              dataKey={primaryKey}
              fill={primaryColor}
              radius={4}
              onClick={handleBarClick}
            />
            <Bar
              dataKey={secondaryKey}
              fill={secondaryColor}
              radius={4}
              onClick={handleBarClick}
            />
          </BarChart>
        </ChartContainer>
      );
    }

    if (chartType === "area") {
      return (
        <ChartContainer config={chartConfig} className="h-full w-full">
          <AreaChart
            data={chartData}
            margin={{ top: 20, right: 30, bottom: 50, left: 60 }}
          >
            <CartesianGrid vertical={false} />
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
              tickFormatter={(value) => `${(Number(value) / 1000).toFixed(0)}k`}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => formatCurrency(Number(value))}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Area
              dataKey={primaryKey}
              stroke={primaryColor}
              fill={primaryColor}
              fillOpacity={0.15}
              strokeWidth={2}
              dot={{ r: 4 }}
            />
            <Area
              dataKey={secondaryKey}
              stroke={secondaryColor}
              fill={secondaryColor}
              fillOpacity={0.15}
              strokeWidth={2}
              dot={{ r: 4 }}
            />
          </AreaChart>
        </ChartContainer>
      );
    }

    return (
      <ChartContainer config={chartConfig} className="h-full w-full">
        <LineChart
          data={chartData}
          margin={{ top: 20, right: 30, bottom: 50, left: 60 }}
        >
          <CartesianGrid vertical={false} />
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
            tickFormatter={(value) => `${(Number(value) / 1000).toFixed(0)}k`}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) => formatCurrency(Number(value))}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Line
            dataKey={primaryKey}
            stroke={primaryColor}
            strokeWidth={2}
            dot={{ r: 4 }}
          />
          <Line
            dataKey={secondaryKey}
            stroke={secondaryColor}
            strokeWidth={2}
            dot={{ r: 4 }}
          />
        </LineChart>
      </ChartContainer>
    );
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
      chartType={chartType}
      availableChartTypes={["bar", "line", "area"]}
      onChartTypeChange={setChartType}
    >
      <div className="h-[280px] w-full">
        {isEmpty ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No data for the selected period. Adjust filters or date range.
          </div>
        ) : (
          renderChart()
        )}
      </div>
    </WidgetCard>
  );
}
