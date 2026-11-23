import { REPORT_WIDGET_DEFAULT_LAYOUT, type ReportWidgetPreferences, type ReportWidgetPreferencesPatch, type WidgetPreference } from "@shared/reports";
import { ValidationError } from "../core/errors";

export type StoredReportWidgetPreferencesPatch = ReportWidgetPreferencesPatch;

const defaults: ReportWidgetPreferences = {
  ...REPORT_WIDGET_DEFAULT_LAYOUT,
  customCharts: [],
  hasCompletedWidgetSetup: false,
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function widgetDefaults(defaultWidgets: object, stored: unknown) {
  const saved = record(stored);
  return {
    ...Object.fromEntries(Object.entries(defaultWidgets).map(([key, value]) => [key, {
      ...value, ...record(saved[key]),
    }])),
    ...Object.fromEntries(Object.entries(saved).filter(([key]) => !Object.hasOwn(defaultWidgets, key))),
  };
}

/** Read defaults without rewriting the stored document or discarding future siblings. */
export function reportWidgetPreferences(value: unknown): ReportWidgetPreferences {
  const stored = record(value);
  return {
    ...defaults,
    ...stored,
    coreWidgets: widgetDefaults(defaults.coreWidgets, stored.coreWidgets),
    optionalWidgets: widgetDefaults(defaults.optionalWidgets, stored.optionalWidgets),
    customCharts: stored.customCharts ?? defaults.customCharts,
    hasCompletedWidgetSetup: stored.hasCompletedWidgetSetup ?? defaults.hasCompletedWidgetSetup,
  } as ReportWidgetPreferences;
}

/** Reset only the layout maps; saved charts, setup, and future siblings survive. */
export function resetReportWidgetLayout(value: unknown): ReportWidgetPreferences {
  const current = reportWidgetPreferences(value);
  const initial = reportWidgetPreferences(undefined);
  return {
    ...current,
    coreWidgets: initial.coreWidgets,
    optionalWidgets: initial.optionalWidgets,
  };
}

function mergeWidgets(
  current: object,
  supplied: Record<string, Partial<WidgetPreference>> | undefined,
) {
  let next = { ...current };
  for (const [key, patch] of Object.entries(supplied ?? {})) {
    const existing = Object.hasOwn(current, key);
    const previous = existing ? record(record(current)[key]) : {};
    const widget = { ...previous, ...patch };
    // Supplied values are validated at the route. A new unknown key cannot
    // borrow defaults, so it must establish a complete stored widget itself.
    // Existing valid legacy widgets may omit the optional wire chartType.
    const chartlessLegacy = existing && previous.chartType === undefined &&
      typeof previous.enabled === "boolean" && typeof previous.order === "number" &&
      Number.isInteger(previous.order) && previous.order >= 0 &&
      (previous.id === undefined || typeof previous.id === "string") &&
      (previous.expanded === undefined || typeof previous.expanded === "boolean");
    if (widget.enabled === undefined || widget.order === undefined ||
      (widget.chartType === undefined && !chartlessLegacy) ||
      (widget.chartType !== undefined && typeof widget.chartType !== "string")) {
      throw new ValidationError(`Widget ${key} requires enabled, order, and chartType`);
    }
    next = { ...next, [key]: widget };
  }
  return next;
}

/** Call only after obtaining the current display row under its writer lock. */
export function mergeReportWidgetPreferences(
  value: unknown,
  patch: StoredReportWidgetPreferencesPatch,
): ReportWidgetPreferences {
  const current = reportWidgetPreferences(value);
  return {
    ...current,
    ...patch,
    coreWidgets: mergeWidgets(current.coreWidgets, patch.coreWidgets),
    optionalWidgets: mergeWidgets(current.optionalWidgets, patch.optionalWidgets),
  } as ReportWidgetPreferences;
}
