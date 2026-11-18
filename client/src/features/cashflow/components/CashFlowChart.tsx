import { useMemo, useState, useEffect, Suspense, lazy } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, TrendingUp, ArrowUpRight, ArrowDownRight, Smartphone } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
  Tooltip,
} from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { type useCashFlowData } from "../hooks/useCashFlowData";
import { CASH_FLOW_CHART_COLORS } from "./chartTokens";

// The nivo Sankey bundle is heavy and only needed for the Sankey view, so it
// is split into its own chunk and fetched on demand when that view is shown.
const CashFlowSankey = lazy(() => import("./CashFlowSankey"));

// Type for our bar chart data with forecast info stored separately
type BarChartDataItem = {
  month: string;
  income: number;
  expenses: number;
  savings: number;
  periodStart: string;
  isForecast: boolean;
};

// Nivo-compatible data type (without isForecast in the index)
type NivoBarData = {
  month: string;
  income: number;
  expenses: number;
  savings: number;
  periodStart: string;
};

interface CashFlowChartProps {
  view: "bar" | "sankey";
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  barChartData: ReturnType<typeof useCashFlowData>["barChartData"];
  sankeyChartData: ReturnType<typeof useCashFlowData>["sankeyChartData"];
  totals?: { income: number; expenses: number; savings: number; savingsRate: number };
  dateRange?: { from: string; to: string };
  formatCurrency?: (value: number) => string;
  hasForecast?: boolean;
}

// Check if any bar data contains forecast items
function hasAnyForecast(data: BarChartDataItem[]): boolean {
  return data.some((item) => item.isForecast);
}

export function CashFlowChart({
  view,
  isLoading,
  error,
  refetch,
  barChartData,
  sankeyChartData,
  hasForecast,
}: CashFlowChartProps) {
  const showForecastLegend = hasForecast || hasAnyForecast(barChartData);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Create a map for quick forecast lookup by month
  const forecastMap = useMemo(() => {
    const map = new Map<string, boolean>();
    barChartData.forEach((item) => {
      map.set(item.month, item.isForecast);
    });
    return map;
  }, [barChartData]);

  // Transform data to Nivo-compatible format (strip isForecast)
  const nivoBarData: NivoBarData[] = useMemo(() => {
    return barChartData.map(({ isForecast: _, ...rest }) => rest);
  }, [barChartData]);

  const barConfig = {
    income: { label: "Income", color: CASH_FLOW_CHART_COLORS.income },
    expenses: { label: "Expenses", color: CASH_FLOW_CHART_COLORS.expense },
  } satisfies ChartConfig;

  return (
    <Card className="p-6 border-border shadow-sm h-[500px] flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-semibold text-lg">
          {view === "bar" ? "Income vs Expenses" : "Cash Flow Diagram"}
        </h3>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <ArrowUpRight className="w-3 h-3 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
            <div className="w-3 h-3 bg-emerald-500 rounded-sm" aria-hidden="true"></div>
            Income
          </span>
          <span className="flex items-center gap-1">
            <ArrowDownRight className="w-3 h-3 text-rose-500 dark:text-rose-400" aria-hidden="true" />
            <div className="w-3 h-3 bg-rose-500 rounded-sm" aria-hidden="true"></div>
            Expenses
          </span>
          {showForecastLegend && (
            <span className="flex items-center gap-1 border-l pl-3 ml-1 border-border">
              <div className="w-3 h-3 rounded-sm bg-gradient-to-r from-emerald-300 to-rose-300 opacity-60" aria-hidden="true"></div>
              Forecast
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 w-full">
        {isLoading ? (
          <output className="flex items-center justify-center h-full" aria-live="polite" aria-label="Loading chart data">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </output>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <AlertCircle className="w-12 h-12 text-destructive" />
            <div className="text-center">
              <p className="font-medium text-foreground">Failed to load data</p>
              <p className="text-sm text-muted-foreground">
                There was an error loading your cash flow data.
              </p>
            </div>
            <Button variant="outline" onClick={() => refetch()}>
              Try Again
            </Button>
          </div>
        ) : view === "bar" && barChartData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <TrendingUp className="w-12 h-12 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium text-foreground">No cash flow data</p>
              <p className="text-sm text-muted-foreground">
                No transactions found for the selected period.
              </p>
            </div>
          </div>
        ) : view === "bar" ? (
          <ChartContainer
            config={barConfig}
            className="h-full w-full"
            role="application"
            aria-label="Cash flow bar chart"
          >
            <BarChart
              data={nivoBarData}
              margin={{ top: 20, right: 30, bottom: 20, left: 10 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} />
              <YAxis
                tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)}k`}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const isForecast = forecastMap.get(String(label)) ?? false;
                  return (
                    <div className="bg-popover text-popover-foreground text-xs px-2 py-1 rounded border border-border shadow-md">
                      {payload.map((p) => (
                        <div key={String(p.dataKey)}>
                          <strong className="capitalize">
                            {String(p.dataKey)}
                          </strong>
                          : {Number(p.value).toLocaleString()}
                        </div>
                      ))}
                      {isForecast && (
                        <span className="text-muted-foreground">(Projected)</span>
                      )}
                    </div>
                  );
                }}
              />
              <Bar dataKey="income" radius={4}>
                {nivoBarData.map((d) => {
                  const isForecast = forecastMap.get(d.month) ?? false;
                  return (
                    <Cell
                      key={`income-${d.month}`}
                      fill={
                        isForecast
                          ? CASH_FLOW_CHART_COLORS.incomeForecastFill
                          : CASH_FLOW_CHART_COLORS.income
                      }
                      stroke={
                        isForecast
                          ? CASH_FLOW_CHART_COLORS.incomeForecastStroke
                          : "transparent"
                      }
                      strokeWidth={isForecast ? 2 : 0}
                      strokeDasharray={isForecast ? "4 2" : undefined}
                    />
                  );
                })}
              </Bar>
              <Bar dataKey="expenses" radius={4}>
                {nivoBarData.map((d) => {
                  const isForecast = forecastMap.get(d.month) ?? false;
                  return (
                    <Cell
                      key={`expenses-${d.month}`}
                      fill={
                        isForecast
                          ? CASH_FLOW_CHART_COLORS.expenseForecastFill
                          : CASH_FLOW_CHART_COLORS.expense
                      }
                      stroke={
                        isForecast
                          ? CASH_FLOW_CHART_COLORS.expenseForecastStroke
                          : "transparent"
                      }
                      strokeWidth={isForecast ? 2 : 0}
                      strokeDasharray={isForecast ? "4 2" : undefined}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ChartContainer>
        ) : (
          <>
            {isMobile && (
              <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 flex items-start gap-2">
                <Smartphone className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Sankey diagrams are best viewed on larger screens. For a better mobile experience, switch to the Trends view.
                </p>
              </div>
            )}
            <Suspense
              fallback={
                <output
                  className="flex items-center justify-center h-full"
                  aria-live="polite"
                  aria-label="Loading cash flow diagram"
                >
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </output>
              }
            >
              <CashFlowSankey data={sankeyChartData} />
            </Suspense>
          </>
        )}
      </div>
    </Card>
  );
}
