import { describe, expect, expectTypeOf, it } from "vitest";
import type { CustomChartConfig, IdentifiedWidgetPreference, WidgetPreference } from "@shared/reports";
import { identifyWidgetPreferences, reportPreferencesResponse } from "../report-preference-response";

const legacyChart = {
  id: "legacy-chart", name: "Legacy chart", chartType: "bar", primaryMetric: "income", order: 0,
  secondaryMetric: "expenses", groupBy: "month", aggregation: "sum", showAverage: true, showComparison: false,
  futureChart: { retained: ["raw", 4] },
};
const preferences = {
  coreWidgets: { summaryCards: { enabled: true, order: 0, chartType: "cards", expanded: false, futureWidget: { retained: true } } },
  optionalWidgets: { futureWidget: { enabled: false, order: 2 } },
  customCharts: [legacyChart], hasCompletedWidgetSetup: true, futurePreferences: { retained: true },
};
const envelope = (value: unknown) => ({ success: true, data: { preferences: value } });

describe("report preference response contract", () => {
  it("accepts and preserves legacy widgets/charts without fabricating identity or creation time", () => {
    const result = reportPreferencesResponse(envelope(preferences));
    expect(result).toEqual(preferences);
    expect(result.coreWidgets.summaryCards).not.toHaveProperty("id");
    expect(result.customCharts[0]).not.toHaveProperty("createdAt");
    expectTypeOf<WidgetPreference["id"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<CustomChartConfig["createdAt"]>().toEqualTypeOf<string | undefined>();
  });

  it("accepts every known optional field when its value has the declared type", () => {
    const result = reportPreferencesResponse(envelope({
      ...preferences,
      coreWidgets: { summaryCards: { ...preferences.coreWidgets.summaryCards, id: "summaryCards" } },
      customCharts: [{ ...legacyChart, createdAt: "2026-10-30T00:00:00.000Z" }],
    }));
    expect(result.customCharts[0]).toMatchObject({ ...legacyChart, createdAt: "2026-10-30T00:00:00.000Z" });
  });

  it.each([
    { id: 4 }, { enabled: "true" }, { order: Infinity }, { order: NaN }, { order: -1 }, { order: 1.5 },
    { chartType: false }, { expanded: "false" },
  ])("rejects malformed known widget fields %j", invalid => {
    expect(() => reportPreferencesResponse(envelope({ ...preferences, coreWidgets: { summaryCards: { ...preferences.coreWidgets.summaryCards, ...invalid } } }))).toThrow(/invalid widget preferences/i);
  });

  it.each([
    { id: 4 }, { name: null }, { chartType: false }, { primaryMetric: [] },
    { secondaryMetric: false }, { groupBy: 1 }, { aggregation: {} },
    { showAverage: "true" }, { showComparison: 0 }, { createdAt: 3 },
    { order: Infinity }, { order: -1 }, { order: 1.5 },
  ])("rejects malformed known custom chart fields %j", invalid => {
    expect(() => reportPreferencesResponse(envelope({ ...preferences, customCharts: [{ ...legacyChart, ...invalid }] }))).toThrow(/invalid widget preferences/i);
  });

  it.each([
    null, {}, { success: false, data: { preferences } },
    { success: true, data: {} }, envelope({ ...preferences, coreWidgets: [] }),
    envelope({ ...preferences, optionalWidgets: null }), envelope({ ...preferences, customCharts: {} }),
    envelope({ ...preferences, hasCompletedWidgetSetup: "true" }),
  ])("rejects a malformed preference envelope %j", value => {
    expect(() => reportPreferencesResponse(value)).toThrow(/invalid widget preferences/i);
  });

  it("derives UI widget identity from each map key while preserving the stored document", () => {
    const widgets = {
      first: { enabled: true, order: 0, futureWidget: { retained: true } },
      second: { id: "old-identity", enabled: false, order: 1, chartType: "bar" },
    };
    const before = structuredClone(widgets);
    const identified = identifyWidgetPreferences(widgets);
    expect(identified).toEqual([
      { ...widgets.first, id: "first" },
      { ...widgets.second, id: "second" },
    ]);
    expect(widgets).toEqual(before);
    expectTypeOf(identified).toEqualTypeOf<IdentifiedWidgetPreference[]>();
  });
});
