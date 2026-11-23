import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useDashboardWidgets } from "../useDashboardWidgets";
import { useDisplaySettings, useUpdateDisplaySettings } from "../use-settings";

const mocks = vi.hoisted(() => ({ api: vi.fn(), fetch: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiCall: mocks.api, securityApi: {} }));
vi.mock("@/lib/protected-fetch", () => ({ protectedFetch: mocks.fetch }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

function Harness() {
  const layout = useDashboardWidgets();
  return <>
    {layout.loadError && <p role="alert">{layout.loadError}</p>}
    <p data-testid="state">{layout.isLoading ? "loading" : layout.saveStatus}</p>
    <button onClick={() => layout.toggleWidget("accounts")}>Toggle account</button>
    <button onClick={layout.retryLoad}>Retry loading</button>
    <button onClick={layout.retrySave}>Retry saving</button>
  </>;
}
const settings = { userId: "user-a", dashboardWidgets: null, theme: null, currency: null, locale: null, timezone: null, numberFormat: null, dateFormat: null, currencyPosition: null, firstDayOfWeek: null, viewMode: null, createdAt: null, updatedAt: null };
function renderLayout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
  return client;
}

it("rejects a malformed successful PUT before cache or success toast, then retries the retained layout", async () => {
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { settings } })));
  mocks.api.mockResolvedValueOnce({ success: true, data: { settings: undefined } }).mockImplementationOnce(async (_url, options) => ({ success: true, data: { settings: { ...settings, ...JSON.parse(options.body) } } }));
  const client = renderLayout();
  await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("idle"));
  vi.useFakeTimers();
  fireEvent.click(screen.getByText("Toggle account"));
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByTestId("state")).toHaveTextContent("error");
  expect(mocks.success).not.toHaveBeenCalled();
  expect(client.getQueryData(["displaySettings"])).toEqual(settings);
  await act(async () => { fireEvent.click(screen.getByText("Retry saving")); await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByTestId("state")).toHaveTextContent("saved");
  expect(mocks.api).toHaveBeenCalledTimes(2);
  expect(mocks.success).toHaveBeenCalledTimes(1);
  client.clear();
});

it("retries an initial GET failure without persisting the visible default layout", async () => {
  mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Layout unavailable" } }), { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { settings } })));
  const client = renderLayout();
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Layout unavailable"));
  expect(screen.getByTestId("state")).toHaveTextContent("idle");
  vi.useFakeTimers();
  fireEvent.click(screen.getByText("Toggle account"));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(mocks.api).not.toHaveBeenCalled();
  vi.useRealTimers();
  fireEvent.click(screen.getByText("Retry loading"));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(mocks.api).not.toHaveBeenCalled();
  expect(screen.getByTestId("state")).toHaveTextContent("idle");
  client.clear();
});

function hookWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
const recapOnlySettings = { ...settings, dashboardWidgets: { weeklyRecap: { enabled: true, deliveryDay: "Monday" } } };

it("loads a recap-only dashboard document through useDisplaySettings without dropping its sibling namespace", async () => {
  mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { settings: recapOnlySettings } })));
  const { client, wrapper } = hookWrapper();
  const { result } = renderHook(useDisplaySettings, { wrapper });
  await waitFor(() => expect(result.current.isFetching).toBe(false));
  expect(result.current.isError).toBe(false);
  expect(result.current.data).toEqual(recapOnlySettings);
  expect(mocks.api).not.toHaveBeenCalled();
  client.clear();
});

it("accepts a general display update acknowledgement containing only the recap namespace", async () => {
  const updated = { ...recapOnlySettings, theme: "dark" };
  mocks.api.mockResolvedValueOnce({ success: true, data: { settings: updated } });
  const { client, wrapper } = hookWrapper();
  const { result } = renderHook(useUpdateDisplaySettings, { wrapper });
  let returned: unknown;
  await act(async () => { returned = await result.current.mutateAsync({ theme: "dark" }); });
  expect(returned).toEqual(updated);
  expect(client.getQueryData(["displaySettings"])).toEqual(updated);
  expect(mocks.api).toHaveBeenCalledWith("/settings/display", { method: "PUT", body: JSON.stringify({ theme: "dark" }) });
  expect(mocks.success).toHaveBeenCalledTimes(1);
  client.clear();
});

it.each([{ widgets: [] }, { version: 1 }, { widgets: "bad", version: 1 }, { widgets: [], version: "bad" }])("rejects a partial or malformed layout document: %j", async dashboardWidgets => {
  mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { settings: { ...settings, dashboardWidgets } } })));
  const { client, wrapper } = hookWrapper();
  const { result } = renderHook(useDisplaySettings, { wrapper });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.error?.message).toMatch(/invalid display settings/i);
  expect(mocks.api).not.toHaveBeenCalled();
  client.clear();
});
