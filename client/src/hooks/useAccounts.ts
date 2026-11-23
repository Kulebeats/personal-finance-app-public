/**
 * Account Hooks
 *
 * TanStack Query hooks for account operations.
 * Uses the API client for server-backed data.
 */

import { userErrorMessage } from "@/lib/errorCopy";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { assertOperationLifetime, captureOperationLifetime } from "@/lib/operation-lifetime";
import { downloadProtectedBlob } from "@/lib/protected-media";
import {
  accountsApi,
  type Account,
  type CreateAccountInput,
  type UpdateAccountInput,
  type BalanceAdjustmentInput,
  type NetWorthSummary,
  type BalanceHistoryPoint,
  type NetWorthHistory,
  type AccountSettings,
  type TransactionImportRow,
  type TransactionImportDecision,
  type ApiError,
  IMPORT_REVIEW_REQUIRED,
} from "../lib/api";
import { useToast } from "@/hooks/use-toast";
import { invalidateImportQueries } from "@/lib/invalidate-import-queries";

// Query keys
export const accountKeys = {
  all: ["accounts"] as const,
  lists: () => ["accounts", "list"] as const,
  netWorthHistories: () => ["accounts", "net-worth-history"] as const,
  list: (params?: {
    includeArchived?: boolean;
    includeHidden?: boolean;
    ownerUserId?: string | null;
  }) => [...accountKeys.all, "list", params] as const,
  detail: (id: string) => [...accountKeys.all, "detail", id] as const,
  summary: () => [...accountKeys.all, "summary"] as const,
  balanceHistory: (id: string, dateRange: string) =>
    [...accountKeys.all, "detail", id, "balance-history", dateRange] as const,
  netWorthHistory: (
    dateRange: string,
    scope?: "user" | "household",
    includeAccounts = false,
    accountOwnerUserId?: string | null,
    viewRevision = 0,
    mountIdentity?: string,
  ) =>
    [...accountKeys.all, "net-worth-history", dateRange, scope,
      ...(includeAccounts ? ["with-accounts", accountOwnerUserId === undefined ? "all" : accountOwnerUserId, viewRevision,
        ...(mountIdentity ? [mountIdentity] : [])] : [])] as const,
};

/**
 * Hook to list all accounts
 * TODO-024: Added ownerUserId for server-side filtering
 */
export function useAccounts(params?: {
  includeArchived?: boolean;
  includeHidden?: boolean;
  ownerUserId?: string | null;
}, enabled = true) {
  return useQuery({
    queryKey: accountKeys.list(params),
    queryFn: () => accountsApi.list(params),
    enabled,
    staleTime: 30_000, // 30 seconds
  });
}

/**
 * Hook to get a single account
 */
export function useAccount(id: string) {
  return useQuery({
    queryKey: accountKeys.detail(id),
    queryFn: () => accountsApi.get(id),
    enabled: !!id,
  });
}

/**
 * Hook to get net worth summary
 */
export function useNetWorthSummary(enabled = true) {
  return useQuery({
    queryKey: accountKeys.summary(),
    queryFn: () => accountsApi.getSummary(),
    enabled,
    staleTime: 60_000, // 1 minute
  });
}

/**
 * Hook to create an account
 */
export function useCreateAccount() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (data: CreateAccountInput) => accountsApi.create(data),
    onSuccess: (newAccount) => {
      // Invalidate list queries
      queryClient.invalidateQueries({ queryKey: accountKeys.all });
      toast({
        title: "Account created",
        description: `${newAccount.name} has been added.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create account",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

/**
 * Hook to update an account
 */
export function useUpdateAccount() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAccountInput }) =>
      accountsApi.update(id, data),
    onSuccess: (updatedAccount) => {
      // Update cache
      queryClient.setQueryData(
        accountKeys.detail(updatedAccount.id),
        updatedAccount,
      );
      queryClient.invalidateQueries({ queryKey: accountKeys.lists() });
      queryClient.invalidateQueries({ queryKey: accountKeys.summary() });
      queryClient.invalidateQueries({ queryKey: accountKeys.netWorthHistories() });
      toast({
        title: "Account updated",
        description: `${updatedAccount.name} has been updated.`,
      });
    },
    onError: (error: Error & { status?: number }) => {
      if (error.status === 409) {
        toast({
          title: "Conflict",
          description: "Account was modified by another user. Please refresh.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Failed to update account",
          description: userErrorMessage(error, "Please try again."),
          variant: "destructive",
        });
      }
    },
  });
}

/**
 * Hook to delete an account
 */
export function useDeleteAccount() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (id: string) => accountsApi.delete(id),
    onSuccess: (_, id) => {
      // Remove from cache
      queryClient.removeQueries({ queryKey: accountKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: accountKeys.lists() });
      queryClient.invalidateQueries({ queryKey: accountKeys.summary() });
      queryClient.invalidateQueries({ queryKey: accountKeys.netWorthHistories() });
      toast({
        title: "Account deleted",
        description: "The account has been removed.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete account",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

/**
 * Hook to adjust account balance
 */
export function useAdjustBalance() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: BalanceAdjustmentInput }) =>
      accountsApi.adjustBalance(id, data),
    onSuccess: (result) => {
      // Update cache
      queryClient.setQueryData(
        accountKeys.detail(result.account.id),
        result.account,
      );
      queryClient.invalidateQueries({ queryKey: accountKeys.lists() });
      queryClient.invalidateQueries({ queryKey: accountKeys.summary() });
      queryClient.invalidateQueries({ queryKey: accountKeys.netWorthHistories() });
      toast({
        title: "Balance adjusted",
        description: "Account balance has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to adjust balance",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

/**
 * Hook to archive/unarchive an account
 */
export function useArchiveAccount() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ id, archive }: { id: string; archive: boolean }) =>
      archive ? accountsApi.archive(id) : accountsApi.unarchive(id),
    onSuccess: (account, { archive }) => {
      queryClient.setQueryData(accountKeys.detail(account.id), account);
      queryClient.invalidateQueries({ queryKey: accountKeys.lists() });
      queryClient.invalidateQueries({ queryKey: accountKeys.summary() });
      queryClient.invalidateQueries({ queryKey: accountKeys.netWorthHistories() });
      toast({
        title: archive ? "Account archived" : "Account restored",
        description: `${account.name} has been ${
          archive ? "archived" : "restored"
        }.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Operation failed",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

/**
 * Hook to get balance history for an account
 */
export function useAccountBalanceHistory(id: string, dateRange: string = "1m") {
  return useQuery({
    queryKey: accountKeys.balanceHistory(id, dateRange),
    queryFn: () => accountsApi.getBalanceHistory(id, dateRange),
    enabled: !!id,
    staleTime: 60_000, // 1 minute
  });
}

/**
 * Hook to get net worth history for charts
 * TODO-009: Added scope parameter - "user" (default) filters by visibility, "household" shows all
 */
export function useNetWorthHistory(
  dateRange: string = "1m",
  scope: "user" | "household" = "user",
  enabled = true,
  includeAccounts = false,
  accountOwnerUserId?: string | null,
  viewRevision = 0,
  mountIdentity?: string,
) {
  return useQuery({
    queryKey: accountKeys.netWorthHistory(dateRange, scope, includeAccounts, accountOwnerUserId, viewRevision, mountIdentity),
    queryFn: () => includeAccounts ? accountOwnerUserId === undefined ? accountsApi.getNetWorthHistory(dateRange, scope, true)
      : accountsApi.getNetWorthHistory(dateRange, scope, true, accountOwnerUserId) : accountsApi.getNetWorthHistory(dateRange, scope),
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchInterval: 60_000,
  });
}

/**
 * Hook to update account visibility settings
 */
export function useUpdateAccountSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ id, settings }: { id: string; settings: AccountSettings }) =>
      accountsApi.updateSettings(id, settings),
    onSuccess: (account) => {
      queryClient.setQueryData(accountKeys.detail(account.id), account);
      queryClient.invalidateQueries({ queryKey: accountKeys.lists() });
      queryClient.invalidateQueries({ queryKey: accountKeys.summary() });
      queryClient.invalidateQueries({ queryKey: accountKeys.netWorthHistories() });
      toast({
        title: "Settings updated",
        description: "Account settings have been saved.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update settings",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

/**
 * Hook to import balance history
 */
export function useImportBalanceHistory() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { date: string; amount: string }[];
    }) => accountsApi.importBalanceHistory(id, data),
    onSuccess: (result, { id }) => {
      queryClient.invalidateQueries({
        queryKey: accountKeys.detail(id),
      });
      queryClient.invalidateQueries({ queryKey: accountKeys.netWorthHistories() });
      toast({
        title: "Balance history imported",
        description: `${result.imported} entries have been added.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to import balance history",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

/**
 * Hook to import transactions
 */
export function useImportTransactions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    onMutate: () => ({ operation: captureOperationLifetime() }),
    mutationFn: ({
      id,
      transactions,
      adjustBalance,
      decisions,
    }: {
      id: string;
      transactions: TransactionImportRow[];
      adjustBalance: boolean;
      /** A-01: choices for the rows a previous attempt flagged. */
      decisions?: TransactionImportDecision[];
    }) => accountsApi.importTransactions(id, transactions, adjustBalance, decisions ?? []),
    // A failed batch may have committed earlier rows before the error reached the client.
    onSettled: (_result, _error, _variables, context) => {
      if (context) return invalidateImportQueries(queryClient, context.operation);
    },
    onSuccess: (result) => {
      // A-01: flagged rows were posted or skipped only by the member's own choice.
      const skipped = result.reviewSkipped ?? 0;
      toast({
        title: "Transactions imported",
        description: `${result.imported} transactions have been added.` + (skipped
          ? ` ${skipped} possible duplicate${skipped === 1 ? " was" : "s were"} skipped.`
          : ""),
      });
    },
    onError: (error: Error) => {
      // A-01: a review request is not a failure; the import dialog shows the rows to decide on.
      if ((error as ApiError).code === IMPORT_REVIEW_REQUIRED) return;
      toast({
        title: "Failed to import transactions",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

/**
 * Hook to export transactions (returns download trigger function)
 */
export function useExportTransactions() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      options,
    }: {
      id: string;
      options?: { startDate?: string; endDate?: string };
    }) => {
      const operation = captureOperationLifetime();
      const csvData = await accountsApi.exportTransactions(id, options, operation);
      assertOperationLifetime(operation);
      // Trigger download
      const blob = new Blob([csvData], { type: "text/csv" });
      downloadProtectedBlob(blob, "transactions.csv", operation);
      return csvData;
    },
    onSuccess: () => {
      toast({
        title: "Export complete",
        description: "Transactions have been downloaded.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Export failed",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

/**
 * Hook to export balance history (returns download trigger function)
 */
export function useExportBalanceHistory() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const operation = captureOperationLifetime();
      const csvData = await accountsApi.exportBalanceHistory(id, operation);
      assertOperationLifetime(operation);
      // Trigger download
      const blob = new Blob([csvData], { type: "text/csv" });
      downloadProtectedBlob(blob, "balance-history.csv", operation);
      return csvData;
    },
    onSuccess: () => {
      toast({
        title: "Export complete",
        description: "Balance history has been downloaded.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Export failed",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

/**
 * Hook to export accounts summary (returns download trigger function)
 */
export function useExportAccountsSummary() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const operation = captureOperationLifetime();
      const csvData = await accountsApi.exportSummary(operation);
      assertOperationLifetime(operation);
      // Trigger download
      const blob = new Blob([csvData], { type: "text/csv" });
      downloadProtectedBlob(blob, "accounts-summary.csv", operation);
      return csvData;
    },
    onSuccess: () => {
      toast({
        title: "Export complete",
        description: "Accounts summary has been downloaded.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Export failed",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}
