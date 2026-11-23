/**
 * @vitest-environment jsdom
 *
 * CSRF long-tail (§4b): the report-widget preferences PATCH must carry
 * x-csrf-token or it 403s in any real browser session.
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import { useUpdateReportWidgetPreferences } from "../use-report-widget-preferences";

const mockFetch = vi.fn();

const mockFetchResponse = (data: unknown, ok = true): Response =>
  ({
    ok,
    headers: { get: () => "application/json" },
    json: vi.fn().mockResolvedValue(data),
  }) as unknown as Response;

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper };
};

describe("useUpdateReportWidgetPreferences", () => {
  beforeEach(() => {
    clearCsrfToken();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/csrf-token")) {
          return Promise.resolve(mockFetchResponse({ csrfToken: "test-csrf" }));
        }
        return mockFetch(input, init);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("PATCHes with x-csrf-token and returns the updated preferences", async () => {
    const preferences = { coreWidgets: {}, optionalWidgets: {}, customCharts: [], hasCompletedWidgetSetup: true };
    mockFetch.mockResolvedValue(
      mockFetchResponse({ success: true, data: { preferences } }),
    );

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateReportWidgetPreferences(), {
      wrapper,
    });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.mutateAsync({
        hasCompletedWidgetSetup: true,
      });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/settings/report-widgets",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        headers: expect.objectContaining({
          "x-csrf-token": "test-csrf",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ hasCompletedWidgetSetup: true }),
      }),
    );
    expect(returned).toEqual(preferences);
  });
});
