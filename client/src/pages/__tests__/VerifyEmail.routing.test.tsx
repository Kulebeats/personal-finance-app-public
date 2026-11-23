import { StrictMode, Suspense } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router as AppRoutes } from "@/App";
import { clearCsrfToken } from "@/lib/csrf";

const TOKEN = "b".repeat(64);
const transport = vi.fn();

describe("verification routes in the actual App Switch", () => {
  beforeEach(() => {
    clearCsrfToken();
    transport.mockReset();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/csrf-token") {
        return Promise.resolve(new Response(JSON.stringify({ csrfToken: "route-csrf" })));
      }
      return transport(input, init);
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it.each(["/verify-email", "/auth/verify-email"])(
    "reaches the public consumer from %s with query preserved through redirect",
    async (path) => {
      window.history.replaceState({ previous: true }, "", `${path}?source=legacy&token=${TOKEN}#details`);
      transport.mockImplementation(() => {
        expect(window.location.pathname).toBe("/verify-email");
        expect(window.location.search).toBe("?source=legacy");
        expect(window.location.hash).toBe("#details");
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: null })));
      });
      const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
      render(
        <StrictMode>
          <QueryClientProvider client={client}>
            <Suspense fallback={<p>Loading verification</p>}><AppRoutes /></Suspense>
          </QueryClientProvider>
        </StrictMode>,
      );
      await screen.findByText("Email Verified!");
      expect(transport).toHaveBeenCalledTimes(1);
      expect(transport).toHaveBeenCalledWith("/api/settings/security/email/verify", expect.objectContaining({
        body: JSON.stringify({ token: TOKEN }),
      }));
      expect(screen.getByRole("link", { name: /^sign in$/i })).toHaveAttribute("href", "/login");
    },
  );
});
