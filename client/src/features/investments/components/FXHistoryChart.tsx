import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { History } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";

interface FXHistoryChartProps {
  data?: { date: string; rate: number }[];
  isLoading: boolean;
}

export function FXHistoryChart({ data, isLoading }: FXHistoryChartProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <History className="h-4 w-4" /> USD/ZMW Trend (30d)
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[180px] w-full pt-4">
        {isLoading ? (
          <Skeleton className="w-full h-full" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="colorFx" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="hsl(var(--chart-1))"
                    stopOpacity={0.1}
                  />
                  <stop
                    offset="95%"
                    stopColor="hsl(var(--chart-1))"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="hsl(var(--muted))"
              />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tickFormatter={(val) =>
                  new Date(val).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                  })
                }
                tick={{
                  fontSize: 10,
                  fill: "hsl(var(--muted-foreground))",
                }}
              />
              <YAxis
                domain={["auto", "auto"]}
                axisLine={false}
                tickLine={false}
                tick={{
                  fontSize: 10,
                  fill: "hsl(var(--muted-foreground))",
                }}
              />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
                labelFormatter={(val) => new Date(val).toLocaleDateString()}
              />
              <Area
                type="monotone"
                dataKey="rate"
                stroke="hsl(var(--chart-1))"
                fillOpacity={1}
                fill="url(#colorFx)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
