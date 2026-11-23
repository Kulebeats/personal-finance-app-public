import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleLoginApi, handleRegisterApi, handleMfaVerifyApi, handleResetPasswordApi } from "../useAuthHandlers";
import { clearCsrfToken } from "@/lib/csrf";
import { authApi } from "@/lib/api";
import { retireOperationLifetime } from "@/lib/operation-lifetime";
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }

describe("originating auth-transition actions", () => {
  beforeEach(() => { clearCsrfToken(); vi.clearAllMocks(); });
  afterEach(() => { retireOperationLifetime(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it.each(["login", "register", "mfa", "reset"])("broadcasts an unclassified UNAUTHORIZED %s outcome to other tabs", async kind => {
    const broadcast = vi.spyOn(localStorage, "setItem");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/csrf-token"
      ? new Response(JSON.stringify({ csrfToken: "token" }))
      : new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Rejected" } }), { status: 401 })));
    const result = kind === "login" ? await handleLoginApi({ email: "a@example.invalid", password: "wrong", rememberMe: false })
      : kind === "register" ? await handleRegisterApi({ email: "a@example.invalid", username: "synthetic", password: "wrong", fullName: "Synthetic" })
      : kind === "mfa" ? await handleMfaVerifyApi("wrong") : await handleResetPasswordApi("wrong", "NewPassword123!");
    expect(result.success).toBe(false);
    expect(broadcast.mock.calls.filter(([key]) => key === "capital.session.invalidate")).toHaveLength(1);
  });
  it.each(["success", "unknown"])("broadcasts %s login outcome", async outcome => {
    const broadcast = vi.spyOn(localStorage, "setItem");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/csrf-token") return new Response(JSON.stringify({ csrfToken: "token" }));
      if (outcome === "unknown") throw new TypeError("Network response lost");
      return new Response(JSON.stringify({ success: true, data: {} }));
    }));
    await handleLoginApi({ email: "a@example.invalid", password: "pw", rememberMe: false });
    expect(broadcast.mock.calls.filter(([key]) => key === "capital.session.invalidate")).toHaveLength(1);
  });
  it.each([400, 403, 500, 200])("broadcasts unclassified failed login response with HTTP %s", async status => {
    const broadcast = vi.spyOn(localStorage, "setItem");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/csrf-token"
      ? new Response(JSON.stringify({ csrfToken: "token" }))
      : new Response(JSON.stringify({ success: false, error: { code: "UNKNOWN", message: "Rejected" } }), { status })));
    expect(await handleLoginApi({ email: "a@example.invalid", password: "pw", rememberMe: false })).toMatchObject({ success: false });
    expect(broadcast.mock.calls.filter(([key]) => key === "capital.session.invalidate")).toHaveLength(1);
  });
  it("a second login cancels an older login paused before dispatch", async () => {
    const csrf = deferred<Response>(); let tokens = 0; const emails: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/csrf-token") return ++tokens === 1 ? csrf.promise : new Response(JSON.stringify({ csrfToken: "current" }));
      emails.push(JSON.parse(String(init?.body)).email); return new Response(JSON.stringify({ success: true, data: {} }));
    }));
    const first = handleLoginApi({ email: "a@example.test", password: "pw", rememberMe: false });
    await handleLoginApi({ email: "b@example.test", password: "pw", rememberMe: false });
    csrf.resolve(new Response(JSON.stringify({ csrfToken: "old" })));
    expect(await first).toMatchObject({ success: false });
    expect(emails).toEqual(["b@example.test"]);
  });

  it("logout cancels a credential submission still acquiring its CSRF token", async () => {
    const csrf = deferred<Response>(); let tokens = 0; const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/csrf-token") return ++tokens === 1 ? csrf.promise : new Response(JSON.stringify({ csrfToken: "current" }));
      requests.push(url); return new Response(JSON.stringify({ success: true, data: {} }));
    }));
    const login = handleLoginApi({ email: "a@example.test", password: "pw", rememberMe: false });
    await authApi.logout();
    csrf.resolve(new Response(JSON.stringify({ csrfToken: "old" })));
    expect(await login).toMatchObject({ success: false });
    expect(requests).toEqual(["/api/auth/logout"]);
  });
});
