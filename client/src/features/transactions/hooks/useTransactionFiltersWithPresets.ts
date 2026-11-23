/**
 * Transactions filters with the saved default preset (R11 / ORG-010).
 *
 * Wraps the URL-backed filters (R8). When the page opens with no filter in the
 * URL, the user's default "transactions" preset is applied once. A deep link
 * that carries filters always wins. Reset returns to the default preset, or to
 * no filters when there is none (a deleted default is refetched as null).
 */
import { useCallback, useEffect, useRef } from "react";
import { defaultFilters, type TransactionFilters } from "../types";
import { presetToTransactionFilters } from "../filterPresetFilters";
import { useDefaultFilterPreset } from "./useFilterPresets";
import { useTransactionFilters } from "./useTransactionFilters";

export const TRANSACTIONS_PRESET_CONTEXT = "transactions";

export function useTransactionFiltersWithPresets() {
  const base = useTransactionFilters();
  const { setFilters, resetFilters, hasActiveFilters } = base;
  const { data: defaultPreset, isSuccess } = useDefaultFilterPreset(TRANSACTIONS_PRESET_CONTEXT);
  const hasCheckedDefault = useRef(false);

  // Replace every filter (a merge would keep fields the preset leaves unset).
  const applyFilters = useCallback(
    (next: TransactionFilters) => setFilters({ ...defaultFilters, ...next }),
    [setFilters],
  );

  useEffect(() => {
    if (hasCheckedDefault.current || !isSuccess) return;
    hasCheckedDefault.current = true;
    if (defaultPreset && !hasActiveFilters) {
      applyFilters(presetToTransactionFilters(defaultPreset.filters));
    }
  }, [isSuccess, defaultPreset, hasActiveFilters, applyFilters]);

  const resetToDefault = useCallback(() => {
    if (defaultPreset) applyFilters(presetToTransactionFilters(defaultPreset.filters));
    else resetFilters();
  }, [defaultPreset, applyFilters, resetFilters]);

  return { ...base, applyFilters, resetFilters: resetToDefault };
}
