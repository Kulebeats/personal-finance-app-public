/**
 * useBudgetCategoryHistory Hook
 *
 * Real per-category monthly spend history for the Budget category detail
 * modal, sourced from the same `/budgets/progress` endpoint the Budget
 * page already uses (one request per trailing month). Replaces the
 * fabricated 6-month chart data that used to be hardcoded in
 * BudgetDetailModal (audit v2 finding B4).
 *
 * Note: a given month only contributes real spend for a category once a
 * `budgets` row exists for that category (the progress endpoint joins
 * spend onto existing budget rows). A month before the category's budget
 * was created renders as 0 here rather than the category's true spend for
 * that month - an honest limitation of reusing the existing endpoint
 * rather than a new fabrication.
 */
import { useQueries } from "@tanstack/react-query";
import { apiCall } from "@/lib/api";
import { budgetKeys, type BudgetWithProgress } from "@/hooks/useBudgets";
import { sumMoneyValues } from "@/lib/money";
import { parseMoney } from "@/lib/utils";

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export interface BudgetCategoryHistoryPoint {
  year: number;
  month: number;
  label: string;
  actual: number;
}

export interface BudgetCategoryHistoryResult {
  points: BudgetCategoryHistoryPoint[];
  isLoading: boolean;
  isError: boolean;
  hasData: boolean;
  average: number;
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

async function fetchBudgetProgress(
  year: number,
  month: number,
): Promise<BudgetWithProgress[]> {
  const res = await apiCall<ApiResponse<BudgetWithProgress[]>>(
    `/budgets/progress?year=${year}&month=${month}`,
  );
  return res.data;
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
  const periods = Array.from({ length: monthsBack }, (_, index) =>
    shiftMonth(year, month, -(monthsBack - 1 - index)),
  );

  const results = useQueries({
    queries: periods.map((period) => ({
      queryKey: budgetKeys.progress(period.year, period.month),
      queryFn: () => fetchBudgetProgress(period.year, period.month),
      enabled: Boolean(categoryId),
      staleTime: 60_000,
    })),
  });

  const isLoading = Boolean(categoryId) && results.some((r) => r.isLoading);
  const isError = results.some((r) => r.isError);

  const points: BudgetCategoryHistoryPoint[] = periods.map(
    (period, index) => {
      const progress = results[index]?.data;
      const entry = progress?.find(
        (budget) => budget.categoryId === categoryId && !budget.isFlexBucket,
      );
      return {
        year: period.year,
        month: period.month,
        label: MONTH_LABELS[period.month - 1],
        actual: entry ? parseMoney(entry.spent) : 0,
      };
    },
  );

  const hasData = !isLoading && points.some((point) => point.actual > 0);
  const average = points.length
    ? sumMoneyValues(points.map((point) => point.actual))
        .dividedBy(points.length)
        .toNumber()
    : 0;

  return { points, isLoading, isError, hasData, average };
}
