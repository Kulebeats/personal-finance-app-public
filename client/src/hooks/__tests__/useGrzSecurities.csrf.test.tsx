/**
 * GRZ securities mutations must carry x-csrf-token.
 *
 * These hooks go through apiRequest (lib/queryClient.ts), not apiCall, and the
 * server enforces double-submit CSRF on all mutating routes — without the
 * header every bond/T-bill/coupon recording is rejected 403. GRZ is the
 * highest-risk money path (CLAUDE.md Rule 1), so each mutation hook gets an
 * explicit header assertion.
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import {
  useCreateGrzBond,
  useCreateGrzTBill,
  useMarkGrzPaymentPaid,
} from "../useGrzSecurities";

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

describe("GRZ securities mutations send x-csrf-token", () => {
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
        return jsonResponse({ success: true, data: {} });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("useCreateGrzBond POSTs /api/grz/bonds with x-csrf-token", async () => {
    const { result } = renderHook(() => useCreateGrzBond(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ bondName: "GRZ 5Y 2031" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/grz/bonds");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.credentials).toBe("include");
    expect(headerOf(calls[0].init, "x-csrf-token")).toBe("test-csrf");
  });

  it("useCreateGrzTBill POSTs /api/grz/tbills with x-csrf-token", async () => {
    const { result } = renderHook(() => useCreateGrzTBill(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ tbillName: "GRZ 364d" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/grz/tbills");
    expect(calls[0].init?.method).toBe("POST");
    expect(headerOf(calls[0].init, "x-csrf-token")).toBe("test-csrf");
  });

  it("useMarkGrzPaymentPaid POSTs /api/grz/payments/:id/pay with x-csrf-token", async () => {
    const { result } = renderHook(() => useMarkGrzPaymentPaid(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: "pay-1", accountId: "acc-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/grz/payments/pay-1/pay");
    expect(calls[0].init?.method).toBe("POST");
    expect(headerOf(calls[0].init, "x-csrf-token")).toBe("test-csrf");
  });
});
