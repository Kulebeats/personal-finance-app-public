/**
 * @vitest-environment jsdom
 *
 * AcceptInvite page tests: the page the household invitation email links to
 * (`/invite/<code>`). Real wouter routing over a memory location, a fresh
 * QueryClient per test, and a fetch stub that serves /csrf-token
 * transparently so apiCall's CSRF fetch never consumes mocked responses.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { clearCsrfToken } from "@/lib/api";
import AcceptInvite from "../AcceptInvite";

const INVITE_CODE = "c0ffee".repeat(10);
const INVITE_PATH = `/invite/${INVITE_CODE}`;

const mockFetch = vi.fn();

// A real Response: apiCall reads error bodies through response.clone().
const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const signedInProfile = {
  success: true,
  data: { profile: { id: "user-1", email: "invitee@example.test" } },
};

const unauthenticated = {
  success: false,
  error: { code: "UNAUTHORIZED", message: "Authentication required" },
};

function stubProfile(response: Response) {
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    if (String(input).includes("/api/settings/profile")) {
      return Promise.resolve(response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${String(input)}`));
  });
}

function renderInvitePage() {
  const location = memoryLocation({ path: INVITE_PATH, record: true });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={location.hook}>
        <Route path="/invite/:code" component={AcceptInvite} />
      </Router>
    </QueryClientProvider>,
  );
  return { history: location.history, queryClient };
}

describe("AcceptInvite page", () => {
  beforeEach(() => {
    clearCsrfToken();
    mockFetch.mockReset();
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

  it("signed out, offers sign-in and create-account links that return to the invite", async () => {
    stubProfile(jsonResponse(unauthenticated, 401));

    renderInvitePage();

    const signIn = await screen.findByRole("link", { name: /sign in/i });
    const createAccount = screen.getByRole("link", { name: /create account/i });
    const next = encodeURIComponent(INVITE_PATH);

    expect(
      screen.getByRole("heading", { name: /you've been invited/i }),
    ).toBeInTheDocument();
    expect(signIn).toHaveAttribute("href", `/login?next=${next}`);
    expect(createAccount).toHaveAttribute(
      "href",
      `/login?mode=register&next=${next}`,
    );
    expect(
      screen.queryByRole("button", { name: /accept invitation/i }),
    ).not.toBeInTheDocument();
  });

  it("signed in, Accept POSTs the invite code with a CSRF token and navigates to /", async () => {
    const user = userEvent.setup();
    stubProfile(jsonResponse(signedInProfile));
    const { history, queryClient } = renderInvitePage();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      if (String(input).includes("/api/settings/profile")) {
        return Promise.resolve(jsonResponse(signedInProfile));
      }
      return Promise.resolve(
        jsonResponse({ success: true, data: { household: { id: "hh-1" } } }),
      );
    });

    await user.click(
      await screen.findByRole("button", { name: /accept invitation/i }),
    );

    await waitFor(() => {
      expect(history[history.length - 1]).toBe("/");
    });

    const acceptCall = mockFetch.mock.calls.find(([input]) =>
      String(input).includes("/api/household/invite/accept"),
    );
    expect(acceptCall).toBeDefined();
    const init = acceptCall?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ inviteCode: INVITE_CODE });
    expect((init.headers as Record<string, string>)["x-csrf-token"]).toBe(
      "test-csrf",
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["household"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["profile"] });
  });

  it("shows the server's message in an alert when accepting fails", async () => {
    const user = userEvent.setup();
    stubProfile(jsonResponse(signedInProfile));
    const { history } = renderInvitePage();

    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      if (String(input).includes("/api/settings/profile")) {
        return Promise.resolve(jsonResponse(signedInProfile));
      }
      return Promise.resolve(
        jsonResponse(
          {
            success: false,
            error: { code: "CONFLICT", message: "This invitation has expired" },
          },
          409,
        ),
      );
    });

    await user.click(
      await screen.findByRole("button", { name: /accept invitation/i }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/this invitation has expired/i);
    expect(history[history.length - 1]).toBe(INVITE_PATH);
  });

  it("says the invitation is for a different email when the signed-in address is not the recipient", async () => {
    const user = userEvent.setup();
    stubProfile(jsonResponse(signedInProfile));
    const { history } = renderInvitePage();
    const message = "This invitation was sent to a different email address. Sign in with that address to accept it.";

    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      if (String(input).includes("/api/settings/profile")) {
        return Promise.resolve(jsonResponse(signedInProfile));
      }
      return Promise.resolve(
        jsonResponse({ success: false, error: { code: "INVITE_RECIPIENT_MISMATCH", message } }, 409),
      );
    });

    await user.click(
      await screen.findByRole("button", { name: /accept invitation/i }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This invitation is for a different email");
    expect(alert).toHaveTextContent(message);
    expect(history[history.length - 1]).toBe(INVITE_PATH);
  });
});
