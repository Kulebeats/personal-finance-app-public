/**
 * useTransactionMutations Hook
 *
 * Mutations for creating, updating, and deleting transactions.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { transactionsApi } from "@/lib/api";
import { toast } from "sonner";

import { type MoneyDto } from "@shared/money";

interface CreateTransactionInput {
  accountId: string;
  amount: MoneyDto;
  name: string;
  date: string;
  type: "income" | "expense";
  categoryId?: string;
  notes?: string;
}

interface UpdateTransactionInput {
  name?: string;
  amount?: MoneyDto;
  date?: string;
  categoryId?: string | null;
  notes?: string | null;
}

export function useTransactionMutations() {
  const queryClient = useQueryClient();

  const invalidateTransactions = () => {
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
  };

  const createMutation = useMutation({
    mutationFn: async (input: CreateTransactionInput) => {
      const response = await transactionsApi.create(input);
      return response.transaction;
    },
    onSuccess: () => {
      toast.success("Transaction created");
      invalidateTransactions();
    },
    onError: (error: Error) => {
      toast.error(`Failed to create transaction: ${error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: UpdateTransactionInput;
    }) => {
      return await transactionsApi.update(id, updates);
    },
    onSuccess: () => {
      toast.success("Transaction updated");
      invalidateTransactions();
    },
    onError: (error: Error) => {
      toast.error(`Failed to update transaction: ${error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await transactionsApi.delete(id);
    },
    onSuccess: () => {
      toast.success("Transaction deleted");
      invalidateTransactions();
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete transaction: ${error.message}`);
    },
  });

  return {
    create: createMutation,
    update: updateMutation,
    delete: deleteMutation,
    isLoading:
      createMutation.isPending ||
      updateMutation.isPending ||
      deleteMutation.isPending,
  };
}
