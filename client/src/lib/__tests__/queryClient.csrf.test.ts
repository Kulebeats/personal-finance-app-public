/**
 * apiRequest CSRF behavior
 *
 * The server enforces double-submit CSRF (csrf-csrf) on every mutating route,
 * so apiRequest — like apiCall in lib/api.ts — must attach x-csrf-token on
 * POST/PUT/PATCH/DELETE. Without it every mutation on this path (GRZ bond/
 * T-bill/coupon recording, filter presets, investments) is rejected 403.
 *
 * The CSRF token fetch is served transparently by the fetch stub (PR #54
 * pattern) so it never consumes queued per-test responses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiRequest } from "../queryClient";
import { clearCsrfToken } from "@/lib/api";

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

const headerOf = (init: RequestInit | undefined, name: string) =>
  (init?.headers as Record<string, string> | undefined)?.[name];

describe("apiRequest CSRF handling", () => {
  const calls: RecordedCall[] = [];
  let csrfFetches = 0;
  let nextResponses: Response[] = [];

  beforeEach(() => {
    calls.length = 0;
    csrfFetches = 0;
    nextResponses = [];
    clearCsrfToken();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/api/csrf-token")) {
          csrfFetches += 1;
          return jsonResponse({ csrfToken: `csrf-${csrfFetches}` });
        }
        calls.push({ url, init });
        return (
          nextResponses.shift() ?? jsonResponse({ success: true, data: {} })
        );
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "attaches x-csrf-token to %s requests",
    async (method) => {
      await apiRequest(method, "/api/things", { a: 1 });

      expect(calls).toHaveLength(1);
      expect(headerOf(calls[0].init, "x-csrf-token")).toBe("csrf-1");
    },
  );

  it("does not attach x-csrf-token to GET requests", async () => {
    await apiRequest("GET", "/api/things");

    expect(calls).toHaveLength(1);
    expect(headerOf(calls[0].init, "x-csrf-token")).toBeUndefined();
    expect(csrfFetches).toBe(0);
  });

  it("keeps the JSON content-type only when a body is present", async () => {
    await apiRequest("POST", "/api/things", { a: 1 });
    await apiRequest("DELETE", "/api/things/1");

    expect(headerOf(calls[0].init, "Content-Type")).toBe("application/json");
    expect(calls[0].init?.body).toBe(JSON.stringify({ a: 1 }));
    expect(headerOf(calls[1].init, "Content-Type")).toBeUndefined();
    expect(calls[1].init?.body).toBeUndefined();
    expect(calls[1].init?.credentials).toBe("include");
  });

  it("reuses the cached token across mutations", async () => {
    await apiRequest("POST", "/api/things", { a: 1 });
    await apiRequest("POST", "/api/things", { b: 2 });

    expect(csrfFetches).toBe(1);
    expect(headerOf(calls[1].init, "x-csrf-token")).toBe("csrf-1");
  });

  it("retries once with a fresh token when the server rejects with CSRF_INVALID", async () => {
    nextResponses.push(
      jsonResponse(
        {
          success: false,
          error: { code: "CSRF_INVALID", message: "invalid csrf token" },
        },
        403,
      ),
    );

    const res = await apiRequest("POST", "/api/things", { a: 1 });

    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(headerOf(calls[0].init, "x-csrf-token")).toBe("csrf-1");
    expect(headerOf(calls[1].init, "x-csrf-token")).toBe("csrf-2");
  });

  it("does not retry non-CSRF 403s", async () => {
    nextResponses.push(
      jsonResponse(
        { success: false, error: { code: "FORBIDDEN", message: "Forbidden" } },
        403,
      ),
    );

    await expect(apiRequest("POST", "/api/things", { a: 1 })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN", message: "Forbidden" });
    expect(calls).toHaveLength(1);
  });
});
