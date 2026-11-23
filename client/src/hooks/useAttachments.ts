import { userErrorMessage } from "@/lib/errorCopy";
import { throwIfResNotOk } from "@/lib/queryClient";
import { protectedFetch } from "@/lib/protected-fetch";
/**
 * Attachment Hooks
 *
 * TanStack Query hooks for transaction attachment operations.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
// apiCall attaches the x-csrf-token header (raw fetch 403s under CSRF
// enforcement) and self-heals on a stale token.
import { apiCall } from "@/lib/api";

export interface Attachment {
  id: string;
  transactionId: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
}

// Query keys
export const attachmentKeys = {
  all: ["attachments"] as const,
  list: (transactionId: string) =>
    [...attachmentKeys.all, "list", transactionId] as const,
};

/**
 * Hook to list attachments for a transaction
 */
export function useAttachments(transactionId: string) {
  return useQuery({
    queryKey: attachmentKeys.list(transactionId),
    queryFn: async () => {
      const response = await protectedFetch(
        `/api/transactions/${transactionId}/attachments`,
        {
          credentials: "include",
        }
      );
      await throwIfResNotOk(response);

      const data = await response.json();
      return data.data as Attachment[];
    },
    enabled: !!transactionId,
  });
}

/**
 * Hook to upload an attachment
 */
export interface UploadAttachmentVars {
  file: File;
  transactionId?: string;
}

export interface UseUploadAttachmentOptions {
  silent?: boolean;
}

function resolveTransactionId(
  vars: UploadAttachmentVars | File,
  defaultTransactionId?: string
) {
  const resolvedTransactionId =
    typeof vars === "object" && "file" in vars
      ? vars.transactionId ?? defaultTransactionId
      : defaultTransactionId;

  if (!resolvedTransactionId) {
    throw new Error("Transaction ID is required for attachment upload");
  }

  return resolvedTransactionId;
}

export function useUploadAttachment(
  transactionId?: string,
  options: UseUploadAttachmentOptions = {}
) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (vars: UploadAttachmentVars | File) => {
      const resolvedTransactionId = resolveTransactionId(vars, transactionId);
      const file = typeof vars === "object" && "file" in vars ? vars.file : vars;
      const formData = new FormData();
      formData.append("file", file);

      const data = await apiCall<{ success: boolean; data: Attachment }>(
        `/transactions/${resolvedTransactionId}/attachments`,
        { method: "POST", body: formData }
      );
      return data.data;
    },
    onSuccess: (_data, vars) => {
      const resolvedTransactionId = resolveTransactionId(vars, transactionId);
      queryClient.invalidateQueries({
        queryKey: attachmentKeys.list(resolvedTransactionId),
      });
      if (!options.silent) {
        toast({
          title: "Attachment uploaded",
          description: "File uploaded successfully.",
        });
      }
    },
    onError: (error: Error) => {
      if (!options.silent) {
        toast({
          title: "Upload failed",
          description: userErrorMessage(error, "Please try again."),
          variant: "destructive",
        });
      }
    },
  });
}

/**
 * Hook to delete an attachment
 */
export function useDeleteAttachment(transactionId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (attachmentId: string) => {
      return apiCall<{ success: boolean; data: { message: string } }>(
        `/transactions/${transactionId}/attachments/${attachmentId}`,
        { method: "DELETE" }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: attachmentKeys.list(transactionId),
      });
      toast({ title: "Attachment deleted" });
    },
    onError: (error: Error) => {
      toast({
        title: "Delete failed",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}
