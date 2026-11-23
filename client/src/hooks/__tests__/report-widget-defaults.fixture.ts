import { REPORT_WIDGET_DEFAULT_LAYOUT, type ReportWidgetPreferences } from "@shared/reports";

// The server writer and client validator consume this same reset layout.
export const serverResetDefaultsFixture: ReportWidgetPreferences = {
  ...REPORT_WIDGET_DEFAULT_LAYOUT,
  customCharts: [],
  hasCompletedWidgetSetup: false,
};
