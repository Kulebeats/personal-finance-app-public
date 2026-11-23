import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionStatus } from "@shared/session-status";
import App from "@/App";
import { toast } from "sonner";
import { handleLoginApi } from "@/pages/Login/useAuthHandlers";
import { clearCsrfToken } from "@/lib/csrf";
import { retireOperationLifetime } from "@/lib/operation-lifetime";

function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const subject = { id: "a", email: "a@example.test", displayName: null };

describe("pending session actions", () => {
  let status: SessionStatus;
  let delivery: string;
  let firstCsrf: ReturnType<typeof deferred<Response>> | null;
  let csrfCount: number;
  let urls: string[];
  let logoutFailure: boolean;
  beforeEach(() => {
    window.history.replaceState({}, "", "/accounts");
    status = { state: "verification_pending", subject }; delivery = "accepted"; firstCsrf = null; csrfCount = 0; urls = []; logoutFailure = false; clearCsrfToken();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); urls.push(url);
      if (url === "/api/auth/session") return json({ success: true, data: status });
      if (url === "/api/csrf-token") { csrfCount++; return firstCsrf && csrfCount === 1 ? firstCsrf.promise : json({ csrfToken: "token" }); }
      if (url === "/api/auth/login") { status = { state: "verified_without_household", subject: { ...subject, id: "b" } }; return json({ success: true, data: {} }); }
      if (url === "/api/auth/mfa/verify") return json({ error: { code: "INVALID_MFA_CODE", message: "The verification code is incorrect" } }, 400);
      if (url === "/api/auth/logout" && logoutFailure) return json({ error: { code: "INTERNAL_ERROR", message: "Unable to sign out right now" } }, 500);
      if (url === "/api/settings/security/email/resend") return json({ success: true, data: { delivery } });
      if (url === "/api/settings/display") return json({ success: true, data: { settings: {} } });
      return json({ success: true, data: {} });
    }));
  });
  afterEach(() => { cleanup(); retireOperationLifetime(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState({}, "", "/"); });

  it.each(["unknown", "unavailable", "not_required"])("does not claim sent for delivery=%s", async outcome => {
    delivery = outcome; render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Resend verification email" }));
    await waitFor(() => expect(urls).toContain("/api/settings/security/email/resend"));
    await waitFor(() => expect(screen.getByRole("status")).not.toHaveTextContent(/email sent/i));
    expect(screen.getByRole("status")).toHaveTextContent(outcome === "not_required" ? /already verified/i : /not confirmed|unavailable/i);
  });

  it("does not dispatch an old pending-session resend after login replaces its identity", async () => {
    firstCsrf = deferred<Response>(); render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Resend verification email" }));
    await waitFor(() => expect(csrfCount).toBe(1));
    await act(async () => { await handleLoginApi({ email: "b@example.test", password: "pw", rememberMe: false }); });
    await screen.findByRole("heading", { name: /create your household/i });
    await act(async () => { firstCsrf!.resolve(json({ csrfToken: "old" })); });
    expect(urls).not.toContain("/api/settings/security/email/resend");
  });

  it("keeps an invalid MFA code failure visible after the status refresh remount", async () => {
    status = { state: "mfa_pending" }; render(<App />);
    const input = await screen.findByLabelText(/verification code/i);
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.submit(input.closest("form")!);
    // The stub's INVALID_MFA_CODE is not a known code, so the fixed generic MFA line shows (never the server text).
    await screen.findByText("We couldn't verify that code. Please try again.");
    expect(screen.getByRole("button", { name: /verify/i })).toBeInTheDocument();
  });

  it("surfaces personal-shell logout failure and rechecks the still-current session", async () => {
    status = { state: "verified_without_household", subject }; logoutFailure = true;
    const display = vi.spyOn(toast, "error");
    render(<App />); await screen.findByRole("heading", { name: /create your household/i });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    // The action that failed, then the reason in plain copy; the server text "Unable to sign out right now" is never shown.
    await waitFor(() => expect(display).toHaveBeenCalledWith("Unable to sign out", { description: "Something went wrong on our side. Try again in a moment." }));
    await screen.findByRole("heading", { name: /create your household/i });
    expect(urls.filter(url => url === "/api/auth/session")).toHaveLength(2);
  });
});
