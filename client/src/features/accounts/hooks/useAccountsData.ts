import { useState, useMemo, useEffect } from "react";
import {
  useNetWorthHistory,
  useExportAccountsSummary,
} from "@/hooks";
import { type DateRange } from "@/components/accounts";
import { Account, type NetWorthHistoryPoint } from "@/lib/api";
import { getAccountDisplayNumber } from "../utils/accountValue";
import { AccountsSummaryData, NetWorthPoint, type AccountHistoryState } from "../types";
import { isCurrencyCode } from "@shared/denomination";
import { canonicalAccountOwner } from "@shared/account-owner";
import { ACCOUNT_TYPE_GROUPS } from "../constants";
import { useAccountOwnerPreference } from "./useAccountOwnerPreference";

// Re-export DateRange for convenience
export type { DateRange };
export function useAccountsData() {
  const [dateRange, setSelectedDateRange] = useState<DateRange>("1m");
  const owner = useAccountOwnerPreference();
  const { ownerPreferencesReady } = owner;
  const ownerUserId = canonicalAccountOwner(owner.ownerUserId);
  // A new page cannot subscribe to an older mount's delayed response. This is
  // cache identity only; every new response still requires server authorization.
  const [mountIdentity] = useState(() => crypto.randomUUID());
  const [view, setView] = useState({ owner: ownerUserId, revision: 0 });
  const scopeReady = view.owner === ownerUserId;
  // Saved-default adoption is also a scope change. Withdraw before requesting
  // its new lifetime; an old in-flight All response cannot satisfy expansion.
  useEffect(() => {
    setView(previous => previous.owner === ownerUserId ? previous : { owner: ownerUserId, revision: previous.revision + 1 });
  }, [ownerUserId, view.owner]);
  const selectOwner = (value: string | null) => {
    if (!ownerPreferencesReady) return;
    const selected = canonicalAccountOwner(value);
    setView(previous => ({ owner: selected, revision: previous.revision + 1 }));
    owner.setOwnerUserId(selected);
  };

  const isFiltered = ownerUserId !== "all";

  const historyQuery = useNetWorthHistory(dateRange, "user", ownerPreferencesReady && scopeReady, true,
    ownerUserId === "all" ? undefined : ownerUserId, view.revision, mountIdentity);
  const netWorthHistoryData = historyQuery.data;
  // A paused request has isFetching=false, but has not renewed its audience.
  const historyState: AccountHistoryState = !ownerPreferencesReady || !scopeReady || historyQuery.isLoading ||
    (historyQuery.fetchStatus && historyQuery.fetchStatus !== "idle") ? "checking"
    : historyQuery.error ? "error" : !netWorthHistoryData ? "checking"
    : !Array.isArray(netWorthHistoryData.accounts) ? "error" : "ready";
  const netWorthLoading = historyState === "checking";
  const accessibleAccounts = historyState === "ready" ? netWorthHistoryData?.accounts : undefined;
  // Cards, per-type balances, current totals and history use one audience. Owner
  // selection narrows already-visible rows and grants no additional account.
  const accounts = useMemo(() => accessibleAccounts?.filter(account => ownerUserId === "all" || account.ownerUserId === ownerUserId),
    [accessibleAccounts, ownerUserId]);

  const exportSummary = useExportAccountsSummary();

  // Group the current frame after applying the selected owner filter.
  const groupedAccounts = useMemo(() => {
    if (!accounts) return {};

    const groups: Record<string, Account[]> = {};

    accounts.forEach((account) => {
      const groupName = ACCOUNT_TYPE_GROUPS[account.type] || "Other";
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(account);
    });

    return groups;
  }, [accounts]);

  // Helper to calculate total using Money helper
  const getGroupTotal = (groupAccounts: Account[]) => {
    return groupAccounts.reduce(
      (sum, acc) => sum + getAccountDisplayNumber(acc),
      0,
    );
  };

  // Summary data
  const summaryData: AccountsSummaryData = useMemo(() => {
    const latest = netWorthHistoryData?.latest;
    if (historyState !== "ready" || netWorthHistoryData?.currentStatus !== "available" || !latest ||
        !isCurrencyCode(latest.currency) || ![latest.assets, latest.liabilities, latest.netWorth].every(Number.isFinite)) {
      return {
        totalAssets: 0,
        totalLiabilities: 0,
        netWorthValue: 0,
        available: false,
        status: historyState === "ready" ? "unavailable" : historyState,
      };
    }
    return {
      totalAssets: latest.assets,
      totalLiabilities: latest.liabilities,
      netWorthValue: latest.netWorth,
      available: true,
      status: "available",
      currency: latest.currency,
    };
  }, [netWorthHistoryData, historyState]);

  // Chart data
  const chartData: NetWorthPoint[] = useMemo(() => {
    if (historyState !== "ready") return [];
    return (netWorthHistoryData?.series ?? []).filter(point => point.provenance === "captured_snapshot" && isCurrencyCode(point.currency))
      .map((point: NetWorthHistoryPoint) => ({
      date: point.date,
      value: point.netWorth,
      assets: point.assets,
      liabilities: point.liabilities,
      currency: point.currency,
      provenance: point.provenance,
    }));
  }, [netWorthHistoryData, historyState]);

  return {
    // State
    dateRange,
    setDateRange: (value: DateRange) => {
      setView(previous => ({ ...previous, revision: previous.revision + 1 }));
      setSelectedDateRange(value);
    },
    ...owner,
    ownerUserId,
    setOwnerUserId: selectOwner,
    resetOwnerFilter: () => selectOwner("all"),
    isFiltered,
    hasAccessibleAccounts: accessibleAccounts ? (netWorthHistoryData?.accessibleAccountCount ?? accessibleAccounts.length) > 0 : undefined,

    // Actions
    refetch: () => historyQuery.refetch(),
    onRetryHistory: () => { void historyQuery.refetch(); },
    exportSummary,
    getGroupTotal,

    // Data
    accounts,
    groupedAccounts,
    summaryData,
    chartData,
    historyState,

    // Loading
    isLoading: netWorthLoading,
    accountsLoading: owner.ownerPreferencesLoading,
    accountsError: historyState === "error" ? historyQuery.error ?? new Error("Account frame is unavailable. Please retry.") : null,
    netWorthLoading,
  };
}
