/**
 * React Query hooks for Report Widget Preferences
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useEffect, useState } from "react";
import { apiCall } from "@/lib/api";

// ============================================================================
// TYPES
// ============================================================================

import {
  CustomChartConfig,
  ReportWidgetPreferences,
  WidgetPreference,
} from "@shared/reports";

// ============================================================================
// TYPES
// ============================================================================

export type WidgetConfig = WidgetPreference; // Alias for backward compatibility if needed

type ApiResponse<T> = { success: boolean; data: T; message?: string };

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Fetch report widget preferences
 */
export function useReportWidgetPreferences() {
  return useQuery({
    queryKey: ["settings", "report-widgets"],
    queryFn: async () => {
      const res = await fetch("/api/settings/report-widgets", {
        credentials: "include",
      });
      const json = (await res.json()) as ApiResponse<{
        preferences: ReportWidgetPreferences;
      }>;
      if (!json.success) throw new Error("Failed to load widget preferences");
      return json.data.preferences;
    },
    staleTime: 60_000, // 1 minute
  });
}

/**
 * Update report widget preferences
 */
export function useUpdateReportWidgetPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: Partial<ReportWidgetPreferences>) => {
      // Through apiCall so the PATCH carries x-csrf-token.
      const json = await apiCall<
        ApiResponse<{ preferences: ReportWidgetPreferences }>
      >("/settings/report-widgets", {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
      if (!json.success) throw new Error("Failed to update widget preferences");
      return json.data.preferences;
    },
    onSuccess: (newPreferences) => {
      queryClient.setQueryData(["settings", "report-widgets"], newPreferences);
    },
  });
}

/**
 * Convenience hook for enabling/disabling widgets
 */
export function useWidgetToggle() {
  const { mutate } = useUpdateReportWidgetPreferences();
  const { data: preferences } = useReportWidgetPreferences();

  const toggleWidget = useCallback(
    (
      section: "coreWidgets" | "optionalWidgets",
      widgetId: string,
      enabled: boolean
    ) => {
      if (!preferences) return;

      const widget = preferences[section][widgetId];
      if (!widget) return;

      mutate({
        [section]: {
          [widgetId]: { ...widget, enabled },
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
      if (!preferences) return;

      const widget = preferences[section][widgetId];
      if (!widget) return;

      mutate({
        [section]: {
          [widgetId]: { ...widget, order: newOrder },
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
      if (!preferences) return;

      const widget = preferences[section][widgetId];
      if (!widget) return;

      mutate({
        [section]: {
          [widgetId]: { ...widget, chartType },
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
  }, []);

  return { chartType, setChartType };
}

/**
 * Hook for managing custom charts
 */
export function useCustomCharts() {
  const { mutate } = useUpdateReportWidgetPreferences();
  const { data: preferences } = useReportWidgetPreferences();

  const addCustomChart = useCallback(
    (chart: Omit<CustomChartConfig, "id" | "order" | "createdAt">) => {
      if (!preferences) return;
      if ((preferences.customCharts || []).length >= 10) {
        throw new Error("Maximum 10 custom charts allowed");
      }

      const newChart: CustomChartConfig = {
        ...chart,
        id: `custom-${Date.now()}`,
        createdAt: new Date().toISOString(),
        order: (preferences.customCharts || []).length,
      };

      mutate({
        customCharts: [...(preferences.customCharts || []), newChart],
      });
    },
    [mutate, preferences]
  );

  const updateCustomChart = useCallback(
    (chartId: string, updates: Partial<Omit<CustomChartConfig, "id">>) => {
      if (!preferences) return;

      const updatedCharts = (preferences.customCharts || []).map((chart) =>
        chart.id === chartId ? { ...chart, ...updates } : chart
      );

      mutate({ customCharts: updatedCharts });
    },
    [mutate, preferences]
  );

  const deleteCustomChart = useCallback(
    (chartId: string) => {
      if (!preferences) return;

      const updatedCharts = (preferences.customCharts || [])
        .filter((chart) => chart.id !== chartId)
        .map((chart, index) => ({ ...chart, order: index }));

      mutate({ customCharts: updatedCharts });
    },
    [mutate, preferences]
  );

  const reorderCustomCharts = useCallback(
    (chartIds: string[]) => {
      if (!preferences) return;

      const currentCharts = preferences.customCharts || [];
      const updatedCharts = chartIds
        .map((id, index) => {
          const chart = currentCharts.find((c) => c.id === id);
          return chart ? { ...chart, order: index } : null;
        })
        .filter(Boolean) as CustomChartConfig[];

      mutate({ customCharts: updatedCharts });
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
  const { data: preferences, isLoading } = useReportWidgetPreferences();
  const { mutate } = useUpdateReportWidgetPreferences();
  const storageKey = "reportsWidgetSetupComplete";
  const [localCompleted, setLocalCompleted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(storageKey) === "true";
  });

  useEffect(() => {
    if (preferences?.hasCompletedWidgetSetup && !localCompleted) {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, "true");
      }
      setLocalCompleted(true);
    }
  }, [preferences?.hasCompletedWidgetSetup, localCompleted, storageKey]);

  const completeOnboarding = useCallback(
    (selectedPrefs: Partial<ReportWidgetPreferences>) => {
      mutate({
        ...selectedPrefs,
        hasCompletedWidgetSetup: true,
      });
      if (typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, "true");
      }
      setLocalCompleted(true);
    },
    [mutate, storageKey]
  );

  const resetOnboarding = useCallback(() => {
    mutate({ hasCompletedWidgetSetup: false });
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(storageKey);
    }
    setLocalCompleted(false);
  }, [mutate, storageKey]);

  return {
    hasCompletedSetup:
      (preferences?.hasCompletedWidgetSetup ?? false) || localCompleted,
    isLoading,
    completeOnboarding,
    resetOnboarding,
  };
}
