import { useState, useEffect, useRef } from "react";
import {
  useDisplaySettings,
  useUpdateDisplaySettings,
} from "@/hooks/use-settings";
import { WidgetConfig } from "@/components/dashboard/CustomizeDashboardModal";
import { arrayMove } from "@dnd-kit/sortable";
import { useDebounce } from "@/hooks/use-debounce"; // Assuming this exists, if not will implement simple timeout or checking imports

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: "weekly-recap", label: "Weekly Recap", enabled: true },
  { id: "budget-summary", label: "Budget Summary", enabled: true },
  { id: "transactions-list", label: "Transactions List", enabled: true },
  { id: "spending-trend", label: "Spending Trend", enabled: true },
  { id: "top-merchants", label: "Top Merchants", enabled: true },
  { id: "net-worth", label: "Net Worth", enabled: true },
  { id: "annual-summary", label: "Annual Summary", enabled: true },
  { id: "recent-transactions", label: "Recent Transactions", enabled: true },
  { id: "cash-flow", label: "Cash Flow", enabled: true },
  { id: "recurring", label: "Recurring Expenses", enabled: true },
  { id: "spending-category", label: "Spending by Category", enabled: true },
  { id: "accounts", label: "Accounts", enabled: true },
  { id: "goals", label: "Goals", enabled: true },
  { id: "budget-status", label: "Budget Status", enabled: true },
  { id: "investments", label: "Investment Portfolio", enabled: true },
];

const DEFAULT_WIDGETS_BY_ID = new Map(
  DEFAULT_WIDGETS.map((widget) => [widget.id, widget]),
);

function isWidgetConfig(value: unknown): value is WidgetConfig {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WidgetConfig>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.enabled === "boolean" &&
    (candidate.label === undefined || typeof candidate.label === "string")
  );
}

function sanitizeWidgets(rawWidgets: unknown): WidgetConfig[] | null {
  if (!Array.isArray(rawWidgets)) return null;

  const sanitized: WidgetConfig[] = [];
  const seen = new Set<string>();

  for (const rawWidget of rawWidgets) {
    if (!isWidgetConfig(rawWidget)) continue;
    if (seen.has(rawWidget.id)) continue;

    const defaultWidget = DEFAULT_WIDGETS_BY_ID.get(rawWidget.id);
    const label = rawWidget.label ?? defaultWidget?.label ?? rawWidget.id;

    sanitized.push({
      id: rawWidget.id,
      label,
      enabled: rawWidget.enabled,
    });
    seen.add(rawWidget.id);
  }

  return sanitized.length > 0 ? sanitized : null;
}

export function useDashboardWidgets() {
  const { data: settings, isLoading } = useDisplaySettings();
  const { mutate: updateSettings } = useUpdateDisplaySettings();
  const [widgets, setWidgets] = useState<WidgetConfig[]>(DEFAULT_WIDGETS);
  const [hasLoaded, setHasLoaded] = useState(false);

  // Debounce the widgets state for saving
  const debouncedWidgets = useDebounce(widgets, 1000);

  // Ref to track if the current widgets state differs from what we loaded/saved
  // This helps prevent saving the initial load or circular updates
  const isDirty = useRef(false);

  // Sync with settings when loaded (only once or if remote changes and we aren't dirty?)
  // For simplicity, we only load once on mount/fetch.
  // Real-time sync with other tabs would require more complex logic.
  useEffect(() => {
    const savedWidgets = sanitizeWidgets(settings?.dashboardWidgets?.widgets);

    if (!savedWidgets) {
      if (settings && !hasLoaded) {
        setHasLoaded(true);
      }
      return;
    }

    // Only update from settings if we haven't modified locally yet,
    // OR if we want to enforce server state (but that breaks UX if typing/dragging)
    // Here we just do it on initial load.
    if (!hasLoaded) {
      const savedIds = new Set(savedWidgets.map((w) => w.id));
      const missingWidgets = DEFAULT_WIDGETS.filter((w) => !savedIds.has(w.id));

      setWidgets([...savedWidgets, ...missingWidgets]);
      setHasLoaded(true);
    }
  }, [settings, hasLoaded]);

  // Effect to save when debounced widgets change
  useEffect(() => {
    if (hasLoaded && isDirty.current) {
      updateSettings({
        dashboardWidgets: {
          widgets: debouncedWidgets,
          version: 1,
        },
      });
      isDirty.current = false;
    }
  }, [debouncedWidgets, hasLoaded, updateSettings]);

  const toggleWidget = (id: string) => {
    isDirty.current = true;
    setWidgets((prev) =>
      prev.map((w) => (w.id === id ? { ...w, enabled: !w.enabled } : w))
    );
  };

  const reorderWidgets = (activeId: string, overId: string) => {
    isDirty.current = true;
    setWidgets((items) => {
      const oldIndex = items.findIndex((item) => item.id === activeId);
      const newIndex = items.findIndex((item) => item.id === overId);
      return arrayMove(items, oldIndex, newIndex);
    });
  };

  const resetToDefault = () => {
    isDirty.current = true;
    setWidgets(DEFAULT_WIDGETS);
  };

  return {
    widgets,
    toggleWidget,
    reorderWidgets,
    resetToDefault,
    isLoading: isLoading || !hasLoaded,
  };
}
