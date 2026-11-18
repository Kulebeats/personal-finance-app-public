import { useEffect, useMemo, useState } from "react";
import { distance } from "fastest-levenshtein";
import { useMerchants, useMerchantAutocomplete } from "@/hooks/use-settings";
import type { Merchant } from "@/hooks/use-settings";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const AUTOCOMPLETE_DEBOUNCE_MS = 250;

const normalizeMerchantName = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLowerCase();

const cleanMerchantName = (value: string) => {
  const cleaned = value
    .replace(/[#*]+/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\b(pos|purchase|payment|card|debit|credit|txn|ref)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return value.trim();

  return cleaned
    .split(" ")
    .map((word) => {
      if (word.length <= 3 && word === word.toUpperCase()) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
};

const similarityScore = (left: string, right: string) => {
  const maxLen = Math.max(left.length, right.length);
  if (maxLen === 0) return 1;
  return 1 - distance(left, right) / maxLen;
};

const scoreMerchantMatch = (query: string, merchantName: string) => {
  if (!query) return 0;
  const normalized = normalizeMerchantName(merchantName);
  if (!normalized) return 0;
  if (normalized === query) return 1;

  const similarity = similarityScore(query, normalized);
  const includes = normalized.includes(query);
  const tokenBoost = normalized
    .split(" ")
    .some((token) => token.startsWith(query))
    ? 0.15
    : 0;

  const baseScore = includes ? Math.max(similarity, 0.85) : similarity;
  return Math.min(1, baseScore + tokenBoost);
};

const parseMerchantDate = (value?: string | null) => {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
};

const mergeMerchantLists = (
  primary: Merchant[] | undefined,
  secondary: Merchant[]
) => {
  const merged: Merchant[] = [];
  const seen = new Set<string>();

  const addList = (list?: Merchant[]) => {
    if (!list) return;
    list.forEach((merchant) => {
      if (seen.has(merchant.id)) return;
      seen.add(merchant.id);
      merged.push(merchant);
    });
  };

  addList(primary);
  addList(secondary);
  return merged;
};

export interface UseMerchantComboboxOptions {
  value: string;
  selectedMerchantId: string;
  recentLimit?: number;
}

export function useMerchantCombobox({
  value,
  selectedMerchantId,
  recentLimit = 8,
}: UseMerchantComboboxOptions) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  const { data: merchants, isLoading: merchantsLoading } = useMerchants();
  const normalizedSearch = useMemo(
    () => normalizeMerchantName(searchValue),
    [searchValue]
  );
  // Debounce only the server lookup: local filtering stays instant, but a
  // burst of keystrokes collapses into one autocomplete request.
  const debouncedSearch = useDebouncedValue(
    normalizedSearch,
    AUTOCOMPLETE_DEBOUNCE_MS
  );
  const { data: autocompleteMerchants, isLoading: autocompleteLoading } =
    useMerchantAutocomplete(debouncedSearch, 25);

  useEffect(() => {
    if (open) {
      setSearchValue(value || "");
    }
  }, [open, value]);

  const cleanedSearch = useMemo(
    () => searchValue.trim().replace(/\s+/g, " "),
    [searchValue]
  );

  const selectedMerchant = useMemo(() => {
    if (!merchants || !selectedMerchantId) return null;
    return (
      merchants.find((merchant) => merchant.id === selectedMerchantId) || null
    );
  }, [merchants, selectedMerchantId]);

  const filteredMerchants = useMemo(() => {
    if (!merchants) return [];
    if (!normalizedSearch) return merchants;

    const scored = merchants
      .map((merchant) => ({
        merchant,
        score: scoreMerchantMatch(normalizedSearch, merchant.name),
      }))
      .filter(({ score }) => score >= 0.6)
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        const countA = a.merchant.transactionCount || 0;
        const countB = b.merchant.transactionCount || 0;
        if (countA !== countB) return countB - countA;
        return a.merchant.name.localeCompare(b.merchant.name);
      });

    return scored.map(({ merchant }) => merchant);
  }, [merchants, normalizedSearch]);

  const matchingMerchant = useMemo(() => {
    if (!normalizedSearch || !merchants) return null;
    return (
      merchants.find(
        (merchant) =>
          normalizeMerchantName(merchant.name) === normalizedSearch
      ) || null
    );
  }, [merchants, normalizedSearch]);

  const hasExactMerchantMatch = !!matchingMerchant;

  const recentMerchants = useMemo(() => {
    if (!merchants) return [];
    const sorted = [...merchants].sort((a, b) => {
      const dateA = parseMerchantDate(a.lastTransactionDate);
      const dateB = parseMerchantDate(b.lastTransactionDate);
      if (dateA !== dateB) return dateB - dateA;

      const countA = a.transactionCount || 0;
      const countB = b.transactionCount || 0;
      if (countA !== countB) return countB - countA;

      return a.name.localeCompare(b.name);
    });

    return sorted.slice(0, recentLimit);
  }, [merchants, recentLimit]);

  const showRecentMerchants =
    normalizedSearch.length === 0 && recentMerchants.length > 0;

  const searchMerchants = useMemo(() => {
    if (normalizedSearch.length === 0) return filteredMerchants;
    return mergeMerchantLists(autocompleteMerchants, filteredMerchants);
  }, [autocompleteMerchants, filteredMerchants, normalizedSearch]);

  const remainingMerchants = useMemo(() => {
    if (normalizedSearch.length > 0) return searchMerchants;
    if (!merchants) return [];
    const recentIds = new Set(recentMerchants.map((merchant) => merchant.id));
    return searchMerchants.filter((merchant) => !recentIds.has(merchant.id));
  }, [merchants, normalizedSearch, recentMerchants, searchMerchants]);

  const bestSimilarMerchant = useMemo(() => {
    if (!merchants || !normalizedSearch) return null;
    const scored = merchants
      .map((merchant) => ({
        merchant,
        score: scoreMerchantMatch(normalizedSearch, merchant.name),
      }))
      .sort((a, b) => b.score - a.score);
    return scored[0] || null;
  }, [merchants, normalizedSearch]);

  const showSimilarWarning =
    normalizedSearch.length > 0 &&
    !hasExactMerchantMatch &&
    (bestSimilarMerchant?.score ?? 0) >= 0.75;

  return {
    open,
    setOpen,
    searchValue,
    setSearchValue,
    cleanedSearch,
    normalizedSearch,
    merchantsLoading,
    autocompleteLoading,
    selectedMerchant,
    filteredMerchants,
    matchingMerchant,
    hasExactMerchantMatch,
    recentMerchants,
    showRecentMerchants,
    remainingMerchants,
    bestSimilarMerchant,
    showSimilarWarning,
    cleanMerchantName,
  };
}
