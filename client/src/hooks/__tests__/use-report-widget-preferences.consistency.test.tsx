import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";
import type { ReportWidgetPreferences } from "@shared/reports";
import { useReportWidgetPreferences, useResetReportWidgetPreferences, useUpdateReportWidgetPreferences } from "../use-report-widget-preferences";
import { serverResetDefaultsFixture } from "./report-widget-defaults.fixture";

const mocks = vi.hoisted(() => ({ api: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiCall: mocks.api }));
vi.mock("@/lib/protected-fetch", () => ({ protectedFetch: mocks.fetch }));

const key = ["settings", "report-widgets"];
const cachedChart = { id: "cached", name: "Cached chart", chartType: "bar", primaryMetric: "income", order: 0 };
const peerChart = { id: "peer", name: "Peer chart", chartType: "line", primaryMetric: "expenses", order: 0 };
const baseline: ReportWidgetPreferences = {
  ...serverResetDefaultsFixture,
  optionalWidgets: {
    ...serverResetDefaultsFixture.optionalWidgets,
    monthlyTrends: { ...serverResetDefaultsFixture.optionalWidgets.monthlyTrends, enabled: false },
  },
  customCharts: [cachedChart], hasCompletedWidgetSetup: true,
};
const resetAccepted: ReportWidgetPreferences = {
  ...serverResetDefaultsFixture, customCharts: [cachedChart], hasCompletedWidgetSetup: true,
};
const patchAccepted: ReportWidgetPreferences = {
  ...baseline,
  coreWidgets: {
    ...baseline.coreWidgets,
    summaryCards: { ...baseline.coreWidgets.summaryCards, enabled: false },
  },
};
const envelope = (preferences: ReportWidgetPreferences) => ({ success: true, data: { preferences } });
const response = (preferences: ReportWidgetPreferences) => new Response(JSON.stringify(envelope(preferences)), {
  status: 200, headers: { "Content-Type": "application/json" },
});

function setup() {
  const client = new QueryClient({ defaultOptions: {
    queries: { staleTime: Infinity, retry: false }, mutations: { retry: false },
  } });
  client.setQueryData(key, baseline);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

beforeEach(() => { mocks.api.mockReset(); mocks.fetch.mockReset(); });
afterEach(() => { cleanup(); retireOperationLifetime(); });

for (const action of ["PATCH", "reset"] as const) {
  it(`${action} keeps its acknowledged cache value when an older GET finishes afterward`, async () => {
    let releaseOldGet!: (value: Response) => void;
    mocks.fetch.mockReturnValueOnce(new Promise<Response>(resolve => { releaseOldGet = resolve; }));
    const accepted = action === "PATCH" ? patchAccepted : resetAccepted;
    mocks.api.mockResolvedValueOnce(envelope(accepted));
    const { client, wrapper } = setup();
    const read = renderHook(useReportWidgetPreferences, { wrapper });
    let oldRead!: Promise<unknown>;
    act(() => { oldRead = read.result.current.refetch(); });
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));

    const patch = renderHook(useUpdateReportWidgetPreferences, { wrapper });
    const reset = renderHook(useResetReportWidgetPreferences, { wrapper });
    await act(async () => {
      if (action === "PATCH") {
        await expect(patch.result.current.mutateAsync({ coreWidgets: { summaryCards: { enabled: false } } })).resolves.toEqual(accepted);
      } else {
        await expect(reset.result.current.mutateAsync()).resolves.toEqual(accepted);
      }
    });
    expect(client.getQueryData(key)).toEqual(accepted);
    await act(async () => { releaseOldGet(response(baseline)); await oldRead; });
    expect(client.getQueryData(key)).toEqual(accepted);
    expect(mocks.api).toHaveBeenCalledWith(
      action === "PATCH" ? "/settings/report-widgets" : "/settings/report-widgets/reset",
      expect.objectContaining({ method: action === "PATCH" ? "PATCH" : "POST" }),
    );
    client.clear();
  });

  it(`${action} does not publish an unknown outcome and an ordinary later read can reconcile`, async () => {
    mocks.api.mockRejectedValueOnce(new Error("Synthetic unknown outcome"));
    mocks.fetch.mockResolvedValueOnce(response(action === "PATCH" ? patchAccepted : resetAccepted));
    const { client, wrapper } = setup();
    const patch = renderHook(useUpdateReportWidgetPreferences, { wrapper });
    const reset = renderHook(useResetReportWidgetPreferences, { wrapper });
    await act(async () => {
      const pending = action === "PATCH"
        ? patch.result.current.mutateAsync({ coreWidgets: { summaryCards: { enabled: false } } })
        : reset.result.current.mutateAsync();
      await expect(pending).rejects.toThrow("Synthetic unknown outcome");
    });
    expect(client.getQueryData(key)).toEqual(baseline);
    expect(mocks.fetch).not.toHaveBeenCalled();
    const read = renderHook(useReportWidgetPreferences, { wrapper });
    await act(async () => { await read.result.current.refetch(); });
    expect(client.getQueryData(key)).toEqual(action === "PATCH" ? patchAccepted : resetAccepted);
    client.clear();
  });

  it(`${action} fences a late acknowledgement from a retired identity`, async () => {
    const identity = createOperationLifetime(); activateOperationLifetime(identity);
    let releaseWrite!: (value: unknown) => void;
    mocks.api.mockReturnValueOnce(new Promise(resolve => { releaseWrite = resolve; }));
    const { client, wrapper } = setup();
    const patch = renderHook(useUpdateReportWidgetPreferences, { wrapper });
    const reset = renderHook(useResetReportWidgetPreferences, { wrapper });
    let pending!: Promise<ReportWidgetPreferences>;
    act(() => { pending = action === "PATCH"
      ? patch.result.current.mutateAsync({ coreWidgets: { summaryCards: { enabled: false } } })
      : reset.result.current.mutateAsync(); });
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    retireOperationLifetime(identity); activateOperationLifetime(createOperationLifetime());
    await act(async () => {
      releaseWrite(envelope(action === "PATCH" ? patchAccepted : resetAccepted));
      await expect(pending).rejects.toThrow(/session changed/i);
    });
    expect(client.getQueryData(key)).toEqual(baseline);
    client.clear();
  });
}

for (const [name, contradicting] of [
  ["unchanged custom layout", baseline],
  ["empty layout maps", { ...resetAccepted, coreWidgets: {}, optionalWidgets: {} }],
] as const) {
  it(`reset rejects a shape-valid ${name} response, keeps cache, and accepts retry`, async () => {
    mocks.api.mockResolvedValueOnce(envelope(contradicting)).mockResolvedValueOnce(envelope(resetAccepted));
    const { client, wrapper } = setup();
    const { result } = renderHook(useResetReportWidgetPreferences, { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toThrow(/reset|default|acknowledge/i);
    });
    expect(client.getQueryData(key)).toEqual(baseline);
    await act(async () => { await expect(result.current.mutateAsync()).resolves.toEqual(resetAccepted); });
    expect(client.getQueryData(key)).toEqual(resetAccepted);
    client.clear();
  });
}

it("reset accepts default layout maps despite unrelated peer chart and setup changes", async () => {
  const accepted = { ...resetAccepted, customCharts: [peerChart], hasCompletedWidgetSetup: false };
  mocks.api.mockResolvedValueOnce(envelope(accepted));
  const { client, wrapper } = setup();
  const { result } = renderHook(useResetReportWidgetPreferences, { wrapper });
  await act(async () => { await expect(result.current.mutateAsync()).resolves.toEqual(accepted); });
  expect(client.getQueryData(key)).toEqual(accepted);
  client.clear();
});
