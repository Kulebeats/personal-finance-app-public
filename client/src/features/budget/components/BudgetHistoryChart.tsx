/**
 * BudgetHistoryChart
 *
 * Renders the trailing months of REAL category spend produced by
 * `useBudgetCategoryHistory` as a bar chart. Shows an honest empty state
 * when there is no real spend history to show, instead of fabricating
 * numbers (audit v2 finding B4).
 */
import { cn } from "@/lib/utils";
import type { BudgetCategoryHistoryPoint } from "../hooks/useBudgetCategoryHistory";

interface BudgetHistoryChartProps {
  points: BudgetCategoryHistoryPoint[];
  isLoading: boolean;
  hasData: boolean;
  average: number;
  formatCurrency: (value: number) => string;
}

const MIN_BAR_HEIGHT_PERCENT = 2;

export function BudgetHistoryChart({
  points,
  isLoading,
  hasData,
  average,
  formatCurrency,
}: BudgetHistoryChartProps) {
  if (isLoading) {
    return (
      <div
        data-testid="budget-history-loading"
        className="bg-muted/20 p-4 rounded-lg border border-border/50 text-sm text-muted-foreground text-center py-10"
      >
        Loading spend history...
      </div>
    );
  }

  if (!hasData) {
    return (
      <div
        data-testid="budget-history-empty-state"
        className="bg-muted/20 p-4 rounded-lg border border-border/50 text-sm text-muted-foreground text-center py-10"
      >
        No spending recorded for this category in the last {points.length}{" "}
        months.
      </div>
    );
  }

  const maxActual = points.reduce(
    (max, point) => Math.max(max, point.actual),
    0,
  );
  // The final point is the currently viewed period; "last month" refers to
  // the month immediately before it.
  const lastMonthPoint = points[points.length - 2] ?? points[points.length - 1];

  return (
    <div className="bg-muted/20 p-4 rounded-lg border border-border/50">
      <div className="flex items-end gap-2 h-32 mb-4">
        {points.map((point, index) => (
          <div
            key={`${point.year}-${point.month}`}
            className="flex-1 flex flex-col items-center gap-1 group"
          >
            <div className="relative w-full flex items-end justify-center h-full">
              <div
                className={cn(
                  "w-full rounded-t transition-all relative",
                  index === points.length - 1
                    ? "bg-emerald-500"
                    : "bg-muted-foreground/30 group-hover:bg-muted-foreground/40",
                )}
                style={{
                  height: `${
                    maxActual > 0
                      ? Math.max(
                          (point.actual / maxActual) * 100,
                          MIN_BAR_HEIGHT_PERCENT,
                        )
                      : MIN_BAR_HEIGHT_PERCENT
                  }%`,
                }}
              >
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-foreground text-background text-[10px] py-0.5 px-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                  {formatCurrency(point.actual)}
                </div>
              </div>
            </div>
            <span className="text-[10px] font-bold text-muted-foreground">
              {point.label}
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground px-1">
        <span>
          {points.length} month avg:{" "}
          <span className="font-medium text-foreground">
            {formatCurrency(average)}
          </span>
        </span>
        <span>
          Last month:{" "}
          <span className="font-medium text-foreground">
            {formatCurrency(lastMonthPoint?.actual ?? 0)}
          </span>
        </span>
      </div>
    </div>
  );
}
