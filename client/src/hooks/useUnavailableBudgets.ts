/**
 * Budgets the server could not report for a month (C3-10).
 *
 * `GET /budgets/progress` lists, in `meta.unavailableBudgets`, any budget
 * whose limit is held in a currency other than the household's. Those
 * budgets are not in the progress rows, so their category looks unbudgeted.
 * The progress hook stores the list here; the budget page reads it so it
 * never creates a second budget over one it cannot show.
 */
import { useQuery, type QueryClient } from "@tanstack/react-query";

export interface UnavailableBudget {
  id: string;
  name: string;
  categoryId: string | null;
  categoryGroupId: string | null;
  currency: string;
  reason: { code: string; message: string };
}

const EMPTY: UnavailableBudget[] = [];

export const unavailableBudgetsKey = (year: number, month: number) =>
  ["budgets", "progress-unavailable", year, month] as const;

/** Only the flex bucket has neither a category nor a group target in progress. */
export function isUnavailableFlexBudget(row: UnavailableBudget): boolean {
  return row.categoryId === null && row.categoryGroupId === null;
}

function isUnavailableBudget(value: unknown): value is UnavailableBudget {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  const reason = row.reason as Record<string, unknown> | null | undefined;
  return typeof row.id === "string" && typeof row.name === "string" && typeof row.currency === "string"
    && typeof reason?.code === "string" && typeof reason?.message === "string";
}

/** Called with the progress response's `meta`; anything malformed is dropped. */
export function storeUnavailableBudgets(queryClient: QueryClient, year: number, month: number, meta: unknown): void {
  const rows = (meta as { unavailableBudgets?: unknown } | null | undefined)?.unavailableBudgets;
  const list = Array.isArray(rows) ? rows.filter(isUnavailableBudget) : EMPTY;
  queryClient.setQueryData(unavailableBudgetsKey(year, month), list);
}

/** Read-only: filled by the progress query, never fetched on its own. */
export function useUnavailableBudgets(year: number, month: number): UnavailableBudget[] {
  const { data } = useQuery(unavailableBudgetsOptions(year, month));
  return data ?? EMPTY;
}

export function unavailableBudgetsOptions(year: number, month: number) {
  return {
    queryKey: unavailableBudgetsKey(year, month),
    queryFn: async () => EMPTY,
    enabled: false,
  };
}

/** The unavailable budget that covers a category or group, if any. */
export function unavailableBudgetFor(
  unavailable: ReadonlyArray<UnavailableBudget>,
  target: { categoryId?: string | null; categoryGroupId?: string | null },
): UnavailableBudget | undefined {
  return unavailable.find((row) =>
    (target.categoryId != null && row.categoryId === target.categoryId)
    || (target.categoryGroupId != null && row.categoryGroupId === target.categoryGroupId));
}
