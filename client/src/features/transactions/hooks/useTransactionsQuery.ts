/**
 * useTransactionsQuery Hook
 *
 * React Query hook for fetching transactions with filtering.
 */

import { formatDateParam } from "@/lib/dates";
import { useInfiniteQuery } from "@tanstack/react-query";
import { transactionsApi, type Transaction } from "@/lib/api";
import type { TransactionFilters, TransactionWithDetails } from "../types";

interface UseTransactionsQueryOptions {
  filters: Partial<TransactionFilters>;
  limit?: number;
  enabled?: boolean;
  /** Current user ID for "mine" filter - required when filters.owner === "mine" */
  userId?: string;
}

interface TransactionsResponse {
  transactions: TransactionWithDetails[];
  pagination: {
    page: number;
    limit: number;
    offset: number;
    count: number;
    hasMore: boolean;
  };
}

export function useTransactionsQuery({
  filters,
  limit = 50,
  enabled = true,
  userId,
}: UseTransactionsQueryOptions) {
  return useInfiniteQuery<TransactionsResponse>({
    queryKey: ["transactions", filters, limit, userId],
    queryFn: async ({ pageParam = 0 }) => {
      const params: Record<string, any> = {
        limit,
        offset: pageParam as number,
      };

      // Forward all filters to API
      if (filters.accountId) params.accountId = filters.accountId;
      if (filters.categoryId) params.categoryId = filters.categoryId;
      if (filters.startDate)
        params.startDate = formatDateParam(filters.startDate);
      if (filters.endDate)
        params.endDate = formatDateParam(filters.endDate);
      if (filters.type && filters.type !== "all") params.type = filters.type;
      if (filters.search) params.search = filters.search;
      if (filters.amountMin !== null && filters.amountMin !== undefined)
        params.amountMin = filters.amountMin;
      if (filters.amountMax !== null && filters.amountMax !== undefined)
        params.amountMax = filters.amountMax;
      if (filters.reviewed && filters.reviewed !== "all")
        params.reviewed = filters.reviewed;
      // Fix: Handle owner filter properly - "mine" needs userId, "shared" needs null
      if (filters.owner && filters.owner !== "all") {
        if (filters.owner === "mine" && userId) {
          params.ownerUserId = userId;
        } else if (filters.owner === "shared") {
          params.ownerUserId = null;
        }
      }

      const response = await transactionsApi.list(params);

      return {
        transactions: response.transactions as TransactionWithDetails[],
        pagination: {
          ...response.pagination,
          page: Math.floor(response.pagination.offset / limit),
          // Use server-provided hasNext field (V7 pagination format)
          hasMore: response.pagination.hasNext ?? false,
        },
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (lastPage.pagination.hasMore) {
        return lastPage.pagination.offset + limit;
      }
      return undefined;
    },
    enabled,
    staleTime: 30_000, // 30 seconds
  });
}

// Flatten pages into single array
export function flattenTransactionPages(
  pages: TransactionsResponse[] | undefined
): TransactionWithDetails[] {
  if (!pages) return [];
  return pages.flatMap((page) => page.transactions);
}
