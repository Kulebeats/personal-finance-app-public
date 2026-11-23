/**
 * useFilterPresets Hook
 *
 * React Query hooks for managing saved filter presets.
 * Allows users to save, load, and manage filter combinations.
 *
 * @module features/transactions/hooks/useFilterPresets
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// Types
export interface FilterPreset {
  id: string;
  householdId: string;
  userId: string;
  name: string;
  context: "transactions" | "reports" | "budget" | "cashflow";
  /** Untyped JSON from the API; read it with presetToTransactionFilters. */
  filters: Record<string, unknown>;
  isDefault: boolean;
  isShared: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFilterPresetInput {
  name: string;
  context: "transactions" | "reports" | "budget" | "cashflow";
  filters: Record<string, unknown>;
  isDefault?: boolean;
  isShared?: boolean;
}

export interface UpdateFilterPresetInput {
  name?: string;
  filters?: Record<string, unknown>;
  isDefault?: boolean;
  isShared?: boolean;
}

// Query keys
export const filterPresetKeys = {
  all: ["filter-presets"] as const,
  list: (context?: string) =>
    context
      ? ([...filterPresetKeys.all, "list", context] as const)
      : ([...filterPresetKeys.all, "list"] as const),
  detail: (id: string) => [...filterPresetKeys.all, "detail", id] as const,
  default: (context: string) =>
    [...filterPresetKeys.all, "default", context] as const,
};

/**
 * Fetch all filter presets for the current user
 */
export function useFilterPresets(context?: string) {
  return useQuery({
    queryKey: filterPresetKeys.list(context),
    queryFn: async () => {
      const url = context
        ? `/api/filter-presets?context=${context}`
        : "/api/filter-presets";
      const response = await apiRequest("GET", url);
      return response.json() as Promise<{ data: FilterPreset[] }>;
    },
    select: (data) => data.data,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Fetch the default preset for a specific context
 */
export function useDefaultFilterPreset(context: string) {
  return useQuery({
    queryKey: filterPresetKeys.default(context),
    queryFn: async () => {
      const response = await apiRequest(
        "GET",
        `/api/filter-presets/default/${context}`,
      );
      return response.json() as Promise<{ data: FilterPreset | null }>;
    },
    select: (data) => data.data,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Create a new filter preset
 */
export function useCreateFilterPreset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateFilterPresetInput) => {
      const response = await apiRequest("POST", "/api/filter-presets", input);
      return response.json() as Promise<{ data: FilterPreset }>;
    },
    onSuccess: (data) => {
      // Invalidate lists and default queries for this context
      queryClient.invalidateQueries({
        queryKey: filterPresetKeys.list(data.data.context),
      });
      queryClient.invalidateQueries({
        queryKey: filterPresetKeys.list(),
      });
      if (data.data.isDefault) {
        queryClient.invalidateQueries({
          queryKey: filterPresetKeys.default(data.data.context),
        });
      }
    },
  });
}

/**
 * Update an existing filter preset
 */
export function useUpdateFilterPreset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: UpdateFilterPresetInput & { id: string }) => {
      const response = await apiRequest(
        "PATCH",
        `/api/filter-presets/${id}`,
        input,
      );
      return response.json() as Promise<{ data: FilterPreset }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: filterPresetKeys.list(data.data.context),
      });
      queryClient.invalidateQueries({
        queryKey: filterPresetKeys.list(),
      });
      queryClient.invalidateQueries({
        queryKey: filterPresetKeys.detail(data.data.id),
      });
      queryClient.invalidateQueries({
        queryKey: filterPresetKeys.default(data.data.context),
      });
    },
  });
}

/**
 * Delete a filter preset
 */
export function useDeleteFilterPreset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, context }: { id: string; context: string }) => {
      const response = await apiRequest("DELETE", `/api/filter-presets/${id}`);
      return { id, context, response };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: filterPresetKeys.list(data.context),
      });
      queryClient.invalidateQueries({
        queryKey: filterPresetKeys.list(),
      });
      queryClient.removeQueries({
        queryKey: filterPresetKeys.detail(data.id),
      });
      // A deleted default must stop being applied (falls back to no preset).
      queryClient.invalidateQueries({
        queryKey: filterPresetKeys.default(data.context),
      });
    },
  });
}
