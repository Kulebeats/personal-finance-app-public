import { useEffect, useMemo, useState } from "react";
import type { Merchant } from "@/hooks/use-settings";

export interface MerchantBulkActionsState {
  bulkSelection: Record<string, boolean>;
  bulkMergeTarget: string;
}

export interface MerchantBulkActionsActions {
  setBulkSelection: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setBulkMergeTarget: (target: string) => void;
  toggleBulkSelection: (id: string) => void;
  clearBulkSelection: () => void;
  selectAllVisible: () => void;
}

export interface MerchantBulkActionsDerived {
  bulkSelectedIds: string[];
  bulkSelectedMerchants: Merchant[];
}

export interface UseMerchantBulkActionsResult {
  state: MerchantBulkActionsState;
  actions: MerchantBulkActionsActions;
  derived: MerchantBulkActionsDerived;
}

export function useMerchantBulkActions(
  merchants: Merchant[] | undefined,
  filteredMerchants: Merchant[] | undefined
): UseMerchantBulkActionsResult {
  const [bulkSelection, setBulkSelection] = useState<Record<string, boolean>>({});
  const [bulkMergeTarget, setBulkMergeTarget] = useState("");

  const bulkSelectedIds = useMemo(
    () => Object.keys(bulkSelection).filter((id) => bulkSelection[id]),
    [bulkSelection]
  );

  const bulkSelectedMerchants = useMemo(() => {
    if (!merchants) return [];
    return merchants.filter((merchant) =>
      bulkSelectedIds.includes(merchant.id)
    );
  }, [bulkSelectedIds, merchants]);

  // Ensure bulkMergeTarget is valid when selection changes
  useEffect(() => {
    if (bulkSelectedIds.length < 2) {
      setBulkMergeTarget("");
      return;
    }
    if (!bulkSelectedIds.includes(bulkMergeTarget)) {
      setBulkMergeTarget(bulkSelectedIds[0] || "");
    }
  }, [bulkMergeTarget, bulkSelectedIds]);

  const toggleBulkSelection = (id: string) => {
    setBulkSelection((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const clearBulkSelection = () => {
    setBulkSelection({});
  };

  const selectAllVisible = () => {
    if (!filteredMerchants) return;
    setBulkSelection((prev) => {
      const next = { ...prev };
      filteredMerchants.forEach((merchant) => {
        next[merchant.id] = true;
      });
      return next;
    });
  };

  return {
    state: {
      bulkSelection,
      bulkMergeTarget,
    },
    actions: {
      setBulkSelection,
      setBulkMergeTarget,
      toggleBulkSelection,
      clearBulkSelection,
      selectAllVisible,
    },
    derived: {
      bulkSelectedIds,
      bulkSelectedMerchants,
    },
  };
}
