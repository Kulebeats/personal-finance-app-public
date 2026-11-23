import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { Link } from "wouter";
import { useFormatters } from "@/contexts/SettingsContext";
import { useCurrentMonthBudgets } from "@/hooks/useBudgets";
import { sumMoneyValues } from "@/lib/money";
import { commonBudgetCurrency } from "@/features/budget/budgetMoneyDisplay";
import { isUnavailableFlexBudget } from "@/hooks/useUnavailableBudgets";
import { WidgetErrorState } from "./WidgetErrorState";

export default function BudgetStatusWidget() {
  const { formatCurrency } = useFormatters();
  const { data: budgets = [], unavailableBudgets = [], budgetSystem, isLoading, error, refetch } = useCurrentMonthBudgets();

  if (isLoading) {
    return (
      <Card className="col-span-1 md:col-span-2 bg-linear-to-br from-background to-muted/30 rounded-xl border border-border p-6 flex flex-col items-center justify-center text-center gap-4 relative overflow-hidden min-h-[200px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (error) {
    return (
      <WidgetErrorState
        title="Unable to load budget status"
        message="We couldn't calculate your budget progress."
        onRetry={() => refetch()}
        className="col-span-1 md:col-span-2 h-full"
      />
    );
  }

  // The flex row already includes every grouped expense. It overlaps the
  // detailed category and group rows, so only one scope can supply progress.
  const hasFlexScope = budgets.some(budget => budget.isFlexBucket) || unavailableBudgets.some(isUnavailableFlexBudget);
  const showFlex = hasFlexScope && budgetSystem === "flex";
  const scopedBudgets = budgets.filter(budget => Boolean(budget.isFlexBucket) === showFlex);
  const withheld = unavailableBudgets.some(budget => isUnavailableFlexBudget(budget) === showFlex);
  const amounts = scopedBudgets.flatMap(({ amount, spent }) => [amount, spent]);
  const currency = commonBudgetCurrency(amounts);
  const legacyNumbers = amounts.every(amount => typeof amount === "string" || typeof amount === "number");
  if ((hasFlexScope && budgetSystem !== "category" && budgetSystem !== "flex") || withheld || (currency === null && !legacyNumbers)) {
    return (
      <WidgetErrorState
        title="Budget status unavailable"
        message="The selected budget's progress is unavailable."
        className="col-span-1 md:col-span-2 h-full"
      />
    );
  }

  // Aggregate the confirmed same-unit amounts. The scalar-only legacy payload
  // keeps the prior display path.
  const totalBudgetDecimal = sumMoneyValues(scopedBudgets.map(budget => budget.amount));
  const totalSpentDecimal = sumMoneyValues(scopedBudgets.map(budget => budget.spent));
  const totalBudget = totalBudgetDecimal.toNumber();
  const totalSpent = totalSpentDecimal.toNumber();

  // Avoid division by zero
  const percentage =
    totalBudget > 0
      ? Math.min(Math.round((totalSpent / totalBudget) * 100), 100)
      : totalSpent > 0
      ? 100
      : 0;

  // Logic from PDF:
  // Green: Under budget (0-70%)
  // Yellow: Approaching limit (70-90%)
  // Red: Over budget (90%+)

  let statusColor = "bg-emerald-500";
  let statusTextColor = "text-emerald-600 dark:text-emerald-400";
  let statusBgColor = "bg-emerald-50 dark:bg-emerald-900/30";
  let statusMessage = "You are on track.";
  let Icon = CheckCircle2;

  if (percentage >= 90) {
    statusColor = "bg-rose-500";
    statusTextColor = "text-rose-600 dark:text-rose-400";
    statusBgColor = "bg-rose-50 dark:bg-rose-900/30";
    statusMessage = "You are over budget.";
    Icon = AlertCircle;
  } else if (percentage >= 70) {
    statusColor = "bg-amber-500";
    statusTextColor = "text-amber-600 dark:text-amber-400";
    statusBgColor = "bg-amber-50 dark:bg-amber-900/30";
    statusMessage = "You are approaching your limit.";
    Icon = AlertTriangle;
  }

  return (
    <Card className="col-span-1 md:col-span-2 bg-gradient-to-br from-background to-muted/30 rounded-xl border border-border p-6 flex flex-col items-center justify-center text-center gap-4 relative overflow-hidden">
      {/* Decorative background element */}
      <div className={cn("absolute top-0 left-0 w-full h-1", statusColor)} />

      <div
        className={cn(
          "w-12 h-12 rounded-full flex items-center justify-center mb-1",
          statusBgColor,
          statusTextColor
        )}
      >
        <Icon className="w-6 h-6" />
      </div>

      <div>
        <h3 className="text-lg font-semibold text-foreground">Budget Status</h3>
        <p className="text-muted-foreground text-sm max-w-xs mx-auto mt-1">
          You've spent{" "}
          <span className="font-bold text-foreground">
            {formatCurrency(totalSpent, currency ?? undefined)}
          </span>{" "}
          of your{" "}
          <span className="font-bold text-foreground">
            {formatCurrency(totalBudget, currency ?? undefined)}
          </span>{" "}
          {showFlex ? "flex budget." : "monthly budget."}
        </p>
        <p className={cn("text-sm font-medium mt-1", statusTextColor)}>
          {statusMessage}
        </p>
      </div>

      <div className="w-full max-w-sm bg-muted/50 h-3 rounded-full overflow-hidden shadow-inner border border-border/50 relative">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            statusColor
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Audit v2 P2: this widget summarized budget status but had no way to
          drill into the underlying budgets - link out to the Budget page. */}
      <Link
        href="/budget"
        className="group flex items-center gap-1 text-sm font-medium text-primary hover:underline max-md:min-h-11"
      >
        View budgets
        <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
      </Link>
    </Card>
  );
}
