import { toastActionError } from "@/lib/actionErrorToast";
import { throwIfResNotOk } from "@/lib/queryClient";
import { protectedFetch } from "@/lib/protected-fetch";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ReceiptDto } from "@shared/receipt-dto";
import { OcrExtractedData } from "../lib/receiptParser";
// apiCall attaches the x-csrf-token header (raw fetch 403s under CSRF
// enforcement) and self-heals on a stale token.
import { apiCall } from "@/lib/api";

export const receiptKeys = {
  all: ["receipts"] as const,
  lists: () => [...receiptKeys.all, "list"] as const,
  list: (filters: string) => [...receiptKeys.lists(), { filters }] as const,
  details: () => [...receiptKeys.all, "detail"] as const,
  detail: (id: string) => [...receiptKeys.details(), id] as const,
};

export interface UseReceiptsOptions {
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

type RequestError = Error & { status?: number };

export function useReceipts(options: UseReceiptsOptions = {}) {
  const queryKey = receiptKeys.list(JSON.stringify(options));

  return useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options.status) params.append("status", options.status);
      if (options.search) params.append("search", options.search);
      if (options.limit) params.append("limit", options.limit.toString());
      if (options.offset) params.append("offset", options.offset.toString());

      const res = await protectedFetch(`/api/receipts?${params.toString()}`, {
        credentials: "include",
      });
      await throwIfResNotOk(res);

      return res.json() as Promise<{
        success: true;
        data: ReceiptDto[];
        pagination: { total: number; limit: number; offset: number };
      }>;
    },
  });
}

export function useReceipt(id: string) {
  return useQuery({
    queryKey: receiptKeys.detail(id),
    queryFn: async () => {
      const res = await protectedFetch(`/api/receipts/${id}`, {
        credentials: "include",
      });
      await throwIfResNotOk(res);

      return res.json() as Promise<{ success: true; data: ReceiptDto }>;
    },
    enabled: !!id,
  });
}

export function useUploadReceipt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { file: File; idempotencyKey?: string }) => {
      const formData = new FormData();
      formData.append("file", vars.file);

      try {
        return await apiCall<{
          success: true;
          data: {
            receiptId: string;
            isDuplicate: boolean;
            duplicateOf?: string;
          };
        }>("/receipts/upload", {
          method: "POST",
          body: formData,
          headers: vars.idempotencyKey
            ? { "x-idempotency-key": vars.idempotencyKey }
            : undefined,
        });
      } catch (err) {
        if ((err as RequestError).status === 401) {
          const error = new Error(
            "Please sign in to upload receipts."
          ) as RequestError;
          error.status = 401;
          throw error;
        }
        throw err;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: receiptKeys.lists() });
      toast.success("Receipt uploaded successfully");
    },
    onError: (err) => {
      toastActionError("The receipt could not be uploaded.", err);
    },
  });
}

export function useStoreOcrResults() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: {
      receiptId: string;
      ocrData: OcrExtractedData;
      confidence: number;
      rawText?: string;
    }) => {
      return apiCall<{ success: boolean; data: unknown }>(
        `/receipts/${vars.receiptId}/ocr-results`,
        {
          method: "POST",
          body: JSON.stringify({
            ...vars.ocrData,
            confidence: vars.confidence,
            rawText: vars.rawText,
          }),
        }
      );
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({
        queryKey: receiptKeys.detail(vars.receiptId),
      });
      queryClient.invalidateQueries({ queryKey: receiptKeys.lists() });
    },
  });
}

export function useMatchReceipt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { receiptId: string; transactionId: string }) => {
      return apiCall<{ success: boolean; data: unknown }>(
        `/receipts/${vars.receiptId}/match`,
        {
          method: "POST",
          body: JSON.stringify({ transactionId: vars.transactionId }),
        }
      );
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({
        queryKey: receiptKeys.detail(vars.receiptId),
      });
      queryClient.invalidateQueries({ queryKey: receiptKeys.lists() });
      toast.success("Receipt matched to transaction");
    },
    onError: (err) => {
      toastActionError("The receipt could not be matched.", err);
    },
  });
}

export function useCreateTransactionFromReceipt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: {
      receiptId: string;
      data: {
        accountId: string;
        name: string;
        amount: string;
        date: string;
        categoryId?: string;
        notes?: string;
      };
    }) => {
      return apiCall<{ success: boolean; data: unknown }>(
        `/receipts/${vars.receiptId}/create-transaction`,
        {
          method: "POST",
          body: JSON.stringify(vars.data),
        }
      );
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({
        queryKey: receiptKeys.detail(vars.receiptId),
      });
      queryClient.invalidateQueries({ queryKey: receiptKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Transaction created from receipt");
    },
    onError: (err) => {
      toastActionError("The transaction could not be created from this receipt.", err);
    },
  });
}

export function useRetryMatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (receiptId: string) => {
      return apiCall<{ success: boolean; data: unknown }>(
        `/receipts/${receiptId}/retry-match`,
        { method: "POST" }
      );
    },
    onSuccess: (_, receiptId) => {
      queryClient.invalidateQueries({
        queryKey: receiptKeys.detail(receiptId),
      });
      toast.success("Matching retry scheduled");
    },
  });
}

export function useDeleteReceipt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (receiptId: string) => {
      return apiCall<{ success: boolean; data: unknown }>(
        `/receipts/${receiptId}`,
        { method: "DELETE" }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: receiptKeys.lists() });
      toast.success("Receipt deleted");
    },
    onError: (err) => {
      toastActionError("The receipt could not be deleted.", err);
    },
  });
}
