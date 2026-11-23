import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { clearCsrfToken } from "@/lib/csrf";

const requests: string[] = [];
let status: unknown;
let pending = false;

describe("complete App session mount boundary", () => {
  beforeEach(() => {
    requests.length = 0;
    pending = false;
    status = { state: "verification_pending", subject: { id: "a", email: "a@example.test", displayName: null } };
    clearCsrfToken();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url === "/api/auth/session") {
        if (pending) return new Promise<Response>(() => {});
        if (status instanceof Error) throw status;
        return new Response(JSON.stringify({ success: true, data: status }));
      }
      if (url === "/api/settings/display") return new Response(JSON.stringify({ success: true, data: { settings: {} } }));
      return new Response(JSON.stringify({ success: true, data: [] }));
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it.each([
    ["/login", "Welcome Back"],
    ["/forgot-password", "Forgot your password?"],
    ["/reset-password", "Link invalid or expired"],
    ["/verify-email", "Verification Failed"],
  ])("public %s mounts no protected providers", async (path, title) => {
    window.history.replaceState({}, "", path);
    render(<App />);
    await screen.findByText(title);
    expect(requests).toEqual([]);
  });

  it("pending entry renders verification controls without financial requests", async () => {
    window.history.replaceState({}, "", "/accounts");
    render(<App />);
    await screen.findByRole("heading", { name: /verify your email/i });
    expect(requests).toEqual(["/api/auth/session"]);
  });

  it("loading bootstrap mounts no data provider", async () => {
    pending = true;
    render(<App />);
    await screen.findByRole("status");
    expect(requests).toEqual(["/api/auth/session"]);
  });

  it("bootstrap failure retains the real failure and a retry without protected requests", async () => {
    status = new Error("Session store unavailable");
    render(<App />);
    await screen.findByText("Session store unavailable");
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(requests).toEqual(["/api/auth/session"]);
  });

  it.each(["/", "/accounts"])("household-free %s renders useful onboarding without finance fetches", async path => {
    status = { state: "verified_without_household", subject: { id: "a", email: "a@example.test", displayName: null } };
    window.history.replaceState({}, "", path);
    render(<App />);
    await screen.findByRole("heading", { name: /create your household/i });
    expect(screen.getByRole("link", { name: /profile/i })).toBeInTheDocument();
    expect(requests.every(url => ["/api/auth/session", "/api/settings/display"].includes(url))).toBe(true);
  });

  it("does not treat old household error prose as a successful onboarding state", async () => {
    status = new Error("No household found in the audit trail");
    render(<App />);
    await screen.findByText("No household found in the audit trail");
    expect(screen.queryByRole("heading", { name: /create your household/i })).not.toBeInTheDocument();
    expect(requests).toEqual(["/api/auth/session"]);
  });
});
