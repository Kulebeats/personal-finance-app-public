import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import type { Merchant } from "@/hooks/use-settings";

export type SortOption = "name" | "count" | "recent";

export interface MerchantFiltersState {
  searchQuery: string;
  sortBy: SortOption;
}

export interface MerchantFiltersActions {
  setSearchQuery: (query: string) => void;
  setSortBy: (sortBy: SortOption) => void;
}

export interface MerchantFiltersDerived {
  filteredMerchants: Merchant[] | undefined;
}

export interface UseMerchantFiltersResult {
  state: MerchantFiltersState;
  actions: MerchantFiltersActions;
  derived: MerchantFiltersDerived;
}

export function useMerchantFilters(
  merchants: Merchant[] | undefined
): UseMerchantFiltersResult {
  const [location] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("count");

  // Sync search query from URL
  useEffect(() => {
    const queryString = location.split("?")[1] || "";
    const params = new URLSearchParams(queryString);
    const query = params.get("q");
    if (query && query !== searchQuery) {
      setSearchQuery(query);
    }
  }, [location, searchQuery]);

  const filteredMerchants = useMemo(() => {
    if (!merchants) return undefined;
    return merchants
      .filter((merchant) =>
        merchant.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
      .sort((a, b) => {
        if (sortBy === "name") return a.name.localeCompare(b.name);
        if (sortBy === "count") {
          return (b.transactionCount || 0) - (a.transactionCount || 0);
        }
        return 0;
      });
  }, [merchants, searchQuery, sortBy]);

  return {
    state: {
      searchQuery,
      sortBy,
    },
    actions: {
      setSearchQuery,
      setSortBy,
    },
    derived: {
      filteredMerchants,
    },
  };
}
