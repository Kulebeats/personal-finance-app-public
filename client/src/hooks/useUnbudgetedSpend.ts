/**
 * This month's spending in categories no budget covers (N3).
 *
 * `GET /budgets/progress` reports it in `meta.unbudgetedSpent`, per section,
 * as a MoneyDto, or null where some of it cannot be shown in the household
 * currency (an exchange rate is missing). Three states stay apart:
 * undefined = not reported (yet), a MoneyDto = reported (zero included),
 * null = unavailable. Unavailable is never read as zero. Only a budget's row carries what was spent, so without this a
 * section with an expense in a category without a limit read 0.00 spent.
 * The progress hook stores it here; the budget page reads it.
 */
import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { MoneyDto } from "@shared/money";

/** undefined: not reported; MoneyDto: reported; null: unavailable (missing exchange rate). */
export type UnbudgetedSection = MoneyDto | null | undefined;

export interface UnbudgetedSpend {
  expense?: MoneyDto | null;
  income?: MoneyDto | null;
}

const NONE: UnbudgetedSpend = {};

/** True when the server could not report this section's unbudgeted spending. */
export const isUnbudgetedUnavailable = (section: UnbudgetedSection): section is null => section === null;

export const unbudgetedSpendKey = (year: number, month: number) =>
  ["budgets", "progress-unbudgeted", year, month] as const;

/** Absent stays not reported; null or anything malformed is unavailable, never zero. */
function section(value: unknown): UnbudgetedSection {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  return typeof row.amount === "string" && typeof row.currency === "string"
    ? { amount: row.amount, currency: row.currency }
    : null;
}

/** Called with the progress response's `meta`. */
export function storeUnbudgetedSpend(queryClient: QueryClient, year: number, month: number, meta: unknown): void {
  const spend = (meta as { unbudgetedSpent?: Record<string, unknown> } | null | undefined)?.unbudgetedSpent;
  queryClient.setQueryData<UnbudgetedSpend>(unbudgetedSpendKey(year, month), {
    expense: section(spend?.expense),
    income: section(spend?.income),
  });
}

/** Read-only: filled by the progress query, never fetched on its own. */
export function useUnbudgetedSpend(year: number, month: number): UnbudgetedSpend {
  const { data } = useQuery<UnbudgetedSpend>({
    queryKey: unbudgetedSpendKey(year, month),
    queryFn: async () => NONE,
    enabled: false,
  });
  return data ?? NONE;
}
