import { Card } from "@/components/ui/card";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { useDisplaySettings } from "@/hooks/use-settings";
import { formatCurrency as formatCurrencyValue } from "@/lib/format";
import { toMoneyNumber } from "@/lib/money";
import type { PerformanceDataPoint } from "@shared/investment-performance";

// P1-5 FIX: Extract type alias for timeframe
type PerformanceTimeframe = "1M" | "3M" | "YTD" | "1Y" | "ALL";

interface InvestmentPerformanceProps {
  data: PerformanceDataPoint[];
  timeframe: PerformanceTimeframe;
  onTimeframeChange: (timeframe: PerformanceTimeframe) => void;
  displayCurrency: string;
  formatCurrency: (amount: number, currency: string) => string;
  totalGainLossPercent: number | null;
}

export function InvestmentPerformance({
  data,
  timeframe,
  onTimeframeChange,
  displayCurrency,
  formatCurrency,
  totalGainLossPercent,
}: InvestmentPerformanceProps) {
  const { data: displaySettings } = useDisplaySettings();
  // Only the chart coordinate is approximate. The tooltip reads the exact DTO.
  const chartData = data.map(point => ({ ...point, plotValue: toMoneyNumber(point.value) }));
  const reportingCurrency = data[0]?.value.currency;

  return (
    <Card className="p-6 shadow-sm border-border">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-lg font-semibold">Portfolio Performance</h3>
          <div className="flex items-center gap-4 mt-1">
            <div className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full bg-primary"></div>
              <span className="text-muted-foreground">
                Your Portfolio ({totalGainLossPercent === null ? "gain/loss unavailable"
                  : `${totalGainLossPercent >= 0 ? "+" : ""}${totalGainLossPercent.toFixed(1)}%`})
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full bg-muted-foreground/50"></div>
              <span className="text-muted-foreground">
                LuSE ASI Benchmark (+12.0%)
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {(["1M", "3M", "YTD", "1Y", "ALL"] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => onTimeframeChange(tf)}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-full transition-colors",
                timeframe === tf
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-muted text-muted-foreground"
              )}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>
      <div className="h-[400px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorPerf" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="hsl(var(--primary))"
                  stopOpacity={0.1}
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
              tick={{
                fontSize: 12,
                fill: "hsl(var(--muted-foreground))",
              }}
              dy={10}
            />
            <YAxis
              hide={false}
              axisLine={false}
              tickLine={false}
              tick={{
                fontSize: 12,
                fill: "hsl(var(--muted-foreground))",
              }}
              tickFormatter={(val) => `${reportingCurrency ?? ""} ${val / 1000}k`.trim()}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                borderRadius: "8px",
                border: "1px solid hsl(var(--border))",
              }}
              itemStyle={{ color: "hsl(var(--foreground))" }}
              formatter={(val: number, name: string, item) => {
                const point = item.payload as PerformanceDataPoint | undefined;
                if (name === "plotValue" && point) {
                  const { amount, currency } = point.value;
                  const label = formatCurrencyValue(amount as `${number}`, currency, displaySettings?.numberFormat);
                  return [label, "Portfolio"];
                }
                return [formatCurrency(val, displayCurrency), "LuSE ASI"];
              }}
            />
            <Area
              type="monotone"
              dataKey="plotValue"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorPerf)"
            />
            <Area
              type="monotone"
              dataKey="benchmark"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={2}
              strokeDasharray="5 5"
              fillOpacity={0}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
