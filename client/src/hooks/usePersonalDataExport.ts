/**
 * Personal-data export (R07.1, AH-08): list the caller's own exports, request
 * a new one (step-up gated; apiCall prompts and retries) and download a ready
 * file through the authenticated fetch, never a public URL.
 */
import { toastActionError } from "@/lib/actionErrorToast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiCall } from "@/lib/api";
import { downloadProtectedResource } from "@/lib/protected-media";
import type { PersonalExportItem } from "@shared/personal-data-export";

export const PERSONAL_EXPORTS_QUERY_KEY = ["settings", "privacy", "exports"] as const;

interface Envelope<T> { success: boolean; data: T }

export function usePersonalExports() {
  return useQuery({
    queryKey: PERSONAL_EXPORTS_QUERY_KEY,
    queryFn: async () => (await apiCall<Envelope<PersonalExportItem[]>>("/settings/privacy/exports")).data,
  });
}

export function useRequestPersonalExport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await apiCall<Envelope<PersonalExportItem>>("/settings/privacy/export", { method: "POST", body: "{}" })).data,
    onSuccess: () => {
      toast.success("Your data export is ready to download");
      void queryClient.invalidateQueries({ queryKey: PERSONAL_EXPORTS_QUERY_KEY });
    },
    onError: (error: Error) => {
      toastActionError("Could not create your data export", error);
    },
  });
}

export function useDownloadPersonalExport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (item: PersonalExportItem) => {
      if (!item.downloadUrl) throw new Error("This export can no longer be downloaded");
      await downloadProtectedResource(item.downloadUrl);
    },
    onError: (error: Error) => {
      toastActionError("Could not download your data export", error);
      // An expired or removed export changes status; show the current one.
      void queryClient.invalidateQueries({ queryKey: PERSONAL_EXPORTS_QUERY_KEY });
    },
  });
}
