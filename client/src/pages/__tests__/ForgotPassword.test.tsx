/**
 * @vitest-environment jsdom
 *
 * ForgotPassword page tests (R1): validation, success, and error states.
 * The fetch stub serves /csrf-token transparently so apiCall's CSRF fetch
 * never consumes the mocked endpoint responses.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import ForgotPassword from "../ForgotPassword";

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

describe("ForgotPassword page", () => {
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

  it("renders a labeled email form", () => {
    render(<ForgotPassword />);

    expect(
      screen.getByText(/forgot your password/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send reset link/i }),
    ).toBeInTheDocument();
  });

  it("submits the email and shows the generic success state", async () => {
    mockFetch.mockResolvedValue(
      mockFetchResponse({ success: true, data: null }),
    );

    render(<ForgotPassword />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/check your email/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/if that email is registered/i),
    ).toBeInTheDocument();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/auth/forgot-password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "user@example.com" }),
        headers: expect.objectContaining({ "x-csrf-token": "test-csrf" }),
      }),
    );
  });

  it("shows an error message and stays on the form when the request fails", async () => {
    mockFetch.mockResolvedValue(
      mockFetchResponse(
        {
          success: false,
          error: { code: "RATE_LIMITED", message: "Too many requests" },
        },
        { ok: false, status: 429 },
      ),
    );

    render(<ForgotPassword />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/too many attempts/i);
    });
    // Still on the form - no success state.
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it("shows a connection error when fetch rejects", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));

    render(<ForgotPassword />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/check your email/i),
    ).not.toBeInTheDocument();
  });
});
