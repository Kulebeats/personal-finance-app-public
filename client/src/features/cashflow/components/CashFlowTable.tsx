import { Card } from "@/components/ui/card";
import { Loader2, AlertCircle, TrendingUp } from "lucide-react";
import { parseLocalDate, getWeekEndDate, type useCashFlowData } from "../hooks/useCashFlowData";
import { toMoneyNumber } from "@/lib/money";

/**
 * Format period label based on interval type
 * Handles cross-year weeks (e.g., "Dec 30, 2024 - Jan 5, 2025")
 */
function formatPeriodLabel(periodStart: string, interval: "day" | "week" | "month"): string {
  const startDate = parseLocalDate(periodStart);

  if (interval === "day") {
    return startDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  if (interval === "week") {
    const endDate = getWeekEndDate(startDate);
    const startMonth = startDate.toLocaleDateString("en-US", { month: "short" });
    const endMonth = endDate.toLocaleDateString("en-US", { month: "short" });
    const startDay = startDate.getDate();
    const endDay = endDate.getDate();
    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();

    // Handle cross-year weeks
    if (endYear > startYear) {
      return `${startMonth} ${startDay}, ${startYear} - ${endMonth} ${endDay}, ${endYear}`;
    }

    if (startMonth === endMonth) {
      return `${startMonth} ${startDay} - ${endDay}, ${startYear}`;
    }
    return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${startYear}`;
  }

  // month
  return startDate.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

interface CashFlowTableProps {
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly data: ReturnType<typeof useCashFlowData>["cashflowData"];
  readonly formatCurrency: (value: number) => string;
  readonly periodLabel?: string;
  readonly interval?: "day" | "week" | "month";
}

export function CashFlowTable({
  isLoading,
  error,
  data,
  formatCurrency,
  periodLabel = "Monthly",
  interval = "month",
}: CashFlowTableProps) {
  const renderContent = () => {
    if (isLoading) {
      return (
        <output className="flex items-center justify-center py-12" aria-live="polite" aria-label="Loading cash flow data">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </output>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <AlertCircle className="w-8 h-8 text-destructive" />
          <p className="text-sm text-muted-foreground">Failed to load data</p>
        </div>
      );
    }

    if (!data?.series?.length) {
      return (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <TrendingUp className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No data for selected period
          </p>
        </div>
      );
    }

    // Determine period column header based on interval
    const getPeriodColumnLabel = () => {
      if (periodLabel === "Daily") return "Date";
      if (periodLabel === "Weekly") return "Week";
      return "Month";
    };
    const periodColumnLabel = getPeriodColumnLabel();

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted/20 text-muted-foreground font-medium border-b border-border">
            <tr>
              <th scope="col" className="px-6 py-3">{periodColumnLabel}</th>
              <th scope="col" className="px-6 py-3 text-right">Income</th>
              <th scope="col" className="px-6 py-3 text-right">Expenses</th>
              <th scope="col" className="px-6 py-3 text-right">Net Savings</th>
              <th scope="col" className="px-6 py-3 text-right">Savings Rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {data.series
              .slice()
              .reverse()
              .map((row) => (
                <tr
                  key={row.periodStart}
                  className="hover:bg-muted/20 transition-colors"
                >
                  <td className="px-6 py-4 font-medium">
                    {formatPeriodLabel(row.periodStart, interval)}
                  </td>
                  <td className="px-6 py-4 text-right text-emerald-600 dark:text-emerald-400">
                    +{formatCurrency(toMoneyNumber(row.income))}
                  </td>
                  <td className="px-6 py-4 text-right text-rose-600 dark:text-rose-400">
                    -{formatCurrency(Math.abs(toMoneyNumber(row.expenses)))}
                  </td>
                  <td className="px-6 py-4 text-right font-bold text-foreground">
                    {formatCurrency(toMoneyNumber(row.savings))}
                  </td>
                  <td className="px-6 py-4 text-right text-muted-foreground">
                    {(Number.isFinite(row.savingsRate)
                      ? row.savingsRate
                      : 0
                    ).toFixed(1)}%
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <Card className="shadow-sm border-border overflow-hidden">
      <div className="p-4 border-b border-border bg-muted/30">
        <h3 className="font-semibold">{periodLabel} Breakdown</h3>
      </div>
      {renderContent()}
    </Card>
  );
}
