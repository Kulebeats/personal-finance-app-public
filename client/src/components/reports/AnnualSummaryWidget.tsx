import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2,
  TrendingDown,
  TrendingUp,
  Wallet,
  PiggyBank,
  CreditCard,
  Landmark,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { useReportsAnnual, useCurrentYearRange } from "@/hooks/use-reports";
import { useFormatters } from "@/contexts/SettingsContext";
import { cn } from "@/lib/utils";
import { useMemo } from "react";
import { toMoneyNumber } from "@/lib/money";
import {
  INCOME_COLOR,
  EXPENSE_COLOR,
  NET_WORTH_COLOR,
  PRIMARY_CHART_COLOR,
} from "@/features/reports";

// ============================================================================
// MINI SPARKLINE COMPONENT
// ============================================================================

interface SparklineProps {
  data: number[];
  color: string;
  className?: string;
}

function Sparkline({ data, color, className }: SparklineProps) {
  if (!data || data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const height = 24;
  const width = 80;
  const step = width / (data.length - 1);

  const points = data
    .map((value, i) => {
      const x = i * step;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      className={cn("opacity-60", className)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ============================================================================
// SUMMARY CARD COMPONENT
// ============================================================================

interface SummaryCardProps {
  title: string;
  value: number;
  subtitle: string;
  changePct?: number;
  invertChange?: boolean;
  icon: React.ReactNode;
  accentColor: string;
  sparklineData?: number[];
  isLoading?: boolean;
  formatValue: (v: number) => string;
}

function SummaryCard({
  title,
  value,
  subtitle,
  changePct,
  invertChange = false,
  icon,
  accentColor,
  sparklineData,
  isLoading,
  formatValue,
}: SummaryCardProps) {
  const isPositive =
    changePct !== undefined
      ? invertChange
        ? changePct <= 0
        : changePct >= 0
      : true;

  const displayChange =
    changePct !== undefined
      ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%`
      : null;

  return (
    <Card
      className={cn(
        "relative overflow-hidden group",
        "bg-linear-to-br from-card/80 to-card/40",
        "backdrop-blur-xl border-white/10",
        "shadow-lg shadow-black/5",
        "hover:shadow-xl hover:shadow-black/10",
        "hover:scale-[1.02]",
        "transition-all duration-300 ease-out",
      )}
    >
      {/* Accent glow */}
      <div
        className="absolute -top-12 -right-12 w-32 h-32 rounded-full blur-3xl opacity-20 group-hover:opacity-30 transition-opacity"
        style={{ backgroundColor: accentColor }}
      />

      <CardContent className="p-5 relative">
        {/* Header: Icon + Change Badge */}
        <div className="flex items-center justify-between mb-4">
          <div
            className="p-2.5 rounded-xl"
            style={{
              backgroundColor: `${accentColor}15`,
              boxShadow: `0 0 20px ${accentColor}10`,
            }}
          >
            {icon}
          </div>

          {displayChange && (
            <div
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold",
                isPositive
                  ? "bg-emerald-500/15 text-emerald-500"
                  : "bg-rose-500/15 text-rose-500",
              )}
            >
              {isPositive ? (
                <ArrowUpRight className="w-3.5 h-3.5" />
              ) : (
                <ArrowDownRight className="w-3.5 h-3.5" />
              )}
              {displayChange}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground/80 uppercase tracking-widest">
            {title}
          </p>
          <div className="flex items-end justify-between gap-2">
            <h3 className="text-2xl font-bold tracking-tight text-foreground">
              {isLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              ) : (
                formatValue(value)
              )}
            </h3>
            {sparklineData && sparklineData.length > 0 && (
              <Sparkline data={sparklineData} color={accentColor} />
            )}
          </div>
          <p className="text-xs text-muted-foreground/60">{subtitle}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function AnnualSummaryWidget() {
  const { year } = useCurrentYearRange();
  const { formatCurrency } = useFormatters();
  const { data, isLoading } = useReportsAnnual({
    year,
    compareYear: year - 1,
  });

  const totals = data?.totals;
  const totalsValue = {
    income: toMoneyNumber(totals?.income ?? 0),
    expenses: toMoneyNumber(totals?.expenses ?? 0),
    savingsContributions: toMoneyNumber(totals?.savingsContributions ?? 0),
    netSavings: toMoneyNumber(totals?.netSavings ?? 0),
    debtPaid: toMoneyNumber(totals?.debtPaid ?? 0),
    netWorth: toMoneyNumber(totals?.netWorth ?? 0),
    savingsRate: totals?.savingsRate ?? 0,
    netSavingsRate: totals?.netSavingsRate ?? 0,
    totalNetWorthChange: toMoneyNumber(totals?.totalNetWorthChange ?? 0),
    avgMonthlyNetWorthChange: toMoneyNumber(
      totals?.avgMonthlyNetWorthChange ?? 0,
    ),
  };
  const comparison = data?.comparison;
  const monthsInRange = data?.monthsInRange ?? 12;
  const monthly = data?.monthly ?? [];

  // Extract sparkline data from monthly series
  const sparklines = useMemo(
    () => ({
      income: monthly.map((m) => toMoneyNumber(m.income)),
      expenses: monthly.map((m) => toMoneyNumber(m.expenses)),
      savings: monthly.map((m) => toMoneyNumber(m.savingsContributions)),
      debt: monthly.map((m) => toMoneyNumber(m.debtPaid)),
      netWorth: monthly.map((m) => toMoneyNumber(m.netWorthChange)),
    }),
    [monthly],
  );

  const cards = [
    {
      title: "Total Income",
      value: totalsValue.income,
      subtitle: `Avg ${formatCurrency(totalsValue.income / monthsInRange)} / mo`,
      changePct: comparison?.incomeChangePct,
      icon: <Wallet className="w-5 h-5 text-emerald-500" />,
      accentColor: INCOME_COLOR,
      sparklineData: sparklines.income,
    },
    {
      title: "Total Expenses",
      value: totalsValue.expenses,
      subtitle: `Avg ${formatCurrency(totalsValue.expenses / monthsInRange)} / mo`,
      changePct: comparison?.expensesChangePct,
      invertChange: true,
      icon: <TrendingDown className="w-5 h-5 text-rose-500" />,
      accentColor: EXPENSE_COLOR,
      sparklineData: sparklines.expenses,
    },
    {
      title: "Savings",
      value: totalsValue.savingsContributions,
      subtitle: `${totalsValue.savingsRate.toFixed(1)}% savings rate`,
      changePct: comparison?.savingsContributionsChangePct,
      icon: <PiggyBank className="w-5 h-5 text-blue-500" />,
      accentColor: NET_WORTH_COLOR,
      sparklineData: sparklines.savings,
    },
    {
      title: "Debt Paid",
      value: totalsValue.debtPaid,
      subtitle: `Avg ${formatCurrency(totalsValue.debtPaid / monthsInRange)} / mo`,
      changePct: comparison?.debtPaidChangePct,
      icon: <CreditCard className="w-5 h-5 text-orange-500" />,
      accentColor: PRIMARY_CHART_COLOR,
      sparklineData: sparklines.debt,
    },
    {
      title: "Net Worth",
      value: totalsValue.netWorth,
      subtitle: `${
        totalsValue.totalNetWorthChange >= 0 ? "+" : ""
      }${formatCurrency(totalsValue.totalNetWorthChange)} YTD`,
      changePct: comparison?.netWorthChangePct,
      icon: <Landmark className="w-5 h-5 text-violet-500" />,
      accentColor: NET_WORTH_COLOR,
      sparklineData: sparklines.netWorth,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {cards.map((card) => (
        <SummaryCard
          key={card.title}
          {...card}
          isLoading={isLoading}
          formatValue={formatCurrency}
        />
      ))}
    </div>
  );
}
