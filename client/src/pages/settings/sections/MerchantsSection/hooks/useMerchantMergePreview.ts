import { useEffect, useState } from "react";
import type { Merchant } from "@/hooks/use-settings";

export interface MerchantMergePreviewState {
  mergePreviewGroup: Merchant[] | null;
  mergePreviewTarget: string;
  mergePreviewSelection: Record<string, boolean>;
  mergePreviewNameSource: string;
  mergePreviewLogoSource: string;
  mergingDuplicateKey: string | null;
}

export interface MerchantMergePreviewActions {
  setMergePreviewTarget: (target: string) => void;
  setMergePreviewSelection: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  setMergePreviewNameSource: React.Dispatch<React.SetStateAction<string>>;
  setMergePreviewLogoSource: React.Dispatch<React.SetStateAction<string>>;
  openMergePreview: (
    group: { merchants: Merchant[] },
    options?: { targetId?: string }
  ) => void;
  resetMergePreview: () => void;
  getDuplicateKey: (merchantsList: Merchant[]) => string;
}

export interface UseMerchantMergePreviewResult {
  state: MerchantMergePreviewState;
  actions: MerchantMergePreviewActions;
  setMergingDuplicateKey: (key: string | null) => void;
}

export function useMerchantMergePreview(
  duplicateTargets: Record<string, string>
): UseMerchantMergePreviewResult {
  const [mergePreviewGroup, setMergePreviewGroup] = useState<Merchant[] | null>(
    null
  );
  const [mergePreviewTarget, setMergePreviewTarget] = useState<string>("");
  const [mergePreviewSelection, setMergePreviewSelection] = useState<
    Record<string, boolean>
  >({});
  const [mergePreviewNameSource, setMergePreviewNameSource] = useState("");
  const [mergePreviewLogoSource, setMergePreviewLogoSource] = useState("");
  const [mergingDuplicateKey, setMergingDuplicateKey] = useState<string | null>(
    null
  );

  // Merge preview group sync
  useEffect(() => {
    if (!mergePreviewGroup || mergePreviewGroup.length === 0) return;
    if (!mergePreviewTarget) {
      setMergePreviewTarget(mergePreviewGroup[0]?.id || "");
    }
    const nameSourceInGroup = mergePreviewGroup.some(
      (merchant) => merchant.id === mergePreviewNameSource
    );
    const logoSourceInGroup = mergePreviewGroup.some(
      (merchant) => merchant.id === mergePreviewLogoSource
    );
    if (!nameSourceInGroup) {
      setMergePreviewNameSource(mergePreviewTarget);
    }
    if (!logoSourceInGroup) {
      setMergePreviewLogoSource(mergePreviewTarget);
    }
  }, [
    mergePreviewGroup,
    mergePreviewTarget,
    mergePreviewNameSource,
    mergePreviewLogoSource,
  ]);

  const getDuplicateKey = (merchantsList: Merchant[]) =>
    merchantsList
      .map((merchant) => merchant.id)
      .sort()
      .join("_");

  const openMergePreview = (
    group: { merchants: Merchant[] },
    options?: { targetId?: string }
  ) => {
    if (!group.merchants.length) return;
    const groupKey = getDuplicateKey(group.merchants);
    const targetId =
      options?.targetId ||
      duplicateTargets[groupKey] ||
      group.merchants[0]?.id ||
      "";
    const selection = group.merchants.reduce(
      (acc, merchant) => ({
        ...acc,
        [merchant.id]: true,
      }),
      {} as Record<string, boolean>
    );

    setMergePreviewGroup(group.merchants);
    setMergePreviewTarget(targetId);
    setMergePreviewSelection(selection);
    setMergePreviewNameSource(targetId);
    setMergePreviewLogoSource(targetId);
  };

  const resetMergePreview = () => {
    setMergePreviewGroup(null);
    setMergePreviewTarget("");
    setMergePreviewSelection({});
    setMergePreviewNameSource("");
    setMergePreviewLogoSource("");
  };

  return {
    state: {
      mergePreviewGroup,
      mergePreviewTarget,
      mergePreviewSelection,
      mergePreviewNameSource,
      mergePreviewLogoSource,
      mergingDuplicateKey,
    },
    actions: {
      setMergePreviewTarget,
      setMergePreviewSelection,
      setMergePreviewNameSource,
      setMergePreviewLogoSource,
      openMergePreview,
      resetMergePreview,
      getDuplicateKey,
    },
    setMergingDuplicateKey,
  };
}
