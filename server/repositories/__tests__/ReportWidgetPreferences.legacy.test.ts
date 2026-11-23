import { describe, expect, it } from "vitest";
import { ValidationError } from "../../core/errors";
import { mergeReportWidgetPreferences, reportWidgetPreferences } from "../ReportWidgetPreferences";

const legacyWidget = { enabled: true, order: 5, expanded: false, futureWidget: { retained: true } };
const saved = {
  coreWidgets: {}, optionalWidgets: { legacyUnknown: legacyWidget }, customCharts: [],
  hasCompletedWidgetSetup: true, futurePreferences: { retained: true },
};

describe("legacy report widgets without a chart type", () => {
  it.each(["coreWidgets", "optionalWidgets"] as const)("preserves missing chartType and future metadata on an enabled-only %s update", section => {
    const input = { ...saved, [section]: { legacyUnknown: legacyWidget } };
    const before = structuredClone(input);
    const result = mergeReportWidgetPreferences(input, { [section]: { legacyUnknown: { enabled: false } } });
    expect(result[section].legacyUnknown).toEqual({ ...legacyWidget, enabled: false });
    expect(result[section].legacyUnknown).not.toHaveProperty("chartType");
    expect(result).toMatchObject({ hasCompletedWidgetSetup: true, futurePreferences: saved.futurePreferences });
    expect(input).toEqual(before);
  });

  it("accepts an explicit chart type update on the legacy record without dropping metadata", () => {
    const result = mergeReportWidgetPreferences(saved, { optionalWidgets: { legacyUnknown: { chartType: "line" } } });
    expect(result.optionalWidgets.legacyUnknown).toEqual({ ...legacyWidget, chartType: "line" });
  });

  it.each([
    { enabled: true, order: 0 }, { enabled: true, chartType: "bar" }, { order: 0, chartType: "bar" },
  ])("still requires a complete first write for a new unknown widget %j", widget => {
    expect(() => mergeReportWidgetPreferences(saved, { optionalWidgets: { newUnknown: widget } })).toThrow(ValidationError);
  });

  it("accepts a complete first write and leaves the existing legacy widget untouched", () => {
    const widget = { enabled: false, order: 0, chartType: "bar" };
    const result = mergeReportWidgetPreferences(saved, { optionalWidgets: { newUnknown: widget } });
    expect(result.optionalWidgets.newUnknown).toEqual(widget);
    expect(result.optionalWidgets.legacyUnknown).toEqual(legacyWidget);
    expect(result.optionalWidgets.legacyUnknown).not.toHaveProperty("chartType");
  });

  it.each([
    null, "invalid", [], { order: 0 }, { enabled: true }, { enabled: "true", order: 0 },
    { enabled: true, order: -1 }, { enabled: true, order: 0.5 }, { enabled: true, order: Infinity },
    { enabled: true, order: 0, expanded: "false" }, { enabled: true, order: 0, id: null },
    { enabled: true, order: 0, chartType: null }, { enabled: true, order: 0, chartType: false },
  ])("does not grant the missing-chartType exception to malformed stored records %j", legacyUnknown => {
    const input = { ...saved, optionalWidgets: { legacyUnknown } };
    expect(() => mergeReportWidgetPreferences(input, { optionalWidgets: { legacyUnknown: { enabled: false, order: 0 } } })).toThrow(ValidationError);
  });

  it("continues to merge partial known-widget defaults", () => {
    const defaults = reportWidgetPreferences(undefined);
    const result = mergeReportWidgetPreferences(undefined, { coreWidgets: { summaryCards: { enabled: false } } });
    expect(result.coreWidgets.summaryCards).toEqual({ ...defaults.coreWidgets.summaryCards, enabled: false });
  });
});
