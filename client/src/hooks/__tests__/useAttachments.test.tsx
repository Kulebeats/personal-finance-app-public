/**
 * @vitest-environment jsdom
 *
 * Attachment mutations must attach the x-csrf-token header — server/app.ts
 * enforces CSRF outside NODE_ENV=test, so a raw fetch without it 403s in any
 * real browser session. The upload path sends FormData and must NOT get a
 * JSON content-type (the browser sets multipart/form-data + boundary).
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import { useUploadAttachment, useDeleteAttachment } from "../useAttachments";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
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

describe("useAttachments mutations", () => {
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

  it("useUploadAttachment POSTs FormData with x-csrf-token and no JSON content-type", async () => {
    const attachment = {
      id: "att-1",
      transactionId: "tx-1",
      filename: "a.png",
      originalFilename: "a.png",
      mimeType: "image/png",
      size: 3,
      uploadedBy: "u-1",
      uploadedAt: "2026-07-01T00:00:00Z",
    };
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ success: true, data: attachment }),
    );

    const { result } = renderHook(() => useUploadAttachment("tx-1"), {
      wrapper: createWrapper(),
    });

    const file = new File(["abc"], "a.png", { type: "image/png" });
    let uploaded: unknown;
    await act(async () => {
      uploaded = await result.current.mutateAsync({ file });
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/transactions/tx-1/attachments");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    expect(headerOf(init, "x-csrf-token")).toBe("test-csrf");
    expect(headerOf(init, "Content-Type")).toBeUndefined();
    expect(init?.credentials).toBe("include");
    expect(uploaded).toEqual(attachment);
  });

  it("useDeleteAttachment DELETEs with x-csrf-token", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { message: "deleted" } }),
    );

    const { result } = renderHook(() => useDeleteAttachment("tx-1"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync("att-1");
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/transactions/tx-1/attachments/att-1");
    expect(init?.method).toBe("DELETE");
    expect(headerOf(init, "x-csrf-token")).toBe("test-csrf");
    expect(init?.credentials).toBe("include");
  });
});
