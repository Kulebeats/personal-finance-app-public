import { CUSTOM_CHART_PERIODS, REPORT_WIDGET_DEFAULT_LAYOUT, type CustomChartConfig, type IdentifiedWidgetPreference, type ReportWidgetPreferences, type ReportWidgetPreferencesPatch, type WidgetPreference } from "@shared/reports";
import { z } from "zod";

const widgetSchema = z.object({
  id: z.string().optional(),
  enabled: z.boolean(),
  order: z.number().int().min(0),
  chartType: z.string().optional(),
  expanded: z.boolean().optional(),
}).passthrough();

const customChartSchema = z.object({
  id: z.string(),
  name: z.string(),
  chartType: z.string(),
  primaryMetric: z.string(),
  secondaryMetric: z.string().optional(),
  groupBy: z.string().optional(),
  period: z.enum(CUSTOM_CHART_PERIODS).optional(),
  aggregation: z.string().optional(),
  showAverage: z.boolean().optional(),
  showComparison: z.boolean().optional(),
  createdAt: z.string().optional(),
  order: z.number().int().min(0),
}).passthrough();

const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    preferences: z.object({
      coreWidgets: z.record(widgetSchema),
      optionalWidgets: z.record(widgetSchema),
      customCharts: z.array(customChartSchema),
      hasCompletedWidgetSetup: z.boolean().optional(),
    }).passthrough(),
  }),
});

/** Validate known fields while retaining legacy values and future stored metadata. */
export function reportPreferencesResponse(value: unknown): ReportWidgetPreferences {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Invalid widget preferences response. Please retry.");
  }
  return parsed.data.data.preferences;
}

function acknowledgesSubmittedValue(returned: unknown, submitted: unknown): boolean {
  if (Array.isArray(submitted)) {
    return Array.isArray(returned) && returned.length === submitted.length &&
      submitted.every((item, index) => acknowledgesSubmittedValue(returned[index], item));
  }
  if (submitted !== null && typeof submitted === "object") {
    if (returned === null || typeof returned !== "object" || Array.isArray(returned)) return false;
    return Object.entries(submitted).every(([key, value]) =>
      Object.hasOwn(returned, key) && acknowledgesSubmittedValue((returned as Record<string, unknown>)[key], value));
  }
  return Object.is(returned, submitted);
}

// The PATCH route's chart schema strips other keys and replaces the whole array.
const chartPatchFields = [
  "id", "name", "chartType", "primaryMetric", "secondaryMetric", "groupBy",
  "period", "aggregation", "showAverage", "showComparison", "createdAt", "order",
] as const satisfies readonly (keyof CustomChartConfig)[];

function acknowledgesChartReplacement(returned: CustomChartConfig[], submitted: CustomChartConfig[]): boolean {
  return returned.length === submitted.length && submitted.every((chart, index) =>
    chartPatchFields.every(field => {
      const supplied = Object.hasOwn(chart, field);
      const echoed = Object.hasOwn(returned[index], field);
      return supplied === echoed && (!supplied || acknowledgesSubmittedValue(returned[index][field], chart[field]));
    }));
}

/** A PATCH succeeds only when the server echoes every serialized value it accepted. */
export function reportPreferencesPatchResponse(value: unknown, submitted: ReportWidgetPreferencesPatch): ReportWidgetPreferences {
  const preferences = reportPreferencesResponse(value);
  const { customCharts, ...otherChanges } = submitted;
  if (!acknowledgesSubmittedValue(preferences, otherChanges) ||
      (customCharts !== undefined && !acknowledgesChartReplacement(preferences.customCharts, customCharts))) {
    throw new Error("Widget preferences response did not acknowledge the saved changes. Please retry.");
  }
  return preferences;
}

/** Reset acknowledges only the server's layout maps; peer chart/setup changes are independent. */
export function reportPreferencesResetResponse(value: unknown): ReportWidgetPreferences {
  const preferences = reportPreferencesResponse(value);
  const coreDefaults = REPORT_WIDGET_DEFAULT_LAYOUT.coreWidgets;
  const optionalDefaults = REPORT_WIDGET_DEFAULT_LAYOUT.optionalWidgets;
  if (!acknowledgesSubmittedValue(preferences.coreWidgets, coreDefaults) ||
      !acknowledgesSubmittedValue(coreDefaults, preferences.coreWidgets) ||
      !acknowledgesSubmittedValue(preferences.optionalWidgets, optionalDefaults) ||
      !acknowledgesSubmittedValue(optionalDefaults, preferences.optionalWidgets)) {
    throw new Error("Widget preferences reset response did not restore the default layout. Please retry.");
  }
  return preferences;
}

/** UI identity belongs to the map key; normalization does not alter persisted values. */
export function identifyWidgetPreferences(widgets: Record<string, WidgetPreference>): IdentifiedWidgetPreference[] {
  return Object.entries(widgets).map(([id, widget]) => ({ ...widget, id }));
}
