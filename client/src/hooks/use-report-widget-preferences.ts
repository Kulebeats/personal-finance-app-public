import { throwIfResNotOk } from "@/lib/queryClient";
import { protectedFetch } from "@/lib/protected-fetch";
/**
 * React Query hooks for Report Widget Preferences
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useEffect } from "react";
import { apiCall } from "@/lib/api";
import { assertOperationLifetime, captureOperationLifetime } from "@/lib/operation-lifetime";
import { reportPreferencesPatchResponse, reportPreferencesResetResponse, reportPreferencesResponse } from "@/lib/report-preference-response";

// ============================================================================
// TYPES
// ============================================================================

import {
  CustomChartConfig,
  ReportWidgetPreferences,
  ReportWidgetPreferencesPatch,
  WidgetPreference,
} from "@shared/reports";

// ============================================================================
// TYPES
// ============================================================================

export type WidgetConfig = WidgetPreference; // Alias for backward compatibility if needed

type ApiResponse<T> = { success: boolean; data: T; message?: string };
const reportPreferencesKey = ["settings", "report-widgets"] as const;

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Fetch report widget preferences
 */
export function useReportWidgetPreferences() {
  const operation = useRef(captureOperationLifetime());
  return useQuery({
    queryKey: reportPreferencesKey,
    queryFn: async () => {
      assertOperationLifetime(operation.current);
      const res = await protectedFetch("/api/settings/report-widgets", {
        credentials: "include",
      }, operation.current);
      await throwIfResNotOk(res);
      const json = await res.json();
      assertOperationLifetime(operation.current);
      return reportPreferencesResponse(json);
    },
    staleTime: 60_000, // 1 minute
  });
}

/**
 * Update report widget preferences
 */
export function useUpdateReportWidgetPreferences() {
  const queryClient = useQueryClient();
  const operation = useRef(captureOperationLifetime());

  return useMutation({
    scope: { id: "report-widget-preferences" },
    mutationFn: async (updates: ReportWidgetPreferencesPatch) => {
      assertOperationLifetime(operation.current);
      const body = JSON.stringify(updates);
      // Through apiCall so the PATCH carries x-csrf-token.
      const json = await apiCall<
        ApiResponse<{ preferences: ReportWidgetPreferences }>
      >("/settings/report-widgets", {
        method: "PATCH",
        body,
      });
      assertOperationLifetime(operation.current);
      return reportPreferencesPatchResponse(json, JSON.parse(body) as ReportWidgetPreferencesPatch);
    },
    onSuccess: async (newPreferences) => {
      assertOperationLifetime(operation.current);
      // A GET started before the write may still be resolving. Its older value
      // must not replace this validated acknowledgement in the shared cache.
      await queryClient.cancelQueries({ queryKey: reportPreferencesKey, exact: true });
      assertOperationLifetime(operation.current);
      queryClient.setQueryData(reportPreferencesKey, newPreferences);
    },
  });
}

/** Restore the server's existing layout defaults while retaining custom charts. */
export function useResetReportWidgetPreferences() {
  const queryClient = useQueryClient();
  const operation = useRef(captureOperationLifetime());
  return useMutation({
    scope: { id: "report-widget-preferences" },
    mutationFn: async () => {
      assertOperationLifetime(operation.current);
      const json = await apiCall<unknown>("/settings/report-widgets/reset", { method: "POST", body: "{}" });
      assertOperationLifetime(operation.current);
      return reportPreferencesResetResponse(json);
    },
    onSuccess: async preferences => {
      assertOperationLifetime(operation.current);
      await queryClient.cancelQueries({ queryKey: reportPreferencesKey, exact: true });
      assertOperationLifetime(operation.current);
      queryClient.setQueryData(reportPreferencesKey, preferences);
    },
  });
}

/**
 * Convenience hook for enabling/disabling widgets
 */
export function useWidgetToggle() {
  const { mutateAsync: mutate } = useUpdateReportWidgetPreferences();
  const { data: preferences } = useReportWidgetPreferences();

  const toggleWidget = useCallback(
    (
      section: "coreWidgets" | "optionalWidgets",
      widgetId: string,
      enabled: boolean
    ) => {
      if (!preferences) return Promise.reject(new Error("Widget preferences are not loaded. Please retry."));

      const widget = preferences[section][widgetId];
      if (!widget) return Promise.reject(new Error("Widget preferences are unavailable. Please reload."));

      return mutate({
        [section]: {
          [widgetId]: { enabled },
        },
      });
    },
    [mutate, preferences]
  );

  const reorderWidget = useCallback(
    (
      section: "coreWidgets" | "optionalWidgets",
      widgetId: string,
      newOrder: number
    ) => {
      if (!preferences) return Promise.reject(new Error("Widget preferences are not loaded. Please retry."));

      const widget = preferences[section][widgetId];
      if (!widget) return Promise.reject(new Error("Widget preferences are unavailable. Please reload."));

      return mutate({
        [section]: {
          [widgetId]: { order: newOrder },
        },
      });
    },
    [mutate, preferences]
  );

  const setChartType = useCallback(
    (
      section: "coreWidgets" | "optionalWidgets",
      widgetId: string,
      chartType: string
    ) => {
      if (!preferences) return Promise.reject(new Error("Widget preferences are not loaded. Please retry."));

      const widget = preferences[section][widgetId];
      if (!widget) return Promise.reject(new Error("Widget preferences are unavailable. Please reload."));

      return mutate({
        [section]: {
          [widgetId]: { chartType },
        },
      });
    },
    [mutate, preferences]
  );

  return { toggleWidget, reorderWidget, setChartType };
}

/**
 * Hook for getting/setting a widget's chart type with debouncing
 */
export function useWidgetChartType(
  section: "coreWidgets" | "optionalWidgets",
  widgetId: string
) {
  const { data: preferences } = useReportWidgetPreferences();
  const { setChartType: persistChartType } = useWidgetToggle();
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const operation = useRef(captureOperationLifetime());

  const widget = preferences?.[section]?.[widgetId];
  const chartType = widget?.chartType;

  const setChartType = useCallback(
    (newChartType: string) => {
      // Clear any pending debounced call
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      // Debounce persistence to avoid rapid API calls
      debounceRef.current = setTimeout(() => {
        try { assertOperationLifetime(operation.current); } catch { return; }
        persistChartType(section, widgetId, newChartType);
      }, 500);
    },
    [section, widgetId, persistChartType]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [section, widgetId]);

  return { chartType, setChartType };
}

/**
 * Hook for managing custom charts
 */
export function useCustomCharts() {
  const { mutateAsync: mutate } = useUpdateReportWidgetPreferences();
  const { data: preferences } = useReportWidgetPreferences();

  const addCustomChart = useCallback(
    async (chart: Omit<CustomChartConfig, "id" | "order" | "createdAt">) => {
      if (!preferences) throw new Error("Widget preferences are not loaded. Please retry.");
      if ((preferences.customCharts || []).length >= 10) {
        throw new Error("Maximum 10 custom charts allowed");
      }

      const newChart: CustomChartConfig = {
        ...chart,
        id: `custom-${Date.now()}`,
        createdAt: new Date().toISOString(),
        order: (preferences.customCharts || []).length,
      };

      return mutate({
        customCharts: [...(preferences.customCharts || []), newChart],
      });
    },
    [mutate, preferences]
  );

  const updateCustomChart = useCallback(
    async (chartId: string, updates: Partial<Omit<CustomChartConfig, "id">>) => {
      if (!preferences) throw new Error("Widget preferences are not loaded. Please retry.");

      const updatedCharts = (preferences.customCharts || []).map((chart) =>
        chart.id === chartId ? { ...chart, ...updates } : chart
      );

      return mutate({ customCharts: updatedCharts });
    },
    [mutate, preferences]
  );

  const deleteCustomChart = useCallback(
    async (chartId: string) => {
      if (!preferences) throw new Error("Widget preferences are not loaded. Please retry.");

      const updatedCharts = (preferences.customCharts || [])
        .filter((chart) => chart.id !== chartId)
        .map((chart, index) => ({ ...chart, order: index }));

      return mutate({ customCharts: updatedCharts });
    },
    [mutate, preferences]
  );

  const reorderCustomCharts = useCallback(
    async (chartIds: string[]) => {
      if (!preferences) throw new Error("Widget preferences are not loaded. Please retry.");

      const currentCharts = preferences.customCharts || [];
      const updatedCharts = chartIds
        .map((id, index) => {
          const chart = currentCharts.find((c) => c.id === id);
          return chart ? { ...chart, order: index } : null;
        })
        .filter(Boolean) as CustomChartConfig[];

      return mutate({ customCharts: updatedCharts });
    },
    [mutate, preferences]
  );

  return {
    customCharts: preferences?.customCharts || [],
    addCustomChart,
    updateCustomChart,
    deleteCustomChart,
    reorderCustomCharts,
    canAddMore: (preferences?.customCharts?.length || 0) < 10,
  };
}

/**
 * Hook for managing widget onboarding state
 */
export function useWidgetOnboarding() {
  const { data: preferences, isLoading, error, refetch } = useReportWidgetPreferences();
  const { mutateAsync: mutate } = useUpdateReportWidgetPreferences();

  const completeOnboarding = useCallback(
    (selectedPrefs: ReportWidgetPreferencesPatch) => {
      return mutate({
        ...selectedPrefs,
        hasCompletedWidgetSetup: true,
      });
    },
    [mutate]
  );

  const resetOnboarding = useCallback(() => {
    return mutate({ hasCompletedWidgetSetup: false });
  }, [mutate]);

  return {
    hasCompletedSetup: preferences?.hasCompletedWidgetSetup,
    isLoading,
    error,
    refetch,
    completeOnboarding,
    resetOnboarding,
  };
}
