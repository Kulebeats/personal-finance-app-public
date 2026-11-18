/**
 * Mid-session 401 handling
 *
 * Audit v2 P2 finding: only the cached profile query (Layout.tsx watching
 * useProfile()'s error) triggered a login redirect on 401, so a mid-session
 * 401 on ANY OTHER query or mutation (accounts, transactions, a save action,
 * etc.) failed silently - the user was left staring at a broken page instead
 * of being sent back to /login.
 *
 * This proves the shared QueryCache/MutationCache onError handlers in
 * queryClient.ts now redirect consistently on a 401 from ANY query/mutation,
 * but ONLY in an authenticated context - a 401 on a public page (login,
 * forgot-password, reset-password, verify-email) is expected background
 * noise and must NOT redirect, or it creates a redirect loop.
 *
 * The CSRF-token fetch is served transparently by the fetch stub (PR #54 /
 * queryClient.csrf.test.ts pattern) so it never consumes a queued response.
 *
 * Each test re-imports queryClient.ts via vi.resetModules() so the
 * module-level "already redirected" guard starts fresh every time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/api/csrf-token")) {
        return jsonResponse({ csrfToken: "csrf-1" });
      }
      return jsonResponse({ success: true, data: {} });
    }),
  );
}

function stubLocation(pathname: string) {
  const assignMock = vi.fn();
  Object.defineProperty(window, "location", {
    value: { ...window.location, pathname, assign: assignMock },
    writable: true,
    configurable: true,
  });
  return assignMock;
}

function makeUnauthorizedError(): Error & { status?: number } {
  const error = new Error("Unauthorized") as Error & { status?: number };
  error.status = 401;
  return error;
}

describe("queryClient mid-session 401 handling", () => {
  beforeEach(() => {
    vi.resetModules();
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redirects to /login on a 401 from a non-profile QUERY in an authenticated context", async () => {
    const assignMock = stubLocation("/accounts");
    const { queryClient } = await import("../queryClient");

    await queryClient
      .fetchQuery({
        queryKey: ["accounts", "widget"],
        queryFn: async () => {
          throw makeUnauthorizedError();
        },
        retry: false,
      })
      .catch(() => {});

    expect(assignMock).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login on a 401 from a MUTATION in an authenticated context", async () => {
    const assignMock = stubLocation("/settings");
    const { queryClient } = await import("../queryClient");

    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: async () => {
        throw makeUnauthorizedError();
      },
    });
    await mutation.execute(undefined).catch(() => {});

    expect(assignMock).toHaveBeenCalledWith("/login");
  });

  it("does NOT sign out when a MUTATION fails with 401 STEP_UP_REQUIRED (step-up dialog cancelled)", async () => {
    const assignMock = stubLocation("/transactions");
    const { queryClient } = await import("../queryClient");

    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: async () => {
        const error = makeUnauthorizedError() as Error & {
          status?: number;
          code?: string;
        };
        error.code = "STEP_UP_REQUIRED";
        throw error;
      },
    });
    await mutation.execute(undefined).catch(() => {});

    expect(assignMock).not.toHaveBeenCalled();
  });

  it.each(["/login", "/forgot-password", "/reset-password", "/verify-email"])(
    "does NOT redirect on a 401 from a background query on the public page %s (no redirect loop)",
    async (publicPath) => {
      const assignMock = stubLocation(publicPath);
      const { queryClient } = await import("../queryClient");

      await queryClient
        .fetchQuery({
          queryKey: ["background-check"],
          queryFn: async () => {
            throw makeUnauthorizedError();
          },
          retry: false,
        })
        .catch(() => {});

      expect(assignMock).not.toHaveBeenCalled();
    },
  );

  it("does not redirect for a non-401 error (keeps existing toast behavior)", async () => {
    const assignMock = stubLocation("/accounts");
    const { queryClient } = await import("../queryClient");

    const serverError = new Error("500: boom") as Error & {
      status?: number;
    };
    serverError.status = 500;

    await queryClient
      .fetchQuery({
        queryKey: ["accounts", "widget-2"],
        queryFn: async () => {
          throw serverError;
        },
        retry: false,
      })
      .catch(() => {});

    expect(assignMock).not.toHaveBeenCalled();
  });

  it("only redirects once even if two 401s fire back to back", async () => {
    const assignMock = stubLocation("/accounts");
    const { queryClient } = await import("../queryClient");

    await Promise.all([
      queryClient
        .fetchQuery({
          queryKey: ["a"],
          queryFn: async () => {
            throw makeUnauthorizedError();
          },
          retry: false,
        })
        .catch(() => {}),
      queryClient
        .fetchQuery({
          queryKey: ["b"],
          queryFn: async () => {
            throw makeUnauthorizedError();
          },
          retry: false,
        })
        .catch(() => {}),
    ]);

    expect(assignMock).toHaveBeenCalledTimes(1);
  });
});
