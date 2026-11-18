import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Loader2 } from "lucide-react";
import { getCurrencySymbol } from "@/lib/format";

interface ChartDataPoint {
  date: string;
  value: number;
}

interface AccountBalanceChartProps {
  data: ChartDataPoint[];
  isLoading: boolean;
  currency: string;
}

export function AccountBalanceChart({
  data,
  isLoading,
  currency,
}: AccountBalanceChartProps) {
  const currencySymbol = getCurrencySymbol(currency || "ZMW");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[240px]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // LOW-002: Use CSS variable for dark mode support
  const chartColor = "hsl(var(--primary))";

  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="colorBal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={chartColor} stopOpacity={0.1} />
              <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{
              fontSize: 12,
              fill: "hsl(var(--muted-foreground))",
            }}
            dy={10}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{
              fontSize: 12,
              fill: "hsl(var(--muted-foreground))",
            }}
            tickFormatter={(val) =>
              `${currencySymbol}${(val / 1000).toFixed(0)}k`
            }
          />
          <Tooltip
            contentStyle={{
              borderRadius: "8px",
              border: "1px solid hsl(var(--border))",
              backgroundColor: "hsl(var(--card))",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            }}
            labelStyle={{ color: "hsl(var(--foreground))" }}
            formatter={(value: number) => [
              `${currencySymbol}${value.toLocaleString(undefined, {
                minimumFractionDigits: 2,
              })}`,
              "Balance",
            ]}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={chartColor}
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorBal)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
