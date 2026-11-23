/**
 * BudgetSummaryCard Component
 *
 * Summary sidebar card with totals and progress bars.
 */

import { Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useBudgetMoneyDisplay } from "../budgetMoneyDisplay";
import type { BudgetGroup } from "../types";
import { groupActual, groupBudgetLimit, remainingBudget } from "../budgetLimits";
import { subtractMoneyValues } from "@/lib/money";

interface BudgetSummaryCardProps {
  totalIncomeBudget: number | null;
  totalIncomeActual: number;
  totalExpenseBudget: number | null;
  totalExpenseActual: number;
  incomeRemaining: number | null;
  expenseRemaining: number | null;
  incomeGroups: BudgetGroup[];
  expenseGroups: BudgetGroup[];
  summaryTab: "summary" | "income" | "expenses";
  onTabChange: (tab: "summary" | "income" | "expenses") => void;
  /** Unbudgeted spending in this section could not be converted (missing exchange rate), N3. */
  isIncomeActualIncomplete?: boolean;
  isExpenseActualIncomplete?: boolean;
  currency?: string | null;
}

export function BudgetSummaryCard({
  totalIncomeBudget,
  totalIncomeActual,
  totalExpenseBudget,
  totalExpenseActual,
  incomeRemaining,
  expenseRemaining,
  incomeGroups,
  expenseGroups,
  summaryTab,
  onTabChange,
  isIncomeActualIncomplete = false,
  isExpenseActualIncomplete = false,
  currency,
}: BudgetSummaryCardProps) {
  const { formatCurrency } = useBudgetMoneyDisplay(currency);
  const incomeLimitWithheld = incomeGroups.some(group => group.hasWithheldLimit);
  const expenseLimitWithheld = expenseGroups.some(group => group.hasWithheldLimit);
  const incomeCurrency = incomeGroups.some(group => group.currency === null) ? null : currency;
  const expenseCurrency = expenseGroups.some(group => group.currency === null) ? null : currency;
  const leftUnavailable = incomeLimitWithheld || expenseLimitWithheld || incomeCurrency === null || expenseCurrency === null;
  const leftToBudget = leftUnavailable || totalIncomeBudget === null || totalExpenseBudget === null
    ? null : subtractMoneyValues(totalIncomeBudget, totalExpenseBudget).toNumber();
  const leftLabel = leftToBudget !== null ? formatCurrency(leftToBudget) : leftUnavailable ? "Unavailable" : "Unbudgeted";
  const isPositive = leftToBudget !== null && leftToBudget >= 0;

  return (
    <Card className="shadow-sm border-border/50 bg-card overflow-hidden">
      {/* Header with Left to Budget */}
      <div
        className={cn(
          "p-6 text-center border-b",
          leftToBudget === null ? "bg-muted/20 border-border" : isPositive
            ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-100 dark:border-emerald-900/50"
            : "bg-rose-50 dark:bg-rose-950/30 border-rose-100 dark:border-rose-900/50"
        )}
      >
        <div
          className={cn(
            "text-3xl font-bold mb-1",
            leftToBudget === null ? "text-muted-foreground" : isPositive ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"
          )}
        >
          {leftLabel}
        </div>
        <div
          className={cn(
            "text-sm font-medium flex items-center justify-center gap-1",
            leftToBudget === null ? "text-muted-foreground" : isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
          )}
        >
          Left to budget <Info className="w-3 h-3" aria-hidden="true" />
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="p-2">
        <div className="flex items-center justify-center gap-1 mb-4 bg-muted/30 p-1 rounded-lg mx-4 mt-4">
          {(["summary", "income", "expenses"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              aria-label={`View ${tab} tab`}
              aria-current={summaryTab === tab ? "page" : undefined}
              className={cn(
                "flex-1 py-1 max-md:min-h-11 text-xs font-medium rounded-md transition-all capitalize",
                summaryTab === tab
                  ? "bg-background dark:bg-card shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="px-6 pb-6 space-y-6">
          {summaryTab === "summary" && (
            <>
              {/* Income Summary */}
              <SummaryRow
                label="Income"
                budget={totalIncomeBudget}
                actual={totalIncomeActual}
                remaining={incomeRemaining}
                isIncome
                isActualIncomplete={isIncomeActualIncomplete || incomeGroups.some(group => group.actualIncomplete)}
                unbudgetedUnavailable={isIncomeActualIncomplete}
                hasWithheldLimit={incomeLimitWithheld}
                currency={incomeCurrency}
              />
              {/* Expenses Summary */}
              <SummaryRow
                label="Expenses"
                budget={totalExpenseBudget}
                actual={totalExpenseActual}
                remaining={expenseRemaining}
                isIncome={false}
                isActualIncomplete={isExpenseActualIncomplete || expenseGroups.some(group => group.actualIncomplete)}
                unbudgetedUnavailable={isExpenseActualIncomplete}
                hasWithheldLimit={expenseLimitWithheld}
                currency={expenseCurrency}
              />
            </>
          )}

          {summaryTab === "income" && (
            <div className="space-y-6">
              {incomeGroups.map((group) => {
                const gBudget = groupBudgetLimit(group);
                const gActual = groupActual(group);
                const gRemaining = remainingBudget(gBudget, gActual);
                return (
                  <SummaryRow
                    key={group.id}
                    label={group.name}
                    budget={gBudget}
                    actual={gActual}
                    remaining={gRemaining}
                    isIncome
                    isActualIncomplete={group.actualIncomplete}
                    hasWithheldLimit={group.hasWithheldLimit}
                    currency={group.currency === undefined ? currency : group.currency}
                  />
                );
              })}
            </div>
          )}

          {summaryTab === "expenses" && (
            <div className="space-y-6">
              {expenseGroups.map((group) => {
                const gBudget = groupBudgetLimit(group);
                const gActual = groupActual(group);
                const gRemaining = remainingBudget(gBudget, gActual);
                const isFlexible = group.id === "flexible-expenses";
                return (
                  <SummaryRow
                    key={group.id}
                    label={group.name}
                    budget={gBudget}
                    actual={gActual}
                    remaining={gRemaining}
                    isIncome={false}
                    isActualIncomplete={group.actualIncomplete}
                    hasWithheldLimit={group.hasWithheldLimit}
                    isFlexible={isFlexible}
                    currency={group.currency === undefined ? currency : group.currency}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function SummaryRow({
  label,
  budget,
  actual,
  remaining,
  isIncome,
  isFlexible = false,
  isActualIncomplete = false,
  unbudgetedUnavailable = false,
  hasWithheldLimit = false,
  currency,
}: {
  label: string;
  budget: number | null;
  actual: number;
  remaining: number | null;
  isIncome: boolean;
  isFlexible?: boolean;
  isActualIncomplete?: boolean;
  unbudgetedUnavailable?: boolean;
  hasWithheldLimit?: boolean;
  currency?: string | null;
}) {
  const { formatCurrency, formatLimit } = useBudgetMoneyDisplay(currency);
  const comparisonIncomplete = currency === null || isActualIncomplete || hasWithheldLimit;
  const progress = !comparisonIncomplete && budget !== null && budget > 0 ? (actual / budget) * 100 : null;
  const budgetLabel = currency === null ? "Unavailable" : `${formatLimit(budget, hasWithheldLimit)}${budget === null ? "" : " budget"}`;
  const actualLabel = currency === null ? "Unavailable" :
    `${isActualIncomplete ? "At least " : ""}${formatCurrency(actual)} ${isIncome ? "earned" : "spent"}`;
  const incompleteReason = unbudgetedUnavailable ? "an exchange rate is missing" : "some budget progress is unavailable";

  return (
    <div>
      <div className="flex justify-between text-sm mb-2">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {budgetLabel}
        </span>
      </div>
      {progress !== null && <div className="h-2 w-full bg-muted rounded-full overflow-hidden mb-1" role="progressbar" aria-valuenow={Math.min(100, Math.max(0, progress))} aria-valuemin={0} aria-valuemax={100} aria-label={`${label} progress: ${Math.round(progress)}%`}>
        <div
          className={cn(
            "h-full rounded-full",
            isFlexible
              ? "bg-gradient-to-r from-emerald-500 to-yellow-400"
              : remaining !== null && remaining < 0
              ? "bg-rose-500"
              : "bg-emerald-500"
          )}
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>}
      <div className="flex justify-between text-xs">
        <span
          className="font-bold text-foreground"
          aria-label={currency !== null && isActualIncomplete ? `${label}: ${actualLabel}; total incomplete because ${incompleteReason}` : undefined}
        >
          {actualLabel}
        </span>
        <span
          className={cn(
            "font-bold",
            comparisonIncomplete
              ? "text-muted-foreground"
              : isFlexible
              ? "text-yellow-600 dark:text-yellow-400"
              : remaining !== null && remaining >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400"
          )}
        >
          {comparisonIncomplete ? "Incomplete" : remaining === null ? "Unbudgeted" : `${formatCurrency(Math.abs(remaining))} ${remaining >= 0 ? "remaining" : isIncome ? "extra" : "over"}`}
        </span>
      </div>
    </div>
  );
}
