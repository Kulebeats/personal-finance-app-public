/**
 * A contribution paid from an account, as one server write: the expense and its
 * link to the goal commit together or not at all (#245, Astra round 2). A refusal
 * leaves nothing behind, so the same request (same key) can simply be sent again.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiCall, type ApiError } from "@/lib/api";
import { goalKeys, type Goal } from "@/hooks/useGoals";
import { transactionKeys } from "@/hooks/useTransactions";
import { accountKeys } from "@/hooks/useAccounts";
import { invalidateReportsForChange } from "@/hooks/use-reports";
import type { MoneyDto } from "@shared/money";

export interface AccountContributionInput {
  accountId: string;
  /** In the account's own currency. */
  amount: MoneyDto;
  date: string;
  reason?: string;
  /** Count the expense in the budget under this category; otherwise it is excluded. */
  categoryId?: string;
  confirmOverfund?: boolean;
  /** One per contribution: a repeat of the same request returns the first result. */
  idempotencyKey: string;
}

interface AccountContributionResponse {
  success: boolean;
  data: { transactionId: string; replayed: boolean; goal: Goal };
}

/** The server's over-fund refusal: a 409 that a confirmation can answer. */
export function isOverfundRefusal(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (error as ApiError).status === 409 && /Confirm overfunding/.test(error.message);
}

export function useContributeFromAccount(goalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AccountContributionInput) => {
      const res = await apiCall<AccountContributionResponse>(`/goals/${goalId}/contributions/from-account`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: goalKeys.all });
      queryClient.invalidateQueries({ queryKey: transactionKeys.all });
      queryClient.invalidateQueries({ queryKey: accountKeys.all });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      invalidateReportsForChange(queryClient, "transaction");
    },
  });
}
