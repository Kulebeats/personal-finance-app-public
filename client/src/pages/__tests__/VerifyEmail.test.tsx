import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/csrf";
import VerifyEmail from "../VerifyEmail";

const transport = vi.fn();
const TOKEN = "a".repeat(64);
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function renderPage(path = "/verify-email", strict = false) {
  window.history.replaceState({}, "", path);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const page = <QueryClientProvider client={client}><VerifyEmail /></QueryClientProvider>;
  return render(strict ? <StrictMode>{page}</StrictMode> : page);
}

describe("public email verification", () => {
  beforeEach(() => {
    clearCsrfToken();
    transport.mockReset();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/csrf-token") {
        return Promise.resolve(response({ csrfToken: "public-csrf" }));
      }
      return transport(input, init);
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("offers email-input public recovery and sign in when the token is missing", () => {
    renderPage();
    expect(screen.getByRole("textbox", { name: /email address/i })).toBeRequired();
    expect(screen.getByRole("link", { name: /^sign in$/i })).toHaveAttribute("href", "/login");
    expect(transport).not.toHaveBeenCalled();
  });

  it("consumes once in StrictMode and removes the bearer before transport", async () => {
    transport.mockImplementation(() => {
      expect(window.location.search).toBe("?source=mail");
      expect(window.location.hash).toBe("#help");
      return Promise.resolve(response({ success: true, data: null }));
    });
    renderPage(`/verify-email?source=mail&token=${TOKEN}#help`, true);
    await screen.findByText("Email Verified!");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith("/api/settings/security/email/verify", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ token: TOKEN }),
      credentials: "include",
      headers: expect.objectContaining({ "x-csrf-token": "public-csrf" }),
    }));
    expect(screen.getByRole("link", { name: /^sign in$/i })).toHaveAttribute("href", "/login");
  });

  it("keeps email-change tokens on the generic consumer and offers sign in after success", async () => {
    transport.mockResolvedValue(response({ success: true, data: null }));
    renderPage(`/verify-email?token=${TOKEN}&purpose=email-change`);
    await screen.findByText("Email Verified!");
    expect(transport).toHaveBeenCalledWith("/api/settings/security/email/verify", expect.objectContaining({
      body: JSON.stringify({ token: TOKEN }),
    }));
    expect(screen.getByRole("link", { name: /^sign in$/i })).toHaveAttribute("href", "/login");
  });

  it("requests public resend with the entered email and shows non-enumerating request status", async () => {
    transport.mockResolvedValue(response({ success: true, data: { message: "private server detail" } }));
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: /email address/i }), "person@example.invalid");
    await user.click(screen.getByRole("button", { name: /request a new verification link/i }));
    await screen.findByText(/if this address has an unverified account/i);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith("/api/auth/resend-verification", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ email: "person@example.invalid" }),
      headers: expect.objectContaining({ "x-csrf-token": "public-csrf" }),
    }));
    expect(screen.queryByText(/private server detail|has been sent|delivered/i)).not.toBeInTheDocument();
  });

  it("does not issue an empty-email resend", async () => {
    renderPage();
    await userEvent.setup().click(screen.getByRole("button", { name: /request a new verification link/i }));
    expect(transport).not.toHaveBeenCalled();
  });

  it("offers recovery after an expired token and keeps email-change help separate", async () => {
    transport.mockResolvedValue(response({ success: false, error: { message: "Invalid or expired token" } }, 400));
    renderPage(`/verify-email?token=${TOKEN}`);
    await screen.findByText("Verification Failed");
    expect(screen.getByRole("textbox", { name: /email address/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /security settings/i })).toHaveAttribute("href", "/settings/security");
    expect(screen.getByText(/email address change/i)).toBeInTheDocument();
  });

  it("reports resend failure truthfully and re-enables retry without exposing server details", async () => {
    transport.mockResolvedValue(response({ success: false, error: { message: "private server detail" } }, 503));
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: /email address/i }), "person@example.invalid");
    await user.click(screen.getByRole("button", { name: /request a new verification link/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't request a new link/i));
    expect(screen.getByRole("button", { name: /request a new verification link/i })).toBeEnabled();
    expect(screen.queryByText(/private server detail|if this address has an unverified account/i)).not.toBeInTheDocument();
  });
});
