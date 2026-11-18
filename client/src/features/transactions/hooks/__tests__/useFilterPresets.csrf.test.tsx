/**
 * Filter-preset mutations must carry x-csrf-token.
 *
 * These hooks go through apiRequest (lib/queryClient.ts), not apiCall, and the
 * server enforces double-submit CSRF on all mutating routes — without the
 * header preset save/update/delete is rejected 403.
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import {
  useCreateFilterPreset,
  useDeleteFilterPreset,
} from "../useFilterPresets";

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

const headerOf = (init: RequestInit | undefined, name: string) =>
  (init?.headers as Record<string, string> | undefined)?.[name];

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("filter-preset mutations send x-csrf-token", () => {
  const calls: RecordedCall[] = [];

  beforeEach(() => {
    calls.length = 0;
    clearCsrfToken();
    // Serve the CSRF token fetch transparently (PR #54 pattern); record every
    // other call.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/api/csrf-token")) {
          return jsonResponse({ csrfToken: "test-csrf" });
        }
        calls.push({ url, init });
        return jsonResponse({
          success: true,
          data: {
            id: "preset-1",
            context: "transactions",
            isDefault: false,
          },
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("useCreateFilterPreset POSTs /api/filter-presets with x-csrf-token", async () => {
    const { result } = renderHook(() => useCreateFilterPreset(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      name: "My preset",
      context: "transactions",
      filters: {},
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/filter-presets");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.credentials).toBe("include");
    expect(headerOf(calls[0].init, "x-csrf-token")).toBe("test-csrf");
  });

  it("useDeleteFilterPreset DELETEs /api/filter-presets/:id with x-csrf-token", async () => {
    const { result } = renderHook(() => useDeleteFilterPreset(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: "preset-1", context: "transactions" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/filter-presets/preset-1");
    expect(calls[0].init?.method).toBe("DELETE");
    expect(headerOf(calls[0].init, "x-csrf-token")).toBe("test-csrf");
  });
});
