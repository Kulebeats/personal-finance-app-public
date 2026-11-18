import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useFXAttribution, useFXHistorical } from "@/hooks/useInvestments";
import { useFormat } from "@/hooks/use-format";
import { TrendingUp, TrendingDown, RefreshCcw, Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  Legend,
} from "recharts";
import { FXHistoryChart } from "./FXHistoryChart";
import { FXAttributionTable } from "./FXAttributionTable";

// Using CSS variables for dark mode support
const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-income))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
];

export function FXImpactPanel() {
  const { data: attribution, isLoading: attributionLoading } =
    useFXAttribution();
  const { data: fxHistory, isLoading: historyLoading } = useFXHistorical(
    "USD",
    "ZMW",
    30,
  );
  const { formatCurrency } = useFormat();

  if (attributionLoading) {
    return <Skeleton className="w-full h-[400px]" />;
  }

  if (!attribution || attribution.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>FX Impact Analysis</CardTitle>
          <CardDescription>
            See how currency fluctuations affect your portfolio returns.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            No attribution data available. Ensure you have holdings with cost
            basis.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Calculate totals
  const totalCostBasis = attribution.reduce(
    (sum, item) => sum + item.costBasis,
    0,
  );
  const totalGain = attribution.reduce((sum, item) => sum + item.totalGain, 0);
  const totalAssetReturn = attribution.reduce(
    (sum, item) => sum + item.assetReturn,
    0,
  );
  const totalFxReturn = attribution.reduce(
    (sum, item) => sum + item.fxReturn,
    0,
  );

  const totalReturnPercent =
    totalCostBasis > 0 ? (totalGain / totalCostBasis) * 100 : 0;

  // Calculate Currency Exposure
  const currencyExposure = attribution.reduce(
    (acc, item) => {
      acc[item.currency] = (acc[item.currency] || 0) + item.currentValue;
      return acc;
    },
    {} as Record<string, number>,
  );

  const exposureData = Object.entries(currencyExposure).map(
    ([name, value]) => ({
      name,
      value,
    }),
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            <Card className="bg-primary/5 border-primary/20 col-span-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Return (ZMW)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-2">
                  {formatCurrency(totalGain)}
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      totalReturnPercent >= 0
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {totalReturnPercent >= 0 ? "+" : ""}
                    {totalReturnPercent.toFixed(2)}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Combined Asset & FX Performance
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  Asset Performance
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="h-3 w-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="w-[200px] text-xs">
                          Gain/Loss from price changes of the underlying assets,
                          excluding currency effects.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(totalAssetReturn)}
                </div>
                <div className="flex items-center text-xs text-muted-foreground mt-1">
                  <TrendingUp className="h-3 w-3 mr-1" />
                  Price Movement Impact
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  FX Impact
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <RefreshCcw className="h-3 w-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="w-[200px] text-xs">
                          Gain/Loss purely from exchange rate fluctuations (e.g.
                          USD vs ZMW).
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${
                    totalFxReturn < 0 ? "text-red-500" : "text-emerald-500"
                  }`}
                >
                  {formatCurrency(totalFxReturn)}
                </div>
                <div className="flex items-center text-xs text-muted-foreground mt-1">
                  <TrendingDown className="h-3 w-3 mr-1" />
                  Currency Fluctuation Impact
                </div>
              </CardContent>
            </Card>
          </div>

          <FXHistoryChart data={fxHistory} isLoading={historyLoading} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Currency Exposure</CardTitle>
            <CardDescription>Portfolio value by currency</CardDescription>
          </CardHeader>
          <CardContent className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={exposureData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {exposureData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <RechartsTooltip
                  formatter={(value: number) => formatCurrency(value)}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <FXAttributionTable
        attribution={attribution}
        formatCurrency={formatCurrency}
      />
    </div>
  );
}
