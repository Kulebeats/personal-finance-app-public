import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiCall, authApi, securityApi } from "../api";
import { apiRequest } from "../queryClient";
import { protectedFetch } from "../protected-fetch";
import { activateOperationLifetime, captureOperationLifetime, createOperationLifetime, retireOperationLifetime } from "../operation-lifetime";
import { clearCsrfToken, getCsrfToken } from "../csrf";

const subjectA = "00000000-0000-4000-8000-000000000001";
const subjectB = "00000000-0000-4000-8000-000000000002";
const householdA = "00000000-0000-4000-8000-000000000003";
const householdB = "00000000-0000-4000-8000-000000000004";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe("immutable cookie-context preconditions", () => {
  beforeEach(() => clearCsrfToken());
  afterEach(() => { retireOperationLifetime(); vi.unstubAllGlobals(); });

  it.each(["step-up", "password", "delete-account", "mfa/disable", "email/change"])("keeps the UI lifetime after %s credential rejection", async endpoint => {
    const operation = createOperationLifetime({ subject: subjectA, household: householdA });
    activateOperationLifetime(operation);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/csrf-token"
      ? json({ csrfToken: "token" }) : json({ error: { code: "INVALID_CREDENTIALS", message: "Invalid password" } }, 401)));
    const call = endpoint === "step-up" ? securityApi.stepUp({ password: "wrong" })
      : endpoint === "password" ? securityApi.changePassword({ currentPassword: "wrong", newPassword: "New123!", confirmPassword: "New123!" })
      : apiCall(`/settings/security/${endpoint}`, { method: "POST", body: JSON.stringify({ password: "wrong" }) });
    await expect(call).rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
    expect(operation.active).toBe(true);
    expect(captureOperationLifetime()).toBe(operation);
  });

  it.each(["UNAUTHORIZED", "UNAUTHENTICATED", undefined])("retires context-bound lifetime for lost authority (%s)", async code => {
    const operation = createOperationLifetime({ subject: subjectA }); activateOperationLifetime(operation);
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code, message: "Sign in again" } }, 401)));
    await expect(protectedFetch("/api/accounts")).rejects.toMatchObject({ status: 401 });
    expect(operation.active).toBe(false);
  });

  it.each(["apiCall", "apiRequest", "protected read"])("%s retains A/H1 when ambient cookie changes before a cross-tab notification", async transport => {
    const expected = { subject: subjectA, household: householdA };
    activateOperationLifetime(createOperationLifetime(expected));
    // Simulate cookie replacement without any local invalidation signal.
    expected.subject = subjectB; expected.household = householdB;
    const headers: Headers[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/csrf-token") return json({ csrfToken: "current-cookie-token" });
      headers.push(new Headers(init?.headers));
      return json({ error: { code: "SESSION_CONTEXT_CHANGED", message: "Your session context changed. Please submit again." } }, 409);
    }));
    const promise = transport === "apiCall" ? apiCall("/accounts", { method: "POST" }) : transport === "apiRequest" ? apiRequest("POST", "/api/accounts") : protectedFetch("/api/accounts");
    await expect(promise).rejects.toMatchObject({ status: 409, code: "SESSION_CONTEXT_CHANGED" });
    expect(headers).toHaveLength(1);
    expect(headers[0].get("X-Capital-Subject")).toBe(subjectA);
    expect(headers[0].get("X-Capital-Household")).toBe(householdA);
  });

  it("retains original preconditions through CSRF_INVALID retry", async () => {
    activateOperationLifetime(createOperationLifetime({ subject: subjectA, household: householdA }));
    const sends: Headers[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/csrf-token") return json({ csrfToken: "token" });
      sends.push(new Headers(init?.headers));
      return sends.length === 1 ? json({ error: { code: "CSRF_INVALID" } }, 403) : json({ success: true });
    }));
    await apiCall("/accounts", { method: "POST" });
    expect(sends).toHaveLength(2);
    for (const headers of sends) { expect(headers.get("X-Capital-Subject")).toBe(subjectA); expect(headers.get("X-Capital-Household")).toBe(householdA); }
  });

  it("pending subject calls send only the immutable subject", async () => {
    activateOperationLifetime(createOperationLifetime({ subject: subjectA }));
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ success: true })); vi.stubGlobal("fetch", fetcher);
    await apiCall("/settings/security/email/resend");
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.get("X-Capital-Subject")).toBe(subjectA);
    expect(headers.has("X-Capital-Household")).toBe(false);
  });

  it("keeps the originating subject precondition during logout's intentional pause", async () => {
    activateOperationLifetime(createOperationLifetime({ subject: subjectA, household: householdA }));
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => String(input) === "/api/csrf-token" ? json({ csrfToken: "token" }) : json({ success: true }));
    vi.stubGlobal("fetch", fetcher);
    await authApi.logout();
    const call = fetcher.mock.calls.find(([input]) => String(input) === "/api/auth/logout");
    expect(new Headers(call?.[1]?.headers).get("X-Capital-Subject")).toBe(subjectA);
  });

  it("does not let a delayed old 409 body invalidate a replacement lifetime", async () => {
    activateOperationLifetime(createOperationLifetime({ subject: subjectA }));
    let release!: (body: unknown) => void;
    const body = new Promise<unknown>(resolve => { release = resolve; });
    const response = json({}, 409);
    const clone = vi.spyOn(response, "clone").mockReturnValue({ json: () => body } as Response);
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const pending = protectedFetch("/api/accounts");
    const rejected = expect(pending).rejects.toThrow(/session changed/i);
    await vi.waitFor(() => expect(clone).toHaveBeenCalled());
    const replacement = createOperationLifetime({ subject: subjectB }); activateOperationLifetime(replacement);
    release({ error: { code: "SESSION_CONTEXT_CHANGED", message: "Old context" } });
    await rejected;
    expect(captureOperationLifetime()).toBe(replacement);
    expect(replacement.active).toBe(true);
  });

  it("does not clear a replacement CSRF cache after delayed old error parsing", async () => {
    activateOperationLifetime(createOperationLifetime({ subject: subjectA }));
    let release!: (body: unknown) => void;
    const body = new Promise<unknown>(resolve => { release = resolve; });
    const response = json({}, 403); let tokens = 0;
    const clone = vi.spyOn(response, "clone").mockReturnValue({ json: () => body } as Response);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/csrf-token" ? json({ csrfToken: `token-${++tokens}` }) : response));
    const pending = apiRequest("POST", "/api/accounts");
    const rejected = expect(pending).rejects.toThrow(/session changed/i);
    await vi.waitFor(() => expect(clone).toHaveBeenCalled());
    activateOperationLifetime(createOperationLifetime({ subject: subjectB })); clearCsrfToken();
    await getCsrfToken();
    release({ error: { code: "CSRF_INVALID" } }); await rejected;
    expect(await getCsrfToken()).toBe("token-2");
    expect(tokens).toBe(2);
  });
});
