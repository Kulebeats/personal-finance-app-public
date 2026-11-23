import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useReportWidgetPreferences, useUpdateReportWidgetPreferences } from "../use-report-widget-preferences";

const mocks = vi.hoisted(() => ({ api: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiCall: mocks.api }));
vi.mock("@/lib/protected-fetch", () => ({ protectedFetch: mocks.fetch }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

it("rejects malformed GET preference maps instead of treating them as a loaded dashboard", async () => {
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { preferences: { coreWidgets: [], optionalWidgets: {}, customCharts: [] } } })));
  const { client, wrapper } = setup();
  const { result } = renderHook(useReportWidgetPreferences, { wrapper });
  await waitFor(() => expect(result.current.isFetching).toBe(false));
  expect(result.current.isError).toBe(true);
  expect(result.current.error?.message).toMatch(/invalid widget preferences/i);
  client.clear();
});

it("rejects an empty successful PATCH payload before updating the preference cache", async () => {
  mocks.api.mockResolvedValue({ success: true, data: {} });
  const { client, wrapper } = setup();
  const saved = { coreWidgets: {}, optionalWidgets: {}, customCharts: [] };
  client.setQueryData(["settings", "report-widgets"], saved);
  const { result } = renderHook(useUpdateReportWidgetPreferences, { wrapper });
  await act(async () => { await expect(result.current.mutateAsync({ hasCompletedWidgetSetup: true })).rejects.toThrow(/invalid widget preferences/i); });
  expect(client.getQueryData(["settings", "report-widgets"])).toEqual(saved);
  client.clear();
});

it("accepts legacy server widgets without ids and custom charts without createdAt without dropping fields", async () => {
  const preferences = { coreWidgets: { summaryCards: { enabled: true, order: 0, chartType: "cards" } }, optionalWidgets: {}, customCharts: [{ id: "old", name: "Legacy chart", chartType: "bar", primaryMetric: "income", order: 0, showAverage: true }], hasCompletedWidgetSetup: false };
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { preferences } })));
  mocks.api.mockResolvedValue({ success: true, data: { preferences } });
  const { client, wrapper } = setup();
  const read = renderHook(useReportWidgetPreferences, { wrapper });
  await waitFor(() => expect(read.result.current.isSuccess).toBe(true));
  expect(read.result.current.data).toEqual(preferences);
  const write = renderHook(useUpdateReportWidgetPreferences, { wrapper });
  await act(async () => { expect(await write.result.current.mutateAsync({ hasCompletedWidgetSetup: false })).toEqual(preferences); });
  client.clear();
});
