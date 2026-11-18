import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRefetchOnFocus } from "../useRefetchOnFocus";
import React from "react";

// Mock document.visibilityState
let mockVisibilityState: DocumentVisibilityState = "visible";
Object.defineProperty(document, "visibilityState", {
  configurable: true,
  get: () => mockVisibilityState,
});

describe("useRefetchOnFocus", () => {
  let queryClient: QueryClient;
  let invalidateQueriesSpy: ReturnType<typeof vi.spyOn>;

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
    mockVisibilityState = "visible";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not invalidate queries when disabled", () => {
    renderHook(() => useRefetchOnFocus({ enabled: false }), { wrapper });

    // Simulate tab becoming hidden then visible
    mockVisibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));

    vi.advanceTimersByTime(120000); // Advance past staleTime

    mockVisibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));

    expect(invalidateQueriesSpy).not.toHaveBeenCalled();
  });

  it("does not invalidate queries if tab was hidden for less than staleTime", () => {
    renderHook(
      () =>
        useRefetchOnFocus({
          queryKeys: [["reports"]],
          staleTime: 60000, // 1 minute
        }),
      { wrapper }
    );

    // Simulate tab becoming hidden
    mockVisibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));

    // Only 30 seconds pass (less than staleTime)
    vi.advanceTimersByTime(30000);

    // Tab becomes visible again
    mockVisibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));

    // Should NOT invalidate because not enough time passed
    expect(invalidateQueriesSpy).not.toHaveBeenCalled();
  });

  it("invalidates specified query keys when tab is hidden for longer than staleTime", () => {
    renderHook(
      () =>
        useRefetchOnFocus({
          queryKeys: [["reports"], ["transactions"]],
          staleTime: 60000, // 1 minute
        }),
      { wrapper }
    );

    // Simulate tab becoming hidden
    mockVisibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));

    // 2 minutes pass (longer than staleTime)
    vi.advanceTimersByTime(120000);

    // Tab becomes visible again
    mockVisibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));

    // Should invalidate both query keys
    expect(invalidateQueriesSpy).toHaveBeenCalledTimes(2);
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ["reports"] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ["transactions"] });
  });

  it("invalidates all queries when no specific keys provided", () => {
    renderHook(
      () =>
        useRefetchOnFocus({
          staleTime: 60000,
        }),
      { wrapper }
    );

    mockVisibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));

    vi.advanceTimersByTime(120000);

    mockVisibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));

    // Should invalidate all queries (called without queryKey filter)
    expect(invalidateQueriesSpy).toHaveBeenCalledTimes(1);
    expect(invalidateQueriesSpy).toHaveBeenCalledWith();
  });

  it("provides refetchNow function for manual refresh", () => {
    const { result } = renderHook(
      () =>
        useRefetchOnFocus({
          queryKeys: [["reports"]],
        }),
      { wrapper }
    );

    // Call refetchNow manually
    act(() => {
      result.current.refetchNow();
    });

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ["reports"] });
  });

  it("cleans up event listener on unmount", () => {
    const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");

    const { unmount } = renderHook(
      () => useRefetchOnFocus({ queryKeys: [["reports"]] }),
      { wrapper }
    );

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function)
    );
  });

  it("uses default staleTime of 60000ms when not specified", () => {
    renderHook(
      () =>
        useRefetchOnFocus({
          queryKeys: [["reports"]],
          // No staleTime specified, should default to 60000
        }),
      { wrapper }
    );

    mockVisibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));

    // 59 seconds - just under default staleTime
    vi.advanceTimersByTime(59000);

    mockVisibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));

    // Should NOT invalidate
    expect(invalidateQueriesSpy).not.toHaveBeenCalled();

    // Go hidden again
    mockVisibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));

    // 61 seconds - just over default staleTime
    vi.advanceTimersByTime(61000);

    mockVisibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));

    // Now it SHOULD invalidate
    expect(invalidateQueriesSpy).toHaveBeenCalled();
  });
});
