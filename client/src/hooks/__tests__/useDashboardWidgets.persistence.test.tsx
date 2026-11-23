import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDashboardWidgets } from "../useDashboardWidgets";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";

const mocks = vi.hoisted(() => ({
  settings: { dashboardWidgets: null } as { dashboardWidgets: null | { widgets: { id: string; label: string; enabled: boolean }[]; version: 1 } } | undefined,
  loadError: null as Error | null,
  refetch: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/hooks/use-settings", () => ({
  useDisplaySettings: () => ({ data: mocks.settings, isLoading: false, isFetching: false, error: mocks.loadError, refetch: mocks.refetch }),
  useUpdateDisplaySettings: () => ({ mutate: mocks.save, mutateAsync: mocks.save }),
}));

function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const advance = async (ms = 1000) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const acknowledgement = (call = 0) => mocks.save.mock.calls[call][0];
beforeEach(() => { vi.useFakeTimers(); mocks.save.mockReset(); mocks.settings = { dashboardWidgets: null }; mocks.loadError = null; mocks.refetch.mockReset(); });
afterEach(() => { cleanup(); retireOperationLifetime(); vi.useRealTimers(); });

describe("dashboard durable layout", () => {
  it("surfaces an initial layout load failure and retries without allowing default writes", async () => {
    mocks.settings = undefined;
    mocks.loadError = new Error("Layout loading unavailable");
    const { result, rerender } = renderHook(useDashboardWidgets);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.loadError).toBe("Layout loading unavailable");
    act(() => result.current.toggleWidget("accounts")); await advance(2000);
    expect(mocks.save).not.toHaveBeenCalled();
    act(() => result.current.retryLoad());
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    mocks.loadError = null;
    mocks.settings = { dashboardWidgets: { version: 1, widgets: [{ id: "accounts", label: "Accounts", enabled: false }] } };
    rerender(); await advance(2000);
    expect(result.current.loadError).toBeNull();
    expect(result.current.widgets[0].enabled).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([undefined, {}, { dashboardWidgets: null }, { dashboardWidgets: { version: 1, widgets: [] } }])("keeps a malformed acknowledgement dirty and offers manual retry: %j", async malformed => {
    mocks.save.mockResolvedValueOnce(malformed).mockImplementationOnce(async data => data);
    const { result } = renderHook(useDashboardWidgets);
    act(() => result.current.toggleWidget("accounts")); await advance();
    expect(result.current.saveStatus).toBe("error");
    expect(result.current.saveError).toMatch(/acknowledg/i);
    expect(result.current.isDirty).toBe(true);
    await act(async () => { result.current.retrySave(); });
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(result.current.saveStatus).toBe("saved");
  });

  it("does not write defaults and coalesces rapid edits until the debounce expires", async () => {
    const pending = deferred(); mocks.save.mockReturnValue(pending.promise);
    const { result } = renderHook(useDashboardWidgets);
    await advance(2000);
    expect(mocks.save).not.toHaveBeenCalled();
    act(() => result.current.toggleWidget("accounts"));
    await advance(500);
    act(() => result.current.toggleWidget("goals"));
    await advance(999);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(result.current.isDirty).toBe(true);
    await advance(1);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(result.current.saveStatus).toBe("saving");
    expect(result.current.isDirty).toBe(true);
    await act(async () => { pending.resolve(acknowledgement()); });
    expect(result.current.saveStatus).toBe("saved");
    expect(result.current.isDirty).toBe(false);
  });

  it("keeps the latest failed draft dirty and retries only on request", async () => {
    const first = deferred(); mocks.save.mockReturnValueOnce(first.promise).mockImplementationOnce(async data => data);
    const { result } = renderHook(useDashboardWidgets);
    act(() => result.current.toggleWidget("accounts")); await advance();
    act(() => result.current.toggleWidget("goals"));
    await act(async () => { first.reject(new Error("Layout unavailable")); });
    expect(result.current.saveStatus).toBe("error");
    expect(result.current.saveError).toBe("Layout unavailable");
    expect(result.current.isDirty).toBe(true);
    await advance(10000);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    await act(async () => { result.current.retrySave(); });
    expect(mocks.save).toHaveBeenCalledTimes(2);
    const widgets = mocks.save.mock.calls[1][0].dashboardWidgets.widgets;
    expect(widgets.find((widget: { id: string }) => widget.id === "goals").enabled).toBe(false);
    expect(result.current.saveStatus).toBe("saved");
  });

  it("serializes responses and saves a reset made while the prior layout is pending", async () => {
    const first = deferred(); const second = deferred();
    mocks.save.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(useDashboardWidgets);
    act(() => result.current.toggleWidget("accounts")); await advance();
    act(() => result.current.resetToDefault()); await advance();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(acknowledgement()); });
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(result.current.isDirty).toBe(true);
    expect(result.current.widgets.find(widget => widget.id === "accounts")?.enabled).toBe(true);
    await act(async () => { second.resolve(acknowledgement(1)); });
    expect(result.current.saveStatus).toBe("saved");
    expect(result.current.isDirty).toBe(false);
  });

  it("discards an old identity's timer and pending response on the keyed session remount", async () => {
    const old = createOperationLifetime(); activateOperationLifetime(old);
    const first = deferred(); mocks.save.mockReturnValueOnce(first.promise);
    const oldHook = renderHook(useDashboardWidgets);
    act(() => oldHook.result.current.toggleWidget("accounts")); await advance();
    act(() => oldHook.result.current.toggleWidget("goals"));
    oldHook.unmount(); retireOperationLifetime(old); activateOperationLifetime(createOperationLifetime());
    const next = renderHook(useDashboardWidgets);
    await act(async () => { first.resolve(acknowledgement()); }); await advance(2000);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(next.result.current.widgets.find(widget => widget.id === "accounts")?.enabled).toBe(true);
    expect(next.result.current.isDirty).toBe(false);
    expect(next.result.current.saveError).toBeNull();
  });

  it("fences a debounce before the old session has finished unmounting", async () => {
    const old = createOperationLifetime(); activateOperationLifetime(old);
    const { result } = renderHook(useDashboardWidgets);
    act(() => result.current.toggleWidget("accounts"));
    retireOperationLifetime(old); activateOperationLifetime(createOperationLifetime());
    await advance();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("retries a reverted draft after an ambiguous failure even when it matches the original layout", async () => {
    const first = deferred(); mocks.save.mockReturnValueOnce(first.promise).mockImplementationOnce(async data => data);
    const { result } = renderHook(useDashboardWidgets);
    act(() => result.current.toggleWidget("accounts")); await advance();
    act(() => result.current.resetToDefault());
    await act(async () => { first.reject(new Error("Response lost")); });
    expect(result.current.isDirty).toBe(true);
    await act(async () => { result.current.retrySave(); });
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1][0].dashboardWidgets.widgets.find((widget: { id: string }) => widget.id === "accounts").enabled).toBe(true);
    expect(result.current.isDirty).toBe(false);
  });

  it("loads an existing saved layout without writing, and ignores an older acknowledgement's cache refresh", async () => {
    mocks.settings = { dashboardWidgets: { version: 1, widgets: [{ id: "accounts", label: "Accounts", enabled: false }] } };
    const first = deferred(); const second = deferred();
    mocks.save.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(useDashboardWidgets);
    await advance();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(result.current.widgets[0].id).toBe("accounts");
    act(() => result.current.toggleWidget("accounts")); await advance();
    act(() => result.current.reorderWidgets("accounts", "goals")); await advance();
    mocks.settings = { dashboardWidgets: mocks.save.mock.calls[0][0].dashboardWidgets };
    rerender();
    await act(async () => { first.resolve(acknowledgement()); });
    expect(result.current.widgets[0].id).not.toBe("accounts");
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1][0].dashboardWidgets.widgets).toEqual(result.current.widgets);
    await act(async () => { second.resolve(acknowledgement(1)); });
    expect(result.current.saveStatus).toBe("saved");
  });
});
