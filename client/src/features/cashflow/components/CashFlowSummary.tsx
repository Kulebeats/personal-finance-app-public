import { Card } from "@/components/ui/card";
import { ArrowUpRight, ArrowDownRight, Info } from "lucide-react";
import { type useCashFlowData } from "../hooks/useCashFlowData";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CashFlowSummaryProps {
  readonly totals: ReturnType<typeof useCashFlowData>["totals"];
  /** Savings per period that has started (NEW-34). */
  /** Null when the response has no elapsed totals to average. */
  readonly averageSavings: number | null;
  readonly periodLabel: string;
  readonly formatCurrency: (value: number) => string;
}

export function CashFlowSummary({
  totals,
  averageSavings,
  periodLabel,
  formatCurrency,
}: CashFlowSummaryProps) {
  const totalSavingsRate = Number.isFinite(totals.savingsRate)
    ? totals.savingsRate
    : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card className="p-5 border-border shadow-sm">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
          Total Income
        </div>
        <div className="text-2xl font-bold text-foreground flex items-center gap-2">
          {formatCurrency(totals.income)}
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.5 rounded-full flex items-center">
            <ArrowUpRight className="w-3 h-3 mr-0.5" /> Total
          </span>
        </div>
      </Card>
      <Card className="p-5 border-border shadow-sm">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
          Total Expenses
        </div>
        <div className="text-2xl font-bold text-foreground flex items-center gap-2">
          {formatCurrency(totals.expenses)}
          <span className="text-xs font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950 px-1.5 py-0.5 rounded-full flex items-center">
            <ArrowDownRight className="w-3 h-3 mr-0.5" /> Total
          </span>
        </div>
      </Card>
      <Card className="p-5 border-border shadow-sm">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
          Net Savings
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  aria-label="Information about Net Savings calculation"
                >
                  <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs text-xs">
                  Net Savings = Income - Expenses - Debt Payments.
                  Debt payments to credit cards, loans, and mortgages are tracked separately.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
          {formatCurrency(totals.savings)}
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.5 rounded-full flex items-center">
            {totalSavingsRate.toFixed(1)}% Rate
          </span>
        </div>
      </Card>
      <Card className="p-5 border-border shadow-sm">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
          Avg. {periodLabel} Savings
        </div>
        <div className="text-2xl font-bold text-foreground">
          {averageSavings === null ? "—" : formatCurrency(averageSavings)}
        </div>
      </Card>
    </div>
  );
}
