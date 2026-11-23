import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as hooks from "../use-report-widget-preferences";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";
import type { ReportWidgetPreferences } from "@shared/reports";
import { serverResetDefaultsFixture } from "./report-widget-defaults.fixture";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiCall: mocks.api }));
const preferences: ReportWidgetPreferences = { coreWidgets: {}, optionalWidgets: {}, customCharts: [], hasCompletedWidgetSetup: false };
const acknowledge = (prefs = preferences) => ({ success: true, data: { preferences: prefs } });
function setup(saved = preferences) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } } });
  client.setQueryData(["settings", "report-widgets"], saved);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
beforeEach(() => {
  mocks.api.mockReset();
  const stored = new Map<string, string>();
  vi.mocked(window.localStorage.getItem).mockImplementation(key => stored.get(key) ?? null);
  vi.mocked(window.localStorage.setItem).mockImplementation((key, value) => { stored.set(key, value); });
  vi.mocked(window.localStorage.removeItem).mockImplementation(key => { stored.delete(key); });
});
afterEach(() => { cleanup(); retireOperationLifetime(); });

it("ignores another user's old localStorage completion and shares acknowledged false state across hook instances", async () => {
  window.localStorage.setItem("reportsWidgetSetupComplete", "true");
  const { client, wrapper } = setup();
  const one = renderHook(hooks.useWidgetOnboarding, { wrapper });
  const two = renderHook(hooks.useWidgetOnboarding, { wrapper });
  expect(one.result.current.hasCompletedSetup).toBe(false);
  expect(two.result.current.hasCompletedSetup).toBe(false);
  mocks.api.mockResolvedValueOnce(acknowledge({ ...preferences, hasCompletedWidgetSetup: true })).mockResolvedValueOnce(acknowledge());
  await act(async () => { await one.result.current.completeOnboarding({}); });
  await waitFor(() => expect(two.result.current.hasCompletedSetup).toBe(true));
  await act(async () => { await one.result.current.resetOnboarding(); });
  await waitFor(() => expect(two.result.current.hasCompletedSetup).toBe(false));
  client.clear();
});

it("does not complete until a valid delayed acknowledgement and propagates malformed response for retry", async () => {
  let resolve!: (value: unknown) => void;
  mocks.api.mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  const { client, wrapper } = setup();
  const { result } = renderHook(hooks.useWidgetOnboarding, { wrapper });
  let saved!: Promise<unknown>;
  act(() => { saved = result.current.completeOnboarding({}); });
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
  expect(result.current.hasCompletedSetup).toBe(false);
  expect(window.localStorage.getItem("reportsWidgetSetupComplete")).toBeNull();
  await act(async () => { resolve({ success: true, data: {} }); await expect(saved).rejects.toThrow(/invalid widget preferences/i); });
  expect(result.current.hasCompletedSetup).toBe(false);
  mocks.api.mockResolvedValueOnce(acknowledge({ ...preferences, hasCompletedWidgetSetup: true }));
  await act(async () => { await result.current.completeOnboarding({}); });
  await waitFor(() => expect(result.current.hasCompletedSetup).toBe(true));
  client.clear();
});

it("does not publish a response from a retired identity into the current cache", async () => {
  const identity = createOperationLifetime(); activateOperationLifetime(identity);
  let resolve!: (value: unknown) => void;
  mocks.api.mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  const { client, wrapper } = setup();
  const { result } = renderHook(hooks.useWidgetOnboarding, { wrapper });
  let saved!: Promise<unknown>;
  act(() => { saved = result.current.completeOnboarding({}); });
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
  retireOperationLifetime(identity); activateOperationLifetime(createOperationLifetime());
  await act(async () => { resolve(acknowledge({ ...preferences, hasCompletedWidgetSetup: true })); await expect(saved).rejects.toThrow(/session changed/i); });
  expect(client.getQueryData(["settings", "report-widgets"])).toEqual(preferences);
  expect(window.localStorage.getItem("reportsWidgetSetupComplete")).toBeNull();
  client.clear();
});

it("resets through the dedicated POST and serializes it with an in-flight preference PATCH", async () => {
  expect(hooks).toHaveProperty("useResetReportWidgetPreferences");
  let resolve!: (value: unknown) => void;
  const resetAccepted = { ...serverResetDefaultsFixture, hasCompletedWidgetSetup: true };
  mocks.api.mockReturnValueOnce(new Promise(yes => { resolve = yes; })).mockResolvedValueOnce(acknowledge(resetAccepted));
  const { client, wrapper } = setup();
  const update = renderHook(hooks.useUpdateReportWidgetPreferences, { wrapper });
  const reset = renderHook(hooks.useResetReportWidgetPreferences, { wrapper });
  let patch!: Promise<unknown>; let restore!: Promise<unknown>;
  act(() => { patch = update.result.current.mutateAsync({ hasCompletedWidgetSetup: true }); });
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
  await act(async () => { restore = reset.result.current.mutateAsync(); });
  expect(mocks.api).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(acknowledge({ ...preferences, hasCompletedWidgetSetup: true })); await patch; await restore; });
  expect(mocks.api).toHaveBeenLastCalledWith("/settings/report-widgets/reset", expect.objectContaining({ method: "POST", body: "{}" }));
  expect(client.getQueryData(["settings", "report-widgets"])).toEqual(resetAccepted);
  client.clear();
});
