/**
 * Transaction Mutations Hook
 *
 * Handles bulk operations and mutation logic for transactions page.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { transactionsApi } from "@/lib/api";
import { invalidateReportsForChange } from "@/hooks/use-reports";
import { toast } from "sonner";

export function useTransactionBulkMutations(clearSelection: () => void) {
  const queryClient = useQueryClient();

  const bulkReviewMutation = useMutation({
    mutationFn: (ids: string[]) => transactionsApi.bulkReview(ids, true),
    onSuccess: (data) => {
      toast.success(`${data.successCount} transactions marked as reviewed`);
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      invalidateReportsForChange(queryClient, "transaction");
      clearSelection();
    },
    onError: () => toast.error("Failed to mark transactions as reviewed"),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => transactionsApi.bulkDelete(ids),
    onSuccess: (data) => {
      toast.success(`${data.successCount} transactions deleted`);
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      invalidateReportsForChange(queryClient, "transaction");
      clearSelection();
    },
    onError: () => toast.error("Failed to delete transactions"),
  });

  const bulkCategorizeMutation = useMutation({
    mutationFn: ({ ids, categoryId }: { ids: string[]; categoryId: string }) =>
      transactionsApi.bulkUpdateCategory(ids, categoryId),
    onSuccess: (data) => {
      toast.success(`${data.successCount} transactions categorized`);
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      invalidateReportsForChange(queryClient, "transaction");
      clearSelection();
    },
    onError: () => toast.error("Failed to update categories"),
  });

  const bulkTagMutation = useMutation({
    mutationFn: ({ ids, tagIds }: { ids: string[]; tagIds: string[] }) =>
      transactionsApi.bulkAddTags(ids, tagIds),
    onSuccess: (data) => {
      toast.success(`${data.successCount} transactions tagged`);
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      invalidateReportsForChange(queryClient, "transaction");
      clearSelection();
    },
    onError: () => toast.error("Failed to add tags"),
  });

  return {
    bulkReviewMutation,
    bulkDeleteMutation,
    bulkCategorizeMutation,
    bulkTagMutation,
  };
}
