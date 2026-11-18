/**
 * BudgetSummaryCard Component
 *
 * Summary sidebar card with totals and progress bars.
 */

import { Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useFormatters } from "@/contexts/SettingsContext";
import type { BudgetGroup } from "../types";

interface BudgetSummaryCardProps {
  totalIncomeBudget: number;
  totalIncomeActual: number;
  totalExpenseBudget: number;
  totalExpenseActual: number;
  incomeRemaining: number;
  expenseRemaining: number;
  incomeGroups: BudgetGroup[];
  expenseGroups: BudgetGroup[];
  summaryTab: "summary" | "income" | "expenses";
  onTabChange: (tab: "summary" | "income" | "expenses") => void;
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
}: BudgetSummaryCardProps) {
  const { formatCurrency } = useFormatters();
  const leftToBudget = totalIncomeBudget - totalExpenseBudget;
  const isPositive = leftToBudget >= 0;

  return (
    <Card className="shadow-sm border-border/50 bg-card overflow-hidden">
      {/* Header with Left to Budget */}
      <div
        className={cn(
          "p-6 text-center border-b",
          isPositive
            ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-100 dark:border-emerald-900/50"
            : "bg-rose-50 dark:bg-rose-950/30 border-rose-100 dark:border-rose-900/50"
        )}
      >
        <div
          className={cn(
            "text-3xl font-bold mb-1",
            isPositive ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"
          )}
        >
          {formatCurrency(leftToBudget)}
        </div>
        <div
          className={cn(
            "text-sm font-medium flex items-center justify-center gap-1",
            isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
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
                "flex-1 py-1 text-xs font-medium rounded-md transition-all capitalize",
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
                formatCurrency={formatCurrency}
              />
              {/* Expenses Summary */}
              <SummaryRow
                label="Expenses"
                budget={totalExpenseBudget}
                actual={totalExpenseActual}
                remaining={expenseRemaining}
                isIncome={false}
                formatCurrency={formatCurrency}
              />
            </>
          )}

          {summaryTab === "income" && (
            <div className="space-y-6">
              {incomeGroups.map((group) => {
                const gBudget = group.items.reduce(
                  (acc, item) => acc + item.budget,
                  0
                );
                const gActual = group.items.reduce(
                  (acc, item) => acc + item.actual,
                  0
                );
                const gRemaining = gBudget - gActual;
                return (
                  <SummaryRow
                    key={group.id}
                    label={group.name}
                    budget={gBudget}
                    actual={gActual}
                    remaining={gRemaining}
                    isIncome
                    formatCurrency={formatCurrency}
                  />
                );
              })}
            </div>
          )}

          {summaryTab === "expenses" && (
            <div className="space-y-6">
              {expenseGroups.map((group) => {
                const gBudget =
                  group.isFlexible && group.budget !== undefined
                    ? group.budget
                    : group.items.reduce((acc, item) => acc + item.budget, 0);
                const gActual = group.items.reduce(
                  (acc, item) => acc + item.actual,
                  0
                );
                const gRemaining = gBudget - gActual;
                const isFlexible = group.id === "flexible-expenses";
                return (
                  <SummaryRow
                    key={group.id}
                    label={group.name}
                    budget={gBudget}
                    actual={gActual}
                    remaining={gRemaining}
                    isIncome={false}
                    isFlexible={isFlexible}
                    formatCurrency={formatCurrency}
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
  formatCurrency,
}: {
  label: string;
  budget: number;
  actual: number;
  remaining: number;
  isIncome: boolean;
  isFlexible?: boolean;
  formatCurrency: (val: number) => string;
}) {
  const progress = (actual / (budget || 1)) * 100;

  return (
    <div>
      <div className="flex justify-between text-sm mb-2">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {formatCurrency(budget)} budget
        </span>
      </div>
      <div className="h-2 w-full bg-muted rounded-full overflow-hidden mb-1" role="progressbar" aria-valuenow={Math.min(100, Math.max(0, progress))} aria-valuemin={0} aria-valuemax={100} aria-label={`${label} progress: ${Math.round(progress)}%`}>
        <div
          className={cn(
            "h-full rounded-full",
            isFlexible
              ? "bg-gradient-to-r from-emerald-500 to-yellow-400"
              : remaining < 0
              ? "bg-rose-500"
              : "bg-emerald-500"
          )}
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>
      <div className="flex justify-between text-xs">
        <span className="font-bold text-foreground">
          {formatCurrency(actual)} {isIncome ? "earned" : "spent"}
        </span>
        <span
          className={cn(
            "font-bold",
            isFlexible
              ? "text-yellow-600 dark:text-yellow-400"
              : remaining >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400"
          )}
        >
          {formatCurrency(Math.abs(remaining))}{" "}
          {remaining >= 0 ? "remaining" : isIncome ? "extra" : "over"}
        </span>
      </div>
    </div>
  );
}
