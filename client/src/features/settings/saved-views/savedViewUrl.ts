/**
 * Applying a saved view opens the Transactions page with the view's filter,
 * built through the page's own URL contract (transactionFilterParams). The
 * list it shows comes from the visibility-enforced transaction API, so a view
 * can only narrow what the member already sees.
 */
import type { SavedViewFilter } from "@shared/saved-views";
import { buildTransactionsUrl } from "@/features/transactions/transactionFilterParams";
import { parseMoneyInputNumber } from "@/lib/money";

/** "YYYY-MM-DD" to local midnight, matching how the Transactions page parses its own URL. */
function localDate(value: string | undefined): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(year, month - 1, day);
}

export function savedViewUrl(filter: SavedViewFilter): string {
  return buildTransactionsUrl({
    search: filter.search ?? "",
    accountId: filter.accountId ?? null,
    categoryId: filter.categoryId ?? null,
    tagIds: filter.tagIds ?? [],
    startDate: localDate(filter.startDate),
    endDate: localDate(filter.endDate),
    amountMin: filter.amountMin ? parseMoneyInputNumber(filter.amountMin) : null,
    amountMax: filter.amountMax ? parseMoneyInputNumber(filter.amountMax) : null,
    type: filter.type ?? "all",
    reviewed: filter.reviewed ?? "all",
    owner: filter.owner ?? "all",
  });
}
