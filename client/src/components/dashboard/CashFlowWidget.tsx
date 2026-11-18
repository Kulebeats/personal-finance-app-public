import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { useFormatters } from "@/contexts/SettingsContext";
import { useReportsCashflow, useLastNMonthsRange } from "@/hooks/use-reports";
import { Loader2, TrendingUp, AlertCircle, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { toMoneyNumber } from "@/lib/money";

/**
 * Parse ISO date string as local date to avoid timezone shifts
 */
function parseLocalDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export default function CashFlowWidget() {
  const { formatCurrency } = useFormatters();
  const { from, to } = useLastNMonthsRange(6);

  const { data: cashflowData, isLoading, error } = useReportsCashflow({
    from,
    to,
    interval: "month",
  });

  // Transform data for chart
  const chartData = cashflowData?.series.map((item) => ({
    name: parseLocalDate(item.periodStart).toLocaleDateString("en-US", {
      month: "short",
    }),
    income: toMoneyNumber(item.income),
    expenses: Math.abs(toMoneyNumber(item.expenses)),
  })) ?? [];

  // Get latest month's totals for header display
  const latestMonth = cashflowData?.series[cashflowData.series.length - 1];
  const displayIncome = toMoneyNumber(latestMonth?.income ?? 0);
  const displayExpenses = Math.abs(toMoneyNumber(latestMonth?.expenses ?? 0));

  if (isLoading) {
    return (
      <Card className="col-span-1 shadow-sm border-border/50 bg-card hover:shadow-md transition-shadow duration-300">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Cash Flow</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[260px]">
          <output aria-live="polite" aria-label="Loading cash flow data">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </output>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="col-span-1 shadow-sm border-border/50 bg-card hover:shadow-md transition-shadow duration-300">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Cash Flow</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center h-[260px] gap-2">
          <AlertCircle className="w-8 h-8 text-destructive" />
          <p className="text-sm text-muted-foreground">Failed to load data</p>
        </CardContent>
      </Card>
    );
  }

  if (!chartData.length) {
    return (
      <Card className="col-span-1 shadow-sm border-border/50 bg-card hover:shadow-md transition-shadow duration-300">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Cash Flow</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center h-[260px] gap-2">
          <TrendingUp className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="col-span-1 shadow-sm border-border/50 bg-card hover:shadow-md transition-shadow duration-300">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Cash Flow</CardTitle>
        <div className="flex gap-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowUpRight className="w-3 h-3 text-emerald-500" aria-hidden="true" />
                <div className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true"></div>
                In
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowDownRight className="w-3 h-3 text-rose-500" aria-hidden="true" />
                <div className="w-2 h-2 rounded-full bg-rose-500" aria-hidden="true"></div>
                Out
            </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex justify-between items-end mb-4">
            <div>
                <span className="text-xs text-muted-foreground block mb-1">Income</span>
                <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(displayIncome)}</div>
            </div>
            <div className="text-right">
                <span className="text-xs text-muted-foreground block mb-1">Expenses</span>
                <div className="text-xl font-bold text-rose-600 dark:text-rose-400">{formatCurrency(displayExpenses)}</div>
            </div>
        </div>
        <div className="h-[180px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} barGap={4}>
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                dy={10}
              />
              <Tooltip
                cursor={{ fill: 'transparent' }}
                contentStyle={{
                    backgroundColor: 'hsl(var(--popover))',
                    borderColor: 'hsl(var(--border))',
                    borderRadius: 'var(--radius)',
                    boxShadow: 'var(--shadow-md)'
                }}
                formatter={(value: number, name: string) => [
                  formatCurrency(value),
                  name === 'income' ? 'Income' : 'Expenses'
                ]}
              />
              <Bar dataKey="income" fill="hsl(var(--chart-income))" radius={[4, 4, 0, 0]} maxBarSize={40} />
              <Bar dataKey="expenses" fill="hsl(var(--chart-expense))" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
