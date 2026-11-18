/**
 * Transaction Filter <-> URL Query Param Contract (R8)
 *
 * This module is the single source of truth for how `TransactionFilters` state
 * round-trips through the Transactions page URL. The Transactions page uses it
 * to hydrate filters on mount/URL-change and to write filter changes back to
 * the URL (see `hooks/useTransactionFilters.ts`). Any other part of the app
 * that wants to deep-link into a filtered transaction list (Reports drill-down,
 * Budget detail, CommandPalette, AccountDetail, ...) MUST build its link with
 * `buildTransactionsUrl` / `serializeTransactionFilterParams` rather than
 * hand-rolling query strings, so links stay correct as the filter shape
 * evolves.
 *
 * Param contract (filter field -> query param key):
 *
 * | Filter field | Query param  | Format                        |
 * | ------------ | ------------ | ------------------------------ |
 * | search       | `q`          | free text                      |
 * | accountId    | `accountId`  | account UUID                   |
 * | categoryId   | `categoryId` | category UUID                  |
 * | tagIds       | `tags`       | comma-separated tag UUIDs      |
 * | startDate    | `from`       | `YYYY-MM-DD`                   |
 * | endDate      | `to`         | `YYYY-MM-DD`                   |
 * | amountMin    | `amountMin`  | decimal number                 |
 * | amountMax    | `amountMax`  | decimal number                 |
 * | type         | `type`       | `income` \| `expense` \| `transfer` |
 * | reviewed     | `reviewed`   | `reviewed` \| `unreviewed`     |
 * | owner        | `owner`      | `mine` \| `shared`             |
 *
 * `accountId` / `categoryId` / `from` / `to` / `type` intentionally match the
 * param names `client/src/hooks/use-drilldown.ts` (used by the Annual
 * Dashboard report widgets) and `CommandPalette` were already emitting before
 * this contract existed - they were silently ignored by the Transactions page
 * (audit v2 finding B1). Keeping those names means both of those existing
 * callers land correctly filtered the moment this contract ships, with no
 * changes required on their end.
 *
 * A value equal to its default is always omitted from the URL, so the
 * "no params present" case renders identically to today's default view and
 * URLs stay short and readable.
 */
import { parseMoneyInputNumber } from "@/lib/money";
import type { TransactionFilters } from "./types";
import { defaultFilters } from "./types";

/** Query param key for each `TransactionFilters` field. Keep this in sync with the table above. */
export const TRANSACTION_FILTER_PARAM_KEYS: Record<keyof TransactionFilters, string> = {
  search: "q",
  accountId: "accountId",
  categoryId: "categoryId",
  tagIds: "tags",
  startDate: "from",
  endDate: "to",
  amountMin: "amountMin",
  amountMax: "amountMax",
  type: "type",
  reviewed: "reviewed",
  owner: "owner",
};

export const TRANSACTIONS_PATH = "/transactions";

const TYPE_VALUES: ReadonlyArray<TransactionFilters["type"]> = [
  "all",
  "income",
  "expense",
  "transfer",
];
const REVIEWED_VALUES: ReadonlyArray<TransactionFilters["reviewed"]> = [
  "all",
  "reviewed",
  "unreviewed",
];
const OWNER_VALUES: ReadonlyArray<TransactionFilters["owner"]> = [
  "all",
  "mine",
  "shared",
];

function isOneOf<T extends string>(
  value: string | null,
  allowed: ReadonlyArray<T>,
): value is T {
  return value !== null && (allowed as ReadonlyArray<string>).includes(value);
}

/**
 * Parse a "YYYY-MM-DD" URL param into a local-midnight Date, or null if
 * absent/malformed/not a real calendar date (CLAUDE.md Rule 8: regex alone
 * is not enough - "2024-02-30" must be rejected, not silently clamped).
 */
function parseDateParam(value: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Format a Date into the "YYYY-MM-DD" URL param format using local date parts (no TZ shift). */
function formatDateParam(date: Date | null): string | undefined {
  if (!date) return undefined;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parse URL search params into a complete `TransactionFilters` object.
 * Missing or invalid values fall back to `defaultFilters`, so this is always
 * safe to call directly off `useSearch()` / `location.search`.
 */
export function parseTransactionFilterParams(
  input: URLSearchParams | string,
): TransactionFilters {
  const params = typeof input === "string" ? new URLSearchParams(input) : input;
  const keys = TRANSACTION_FILTER_PARAM_KEYS;

  const tagsParam = params.get(keys.tagIds);
  const typeParam = params.get(keys.type);
  const reviewedParam = params.get(keys.reviewed);
  const ownerParam = params.get(keys.owner);

  return {
    search: params.get(keys.search) ?? defaultFilters.search,
    accountId: params.get(keys.accountId) || defaultFilters.accountId,
    categoryId: params.get(keys.categoryId) || defaultFilters.categoryId,
    tagIds: tagsParam
      ? tagsParam
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      : defaultFilters.tagIds,
    startDate: parseDateParam(params.get(keys.startDate)) ?? defaultFilters.startDate,
    endDate: parseDateParam(params.get(keys.endDate)) ?? defaultFilters.endDate,
    amountMin:
      parseMoneyInputNumber(params.get(keys.amountMin)) ?? defaultFilters.amountMin,
    amountMax:
      parseMoneyInputNumber(params.get(keys.amountMax)) ?? defaultFilters.amountMax,
    type: isOneOf(typeParam, TYPE_VALUES) ? typeParam : defaultFilters.type,
    reviewed: isOneOf(reviewedParam, REVIEWED_VALUES)
      ? reviewedParam
      : defaultFilters.reviewed,
    owner: isOneOf(ownerParam, OWNER_VALUES) ? ownerParam : defaultFilters.owner,
  };
}

/**
 * Serialize (possibly partial) filter state into URL search params.
 * Values equal to their default are omitted so URLs stay short and the
 * "no params" case is indistinguishable from today's default view.
 */
export function serializeTransactionFilterParams(
  filters: Partial<TransactionFilters>,
): URLSearchParams {
  const merged: TransactionFilters = { ...defaultFilters, ...filters };
  const keys = TRANSACTION_FILTER_PARAM_KEYS;
  const params = new URLSearchParams();

  if (merged.search) params.set(keys.search, merged.search);
  if (merged.accountId) params.set(keys.accountId, merged.accountId);
  if (merged.categoryId) params.set(keys.categoryId, merged.categoryId);
  if (merged.tagIds.length > 0) params.set(keys.tagIds, merged.tagIds.join(","));

  const from = formatDateParam(merged.startDate);
  if (from) params.set(keys.startDate, from);
  const to = formatDateParam(merged.endDate);
  if (to) params.set(keys.endDate, to);

  if (merged.amountMin !== null) params.set(keys.amountMin, String(merged.amountMin));
  if (merged.amountMax !== null) params.set(keys.amountMax, String(merged.amountMax));

  if (merged.type !== defaultFilters.type) params.set(keys.type, merged.type);
  if (merged.reviewed !== defaultFilters.reviewed)
    params.set(keys.reviewed, merged.reviewed);
  if (merged.owner !== defaultFilters.owner) params.set(keys.owner, merged.owner);

  return params;
}

/**
 * Build a full `/transactions?...` link for the given (possibly partial)
 * filters. This is the contract every cross-section deep-link (Reports
 * drill-down, Budget detail, CommandPalette, AccountDetail, ...) should use
 * instead of hand-building query strings.
 */
export function buildTransactionsUrl(filters: Partial<TransactionFilters>): string {
  const query = serializeTransactionFilterParams(filters).toString();
  return query ? `${TRANSACTIONS_PATH}?${query}` : TRANSACTIONS_PATH;
}
