/**
 * Transaction Hooks
 *
 * TanStack Query hooks for transaction operations.
 * Uses the API client for server-backed data.
 */

import { userErrorMessage } from "@/lib/errorCopy";
import { useEffect } from "react";
import {
  focusManager,
  onlineManager,
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";
import {
  transactionsApi,
  type Transaction,
  type CreateTransactionInput,
  type CreateTransferInput,
  type UpdateTransferInput,
  type UpdateTransactionInput,
  type TransactionSummary,
  type ListTransactionsParams,
  generateIdempotencyKey,
} from "../lib/api";
import { useToast } from "@/hooks/use-toast";
import { accountKeys } from "./useAccounts";
import { invalidateReportsForChange } from "./use-reports";

type TransactionSummaryFilters = Omit<ListTransactionsParams, "startDate" | "endDate" | "limit" | "offset">;

// Query keys
export const transactionKeys = {
  all: ["transactions"] as const,
  list: (params?: ListTransactionsParams) =>
    [...transactionKeys.all, "list", params] as const,
  detail: (id: string) => [...transactionKeys.all, "detail", id] as const,
  summary: (startDate: string, endDate: string, filters: TransactionSummaryFilters = {}) =>
    [...transactionKeys.all, "summary", startDate, endDate, filters] as const,
};

/**
 * Hook to list transactions with pagination
 */
export function useTransactions(
  params?: ListTransactionsParams,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: transactionKeys.list(params),
    queryFn: () => transactionsApi.list(params),
    staleTime: 30_000, // 30 seconds
    enabled: options?.enabled ?? true,
  });
}

/**
 * Hook for infinite scroll transactions
 */
export function useInfiniteTransactions(
  params?: Omit<ListTransactionsParams, "offset">,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: [...transactionKeys.all, "infinite", params],
    enabled,
    queryFn: ({ pageParam = 0 }) =>
      transactionsApi.list({
        ...params,
        offset: pageParam,
        limit: params?.limit || 50,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      // Use pageSize (actual items returned) for offset calculation, not count (which is now totalCount)
      const nextOffset =
        lastPage.pagination.offset + lastPage.pagination.pageSize;
      return nextOffset < lastPage.pagination.totalCount
        ? nextOffset
        : undefined;
    },
  });
}

/**
 * Hook to get a single transaction
 */
export function useTransaction(id: string) {
  return useQuery({
    queryKey: transactionKeys.detail(id),
    queryFn: () => transactionsApi.get(id),
    enabled: !!id,
  });
}

/**
 * Hook to get transaction summary
 * R-09: Updated to use object-based API params
 */
export function useTransactionSummary(
  startDate: string,
  endDate: string,
  filters: TransactionSummaryFilters = {},
  enabled = true,
) {
  const client = useQueryClient();
  const queryKey = transactionKeys.summary(startDate, endDate, filters);
  const canRead = enabled && !!startDate && !!endDate;
  const result = useQuery({
    queryKey,
    queryFn: ({ signal }) => transactionsApi.getSummary({ startDate, endDate, ...filters }, signal),
    enabled: canRead,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const query = client.getQueryCache().find({ queryKey, exact: true });
  useEffect(() => {
    if (!canRead || !query) return;
    const refresh = () => {
      // TanStack normally joins an in-flight GET on focus. It may predate the
      // privacy change, even when this is the very first read for this key.
      const match = { queryKey: query.queryKey, exact: true };
      void client.cancelQueries(match);
      void client.refetchQueries(match);
    };
    const unsubscribeFocus = focusManager.subscribe(focused => { if (focused) refresh(); });
    const unsubscribeOnline = onlineManager.subscribe(online => { if (online) refresh(); });
    return () => { unsubscribeFocus(); unsubscribeOnline(); };
  }, [canRead, client, query]);
  // Another household member can change the amount or withdraw access.
  // A cached result cannot stand in for the new read, including when offline.
  const current = canRead && result.fetchStatus === "idle" && result.isSuccess;
  return { ...result, data: current ? result.data : undefined };
}

/**
 * Hook to create a transaction
 */
export function useCreateTransaction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (data: CreateTransactionInput) =>
      transactionsApi.create({
        ...data,
        idempotencyKey: data.idempotencyKey || generateIdempotencyKey(),
      }),
    onSuccess: (result) => {
      // Invalidate list queries
      queryClient.invalidateQueries({ queryKey: transactionKeys.all });
      // Invalidate account balances
      queryClient.invalidateQueries({ queryKey: accountKeys.all });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      invalidateReportsForChange(queryClient, "transaction");

      if (result.isDuplicate) {
        toast({
          title: "Duplicate detected",
          description: "This transaction was already created.",
        });
      } else {
        toast({
          title: "Transaction created",
          description: `${result.transaction.name} has been added.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create transaction",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

/**
 * Hook to create a transfer
 */
export function useCreateTransfer() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (data: CreateTransferInput) =>
      transactionsApi.createTransfer({
        ...data,
        idempotencyKey: data.idempotencyKey || generateIdempotencyKey(),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: transactionKeys.all });
      queryClient.invalidateQueries({ queryKey: accountKeys.all });
      invalidateReportsForChange(queryClient, "transaction");

      if (result.isDuplicate) {
        toast({
          title: "Duplicate detected",
          description: "This transfer was already created.",
        });
      } else {
        toast({
          title: "Transfer created",
          description: "Funds have been transferred.",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create transfer",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

/**
 * Hook to update a transfer
 */
export function useUpdateTransfer() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTransferInput }) =>
      transactionsApi.updateTransfer(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transactionKeys.list() });
      queryClient.invalidateQueries({ queryKey: accountKeys.all });
      // Audit v2 B2: this mutation omitted budget/category/report
      // invalidation entirely - editing amount/date/accounts on a transfer
      // must refresh the same caches a transaction edit does.
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      invalidateReportsForChange(queryClient, "transaction");
      toast({
        title: "Transfer updated",
        description: "The transfer has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update transfer",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

/**
 * Hook to update a transaction
 */
export function useUpdateTransaction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTransactionInput }) =>
      transactionsApi.update(id, data),
    onSuccess: async (updatedTransaction) => {
      queryClient.setQueryData(
        transactionKeys.detail(updatedTransaction.id),
        updatedTransaction,
      );
      queryClient.invalidateQueries({ queryKey: [...transactionKeys.all, "list"] });
      queryClient.invalidateQueries({ queryKey: accountKeys.all });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      invalidateReportsForChange(queryClient, "transaction");
      await queryClient.invalidateQueries({ queryKey: [...transactionKeys.all, "infinite"] });
      toast({
        title: "Transaction updated",
        description: `${updatedTransaction.name} has been updated.`,
      });
    },
    onError: (error: Error & { status?: number }) => {
      if (error.status === 409) {
        toast({
          title: "Conflict",
          description:
            "Transaction was modified by another user. Please refresh.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Failed to update transaction",
          description: userErrorMessage(error, "Please try again."),
          variant: "destructive",
        });
      }
    },
  });
}

/**
 * Hook to mark transaction as reviewed (uses dedicated /review endpoint)
 */
export function useReviewTransaction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ id, reviewed }: { id: string; reviewed: boolean }) =>
      transactionsApi.review(id, reviewed),
    onSuccess: (updatedTransaction) => {
      queryClient.setQueryData(
        transactionKeys.detail(updatedTransaction.id),
        updatedTransaction,
      );
      queryClient.invalidateQueries({ queryKey: transactionKeys.list() });
      // The reports/transactions drilldown displays reviewedAt per row.
      invalidateReportsForChange(queryClient, "transaction");
      toast({
        title: updatedTransaction.reviewedAt
          ? "Transaction reviewed"
          : "Transaction marked unreviewed",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update review status",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

/**
 * Hook to delete a transaction
 */
export function useDeleteTransaction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (id: string) => transactionsApi.delete(id),
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: transactionKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: transactionKeys.all });
      queryClient.invalidateQueries({ queryKey: accountKeys.all });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      invalidateReportsForChange(queryClient, "transaction");
      toast({
        title: "Transaction deleted",
        description: "The transaction has been removed.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete transaction",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

/**
 * Helper hook for current month summary
 */
export function useCurrentMonthSummary() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;

  return useTransactionSummary(startDate, endDate);
}
