/**
 * @vitest-environment jsdom
 *
 * Login return path: after signing in or registering, the user goes back to
 * a validated same-origin `next` path (e.g. the household invite page) and
 * never to an off-site URL.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const handlers = vi.hoisted(() => ({
  handleLoginApi: vi.fn(),
  handleRegisterApi: vi.fn(),
  handleMfaVerifyApi: vi.fn(),
  handleResendMfaApi: vi.fn(),
  handleResendVerificationApi: vi.fn(),
  handleForgotPasswordApi: vi.fn(),
  handleResetPasswordApi: vi.fn(),
}));

vi.mock("../useAuthHandlers", () => handlers);

import Login from "../index";

function renderLogin(search: string) {
  window.history.pushState({}, "", `/login${search}`);
  const location = memoryLocation({ path: "/login", record: true });
  render(
    <Router hook={location.hook}>
      <Login />
    </Router>,
  );
  return location.history;
}

async function signIn() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/email/i), "invitee@example.test");
  await user.type(screen.getByLabelText(/^password/i), "Synthetic-Pass-123!");
  await user.click(screen.getByRole("button", { name: /^sign in$/i }));
}

describe("Login return path", () => {
  beforeEach(() => {
    handlers.handleLoginApi.mockResolvedValue({ success: true });
    handlers.handleRegisterApi.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/");
  });

  it("returns to a valid next path after signing in", async () => {
    const history = renderLogin("?next=%2Finvite%2Fabc123");

    await signIn();

    await waitFor(() => {
      expect(history[history.length - 1]).toBe("/invite/abc123");
    });
  });

  it.each([
    ["a protocol-relative URL", "%2F%2Fevil.example"],
    ["an absolute https URL", "https%3A%2F%2Fevil.example%2Finvite"],
  ])("ignores %s and goes to /", async (_label, next) => {
    const history = renderLogin(`?next=${next}`);

    await signIn();

    await waitFor(() => {
      expect(handlers.handleLoginApi).toHaveBeenCalled();
      expect(history[history.length - 1]).toBe("/");
    });
  });

  it("opens the register form for mode=register and returns to next after sign-up", async () => {
    const user = userEvent.setup();
    const history = renderLogin("?mode=register&next=%2Finvite%2Fabc123");

    expect(
      screen.getByRole("button", { name: /create account/i }),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText(/full name/i), "Synthetic Invitee");
    await user.type(screen.getByLabelText(/username/i), "synthetic_invitee");
    await user.type(screen.getByLabelText(/email/i), "invitee@example.test");
    await user.type(screen.getByLabelText(/^password/i), "Synthetic-Pass-123!");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(history[history.length - 1]).toBe("/invite/abc123");
    });
  });
});
