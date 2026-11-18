import { useState, useMemo } from "react";
import {
  useAccounts,
  useNetWorthSummary,
  useNetWorthHistory,
  useExportAccountsSummary,
} from "@/hooks";
import { type DateRange } from "@/components/accounts";
import { Account, type NetWorthHistoryPoint } from "@/lib/api";
import { getAccountDisplayNumber } from "../utils/accountValue";
import { AccountsSummaryData, NetWorthPoint } from "../types";
import { ACCOUNT_TYPE_GROUPS } from "../constants";

// Re-export DateRange for convenience
export type { DateRange };
export function useAccountsData() {
  const [dateRange, setDateRange] = useState<DateRange>("1m");
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);

  // Fetch data with server-side owner filtering
  const {
    data: accounts,
    isLoading: accountsLoading,
    error: accountsError,
    refetch,
  } = useAccounts({ ownerUserId });

  const { data: netWorth, isLoading: netWorthLoading } = useNetWorthSummary();

  const { data: netWorthHistoryData, isLoading: historyLoading } =
    useNetWorthHistory(dateRange);

  const exportSummary = useExportAccountsSummary();

  // Group accounts by type (server already filters by ownerUserId)
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
    if (!netWorth) {
      return {
        totalAssets: 0,
        totalLiabilities: 0,
        netWorthValue: 0,
      };
    }
    return {
      totalAssets: netWorth.totalAssets,
      totalLiabilities: netWorth.totalLiabilities,
      netWorthValue: netWorth.netWorth,
    };
  }, [netWorth]);

  // Chart data
  const chartData: NetWorthPoint[] = useMemo(() => {
    if (
      !netWorthHistoryData?.series ||
      netWorthHistoryData.series.length === 0
    ) {
      if (!summaryData.netWorthValue) return [];
      // Fallback single point
      return [
        {
          date: new Date().toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          }),
          value: summaryData.netWorthValue,
          assets: summaryData.totalAssets,
          liabilities: summaryData.totalLiabilities,
        },
      ];
    }

    return netWorthHistoryData.series.map((point: NetWorthHistoryPoint) => ({
      date: new Date(point.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      value: point.netWorth,
      assets: point.assets,
      liabilities: point.liabilities,
    }));
  }, [netWorthHistoryData, summaryData]);

  return {
    // State
    dateRange,
    setDateRange,
    ownerUserId,
    setOwnerUserId,

    // Actions
    refetch,
    exportSummary,
    getGroupTotal,

    // Data
    accounts,
    groupedAccounts,
    summaryData,
    chartData,

    // Loading
    isLoading: accountsLoading || netWorthLoading || historyLoading,
    accountsLoading,
    accountsError,
    netWorthLoading,
  };
}
