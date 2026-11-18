import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertCircle, Loader2 } from "lucide-react";
import { NetWorthPoint } from "../types";

interface NetWorthChartProps {
  data: NetWorthPoint[];
  currentNetWorth: number;
  isLoading: boolean;
  children?: React.ReactNode; // For the filters (e.g. TimeRangeSelector)
}

export function NetWorthChart({
  data,
  currentNetWorth,
  isLoading,
  children,
}: NetWorthChartProps) {
  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-6">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Net Worth{" "}
            <span aria-label="Net worth is calculated from all your accounts">
              <AlertCircle className="w-3 h-3" aria-hidden="true" />
            </span>
          </div>
          <div className="flex items-baseline gap-3">
            <h1 className="text-3xl font-bold text-foreground">
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                  <span className="sr-only">Loading net worth</span>
                </span>
              ) : (
                `K${currentNetWorth.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`
              )}
            </h1>
          </div>
        </div>
        <div className="flex gap-2">{children}</div>
      </div>

      <div className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            {/* LOW-001: Use CSS variable-friendly colors for dark mode support */}
            <defs>
              <linearGradient id="colorNw" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="hsl(var(--primary))"
                  stopOpacity={0.15}
                />
                <stop
                  offset="95%"
                  stopColor="hsl(var(--primary))"
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              dy={10}
              interval={1}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(val) => `K${(val / 1000).toFixed(0)}K`}
              dx={-10}
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
                `K${value.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}`,
                "Net Worth",
              ]}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="hsl(var(--primary))"
              strokeWidth={3}
              fillOpacity={1}
              fill="url(#colorNw)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
