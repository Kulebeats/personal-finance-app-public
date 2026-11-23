import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useFXAttribution, useFXHistorical } from "@/hooks/useInvestments";
import { useFormat } from "@/hooks/use-format";
import { FX_ATTRIBUTION_CURRENCY } from "@/hooks/investments/types";
import Decimal from "decimal.js";
import { moneyValueToDecimal, sumMoneyValues, toMoneyNumber } from "@/lib/money";
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
  // Attribution amounts are in the server's FX base, never the display currency (A-31).
  // They arrive as MoneyDto (defect 10); a number appears only for display.
  const formatFx = (value: Decimal) => formatCurrency(toMoneyNumber(value.toFixed(2)), FX_ATTRIBUTION_CURRENCY);

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

  // Totals in Decimal from the MoneyDto amounts, never float sums (defect 10).
  const totalCostBasis = sumMoneyValues(attribution.map((item) => item.costBasis));
  const totalGain = sumMoneyValues(attribution.map((item) => item.totalGain));
  const totalAssetReturn = sumMoneyValues(attribution.map((item) => item.assetReturn));
  const totalFxReturn = sumMoneyValues(attribution.map((item) => item.fxReturn));

  const totalReturnPercent = totalCostBasis.greaterThan(0)
    ? totalGain.dividedBy(totalCostBasis).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
    : 0;

  // Currency exposure: ZMW value per security currency, summed in Decimal.
  const currencyExposure = attribution.reduce<Record<string, Decimal>>(
    (acc, item) => ({
      ...acc,
      [item.currency]: (acc[item.currency] ?? new Decimal(0)).plus(moneyValueToDecimal(item.currentValue)),
    }),
    {},
  );

  // The chart takes numbers; they are display values only.
  const exposureData = Object.entries(currencyExposure).map(
    ([name, value]) => ({
      name,
      value: toMoneyNumber(value.toFixed(2)),
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
                  Total Return ({FX_ATTRIBUTION_CURRENCY})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-2">
                  {formatFx(totalGain)}
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
                  {formatFx(totalAssetReturn)}
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
                    totalFxReturn.isNegative() ? "text-red-500" : "text-emerald-500"
                  }`}
                >
                  {formatFx(totalFxReturn)}
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
                  formatter={(value: number) => formatCurrency(value, FX_ATTRIBUTION_CURRENCY)}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <FXAttributionTable
        attribution={attribution}
        formatAmount={formatFx}
      />
    </div>
  );
}
