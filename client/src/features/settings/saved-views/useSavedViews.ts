/**
 * R05.2 named household saved views: list for every member, owner/admin writes.
 * Mutations go through apiRequest (CSRF token, step-up, error envelopes).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateSavedViewInput, SavedViewResponse, UpdateSavedViewInput } from "@shared/saved-views";
import { apiRequest } from "@/lib/queryClient";

export const SAVED_VIEWS_PATH = "/api/settings/saved-views";
export const savedViewsKey = ["saved-views"] as const;

export function useSavedViews() {
  return useQuery({
    queryKey: savedViewsKey,
    queryFn: async () => {
      const response = await apiRequest("GET", SAVED_VIEWS_PATH);
      const body = (await response.json()) as { data: SavedViewResponse[] };
      return body.data;
    },
  });
}

export type SaveSavedViewInput =
  | { mode: "create"; input: CreateSavedViewInput }
  | { mode: "update"; id: string; input: UpdateSavedViewInput };

export function useSaveSavedView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: SaveSavedViewInput) => {
      const response = request.mode === "create"
        ? await apiRequest("POST", SAVED_VIEWS_PATH, request.input)
        : await apiRequest("PUT", `${SAVED_VIEWS_PATH}/${request.id}`, request.input);
      const body = (await response.json()) as { data: SavedViewResponse };
      return body.data;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: savedViewsKey }),
  });
}

export function useDeleteSavedView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (view: Pick<SavedViewResponse, "id" | "version">) => {
      await apiRequest("DELETE", `${SAVED_VIEWS_PATH}/${view.id}?version=${view.version}`);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: savedViewsKey }),
  });
}
