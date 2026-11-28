/**
 * AH-08 (d): the erasure screen calls POST /api/settings/account/delete with
 * the CSRF token and the password the controller checks, leaves only after
 * the server confirms, and keeps no password in the mutation cache.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { clearCsrfToken } from "@/lib/api";
import { useAccountErasure, useForgetErasurePassword } from "../useAccountErasure";

const mockFetch = vi.fn();
global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).includes("/csrf-token")) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ csrfToken: "test-csrf" }) });
  }
  return mockFetch(input, init);
}) as unknown as typeof fetch;

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useAccountErasure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCsrfToken();
    client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  });

  it("posts the password with the CSRF token and leaves once the server confirms", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true, data: null }) });
    const onErased = vi.fn();
    const { result } = renderHook(() => useAccountErasure(onErased), { wrapper });

    act(() => result.current.mutate("Synthetic-Password-1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url, init] = mockFetch.mock.calls.at(-1)!;
    expect(url).toBe("/api/settings/account/delete");
    expect(init.method).toBe("POST");
    expect(init.headers["x-csrf-token"]).toBe("test-csrf");
    expect(JSON.parse(init.body)).toEqual({ password: "Synthetic-Password-1" });
    expect(onErased).toHaveBeenCalledTimes(1);
  });

  it("stays put when the server refuses the password", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 401, headers: new Headers(),
      json: async () => ({ success: false, error: { code: "INVALID_CREDENTIALS", message: "Password is incorrect" } }),
    });
    const onErased = vi.fn();
    const { result } = renderHook(() => useAccountErasure(onErased), { wrapper });

    act(() => result.current.mutate("wrong"));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toMatchObject({ code: "INVALID_CREDENTIALS", status: 401 });
    expect(onErased).not.toHaveBeenCalled();
  });

  it("forgets a pending attempt's password on request", async () => {
    mockFetch.mockReturnValueOnce(new Promise(() => undefined));
    const { result } = renderHook(() => ({ erase: useAccountErasure(vi.fn()), forget: useForgetErasurePassword() }), { wrapper });

    act(() => result.current.erase.mutate("Synthetic-Password-1"));
    await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(1));
    act(() => result.current.forget());

    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });
});
