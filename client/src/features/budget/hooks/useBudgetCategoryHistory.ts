/**
 * useBudgetCategoryHistory Hook
 *
 * Real per-category monthly spend history for the Budget category detail
 * modal, sourced from the same `/budgets/progress` endpoint the Budget
 * page already uses (one request per trailing month). Replaces the
 * fabricated 6-month chart data that used to be hardcoded in
 * BudgetDetailModal (audit v2 finding B4).
 *
 * Only a category's own progress row establishes that month's spend.
 * Group and unbudgeted aggregates cannot establish a category amount.
 */
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { budgetKeys, fetchBudgetProgress } from "@/hooks/useBudgets";
import { sumMoneyValues } from "@/lib/money";
import { parseMoney } from "@/lib/utils";
import { commonBudgetCurrency } from "../budgetMoneyDisplay";

export interface BudgetCategoryHistoryPoint {
  year: number;
  month: number;
  label: string;
  actual: number | null;
}

export interface BudgetCategoryHistoryResult {
  points: BudgetCategoryHistoryPoint[];
  isLoading: boolean;
  isError: boolean;
  hasData: boolean;
  average: number | null;
  currency?: string | null;
}

const MONTH_LABELS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

/** Shift `year`/`month` by `delta` months, wrapping across year boundaries. */
function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  let nextYear = year;
  let nextMonth = month + delta;
  while (nextMonth < 1) {
    nextMonth += 12;
    nextYear -= 1;
  }
  while (nextMonth > 12) {
    nextMonth -= 12;
    nextYear += 1;
  }
  return { year: nextYear, month: nextMonth };
}

/**
 * Fetches real actual-spend-per-month for `categoryId` across the
 * `monthsBack` trailing months ending at (and including) `year`/`month`.
 */
export function useBudgetCategoryHistory(
  categoryId: string | undefined,
  year: number,
  month: number,
  monthsBack = 6,
): BudgetCategoryHistoryResult {
  const queryClient = useQueryClient();
  const periods = Array.from({ length: monthsBack }, (_, index) =>
    shiftMonth(year, month, -(monthsBack - 1 - index)),
  );

  const results = useQueries({
    queries: periods.map((period) => ({
      queryKey: budgetKeys.progress(period.year, period.month),
      queryFn: () => fetchBudgetProgress(queryClient, period.year, period.month),
      enabled: Boolean(categoryId),
      staleTime: 60_000,
    })),
  });
  const isLoading = Boolean(categoryId) && results.some((r) => r.isLoading);
  const isError = results.some((r) => r.isError);
  const observedCurrencies = new Set<string>();

  const points: BudgetCategoryHistoryPoint[] = periods.map(
    (period, index) => {
      const result = results[index];
      const entry = categoryId && result?.isSuccess
        ? result.data?.find(budget => budget.categoryId === categoryId && !budget.categoryGroupId && !budget.isFlexBucket)
        : undefined;
      const spentCurrency = commonBudgetCurrency([entry?.spent]);
      if (spentCurrency) observedCurrencies.add(spentCurrency);
      return {
        year: period.year,
        month: period.month,
        label: MONTH_LABELS[period.month - 1],
        actual: entry && spentCurrency ? parseMoney(entry.spent) : null,
      };
    },
  );

  const currency = observedCurrencies.size > 1 ? null : observedCurrencies.values().next().value;
  const hasUnknown = points.some(point => point.actual === null);
  const hasData = !isLoading && Boolean(currency);
  const average = hasData && !hasUnknown && points.length > 0
    ? sumMoneyValues(points.map((point) => point.actual))
        .dividedBy(points.length)
        .toNumber()
    : null;

  return { points, isLoading, isError, hasData, average, currency };
}
