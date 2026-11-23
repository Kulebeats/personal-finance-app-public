/**
 * useAIConsent / useUpdateAIConsent Hook Tests (packet R4)
 *
 * Audit finding (a): the Settings "AI Features" consent card called
 * /api/settings/ai-preferences, which does not exist on the server. The real
 * consent endpoints are GET/POST /api/ai/consent (server/modules/ai/ai.routes.ts).
 * These tests pin the hooks to the REAL endpoint path/method/payload and to
 * the REAL (non-V7-enveloped) response shape returned by
 * server/modules/ai/ai.controller.ts getConsent/setConsent.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";
import { clearCsrfToken } from "@/lib/api";

// apiCall() fetches a CSRF token (GET /api/csrf-token) before every mutating
// request. Serve that token transparently so it never consumes a per-test
// mockResolvedValueOnce and never shows up in mockFetch call assertions.
const mockFetch = vi.fn();
global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).includes("/csrf-token")) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ csrfToken: "test-csrf" }),
    });
  }
  return mockFetch(input, init);
}) as unknown as typeof fetch;

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
};

// Import after mocks
import { useAIConsent, useUpdateAIConsent } from "../use-settings";

describe("useAIConsent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCsrfToken();
  });

  it("reads consent status from the real endpoint GET /api/ai/consent", async () => {
    const raw = {
      consentGiven: true,
      consentDate: "2026-07-01T00:00:00.000Z",
      consentVersion: "v1.0",
      currentVersion: "v1.0",
      needsReconsent: false,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(raw),
    });

    const { result } = renderHook(() => useAIConsent(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The real endpoint hit was /api/ai/consent (NOT /api/settings/ai-preferences).
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/ai/consent",
      expect.objectContaining({ credentials: "include" }),
    );

    // Response is NOT V7-enveloped: consumed as-is, no `.data` unwrap.
    expect(result.current.data).toEqual(raw);
  });
});

describe("useUpdateAIConsent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCsrfToken();
  });

  it("grants consent via POST /api/ai/consent naming the disclosure version shown, with a CSRF header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          consentGiven: true,
          consentDate: "2026-07-12T00:00:00.000Z",
          consentVersion: "v1.0",
        }),
    });

    const { result } = renderHook(() => useUpdateAIConsent(), {
      wrapper: createWrapper(),
    });

    let mutationResult: unknown;
    await act(async () => {
      mutationResult = await result.current.mutateAsync({ consentGiven: true, consentVersion: "v2.0" });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/ai/consent",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ consentGiven: true, consentVersion: "v2.0" }),
        headers: expect.objectContaining({
          "x-csrf-token": "test-csrf",
          "Content-Type": "application/json",
        }),
      }),
    );

    // Not V7-enveloped: mutateAsync resolves the raw response as-is.
    expect(mutationResult).toEqual({
      consentGiven: true,
      consentDate: "2026-07-12T00:00:00.000Z",
      consentVersion: "v1.0",
    });
    await waitFor(() =>
      expect(result.current.data).toEqual({
        consentGiven: true,
        consentDate: "2026-07-12T00:00:00.000Z",
        consentVersion: "v1.0",
      }),
    );
  });

  it("revokes consent via POST /api/ai/consent with { consentGiven: false }", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          consentGiven: false,
          consentDate: "2026-07-12T00:00:00.000Z",
          consentVersion: null,
        }),
    });

    const { result } = renderHook(() => useUpdateAIConsent(), {
      wrapper: createWrapper(),
    });

    let mutationResult: { consentGiven: boolean } | undefined;
    await act(async () => {
      mutationResult = (await result.current.mutateAsync({ consentGiven: false })) as {
        consentGiven: boolean;
      };
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/ai/consent",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ consentGiven: false }),
      }),
    );
    expect(mutationResult?.consentGiven).toBe(false);
    await waitFor(() => expect(result.current.data?.consentGiven).toBe(false));
  });
});
