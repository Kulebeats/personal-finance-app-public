/**
 * useTransactionSelection Hook
 *
 * Manages multi-select state for bulk operations.
 */

import { useState, useCallback, useMemo } from "react";
import type { TransactionWithDetails } from "../types";

export function useTransactionSelection(
  transactions: TransactionWithDetails[]
) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(transactions.map((t) => t.id)));
  }, [transactions]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectRange = useCallback(
    (startId: string, endId: string) => {
      const startIndex = transactions.findIndex((t) => t.id === startId);
      const endIndex = transactions.findIndex((t) => t.id === endId);

      if (startIndex === -1 || endIndex === -1) return;

      const start = Math.min(startIndex, endIndex);
      const end = Math.max(startIndex, endIndex);

      const idsInRange = transactions.slice(start, end + 1).map((t) => t.id);
      setSelectedIds((prev) => new Set([...prev, ...idsInRange]));
    },
    [transactions]
  );

  const isAllSelected = useMemo(() => {
    return transactions.length > 0 && selectedIds.size === transactions.length;
  }, [transactions.length, selectedIds.size]);

  const selectedTransactions = useMemo(() => {
    return transactions.filter((t) => selectedIds.has(t.id));
  }, [transactions, selectedIds]);

  return {
    selectedIds,
    selectedCount: selectedIds.size,
    selectedTransactions,
    isAllSelected,
    toggleSelection,
    selectAll,
    clearSelection,
    selectRange,
    hasSelection: selectedIds.size > 0,
  };
}
