/**
 * @vitest-environment jsdom
 *
 * Goal image upload must attach the x-csrf-token header — server/app.ts
 * enforces CSRF outside NODE_ENV=test, so a raw fetch without it 403s in any
 * real browser session. FormData must NOT get a JSON content-type (the
 * browser sets multipart/form-data + boundary).
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import { useUploadGoalImage } from "../useGoals";

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

describe("useUploadGoalImage", () => {
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

  it("POSTs FormData with x-csrf-token and no JSON content-type", async () => {
    const image = {
      id: "img-1",
      url: "/uploads/goals/img-1.png",
      filename: "img-1.png",
    };
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { image } }),
    );

    const { result } = renderHook(() => useUploadGoalImage(), {
      wrapper: createWrapper(),
    });

    const file = new File(["img"], "goal.png", { type: "image/png" });
    let uploaded: unknown;
    await act(async () => {
      uploaded = await result.current.mutateAsync(file);
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/goals/images");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    expect(headerOf(init, "x-csrf-token")).toBe("test-csrf");
    expect(headerOf(init, "Content-Type")).toBeUndefined();
    expect(init?.credentials).toBe("include");
    expect(uploaded).toEqual(image);
  });

  it("surfaces the server error message on failure", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: { message: "File too large" } }, 400),
    );

    const { result } = renderHook(() => useUploadGoalImage(), {
      wrapper: createWrapper(),
    });

    const file = new File(["img"], "goal.png", { type: "image/png" });
    await expect(result.current.mutateAsync(file)).rejects.toThrow(
      "File too large",
    );
  });
});
