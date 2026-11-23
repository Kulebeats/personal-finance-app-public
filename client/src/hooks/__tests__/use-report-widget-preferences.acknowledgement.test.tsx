import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReportWidgetPreferences, ReportWidgetPreferencesPatch } from "@shared/reports";
import { useCustomCharts, useUpdateReportWidgetPreferences } from "../use-report-widget-preferences";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiCall: mocks.api }));

const chart = { id: "chart-1", name: "Income", chartType: "bar", primaryMetric: "income", order: 0 };
const saved: ReportWidgetPreferences = {
  coreWidgets: { summaryCards: { enabled: true, order: 0, chartType: "cards", expanded: false } },
  optionalWidgets: { monthlyTrends: { enabled: true, order: 1, chartType: "line" } },
  customCharts: [chart],
  hasCompletedWidgetSetup: true,
};
const acknowledge = (preferences: ReportWidgetPreferences) => ({ success: true, data: { preferences } });

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it.each([
  {
    name: "a changed core widget field",
    patch: { coreWidgets: { summaryCards: { enabled: false } } },
    accepted: { ...saved, coreWidgets: { summaryCards: { ...saved.coreWidgets.summaryCards, enabled: false } } },
  },
  {
    name: "a changed optional widget field",
    patch: { optionalWidgets: { monthlyTrends: { order: 8, chartType: "bar" } } },
    accepted: { ...saved, optionalWidgets: { monthlyTrends: { ...saved.optionalWidgets.monthlyTrends, order: 8, chartType: "bar" } } },
  },
  {
    name: "setup completion false",
    patch: { hasCompletedWidgetSetup: false },
    accepted: { ...saved, hasCompletedWidgetSetup: false },
  },
  {
    name: "setup completion true",
    patch: { hasCompletedWidgetSetup: true },
    rejected: { ...saved, hasCompletedWidgetSetup: false },
    accepted: saved,
  },
  {
    name: "an empty replacement chart array",
    patch: { customCharts: [] },
    accepted: { ...saved, customCharts: [] },
  },
  {
    name: "a whole replacement chart array",
    patch: { customCharts: [{ ...chart, id: "chart-2", name: "Expenses", primaryMetric: "expenses", order: 0 }] },
    accepted: { ...saved, customCharts: [{ ...chart, id: "chart-2", name: "Expenses", primaryMetric: "expenses", order: 0 }] },
  },
])("rejects shape-valid PATCH response contradicting $name, keeps cache, and accepts retry", async ({ patch, accepted, rejected }) => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } } });
  client.setQueryData(["settings", "report-widgets"], saved);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  mocks.api.mockResolvedValueOnce(acknowledge(rejected ?? saved)).mockResolvedValueOnce(acknowledge(accepted));
  const { result } = renderHook(useUpdateReportWidgetPreferences, { wrapper });

  await act(async () => {
    await expect(result.current.mutateAsync(patch as ReportWidgetPreferencesPatch)).rejects.toThrow(/acknowledge/i);
  });
  expect(client.getQueryData(["settings", "report-widgets"])).toEqual(saved);
  await act(async () => {
    await expect(result.current.mutateAsync(patch as ReportWidgetPreferencesPatch)).resolves.toEqual(accepted);
  });
  expect(client.getQueryData(["settings", "report-widgets"])).toEqual(accepted);
  expect(mocks.api.mock.calls.map((call: unknown[]) => JSON.parse((call[1] as { body: string }).body))).toEqual([patch, patch]);
  client.clear();
});

it("compares the serialized PATCH snapshot and ignores omitted undefined fields and unrelated response metadata", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } } });
  client.setQueryData(["settings", "report-widgets"], saved);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const patch: ReportWidgetPreferencesPatch = {
    hasCompletedWidgetSetup: undefined,
    coreWidgets: { summaryCards: { enabled: false, expanded: undefined } },
  };
  let resolve!: (response: unknown) => void;
  mocks.api.mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  const { result } = renderHook(useUpdateReportWidgetPreferences, { wrapper });
  let pending!: Promise<ReportWidgetPreferences>;
  act(() => { pending = result.current.mutateAsync(patch); });
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
  expect(JSON.parse(mocks.api.mock.calls[0][1].body)).toEqual({ coreWidgets: { summaryCards: { enabled: false } } });
  patch.coreWidgets!.summaryCards.enabled = true;
  const returned = {
    ...saved,
    hasCompletedWidgetSetup: false,
    futurePreferences: { retained: true },
    coreWidgets: {
      ...saved.coreWidgets,
      summaryCards: { ...saved.coreWidgets.summaryCards, enabled: false, futureWidget: "retained" },
      legacyWidget: { enabled: true, order: 9, futureWidget: true },
    },
  };
  await act(async () => { resolve(acknowledge(returned)); await expect(pending).resolves.toEqual(returned); });
  expect(client.getQueryData(["settings", "report-widgets"])).toEqual(returned);
  client.clear();
});

it.each([
  { submittedFields: {}, staleFields: { showAverage: true } },
  { submittedFields: { period: "quarterly" as const }, staleFields: { period: undefined } },
])("rejects a whole-chart replacement when an option differs from the submitted value", async ({ submittedFields, staleFields }) => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } } });
  client.setQueryData(["settings", "report-widgets"], saved);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const submitted = { ...chart, name: "Renamed", ...submittedFields };
  const stale = { ...saved, customCharts: [{ ...submitted, ...staleFields }] };
  const accepted = { ...saved, customCharts: [submitted] };
  mocks.api.mockResolvedValueOnce(acknowledge(stale)).mockResolvedValueOnce(acknowledge(accepted));
  const { result } = renderHook(useUpdateReportWidgetPreferences, { wrapper });

  await act(async () => {
    await expect(result.current.mutateAsync({ customCharts: [submitted] })).rejects.toThrow(/acknowledge/i);
  });
  expect(client.getQueryData(["settings", "report-widgets"])).toEqual(saved);
  await act(async () => {
    await expect(result.current.mutateAsync({ customCharts: [submitted] })).resolves.toEqual(accepted);
  });
  expect(client.getQueryData(["settings", "report-widgets"])).toEqual(accepted);
  client.clear();
});

it("accepts a custom-chart caller's acknowledged edit when the server strips unknown cached chart metadata", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } } });
  const cached = { ...saved, customCharts: [{ ...chart, futureChart: { retained: true } }] };
  client.setQueryData(["settings", "report-widgets"], cached);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const returned = { ...saved, customCharts: [{ ...chart, name: "Renamed" }] };
  mocks.api.mockResolvedValue(acknowledge(returned));
  const { result } = renderHook(useCustomCharts, { wrapper });

  await act(async () => {
    await expect(result.current.updateCustomChart(chart.id, { name: "Renamed" })).resolves.toEqual(returned);
  });
  expect(JSON.parse(mocks.api.mock.calls[0][1].body)).toEqual({
    customCharts: [{ ...chart, name: "Renamed", futureChart: { retained: true } }],
  });
  expect(client.getQueryData(["settings", "report-widgets"])).toEqual(returned);
  client.clear();
});
