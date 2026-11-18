import { useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { useFormatters } from "@/contexts/SettingsContext";

interface WeeklyChartProps {
  data: Array<{ date: string; value: number }>;
  color?: string;
  height?: number;
  title?: string;
}

export default function WeeklyChart({
  data,
  color = "hsl(var(--chart-1))",
  height = 200,
  title = "Weekly financial data",
}: WeeklyChartProps) {
  const { formatCurrency, formatDate } = useFormatters();

  // Generate accessible description of the chart data
  const chartDescription = useMemo(() => {
    if (!data || data.length === 0) return "No data available";
    const firstValue = data[0]?.value ?? 0;
    const lastValue = data[data.length - 1]?.value ?? 0;
    const trend = lastValue > firstValue ? "increased" : lastValue < firstValue ? "decreased" : "remained stable";
    return `${title}. Values ${trend} from ${formatCurrency(firstValue)} to ${formatCurrency(lastValue)} over ${data.length} data points.`;
  }, [data, formatCurrency, title]);

  return (
    <div
      style={{ height }}
      role="img"
      aria-label={chartDescription}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} aria-hidden="true">
          <defs>
            <linearGradient id="gradientColor" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tickFormatter={(val) =>
              new Date(val).toLocaleDateString(undefined, { weekday: "short" })
            }
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
            dy={10}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              borderColor: "hsl(var(--border))",
              borderRadius: "var(--radius)",
              boxShadow: "var(--shadow-md)",
            }}
            formatter={(val: number) => [formatCurrency(val), "Value"]}
            labelFormatter={(label) => formatDate(label)}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            fill="url(#gradientColor)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
      {/* Screen reader accessible data table (visually hidden) */}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point, index) => (
            <tr key={index}>
              <td>{formatDate(point.date)}</td>
              <td>{formatCurrency(point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
