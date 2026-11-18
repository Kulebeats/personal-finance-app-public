/**
 * @vitest-environment jsdom
 *
 * ResetPassword page tests (R1): token handling, validation, success, and
 * generic invalid-link states. The fetch stub serves /csrf-token
 * transparently so apiCall's CSRF fetch never consumes mocked responses.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import ResetPassword from "../ResetPassword";

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

const VALID_PASSWORD = "NewPassword456!";
const TOKEN = "a".repeat(64);

function renderWithToken(token: string | null) {
  window.history.pushState(
    {},
    "",
    token ? `/reset-password?token=${token}` : "/reset-password",
  );
  return render(<ResetPassword />);
}

function fillPasswords(password: string, confirm: string = password) {
  fireEvent.change(screen.getByLabelText(/^new password/i), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText(/confirm password/i), {
    target: { value: confirm },
  });
}

describe("ResetPassword page", () => {
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
    // Unmount BEFORE resetting the URL - a mounted wouter <Link> reacts to
    // pushState and would trigger an out-of-act state update.
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    window.history.pushState({}, "", "/");
  });

  it("shows the invalid state with a request-again link when the token is missing", () => {
    renderWithToken(null);

    expect(
      screen.getByText(/link invalid or expired/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /request a new reset link/i }),
    ).toHaveAttribute("href", "/forgot-password");
  });

  it("renders labeled password fields when a token is present", () => {
    renderWithToken(TOKEN);

    expect(
      screen.getByText(/choose a new password/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^new password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
  });

  it("disables submit for a weak password", () => {
    renderWithToken(TOKEN);

    fillPasswords("weak");

    expect(
      screen.getByRole("button", { name: /reset password/i }),
    ).toBeDisabled();
  });

  it("disables submit and warns when passwords do not match", () => {
    renderWithToken(TOKEN);

    fillPasswords(VALID_PASSWORD, "Different123!");

    expect(screen.getByRole("alert")).toHaveTextContent(
      /passwords do not match/i,
    );
    expect(
      screen.getByRole("button", { name: /reset password/i }),
    ).toBeDisabled();
  });

  it("submits the token and new password, then shows the success state", async () => {
    mockFetch.mockResolvedValue(
      mockFetchResponse({ success: true, data: null }),
    );

    renderWithToken(TOKEN);
    fillPasswords(VALID_PASSWORD);
    fireEvent.click(screen.getByRole("button", { name: /reset password/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Password reset"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("link", { name: /sign in with your new password/i }),
    ).toHaveAttribute("href", "/login");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/auth/reset-password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ token: TOKEN, newPassword: VALID_PASSWORD }),
        headers: expect.objectContaining({ "x-csrf-token": "test-csrf" }),
      }),
    );
  });

  it("shows the generic invalid-link state when the server rejects the token", async () => {
    mockFetch.mockResolvedValue(
      mockFetchResponse(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message:
              "This password reset link is invalid or has expired. Please request a new one.",
          },
        },
        { ok: false, status: 400 },
      ),
    );

    renderWithToken(TOKEN);
    fillPasswords(VALID_PASSWORD);
    fireEvent.click(screen.getByRole("button", { name: /reset password/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/link invalid or expired/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("link", { name: /request a new reset link/i }),
    ).toHaveAttribute("href", "/forgot-password");
  });
});
