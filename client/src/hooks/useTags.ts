/**
 * Tag Hooks
 *
 * TanStack Query hooks for tag operations.
 * Uses the API client for server-backed data.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  tagsApi,
  type Tag,
  type CreateTagInput,
  type UpdateTagInput,
  type TransactionTagInfo,
} from "../lib/api";
import { useToast } from "@/hooks/use-toast";

// Query keys
export const tagKeys = {
  all: ["tags"] as const,
  list: () => [...tagKeys.all, "list"] as const,
  detail: (id: string) => [...tagKeys.all, "detail", id] as const,
  transactions: (id: string) => [...tagKeys.all, id, "transactions"] as const,
  transactionTags: (transactionId: string) =>
    [...tagKeys.all, "transaction", transactionId] as const,
};

/**
 * Hook to list all tags
 */
export function useTags() {
  return useQuery({
    queryKey: tagKeys.list(),
    queryFn: () => tagsApi.list(),
    staleTime: 30_000, // 30 seconds
  });
}

/**
 * Hook to get a single tag
 */
export function useTag(id: string) {
  return useQuery({
    queryKey: tagKeys.detail(id),
    queryFn: () => tagsApi.get(id),
    enabled: !!id,
  });
}

/**
 * Hook to get transactions for a tag
 */
export function useTagTransactions(id: string, limit = 50) {
  return useQuery({
    queryKey: tagKeys.transactions(id),
    queryFn: () => tagsApi.getTransactions(id, limit),
    enabled: !!id,
  });
}

/**
 * Hook to create a tag
 */
export function useCreateTag() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (data: CreateTagInput) => tagsApi.create(data),
    onSuccess: (newTag) => {
      queryClient.invalidateQueries({ queryKey: tagKeys.list() });
      toast({
        title: "Tag created",
        description: `"${newTag.name}" has been created.`,
      });
    },
    onError: (error: Error & { code?: string }) => {
      if (error.code === "CONFLICT") {
        toast({
          title: "Tag already exists",
          description: "A tag with this name already exists.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: "Failed to create tag. Please try again.",
          variant: "destructive",
        });
      }
    },
  });
}

/**
 * Hook to update a tag
 */
export function useUpdateTag() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTagInput }) =>
      tagsApi.update(id, data),
    onSuccess: (updatedTag) => {
      queryClient.invalidateQueries({ queryKey: tagKeys.list() });
      queryClient.invalidateQueries({ queryKey: tagKeys.detail(updatedTag.id) });
      toast({
        title: "Tag updated",
        description: `"${updatedTag.name}" has been updated.`,
      });
    },
    onError: (error: Error & { code?: string }) => {
      if (error.code === "CONFLICT") {
        toast({
          title: "Tag already exists",
          description: "A tag with this name already exists.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: "Failed to update tag. Please try again.",
          variant: "destructive",
        });
      }
    },
  });
}

/**
 * Hook to delete a tag with optimistic update
 */
export function useDeleteTag() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (id: string) => tagsApi.delete(id),
    onMutate: async (deletedId: string) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: tagKeys.list() });

      // Snapshot previous value
      const previousTags = queryClient.getQueryData<Tag[]>(tagKeys.list());

      // Optimistically remove the tag
      if (previousTags) {
        queryClient.setQueryData<Tag[]>(
          tagKeys.list(),
          previousTags.filter((tag) => tag.id !== deletedId)
        );
      }

      return { previousTags };
    },
    onSuccess: () => {
      toast({
        title: "Tag deleted",
        description: "The tag has been deleted.",
      });
    },
    onError: (_error, _id, context) => {
      // Rollback on error
      if (context?.previousTags) {
        queryClient.setQueryData(tagKeys.list(), context.previousTags);
      }
      toast({
        title: "Error",
        description: "Failed to delete tag. Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
    },
  });
}

/**
 * Hook to get tags for a transaction
 */
export function useTransactionTags(transactionId: string) {
  return useQuery({
    queryKey: tagKeys.transactionTags(transactionId),
    queryFn: () => tagsApi.getTransactionTags(transactionId),
    enabled: !!transactionId,
  });
}

/**
 * Hook to add tags to a transaction
 */
export function useAddTagsToTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      transactionId,
      tagIds,
    }: {
      transactionId: string;
      tagIds: string[];
    }) => tagsApi.addTagsToTransaction(transactionId, tagIds),
    onSuccess: (_, { transactionId }) => {
      queryClient.invalidateQueries({
        queryKey: tagKeys.transactionTags(transactionId),
      });
      queryClient.invalidateQueries({ queryKey: tagKeys.list() }); // Update usage counts
      queryClient.invalidateQueries({ queryKey: ["transactions"] }); // Update transaction list
    },
  });
}

/**
 * Hook to set all tags on a transaction (replace existing)
 */
export function useSetTransactionTags() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      transactionId,
      tagIds,
    }: {
      transactionId: string;
      tagIds: string[];
    }) => tagsApi.setTransactionTags(transactionId, tagIds),
    onSuccess: (_, { transactionId }) => {
      queryClient.invalidateQueries({
        queryKey: tagKeys.transactionTags(transactionId),
      });
      queryClient.invalidateQueries({ queryKey: tagKeys.list() }); // Update usage counts
      queryClient.invalidateQueries({ queryKey: ["transactions"] }); // Update transaction list
    },
  });
}

/**
 * Hook to remove a tag from a transaction
 */
export function useRemoveTagFromTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      transactionId,
      tagId,
    }: {
      transactionId: string;
      tagId: string;
    }) => tagsApi.removeTagFromTransaction(transactionId, tagId),
    onSuccess: (_, { transactionId }) => {
      queryClient.invalidateQueries({
        queryKey: tagKeys.transactionTags(transactionId),
      });
      queryClient.invalidateQueries({ queryKey: tagKeys.list() }); // Update usage counts
      queryClient.invalidateQueries({ queryKey: ["transactions"] }); // Update transaction list
    },
  });
}

/**
 * Hook to merge multiple tags into one
 */
export function useMergeTags() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({
      sourceTagIds,
      targetTagId,
    }: {
      sourceTagIds: string[];
      targetTagId: string;
    }) => tagsApi.merge(sourceTagIds, targetTagId),
    onMutate: async ({ sourceTagIds }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: tagKeys.list() });

      // Snapshot previous value
      const previousTags = queryClient.getQueryData<Tag[]>(tagKeys.list());

      // Optimistically remove source tags
      if (previousTags) {
        queryClient.setQueryData<Tag[]>(
          tagKeys.list(),
          previousTags.filter((tag) => !sourceTagIds.includes(tag.id))
        );
      }

      return { previousTags };
    },
    onSuccess: (result) => {
      toast({
        title: "Tags merged",
        description: `${result.mergedTagNames.length} tag(s) merged into "${result.targetTag.name}".`,
      });
    },
    onError: (_error, _vars, context) => {
      // Rollback on error
      if (context?.previousTags) {
        queryClient.setQueryData(tagKeys.list(), context.previousTags);
      }
      toast({
        title: "Error",
        description: "Failed to merge tags. Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

/**
 * Hook to archive a tag
 */
export function useArchiveTag() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (id: string) => tagsApi.archive(id),
    onMutate: async (archivedId: string) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: tagKeys.list() });

      // Snapshot previous value
      const previousTags = queryClient.getQueryData<Tag[]>(tagKeys.list());

      // Optimistically remove the archived tag from list
      if (previousTags) {
        queryClient.setQueryData<Tag[]>(
          tagKeys.list(),
          previousTags.filter((tag) => tag.id !== archivedId)
        );
      }

      return { previousTags };
    },
    onSuccess: (archivedTag) => {
      toast({
        title: "Tag archived",
        description: `"${archivedTag.name}" has been archived.`,
      });
    },
    onError: (_error, _id, context) => {
      // Rollback on error
      if (context?.previousTags) {
        queryClient.setQueryData(tagKeys.list(), context.previousTags);
      }
      toast({
        title: "Error",
        description: "Failed to archive tag. Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
    },
  });
}

/**
 * Hook to get tag analytics
 */
export function useTagAnalytics(limit = 20) {
  return useQuery({
    queryKey: [...tagKeys.all, "analytics", limit] as const,
    queryFn: () => tagsApi.getAnalytics(limit),
    staleTime: 60_000, // 1 minute
  });
}

// Export types for convenience
export type { Tag, CreateTagInput, UpdateTagInput, TransactionTagInfo };
