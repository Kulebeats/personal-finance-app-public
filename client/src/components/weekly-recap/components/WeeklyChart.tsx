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
import { formatCapturedWorth, snapshotCalendarDate } from "../formatCapturedWorth";

interface WeeklyChartProps {
  data: Array<{ date: string; value: number; currency?: string }>;
  currency?: string;
  color?: string;
  height?: number;
  title?: string;
}

export default function WeeklyChart({
  data,
  color = "hsl(var(--chart-1))",
  height = 200,
  title = "Weekly financial data",
  currency,
}: WeeklyChartProps) {
  const { formatCurrency, formatDate } = useFormatters();

  // Generate accessible description of the chart data
  const chartDescription = useMemo(() => {
    if (!data || data.length === 0) return "No data available";
    const firstValue = data[0]?.value ?? 0;
    const lastValue = data[data.length - 1]?.value ?? 0;
    const trend = lastValue > firstValue ? "increased" : lastValue < firstValue ? "decreased" : "remained stable";
    const first = data[0], last = data[data.length - 1];
    return `${title}. Values ${trend} from ${formatCapturedWorth(firstValue, first.currency || currency, formatCurrency)} on ${formatDate(snapshotCalendarDate(first.date))} to ${formatCapturedWorth(lastValue, last.currency || currency, formatCurrency)} on ${formatDate(snapshotCalendarDate(last.date))} over ${data.length} data points.`;
  }, [data, formatCurrency, formatDate, title, currency]);

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
              snapshotCalendarDate(val).toLocaleDateString(undefined, { weekday: "short" })
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
            formatter={(val: number, _name, item) => [formatCapturedWorth(val, item.payload?.currency || currency, formatCurrency), "Value"]}
            labelFormatter={(label) => formatDate(snapshotCalendarDate(String(label)))}
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
              <td>{formatDate(snapshotCalendarDate(point.date))}</td>
              <td>{formatCapturedWorth(point.value, point.currency || currency, formatCurrency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
