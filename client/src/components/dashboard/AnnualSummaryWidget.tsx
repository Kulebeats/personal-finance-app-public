import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import { useFormatters } from "@/contexts/SettingsContext";
import { useReportsAnnual } from "@/hooks/use-reports";
import { toMoneyNumber } from "@/lib/money";
import { cn } from "@/lib/utils";
import { WidgetErrorState } from "./WidgetErrorState";

/**
 * Editorial-styled Annual Summary Widget
 *
 * Design: Refined typographic hierarchy with Art Deco flourishes
 * - Fraunces display font for large currency values
 * - Sophisticated color palette (teal/terracotta/indigo vs generic green/red)
 * - Staggered entrance animations
 * - Geometric accent elements
 */
export default function AnnualSummaryWidget() {
  const { formatCurrency } = useFormatters();
  const currentYear = new Date().getFullYear();

  const { data: annualData, isLoading, error, refetch } = useReportsAnnual({
    year: currentYear,
    compareYear: currentYear - 1,
  });

  if (isLoading) {
    return (
      <Card className="h-full widget-editorial border-border/30 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-xs font-body text-muted-foreground tracking-wide">
            Loading annual data...
          </span>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <WidgetErrorState
        title="Unable to load annual summary"
        message="We couldn't fetch annual report data."
        onRetry={() => refetch()}
        className="h-full"
      />
    );
  }

  const { income, expenses, savingsContributions } = annualData?.totals ?? {
    income: 0,
    expenses: 0,
    savingsContributions: 0,
  };
  const incomeValue = toMoneyNumber(income);
  const expensesValue = toMoneyNumber(expenses);
  const savingsValue = toMoneyNumber(savingsContributions);
  const { incomeChangePct, expensesChangePct, savingsContributionsChangePct } =
    annualData?.comparison ?? {
      incomeChangePct: 0,
      expensesChangePct: 0,
      savingsContributionsChangePct: 0,
    };

  const formatPercent = (val: number) => {
    const absVal = Math.abs(val);
    if (absVal === 0) return "0%";
    return `${val > 0 ? "+" : ""}${Math.round(val)}%`;
  };

  // Metric configuration with sophisticated colors
  const metrics = [
    {
      label: "Income",
      value: incomeValue,
      change: incomeChangePct,
      isPositiveGood: true,
      colorClass: "text-[hsl(var(--widget-income))]",
      bgClass: "bg-[hsl(var(--widget-income-light))]",
      borderClass: "border-[hsl(var(--widget-income)/0.2)]",
      icon: "↗",
    },
    {
      label: "Expenses",
      value: expensesValue,
      change: expensesChangePct,
      isPositiveGood: false,
      colorClass: "text-[hsl(var(--widget-expense))]",
      bgClass: "bg-[hsl(var(--widget-expense-light))]",
      borderClass: "border-[hsl(var(--widget-expense)/0.2)]",
      icon: "↘",
    },
    {
      label: "Saved",
      value: savingsValue,
      change: savingsContributionsChangePct,
      isPositiveGood: true,
      colorClass: "text-[hsl(var(--widget-savings))]",
      bgClass: "bg-[hsl(var(--widget-savings-light))]",
      borderClass: "border-[hsl(var(--widget-savings)/0.2)]",
      icon: "◆",
    },
  ];

  return (
    <Card className="h-full widget-editorial border-border/30 hover-lift flex flex-col overflow-hidden">
      {/* Art Deco corner flourish */}
      <div className="widget-flourish" />

      <CardHeader className="pb-3 pt-5 px-5 relative z-10">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-lg font-semibold tracking-tight text-foreground">
            {currentYear} Summary
          </h3>
          <span className="font-body text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            Year to date
          </span>
        </div>
        {/* Elegant separator line */}
        <div className="mt-3 h-px bg-gradient-to-r from-[hsl(var(--widget-gold)/0.5)] via-[hsl(var(--border))] to-transparent" />
      </CardHeader>

      <CardContent className="flex-1 px-5 pb-5 flex flex-col justify-between gap-3">
        {metrics.map((metric, index) => {
          const isGood = metric.isPositiveGood
            ? metric.change >= 0
            : metric.change <= 0;

          return (
            <div
              key={metric.label}
              className={cn(
                "relative flex items-center gap-4 p-4 rounded-xl border transition-all duration-300",
                "animate-count-up opacity-0",
                metric.bgClass,
                metric.borderClass,
                `stagger-${index + 1}`
              )}
              style={{ animationFillMode: "forwards" }}
            >
              {/* Metric icon */}
              <div
                className={cn(
                  "flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center",
                  "bg-white/60 dark:bg-black/20 backdrop-blur-sm"
                )}
              >
                <span className={cn("font-display text-xl", metric.colorClass)}>
                  {metric.icon}
                </span>
              </div>

              {/* Metric content */}
              <div className="flex-1 min-w-0">
                <p className="font-body text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1">
                  {metric.label}
                </p>
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span
                    className={cn(
                      "font-display text-2xl font-semibold tracking-tight",
                      metric.colorClass
                    )}
                  >
                    {formatCurrency(metric.value)}
                  </span>

                  {/* Change indicator */}
                  <div
                    className={cn(
                      "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-body font-medium",
                      isGood
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                    )}
                  >
                    {isGood ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : (
                      <TrendingDown className="w-3 h-3" />
                    )}
                    <span>{formatPercent(metric.change)}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Net position indicator */}
        <div className="mt-auto pt-3 border-t border-dashed border-[hsl(var(--widget-gold)/0.3)]">
          <div className="flex items-center justify-between">
            <span className="font-body text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              Net Position
            </span>
            <span
              className={cn(
                "font-display text-lg font-semibold",
                incomeValue - expensesValue >= 0
                  ? "text-[hsl(var(--widget-income))]"
                  : "text-[hsl(var(--widget-expense))]"
              )}
            >
              {incomeValue - expensesValue >= 0 ? "+" : ""}
              {formatCurrency(incomeValue - expensesValue)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
