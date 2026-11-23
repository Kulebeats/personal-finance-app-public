import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { useFormatters } from "@/contexts/SettingsContext";
import {
  useReportsCashflow,
  useCurrentMonthRange,
  useLastNMonthsRange,
  useCurrentYearRange,
} from "@/hooks/use-reports";
import { toMoneyNumber } from "@/lib/money";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { WidgetErrorState } from "./WidgetErrorState";

export default function DashboardBudgetWidget() {
  const { formatCurrency } = useFormatters();
  const { from: monthFrom, to: monthTo } = useCurrentMonthRange();
  const { from: last3From, to: last3To } = useLastNMonthsRange(3);
  const { from: yearFrom, to: yearTo, year } = useCurrentYearRange();
  const [rangeKey, setRangeKey] = useState<"month" | "last3" | "ytd">("month");

  const rangeOptions = {
    month: {
      label: new Date().toLocaleString("default", {
        month: "long",
        year: "numeric",
      }),
      from: monthFrom,
      to: monthTo,
    },
    last3: {
      label: "Last 3 months",
      from: last3From,
      to: last3To,
    },
    ytd: {
      label: `YTD ${year}`,
      from: yearFrom,
      to: yearTo,
    },
  };

  const selectedRange = rangeOptions[rangeKey];

  const { data, isLoading, error, refetch } = useReportsCashflow({
    from: selectedRange.from,
    to: selectedRange.to,
    interval: "month",
  });

  const income = toMoneyNumber(data?.totals.income ?? 0);
  const expenses = Math.abs(toMoneyNumber(data?.totals.expenses ?? 0));
  const netFlow = income - expenses;
  const savingsRate =
    income > 0 ? Math.round((netFlow / income) * 100) : 0;

  // Calculate percentages for progress bars
  // Cap at 100% for visual sanity if expenses exceed income or income is 0
  const incomePercent = 100; // Income is always full bar relative to itself
  const expensePercent =
    income > 0
      ? Math.min((expenses / income) * 100, 100)
      : expenses > 0
      ? 100
      : 0;

  if (isLoading) {
    return (
      <Card className="shadow-sm border-border/50 bg-card h-full flex flex-col justify-center items-center p-6">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (error) {
    return (
      <WidgetErrorState
        title="Unable to load budget summary"
        message="We couldn't fetch income and expense totals."
        onRetry={() => refetch()}
        className="shadow-sm border-border/50 h-full"
      />
    );
  }

  return (
    <Card className="shadow-sm border-border/50 bg-card h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0 shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-6 w-1 bg-emerald-500 rounded-full"></div>
          <CardTitle className="text-lg font-bold text-foreground">
            Budget{" "}
            <span className="text-muted-foreground font-normal ml-1">
              {selectedRange.label}
            </span>
          </CardTitle>
        </div>
        <div className="flex items-center gap-3">
          {/* Audit v2 P2: this widget had no way to drill into the Budget
              page - link out, matching the "View All" convention used by
              sibling dashboard widgets. */}
          <Link
            href="/budget"
            className="group flex items-center gap-1 text-xs font-medium text-primary hover:underline max-md:min-h-11"
          >
            View Budget
            <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <Select
            value={rangeKey}
            onValueChange={(value) =>
              setRangeKey(value as "month" | "last3" | "ytd")
            }
          >
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">This month</SelectItem>
              <SelectItem value="last3">Last 3 months</SelectItem>
              <SelectItem value="ytd">YTD</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-8 mt-2">
        {/* Income */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm font-medium">
            <span>Income</span>
          </div>
          <div className="h-3 w-full bg-muted/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.3)]"
              style={{ width: `${incomePercent}%` }}
            />
          </div>
          <div className="text-sm font-bold text-foreground mt-1">
            {formatCurrency(income)}{" "}
            <span className="font-medium text-muted-foreground">earned</span>
          </div>
        </div>

        {/* Expenses */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm font-medium">
            <span>Expenses</span>
          </div>
          <div className="h-3 w-full bg-muted/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.3)] transition-all duration-500"
              style={{ width: `${expensePercent}%` }}
            />
          </div>
          <div className="text-sm font-bold text-foreground mt-1">
            {formatCurrency(expenses)}{" "}
            <span className="font-medium text-muted-foreground">spent</span>
          </div>
        </div>

        {/* Net */}
        <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Net cashflow</span>
            <span
              className={
                netFlow >= 0
                  ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                  : "text-rose-600 dark:text-rose-400 font-semibold"
              }
            >
              {netFlow >= 0 ? "+" : ""}
              {formatCurrency(netFlow)}
            </span>
          </div>
          <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
            <span>Savings rate</span>
            <span className="font-medium">{savingsRate}%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
