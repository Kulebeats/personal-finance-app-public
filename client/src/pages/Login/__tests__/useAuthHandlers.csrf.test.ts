/**
 * @vitest-environment jsdom
 *
 * Auth POST handlers are pre-auth on the server, but routing them through
 * apiCall keeps CSRF token caching and stale-token recovery behavior consistent
 * with the rest of the client mutation surface.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import {
  handleLoginApi,
  handleMfaVerifyApi,
  handleRegisterApi,
  handleResendMfaApi,
  handleResendVerificationApi,
} from "../useAuthHandlers";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

const mockFetch = vi.fn();

const mockFetchResponse = (
  data: unknown,
  options: { ok?: boolean; status?: number } = {},
): Response =>
  ({
    ok: options.ok ?? true,
    status: options.status ?? (options.ok === false ? 400 : 200),
    json: vi.fn().mockResolvedValue(data),
  }) as unknown as Response;

describe("auth handlers CSRF coverage", () => {
  beforeEach(() => {
    clearCsrfToken();
    mockFetch.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/csrf-token")) {
          return Promise.resolve(mockFetchResponse({ csrfToken: "test-csrf" }));
        }
        return mockFetch(input, init);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each([
    {
      name: "login",
      call: () =>
        handleLoginApi({
          email: "user@example.com",
          password: "correct horse battery staple",
          rememberMe: true,
        }),
      url: "/api/auth/login",
      body: {
        email: "user@example.com",
        password: "correct horse battery staple",
        rememberMe: true,
      },
      response: { success: true, data: {} },
    },
    {
      name: "register",
      call: () =>
        handleRegisterApi({
          username: "new-user",
          email: "new@example.com",
          password: "correct horse battery staple",
          fullName: "New User",
        }),
      url: "/api/auth/register",
      body: {
        username: "new-user",
        email: "new@example.com",
        password: "correct horse battery staple",
        fullName: "New User",
      },
      response: { success: true, data: { user: { id: "u1" } } },
    },
    {
      name: "MFA verification",
      call: () => handleMfaVerifyApi("123456"),
      url: "/api/auth/mfa/verify",
      body: { code: "123456" },
      response: { success: true, data: { user: { id: "u1" } } },
    },
    {
      name: "MFA resend",
      call: () => handleResendMfaApi(),
      url: "/api/auth/mfa/resend",
      response: {
        success: true,
        data: { maskedEmail: "u***@example.com" },
      },
    },
    {
      name: "verification email resend",
      call: () => handleResendVerificationApi("user@example.com"),
      url: "/api/auth/resend-verification",
      body: { email: "user@example.com" },
      response: { success: true, data: null },
    },
  ])("$name POST goes through apiCall with x-csrf-token", async (testCase) => {
    mockFetch.mockResolvedValue(mockFetchResponse(testCase.response));

    await expect(testCase.call()).resolves.toMatchObject({ success: true });

    expect(mockFetch).toHaveBeenCalledWith(
      testCase.url,
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "x-csrf-token": "test-csrf",
        }),
        ...(testCase.body ? { body: JSON.stringify(testCase.body) } : {}),
      }),
    );
  });

  it("preserves the email-not-verified login state from the apiCall error", async () => {
    mockFetch.mockResolvedValue(
      mockFetchResponse(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Email not verified. Please check your inbox.",
          },
        },
        { ok: false, status: 403 },
      ),
    );

    await expect(
      handleLoginApi({
        email: "user@example.com",
        password: "password",
        rememberMe: false,
      }),
    ).resolves.toEqual({
      success: false,
      message: "Email not verified. Please check your inbox.",
      isEmailNotVerified: true,
    });
  });

  it("keeps the invalid login response message when JSON parsing fails", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token <")),
    } as unknown as Response);

    await expect(
      handleLoginApi({
        email: "user@example.com",
        password: "password",
        rememberMe: false,
      }),
    ).resolves.toEqual({
      success: false,
      message: "Server returned invalid response",
      isEmailNotVerified: false,
    });
  });
});
