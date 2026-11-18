/**
 * @vitest-environment jsdom
 *
 * Receipt mutations must attach the x-csrf-token header — server/app.ts
 * enforces CSRF outside NODE_ENV=test, so a raw fetch without it 403s in any
 * real browser session. The upload path sends FormData and must NOT get a
 * JSON content-type (the browser sets multipart/form-data + boundary).
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import {
  useUploadReceipt,
  useStoreOcrResults,
  useMatchReceipt,
  useCreateTransactionFromReceipt,
  useRetryMatch,
  useDeleteReceipt,
} from "../useReceipts";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockFetch = vi.fn();

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
};

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });

const headerOf = (init: RequestInit | undefined, name: string) =>
  (init?.headers as Record<string, string> | undefined)?.[name];

describe("useReceipts mutations", () => {
  beforeEach(() => {
    clearCsrfToken();
    // apiCall fetches a CSRF token (GET /api/csrf-token) before each mutating
    // request; serve it transparently so it never consumes per-test mocks.
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/csrf-token")) {
          return Promise.resolve(jsonResponse({ csrfToken: "test-csrf" }));
        }
        return mockFetch(input, init);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe("useUploadReceipt", () => {
    it("uploads FormData with x-csrf-token and no JSON content-type", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { receiptId: "r-1", isDuplicate: false },
        }),
      );

      const { result } = renderHook(() => useUploadReceipt(), {
        wrapper: createWrapper(),
      });

      const file = new File(["img"], "receipt.jpg", { type: "image/jpeg" });
      await act(async () => {
        await result.current.mutateAsync({ file });
      });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/receipts/upload");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeInstanceOf(FormData);
      expect(headerOf(init, "x-csrf-token")).toBe("test-csrf");
      expect(headerOf(init, "Content-Type")).toBeUndefined();
      expect(init?.credentials).toBe("include");
    });

    it("preserves the x-idempotency-key header", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { receiptId: "r-1", isDuplicate: false },
        }),
      );

      const { result } = renderHook(() => useUploadReceipt(), {
        wrapper: createWrapper(),
      });

      const file = new File(["img"], "receipt.jpg", { type: "image/jpeg" });
      await act(async () => {
        await result.current.mutateAsync({ file, idempotencyKey: "idem-1" });
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(headerOf(init, "x-idempotency-key")).toBe("idem-1");
      expect(headerOf(init, "x-csrf-token")).toBe("test-csrf");
    });

    it("keeps the friendly sign-in message on 401", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
          401,
        ),
      );

      const { result } = renderHook(() => useUploadReceipt(), {
        wrapper: createWrapper(),
      });

      const file = new File(["img"], "receipt.jpg", { type: "image/jpeg" });
      await expect(result.current.mutateAsync({ file })).rejects.toThrow(
        "Please sign in to upload receipts.",
      );
    });
  });

  it("useStoreOcrResults POSTs JSON with x-csrf-token", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: {} }));

    const { result } = renderHook(() => useStoreOcrResults(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        receiptId: "r-1",
        ocrData: { merchantName: "Shoprite", amount: "150.00" },
        confidence: 0.92,
        rawText: "SHOPRITE 150.00",
      });
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/receipts/r-1/ocr-results");
    expect(init?.method).toBe("POST");
    expect(headerOf(init, "x-csrf-token")).toBe("test-csrf");
    expect(headerOf(init, "Content-Type")).toBe("application/json");
  });

  it("useMatchReceipt POSTs JSON with x-csrf-token", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: {} }));

    const { result } = renderHook(() => useMatchReceipt(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        receiptId: "r-1",
        transactionId: "tx-1",
      });
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/receipts/r-1/match");
    expect(init?.method).toBe("POST");
    expect(headerOf(init, "x-csrf-token")).toBe("test-csrf");
    expect(init?.body).toBe(JSON.stringify({ transactionId: "tx-1" }));
  });

  it("useCreateTransactionFromReceipt POSTs JSON with x-csrf-token", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: {} }));

    const { result } = renderHook(() => useCreateTransactionFromReceipt(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        receiptId: "r-1",
        data: {
          accountId: "acc-1",
          name: "Shoprite",
          amount: "150.00",
          date: "2026-07-01",
        },
      });
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/receipts/r-1/create-transaction");
    expect(init?.method).toBe("POST");
    expect(headerOf(init, "x-csrf-token")).toBe("test-csrf");
  });

  it("useRetryMatch POSTs with x-csrf-token", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: {} }));

    const { result } = renderHook(() => useRetryMatch(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync("r-1");
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/receipts/r-1/retry-match");
    expect(init?.method).toBe("POST");
    expect(headerOf(init, "x-csrf-token")).toBe("test-csrf");
  });

  it("useDeleteReceipt DELETEs with x-csrf-token", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: {} }));

    const { result } = renderHook(() => useDeleteReceipt(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync("r-1");
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/receipts/r-1");
    expect(init?.method).toBe("DELETE");
    expect(headerOf(init, "x-csrf-token")).toBe("test-csrf");
  });
});
