/**
 * useAccountDetail Hook
 *
 * Fetches account data, balance history, and transactions.
 * NOTE: Business logic (balanceChange calculation, grouping) has been REMOVED.
 * These should come from the server API or be computed in a dedicated calculation service.
 */

import { useState } from "react";
import { useAccount, useAccountBalanceHistory, useTransactions } from "@/hooks";
import { type DateRange } from "@/components/accounts";

export function useAccountDetail(accountId: string) {
  const [dateRange, setDateRange] = useState<DateRange>("1m");

  // Fetch account data
  const {
    data: account,
    isLoading: accountLoading,
    error: accountError,
    refetch: refetchAccount,
    isFetching: isRefetching,
  } = useAccount(accountId);

  // Fetch balance history - returns raw data from API
  const { data: balanceHistory, isLoading: historyLoading } =
    useAccountBalanceHistory(accountId, dateRange);

  // Fetch transactions for this account
  const { data: transactionsData, isLoading: transactionsLoading } =
    useTransactions({ accountId, limit: 50 });

  // Chart data formatting - simple transformation, not business logic
  const chartData =
    balanceHistory?.map((point) => ({
      date: new Date(point.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      value: point.balance,
    })) ?? [];

  // Transaction grouping - simple UI grouping, delegate to component if needed
  const transactions = transactionsData?.transactions ?? [];

  return {
    account,
    accountLoading,
    accountError,
    balanceHistory,
    historyLoading,
    transactionsData,
    transactionsLoading,
    chartData,
    transactions,
    dateRange,
    setDateRange,
    // MED-002: Expose refetch for sidebar refresh button
    refetchAccount,
    isRefetching,
  };
}
