/**
 * BudgetForecastTable Component
 *
 * Displays a 12-month budget forecast grid with editable cells.
 */

import { cn } from "@/lib/utils";
import type { BudgetForecastData } from "@/hooks/useBudgets";
import { formatPreviewMoney } from "../previewContract";

type ForecastBudget = BudgetForecastData["budgets"][number];
type ForecastPeriod = ForecastBudget["periods"][number];

interface BudgetForecastTableProps {
  forecast?: BudgetForecastData;
  isLoading: boolean;
  currentYear: number;
  currentMonth: number;
  onEdit?: (budget: ForecastBudget, period: ForecastPeriod) => void;
  showUnbudgeted: boolean;
  onToggleShowUnbudgeted: () => void;
}

export function BudgetForecastTable({
  forecast,
  isLoading,
  currentYear,
  currentMonth,
  onEdit,
  showUnbudgeted,
  onToggleShowUnbudgeted,
}: BudgetForecastTableProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[240px] bg-card border border-border rounded-lg">
        <div className="text-sm text-muted-foreground">Loading forecast...</div>
      </div>
    );
  }

  if (!forecast || forecast.budgets.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[240px] bg-card border border-border rounded-lg">
        <div className="text-sm text-muted-foreground">
          No forecast data yet.
        </div>
      </div>
    );
  }

  const isBudgetUnbudgeted = (budget: ForecastBudget) =>
    budget.periods.every((period) => period.amount === null);

  const unbudgetedCount = forecast.budgets.filter(isBudgetUnbudgeted).length;
  const visibleBudgets = showUnbudgeted
    ? forecast.budgets
    : forecast.budgets.filter((budget) => !isBudgetUnbudgeted(budget));

  const columnTemplate = `minmax(220px, 1fr) repeat(${forecast.range.length}, minmax(90px, 1fr))`;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Toggle for unbudgeted items */}
      {unbudgetedCount > 0 && (
        <div className="flex justify-end px-4 py-2 border-b border-border/60 bg-muted/10">
          <button
            type="button"
            onClick={onToggleShowUnbudgeted}
            className="text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            {showUnbudgeted ? "Hide" : "Show"} {unbudgetedCount} unbudgeted
          </button>
        </div>
      )}

      {/* Scrollable container for mobile */}
      <div className="overflow-x-auto">
        {/* Header Row */}
        <div
          className="grid gap-3 px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border min-w-max"
          style={{ gridTemplateColumns: columnTemplate }}
        >
        <div>Budget Item</div>
        {forecast.range.map((rangeItem) => {
          const date = new Date(rangeItem.year, rangeItem.month - 1, 1);
          const label = date.toLocaleString("en-US", { month: "short" });
          return (
            <div
              key={`${rangeItem.year}-${rangeItem.month}`}
              className="text-right"
            >
              {label} {rangeItem.year}
            </div>
          );
        })}
      </div>

        {/* Data Rows */}
        <div className="divide-y divide-border min-w-max">
          {visibleBudgets.map((budget) => (
            <div
              key={budget.id}
              className="grid gap-3 px-4 py-3 text-sm"
              style={{ gridTemplateColumns: columnTemplate }}
            >
              <div className="font-medium text-foreground">{budget.name}</div>
              {budget.periods.map((period) => {
                const isPast =
                  period.year < currentYear ||
                  (period.year === currentYear && period.month < currentMonth);
                const isEditable = Boolean(onEdit) && !isPast;

                return (
                  <button
                    type="button"
                    key={`${budget.id}-${period.year}-${period.month}`}
                    disabled={!isEditable}
                    onClick={() => {
                      if (isEditable && onEdit) {
                        onEdit(budget, period);
                      }
                    }}
                    className={cn(
                      "text-right rounded px-1 py-0.5 transition-colors",
                      isEditable
                        ? "text-foreground hover:bg-muted/50"
                        : "text-muted-foreground"
                    )}
                  >
                    {period.amount === null ? "Unbudgeted" : formatPreviewMoney(period.amount)}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
