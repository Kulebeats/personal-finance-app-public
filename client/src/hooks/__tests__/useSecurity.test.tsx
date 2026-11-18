/**
 * @vitest-environment jsdom
 *
 * useSecurity email-change mutations must attach the x-csrf-token header —
 * server/app.ts enforces CSRF outside NODE_ENV=test, so a raw fetch without
 * it 403s in any real browser session.
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import {
  useChangeEmail,
  useVerifyEmail,
  useResendVerification,
  useCancelEmailChange,
  useMfaStatus,
} from "../useSecurity";
import { waitFor } from "@testing-library/react";

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

describe("useSecurity email mutations", () => {
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

  it("useChangeEmail POSTs with x-csrf-token and JSON body", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ success: true, message: "Verification email sent" }),
    );

    const { result } = renderHook(() => useChangeEmail(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        newEmail: "new@example.com",
        password: "pw-123456",
      });
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/settings/security/email/change");
    expect(init?.method).toBe("POST");
    expect(headerOf(init, "x-csrf-token")).toBe("test-csrf");
    expect(headerOf(init, "Content-Type")).toBe("application/json");
    expect(init?.credentials).toBe("include");
    expect(init?.body).toBe(
      JSON.stringify({ newEmail: "new@example.com", password: "pw-123456" }),
    );
  });

  it("useVerifyEmail POSTs the token with x-csrf-token", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

    const { result } = renderHook(() => useVerifyEmail(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync("verify-token-1");
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/settings/security/email/verify");
    expect(init?.method).toBe("POST");
    expect(headerOf(init, "x-csrf-token")).toBe("test-csrf");
    expect(init?.body).toBe(JSON.stringify({ token: "verify-token-1" }));
  });

  it("useResendVerification POSTs with x-csrf-token", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

    const { result } = renderHook(() => useResendVerification(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/settings/security/email/resend");
    expect(init?.method).toBe("POST");
    expect(headerOf(init, "x-csrf-token")).toBe("test-csrf");
  });

  it("useCancelEmailChange POSTs with x-csrf-token", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

    const { result } = renderHook(() => useCancelEmailChange(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/settings/security/email/cancel");
    expect(init?.method).toBe("POST");
    expect(headerOf(init, "x-csrf-token")).toBe("test-csrf");
  });

  it("surfaces the server error message on failure", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        { error: { message: "Current password is incorrect" } },
        400,
      ),
    );

    const { result } = renderHook(() => useChangeEmail(), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.mutateAsync({
        newEmail: "new@example.com",
        password: "wrong",
      }),
    ).rejects.toThrow("Current password is incorrect");
  });
});

describe("useMfaStatus", () => {
  const mockMfaFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockMfaFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // The real server route lives under /api/settings/security/mfa/status
  // (server/routes/security.ts mounts security.mfa.ts at /mfa, and
  // server/routes.ts mounts security.ts at /api/settings/security). A
  // wrong-prefix request to /api/security/mfa/status 404s.
  it("requests the correct /api/settings/security/mfa/status path", async () => {
    mockMfaFetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: { mfaEnabled: false, mfaMethod: null, backupCodesRemaining: 0, lowCodesWarning: false },
      }),
    );

    const { result } = renderHook(() => useMfaStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = mockMfaFetch.mock.calls[0];
    expect(url).toBe("/api/settings/security/mfa/status");
  });

  it("renders MFA as enabled with the real backup-codes count when the server reports it enabled", async () => {
    mockMfaFetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          mfaEnabled: true,
          mfaMethod: "email",
          backupCodesRemaining: 2,
          lowCodesWarning: true,
        },
      }),
    );

    const { result } = renderHook(() => useMfaStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      mfaEnabled: true,
      mfaMethod: "email",
      backupCodesRemaining: 2,
      lowCodesWarning: true,
    });
  });

  it("surfaces a 404 as an error instead of silently reporting MFA disabled", async () => {
    // A 404 here means something is actually broken (wrong route, server
    // down) — the real /status handler always returns 200. It must not be
    // swallowed into a default "MFA off, 0 backup codes" result.
    mockMfaFetch.mockResolvedValueOnce(
      jsonResponse({ error: { message: "Not found" } }, 404),
    );

    const { result } = renderHook(() => useMfaStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
