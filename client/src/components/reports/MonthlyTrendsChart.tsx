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
import { ChartType } from "./shared/ChartTypeSwitcher";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  INCOME_COLOR,
  EXPENSE_COLOR,
  NET_WORTH_COLOR,
} from "@/features/reports";

type ChartDatum = {
  label: string;
  income: number;
  expenses: number;
  savings: number;
};

type LineSeries = {
  id: string;
  data: Array<{ x: string; y: number }>;
  color: string;
};

interface MonthlyTrendsChartProps {
  chartType: ChartType;
  chartData: ChartDatum[];
  lineData: LineSeries[];
  formatCurrency: (value: number) => string;
}

const BAR_KEYS = ["income", "expenses", "savings"] as const;
const BAR_COLORS = [INCOME_COLOR, EXPENSE_COLOR, NET_WORTH_COLOR];

const formatAxisValue = (value: number): string =>
  `${(Number(value) / 1000).toFixed(0)}k`;

export function MonthlyTrendsChart({
  chartType,
  chartData,
  lineData,
  formatCurrency,
}: MonthlyTrendsChartProps) {
  if (chartType === "bar" || chartType === "horizontal_bar") {
    const barConfig = BAR_KEYS.reduce((acc, key, index) => {
      acc[key] = { label: key, color: BAR_COLORS[index % BAR_COLORS.length] };
      return acc;
    }, {} as ChartConfig);

    return (
      <ChartContainer config={barConfig} className="w-full h-full">
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
            tickFormatter={(value) => formatAxisValue(Number(value))}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) => formatCurrency(Number(value))}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          {BAR_KEYS.map((key, index) => (
            <Bar
              key={key}
              dataKey={key}
              fill={BAR_COLORS[index % BAR_COLORS.length]}
              radius={4}
            />
          ))}
        </BarChart>
      </ChartContainer>
    );
  }

  if (chartType === "line" || chartType === "area") {
    const lineConfig = lineData.reduce((acc, series) => {
      acc[series.id] = { label: series.id, color: series.color };
      return acc;
    }, {} as ChartConfig);

    const xs = Array.from(
      new Set(lineData.flatMap((s) => s.data.map((p) => String(p.x)))),
    );
    const rows = xs.map((x) => {
      const row: Record<string, string | number> = { x };
      for (const s of lineData) {
        row[s.id] = s.data.find((p) => String(p.x) === x)?.y ?? 0;
      }
      return row;
    });

    const isArea = chartType === "area";

    return (
      <ChartContainer config={lineConfig} className="w-full h-full">
        {isArea ? (
          <AreaChart
            data={rows}
            margin={{ top: 20, right: 30, bottom: 50, left: 60 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="x"
              tickLine={false}
              axisLine={false}
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => formatAxisValue(Number(value))}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => formatCurrency(Number(value))}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            {lineData.map((series) => (
              <Area
                key={series.id}
                dataKey={series.id}
                stroke={series.color}
                fill={series.color}
                fillOpacity={0.15}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            ))}
          </AreaChart>
        ) : (
          <LineChart
            data={rows}
            margin={{ top: 20, right: 30, bottom: 50, left: 60 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="x"
              tickLine={false}
              axisLine={false}
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => formatAxisValue(Number(value))}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => formatCurrency(Number(value))}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            {lineData.map((series) => (
              <Line
                key={series.id}
                dataKey={series.id}
                stroke={series.color}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            ))}
          </LineChart>
        )}
      </ChartContainer>
    );
  }

  return null;
}
