import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { CustomChartConfig } from "@shared/reports";
import { useCustomChartData } from "./useCustomChartData";
import { WidgetCard, WidgetEmptyState } from "./shared/WidgetCard";
import { useHouseholdMoneyFormat } from "./shared/useHouseholdMoneyFormat";
import { ChartTypeSwitcher, ChartType } from "./shared/ChartTypeSwitcher";
import { ComboChart } from "./shared/ComboChart";
import { StackedBarChart } from "./shared/StackedBarChart";

// Chart data point returned from API
interface ChartDatum {
  label: string;
  primary: number;
  secondary?: number;
  [key: string]: string | number | undefined;
}

const CHART_COLORS = [
  "#3b82f6", // blue
  "#10b981", // green
  "#f59e0b", // amber
  "#8b5cf6", // purple
  "#f43f5e", // rose
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#ec4899", // pink
];
const RATE_CHART_TYPES: ChartType[] = ["bar", "horizontal_bar", "line", "area", "pie"];
const AMOUNT_CHART_TYPES: ChartType[] = [...RATE_CHART_TYPES, "combo", "stacked_bar"];
const percent = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 2 });

interface CustomChartWidgetProps {
  config: CustomChartConfig;
  onEdit?: () => void;
  onDelete?: () => void;
}

export default function CustomChartWidget({
  config,
  onEdit,
  onDelete,
}: CustomChartWidgetProps) {
  const [selectedChartType, setActiveChartType] = useState<ChartType>(
    (config.chartType as ChartType) || "bar"
  );

  // Sync chart type when config changes (important for Live Preview)
  useMemo(() => {
    if (config.chartType) {
      setActiveChartType(config.chartType as ChartType);
    }
  }, [config.chartType]);

  const { query: { data, isLoading, error }, supportedMetric, groupBy, secondaryMetric } = useCustomChartData(config);
  const isSavingsRate = config.primaryMetric === "savingsRate";
  const allowedTypes = isSavingsRate ? RATE_CHART_TYPES : AMOUNT_CHART_TYPES;
  const activeChartType = allowedTypes.includes(selectedChartType) ? selectedChartType : "line";
  const formatCurrency = useHouseholdMoneyFormat();
  const formatValue = (value: number) => isSavingsRate ? percent.format(value / 100) : formatCurrency(value);
  const chartData = data?.data ?? [];
  const isEmpty = !isLoading && chartData.length === 0;

  const renderChart = () => {
    if (activeChartType === "bar" || activeChartType === "horizontal_bar") {
      const keys = secondaryMetric
        ? ["primary", "secondary"]
        : ["primary"];
      const isHorizontal = activeChartType === "horizontal_bar";
      const barConfig = keys.reduce((acc, key, index) => {
        acc[key] = {
          label: key === "primary" ? config.primaryMetric : secondaryMetric,
          color: CHART_COLORS[index % CHART_COLORS.length],
        };
        return acc;
      }, {} as ChartConfig);

      return (
        <ChartContainer config={barConfig} className="w-full h-full">
          <BarChart
            data={chartData}
            layout={isHorizontal ? "vertical" : "horizontal"}
            margin={{
              top: 10,
              right: isHorizontal ? 20 : 10,
              bottom: 40,
              left: isHorizontal ? 60 : 10,
            }}
          >
            <CartesianGrid vertical={false} />
            {isHorizontal ? (
              <>
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => formatValue(Number(value))}
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
                  height={50}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => formatValue(Number(value))}
                />
              </>
            )}
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => formatValue(Number(value))}
                />
              }
            />
            {keys.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
            {keys.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                fill={CHART_COLORS[index % CHART_COLORS.length]}
                radius={4}
              />
            ))}
          </BarChart>
        </ChartContainer>
      );
    }

    if (activeChartType === "line" || activeChartType === "area") {
      // Transform for line chart
      const series = [
        {
          id: config.primaryMetric,
          color: CHART_COLORS[0],
          data: chartData.map((d) => ({ x: d.label, y: d.primary })),
        },
      ];
      if (secondaryMetric) {
        series.push({
          id: secondaryMetric,
          color: CHART_COLORS[1],
          data: chartData.map((d) => ({ x: d.label, y: d.secondary || 0 })),
        });
      }

      const lineConfig = series.reduce((acc, s) => {
        acc[s.id] = { label: s.id, color: s.color };
        return acc;
      }, {} as ChartConfig);

      // Pivot series-shaped nivo data to flat rows for recharts
      const xs = Array.from(
        new Set(series.flatMap((s) => s.data.map((p) => String(p.x))))
      );
      const rows = xs.map((x) => {
        const row: Record<string, string | number> = { x };
        for (const s of series) {
          row[s.id] = s.data.find((p) => String(p.x) === x)?.y ?? 0;
        }
        return row;
      });

      const isArea = activeChartType === "area";

      return (
        <ChartContainer config={lineConfig} className="w-full h-full">
          {isArea ? (
            <AreaChart
              data={rows}
              margin={{ top: 10, right: 20, bottom: 40, left: 60 }}
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
                tickFormatter={(value) => formatValue(Number(value))}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => formatValue(Number(value))}
                  />
                }
              />
              {series.length > 1 && (
                <ChartLegend content={<ChartLegendContent />} />
              )}
              {series.map((s) => (
                <Area
                  key={s.id}
                  dataKey={s.id}
                  stroke={s.color}
                  fill={s.color}
                  fillOpacity={0.1}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </AreaChart>
          ) : (
            <LineChart
              data={rows}
              margin={{ top: 10, right: 20, bottom: 40, left: 60 }}
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
                tickFormatter={(value) => formatValue(Number(value))}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => formatValue(Number(value))}
                  />
                }
              />
              {series.length > 1 && (
                <ChartLegend content={<ChartLegendContent />} />
              )}
              {series.map((s) => (
                <Line
                  key={s.id}
                  dataKey={s.id}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              ))}
            </LineChart>
          )}
        </ChartContainer>
      );
    }

    if (activeChartType === "pie") {
      const pieData = chartData.map((d, index) => ({
        id: d.label,
        label: d.label,
        value: d.primary,
        color: CHART_COLORS[index % CHART_COLORS.length],
      }));

      const pieConfig = pieData.reduce((acc, item) => {
        acc[item.id] = { label: item.label, color: item.color };
        return acc;
      }, {} as ChartConfig);

      return (
        <ChartContainer config={pieConfig} className="mx-auto w-full h-full">
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="id"
              innerRadius={45}
              outerRadius={75}
              paddingAngle={2}
              strokeWidth={2}
            >
              {pieData.map((d) => (
                <Cell key={d.id} fill={d.color} />
              ))}
            </Pie>
            <ChartTooltip
              content={
                <ChartTooltipContent
                  nameKey="id"
                  formatter={(value) => formatValue(Number(value))}
                />
              }
            />
          </PieChart>
        </ChartContainer>
      );
    }

    if (activeChartType === "combo") {
      const comboData = chartData.map((d: ChartDatum) => ({
        label: d.label,
        primary: d.primary,
        secondary: d.secondary,
      }));
      return (
        <ComboChart
          data={comboData}
          primaryKey={config.primaryMetric}
          secondaryKey={secondaryMetric}
          showAverage={true}
        />
      );
    }

    if (activeChartType === "stacked_bar") {
      const keys = secondaryMetric
        ? [config.primaryMetric, secondaryMetric]
        : [config.primaryMetric];
      const stackedData = chartData.map((d: ChartDatum) => ({
        label: d.label,
        [config.primaryMetric]: d.primary,
        ...(secondaryMetric
          ? { [secondaryMetric]: d.secondary || 0 }
          : {}),
      }));
      return <StackedBarChart data={stackedData} keys={keys} />;
    }

    return null;
  };

  return (
    <WidgetCard
      title={config.name || "Custom Chart"}
      description={config.groupBy && config.groupBy !== "none" && !groupBy ? "Saved grouping is unavailable. Showing a time series." : `Analysis of ${config.primaryMetric}`}
      isLoading={isLoading}
      error={error}
      onSettings={onEdit}
      action={
        <ChartTypeSwitcher
          value={activeChartType}
          onChange={setActiveChartType}
          allowedTypes={allowedTypes}
        />
      }
    >
      {!supportedMetric ? (
        <WidgetEmptyState title="Metric unavailable" description="Edit this chart to select an available metric." />
      ) : isEmpty ? (
        <WidgetEmptyState
          title="No data for this chart"
          description="Try adjusting metrics, groupings, or the date range"
        />
      ) : (
        <div className="h-[300px] w-full">{renderChart()}</div>
      )}
    </WidgetCard>
  );
}
