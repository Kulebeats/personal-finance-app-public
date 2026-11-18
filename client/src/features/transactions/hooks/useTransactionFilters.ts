/**
 * useTransactionFilters Hook
 *
 * Manages filter state for transactions, backed by the URL query string
 * (R8: Transactions page URL-param filter contract - audit v2 finding B1).
 * The URL is the single source of truth for filter state: it is parsed on
 * mount/URL-change and every `setFilters`/`resetFilters` call writes back to
 * the URL (via `replace`, so filter tweaks don't pollute browser history).
 * This makes filtered views shareable/bookmarkable and lets other pages
 * (Reports drill-down, CommandPalette, AccountDetail) deep-link in with a
 * filtered result instead of silently landing on an unfiltered list.
 *
 * See `../transactionFilterParams.ts` for the documented param contract.
 */

import { useCallback, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import type { TransactionFilters } from "../types";
import { defaultFilters } from "../types";
import {
  parseTransactionFilterParams,
  serializeTransactionFilterParams,
} from "../transactionFilterParams";

export function useTransactionFilters() {
  const [location, navigate] = useLocation();
  const search = useSearch();

  const filters = useMemo(() => parseTransactionFilterParams(search), [search]);

  // Update filters - merges into the current filter state and replaces the
  // URL's query string (not a push navigation - filter tweaks shouldn't add
  // browser-history entries). Builds the URL manually (rather than wouter's
  // useSearchParams) so a fully-default filter state clears back to the bare
  // path instead of leaving a trailing "?".
  const setFilters = useCallback(
    (updates: Partial<TransactionFilters>) => {
      const next = { ...filters, ...updates };
      const query = serializeTransactionFilterParams(next).toString();
      navigate(query ? `${location}?${query}` : location, { replace: true });
    },
    [filters, location, navigate],
  );

  // Reset all filters back to defaults (clears the query string).
  const resetFilters = useCallback(() => {
    navigate(location, { replace: true });
  }, [location, navigate]);

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return (
      filters.search !== defaultFilters.search ||
      filters.accountId !== defaultFilters.accountId ||
      filters.categoryId !== defaultFilters.categoryId ||
      filters.tagIds.length > 0 ||
      filters.startDate !== defaultFilters.startDate ||
      filters.endDate !== defaultFilters.endDate ||
      filters.amountMin !== defaultFilters.amountMin ||
      filters.amountMax !== defaultFilters.amountMax ||
      filters.type !== defaultFilters.type ||
      filters.reviewed !== defaultFilters.reviewed ||
      filters.owner !== defaultFilters.owner
    );
  }, [filters]);

  // Count active filters (excluding search)
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.accountId) count++;
    if (filters.categoryId) count++;
    if (filters.tagIds.length > 0) count++;
    if (filters.startDate || filters.endDate) count++;
    if (filters.amountMin !== null || filters.amountMax !== null) count++;
    if (filters.type !== "all") count++;
    if (filters.reviewed !== "all") count++;
    if (filters.owner !== "all") count++;
    return count;
  }, [filters]);

  return {
    filters,
    setFilters,
    resetFilters,
    hasActiveFilters,
    activeFilterCount,
  };
}
