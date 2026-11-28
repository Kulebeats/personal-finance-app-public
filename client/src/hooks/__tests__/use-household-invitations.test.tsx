/**
 * AH-05: the pending-invitations screen calls the three routes that exist
 * (server/modules/household/household.routes.ts), with the CSRF token on the
 * writes, and reads the list from the V7 envelope the controller sends.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { clearCsrfToken } from "@/lib/api";
import {
  usePendingInvitations,
  useResendInvitation,
  useRevokeInvitation,
  type PendingInvitation,
} from "../use-household-invitations";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockFetch = vi.fn();
global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).includes("/csrf-token")) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ csrfToken: "test-csrf" }) });
  }
  return mockFetch(input, init);
}) as unknown as typeof fetch;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const INVITE: PendingInvitation = {
  id: "inv-1", email: "guest@example.test", role: "member", invitedBy: "user-1",
  expiresAt: "2099-01-01T00:00:00.000Z", createdAt: "2026-11-28T00:00:00.000Z",
};

function lastRequest(): { url: string; method?: string; csrf?: string } {
  const [url, init] = mockFetch.mock.calls.at(-1)!;
  return { url: String(url), method: init?.method, csrf: init?.headers?.["x-csrf-token"] };
}

describe("household invitation hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCsrfToken();
  });

  it("lists pending invitations from GET /api/household/invitations", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true, data: { invitations: [INVITE] } }) });
    const { result } = renderHook(() => usePendingInvitations(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([INVITE]);
    expect(lastRequest()).toMatchObject({ url: "/api/household/invitations" });
  });

  it("does not ask for the list when it is disabled", () => {
    renderHook(() => usePendingInvitations(false), { wrapper });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("resends through POST /api/household/invitations/:id/resend with the CSRF token", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true, data: { invitation: INVITE } }) });
    const { result } = renderHook(() => useResendInvitation(), { wrapper });

    act(() => result.current.mutate(INVITE));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(lastRequest()).toEqual({ url: "/api/household/invitations/inv-1/resend", method: "POST", csrf: "test-csrf" });
  });

  it("revokes through DELETE /api/household/invitations/:id and accepts the 204", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204, json: async () => { throw new Error("no body"); } });
    const { result } = renderHook(() => useRevokeInvitation(), { wrapper });

    act(() => result.current.mutate(INVITE));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(lastRequest()).toEqual({ url: "/api/household/invitations/inv-1", method: "DELETE", csrf: "test-csrf" });
  });
});
