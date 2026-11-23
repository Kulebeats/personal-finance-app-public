import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWidgetToggle, useWidgetChartType } from "../use-report-widget-preferences";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";
import type { ReportWidgetPreferences } from "@shared/reports";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiCall: mocks.call }));
const preferences: ReportWidgetPreferences = {
  coreWidgets: { summaryCards: { id: "summaryCards", enabled: true, order: 3, chartType: "bar", expanded: true } },
  optionalWidgets: { monthlyTrends: { id: "monthlyTrends", enabled: true, order: 2, chartType: "line" } },
  customCharts: [], hasCompletedWidgetSetup: true,
};
beforeEach(() => { mocks.call.mockReset(); mocks.call.mockResolvedValue({ success: true, data: { preferences } }); });
afterEach(() => { cleanup(); retireOperationLifetime(); vi.useRealTimers(); });

it("sends only the edited widget field even when cached sibling values are stale", async () => {
  mocks.call
    .mockResolvedValueOnce({ success: true, data: { preferences: { ...preferences, coreWidgets: { summaryCards: { ...preferences.coreWidgets.summaryCards, enabled: false } } } } })
    .mockResolvedValueOnce({ success: true, data: { preferences: { ...preferences, optionalWidgets: { monthlyTrends: { ...preferences.optionalWidgets.monthlyTrends, order: 8 } } } } })
    .mockResolvedValueOnce({ success: true, data: { preferences: { ...preferences, optionalWidgets: { monthlyTrends: { ...preferences.optionalWidgets.monthlyTrends, chartType: "bar" } } } } });
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } } });
  client.setQueryData(["settings", "report-widgets"], preferences);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(useWidgetToggle, { wrapper });
  await act(async () => { await result.current.toggleWidget("coreWidgets", "summaryCards", false); });
  await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(1));
  expect(JSON.parse(mocks.call.mock.calls[0][1].body)).toEqual({ coreWidgets: { summaryCards: { enabled: false } } });
  await act(async () => { await result.current.reorderWidget("optionalWidgets", "monthlyTrends", 8); });
  await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2));
  expect(JSON.parse(mocks.call.mock.calls[1][1].body)).toEqual({ optionalWidgets: { monthlyTrends: { order: 8 } } });
  await act(async () => { await result.current.setChartType("optionalWidgets", "monthlyTrends", "bar"); });
  await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(3));
  expect(JSON.parse(mocks.call.mock.calls[2][1].body)).toEqual({ optionalWidgets: { monthlyTrends: { chartType: "bar" } } });
  client.clear();
});

it("discards a debounced chart selection when the initiating identity retires before unmount", async () => {
  vi.useFakeTimers();
  const operation = createOperationLifetime(); activateOperationLifetime(operation);
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } } });
  client.setQueryData(["settings", "report-widgets"], preferences);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useWidgetChartType("optionalWidgets", "monthlyTrends"), { wrapper });
  act(() => result.current.setChartType("bar"));
  retireOperationLifetime(operation); activateOperationLifetime(createOperationLifetime());
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(mocks.call).not.toHaveBeenCalled();
  client.clear();
});

it("serializes disjoint writes across hook instances so a late older response cannot clobber the cache", async () => {
  let acknowledgeFirst!: (value: unknown) => void;
  let acknowledgeSecond!: (value: unknown) => void;
  const first = new Promise(resolve => { acknowledgeFirst = resolve; });
  const second = new Promise(resolve => { acknowledgeSecond = resolve; });
  mocks.call.mockReturnValueOnce(first).mockReturnValueOnce(second);
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } } });
  client.setQueryData(["settings", "report-widgets"], preferences);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const one = renderHook(useWidgetToggle, { wrapper });
  const two = renderHook(useWidgetToggle, { wrapper });
  act(() => { void one.result.current.toggleWidget("optionalWidgets", "monthlyTrends", false); });
  await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(1));
  await act(async () => { two.result.current.setChartType("optionalWidgets", "monthlyTrends", "bar"); });
  expect(mocks.call).toHaveBeenCalledTimes(1);
  const combined = { ...preferences, optionalWidgets: { monthlyTrends: { ...preferences.optionalWidgets.monthlyTrends, enabled: false, chartType: "bar" } } };
  // The later response is already available, but it cannot be applied before the first acknowledgement.
  await act(async () => { acknowledgeSecond({ success: true, data: { preferences: combined } }); });
  expect(client.getQueryData(["settings", "report-widgets"])).toEqual(preferences);
  await act(async () => { acknowledgeFirst({ success: true, data: { preferences: { ...preferences, optionalWidgets: { monthlyTrends: { ...preferences.optionalWidgets.monthlyTrends, enabled: false } } } } }); });
  await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(client.getQueryData(["settings", "report-widgets"])).toEqual(combined));
  expect(JSON.parse(mocks.call.mock.calls[0][1].body)).toEqual({ optionalWidgets: { monthlyTrends: { enabled: false } } });
  expect(JSON.parse(mocks.call.mock.calls[1][1].body)).toEqual({ optionalWidgets: { monthlyTrends: { chartType: "bar" } } });
  client.clear();
});
