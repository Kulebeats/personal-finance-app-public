import { useState, useEffect, useRef, useCallback } from "react";
import {
  useDisplaySettings,
  useUpdateDisplaySettings,
} from "@/hooks/use-settings";
import { WidgetConfig } from "@/components/dashboard/CustomizeDashboardModal";
import { arrayMove } from "@dnd-kit/sortable";
import { assertOperationLifetime, captureOperationLifetime } from "@/lib/operation-lifetime";

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
  const { data: settings, isLoading, isFetching, error: settingsError, refetch } = useDisplaySettings();
  const { mutateAsync: updateSettings } = useUpdateDisplaySettings();
  const [widgets, setWidgets] = useState<WidgetConfig[]>(DEFAULT_WIDGETS);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "unsaved" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const save = useRef(updateSettings);
  save.current = updateSettings;
  const operation = useRef(captureOperationLifetime());
  const queue = useRef({
    active: true,
    pending: false,
    failed: false,
    draft: DEFAULT_WIDGETS,
    acknowledged: DEFAULT_WIDGETS,
    timer: null as ReturnType<typeof setTimeout> | null,
  });
  const sameLayout = (a: WidgetConfig[], b: WidgetConfig[]) => JSON.stringify(a) === JSON.stringify(b);

  const saveLatest = useCallback(async function persistLatest(force = false): Promise<void> {
    const current = queue.current;
    if (!current.active || current.pending || (current.failed && !force)) return;
    try { assertOperationLifetime(operation.current); } catch { return; }
    if (current.timer) clearTimeout(current.timer);
    current.timer = null;
    if (!force && sameLayout(current.draft, current.acknowledged)) return;

    const sent = current.draft;
    current.pending = true;
    current.failed = false;
    setSaveError(null);
    setSaveStatus("saving");
    try {
      const acknowledged = await save.current({ dashboardWidgets: { widgets: sent, version: 1 } });
      if (!current.active) return;
      assertOperationLifetime(operation.current);
      const stored = acknowledged?.dashboardWidgets;
      if (!stored || stored.version !== 1 || !Array.isArray(stored.widgets) || stored.widgets.length !== sent.length ||
        !stored.widgets.every((widget, index) => isWidgetConfig(widget) && widget.id === sent[index].id && widget.label === sent[index].label && widget.enabled === sent[index].enabled)) {
        throw new Error("Dashboard layout was not acknowledged. Retry saving.");
      }
      current.acknowledged = sent;
      current.pending = false;
      if (sameLayout(current.draft, sent)) {
        setSaveStatus("saved");
      } else {
        setSaveStatus("unsaved");
        // A newer draft whose debounce already expired follows this acknowledgement.
        if (!current.timer) void persistLatest();
      }
    } catch (error) {
      if (!current.active) return;
      try { assertOperationLifetime(operation.current); } catch { return; }
      current.pending = false;
      current.failed = true;
      setSaveError(error instanceof Error ? error.message : "Unable to save dashboard layout");
      setSaveStatus("error");
    }
  }, []);

  // SessionBoundary keys this hook's tree by lifetime; discard its timer and response on unmount.
  useEffect(() => {
    queue.current.active = true;
    return () => {
      queue.current.active = false;
      if (queue.current.timer) clearTimeout(queue.current.timer);
    };
  }, []);

  useEffect(() => {
    if (hasLoaded || !settings) return;
    const savedWidgets = sanitizeWidgets(settings?.dashboardWidgets?.widgets);
    const savedIds = new Set(savedWidgets?.map((widget) => widget.id));
    const loaded = savedWidgets
      ? [...savedWidgets, ...DEFAULT_WIDGETS.filter((widget) => !savedIds.has(widget.id))]
      : DEFAULT_WIDGETS;
    queue.current.acknowledged = loaded;
    queue.current.draft = loaded;
    setWidgets(loaded);
    setHasLoaded(true);
  }, [settings, hasLoaded]);

  useEffect(() => {
    if (!hasLoaded) return;
    const current = queue.current;
    current.draft = widgets;
    if (current.timer) clearTimeout(current.timer);
    current.timer = null;
    if (current.failed) return; // Explicit Retry resumes after a failure, without a retry loop.
    if (!current.pending && sameLayout(widgets, current.acknowledged)) {
      setSaveStatus(status => status === "saved" ? status : "idle");
      return;
    }
    setSaveStatus(current.pending ? "saving" : "unsaved");
    current.timer = setTimeout(() => { current.timer = null; void saveLatest(); }, 1000);
  }, [widgets, hasLoaded, saveLatest]);

  const toggleWidget = (id: string) => {
    if (!hasLoaded) return;
    setWidgets((prev) =>
      prev.map((w) => (w.id === id ? { ...w, enabled: !w.enabled } : w))
    );
  };

  const reorderWidgets = (activeId: string, overId: string) => {
    if (!hasLoaded) return;
    setWidgets((items) => {
      const oldIndex = items.findIndex((item) => item.id === activeId);
      const newIndex = items.findIndex((item) => item.id === overId);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return items;
      return arrayMove(items, oldIndex, newIndex);
    });
  };

  const resetToDefault = () => {
    if (!hasLoaded) return;
    setWidgets(DEFAULT_WIDGETS);
  };

  return {
    widgets,
    toggleWidget,
    reorderWidgets,
    resetToDefault,
    saveStatus,
    saveError,
    isDirty: saveStatus === "unsaved" || saveStatus === "saving" || saveStatus === "error",
    retrySave: () => { if (queue.current.failed) void saveLatest(true); },
    loadError: !hasLoaded && settingsError ? settingsError.message : null,
    retryLoad: () => {
      try { assertOperationLifetime(operation.current); } catch { return; }
      void refetch();
    },
    isLoading: !hasLoaded && (isLoading || isFetching || !settingsError),
  };
}
