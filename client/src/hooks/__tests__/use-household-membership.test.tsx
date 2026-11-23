/**
 * AH-05: the members screen calls routes that exist, with the bodies the
 * server validates (server/modules/household/household.routes.ts).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { clearCsrfToken } from "@/lib/api";
import {
  useInviteMember,
  useLeaveHousehold,
  useTransferOwnership,
} from "../use-household-membership";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// apiCall() fetches a CSRF token before each mutation; serve it here so only
// the real request reaches mockFetch.
const mockFetch = vi.fn();
global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).includes("/csrf-token")) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ csrfToken: "test-csrf" }) });
  }
  return mockFetch(input, init);
}) as unknown as typeof fetch;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function respondOk(data: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data }),
  });
}

function lastRequest(): { url: string; method?: string; body: unknown } {
  const [url, init] = mockFetch.mock.calls.at(-1)!;
  return { url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined };
}

describe("household membership hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCsrfToken();
  });

  it("invites by email through POST /api/household/invite", async () => {
    respondOk({ invitation: { id: "inv-1", email: "a@b.c", role: "member" } });
    const { result } = renderHook(() => useInviteMember(), { wrapper });

    act(() => result.current.mutate({ email: "a@b.c", role: "professional" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(lastRequest()).toEqual({
      url: "/api/household/invite",
      method: "POST",
      body: { email: "a@b.c", role: "professional" },
    });
  });

  it("transfers ownership through POST /api/household/transfer-ownership", async () => {
    respondOk({ transferred: true });
    const { result } = renderHook(() => useTransferOwnership(), { wrapper });

    act(() => result.current.mutate("user-3"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(lastRequest()).toEqual({
      url: "/api/household/transfer-ownership",
      method: "POST",
      body: { newOwnerId: "user-3" },
    });
  });

  it("leaves through POST /api/household/leave", async () => {
    respondOk({ left: true });
    const { result } = renderHook(() => useLeaveHousehold(), { wrapper });

    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(lastRequest()).toMatchObject({ url: "/api/household/leave", method: "POST" });
  });
});
