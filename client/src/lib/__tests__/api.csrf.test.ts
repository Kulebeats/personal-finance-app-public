/**
 * apiCall CSRF + FormData behavior
 *
 * Every mutating request (POST/PUT/DELETE/PATCH) must carry the x-csrf-token
 * header — server/app.ts enforces CSRF outside NODE_ENV=test, so a missing
 * header 403s in any real browser session. FormData bodies must NOT get a
 * JSON content-type: the browser has to set multipart/form-data with its own
 * boundary.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiCall, authApi, clearCsrfToken } from "../api";

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

const headerOf = (init: RequestInit | undefined, name: string) =>
  (init?.headers as Record<string, string> | undefined)?.[name];

describe("apiCall CSRF + FormData handling", () => {
  const calls: RecordedCall[] = [];

  beforeEach(() => {
    calls.length = 0;
    clearCsrfToken();
    // Serve the CSRF token fetch transparently; record every other call.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/api/csrf-token")) {
          return jsonResponse({ csrfToken: "test-csrf" });
        }
        calls.push({ url, init });
        return jsonResponse({ success: true, data: {} });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches x-csrf-token and a JSON content-type to mutating JSON requests", async () => {
    await apiCall("/things", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/things");
    expect(headerOf(calls[0].init, "x-csrf-token")).toBe("test-csrf");
    expect(headerOf(calls[0].init, "Content-Type")).toBe("application/json");
    expect(calls[0].init?.credentials).toBe("include");
  });

  it("does not attach x-csrf-token to GET requests", async () => {
    await apiCall("/things");

    expect(calls).toHaveLength(1);
    expect(headerOf(calls[0].init, "x-csrf-token")).toBeUndefined();
  });

  it("sends FormData bodies without a JSON content-type but with x-csrf-token", async () => {
    const formData = new FormData();
    formData.append("file", new File(["x"], "receipt.png", { type: "image/png" }));

    await apiCall("/receipts/upload", { method: "POST", body: formData });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/receipts/upload");
    expect(calls[0].init?.body).toBe(formData);
    expect(headerOf(calls[0].init, "x-csrf-token")).toBe("test-csrf");
    expect(headerOf(calls[0].init, "Content-Type")).toBeUndefined();
  });

  it("preserves caller-supplied headers alongside the CSRF header", async () => {
    const formData = new FormData();

    await apiCall("/receipts/upload", {
      method: "POST",
      body: formData,
      headers: { "x-idempotency-key": "idem-1" },
    });

    expect(headerOf(calls[0].init, "x-idempotency-key")).toBe("idem-1");
    expect(headerOf(calls[0].init, "x-csrf-token")).toBe("test-csrf");
  });

  it("logs out through apiCall with x-csrf-token", async () => {
    await authApi.logout();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/auth/logout");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.credentials).toBe("include");
    expect(headerOf(calls[0].init, "x-csrf-token")).toBe("test-csrf");
    expect(headerOf(calls[0].init, "Content-Type")).toBe("application/json");
  });
});
