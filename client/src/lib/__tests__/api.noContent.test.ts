/**
 * apiCall 204 No Content handling
 *
 * A 204 response carries an EMPTY body, so response.json() rejects with a
 * SyntaxError. Endpoints that answer 204 (e.g. DELETE /api/ai/conversations/:id,
 * api-spec §7.3) must therefore resolve, not throw. This is the additive
 * counterpart to the error.fields passthrough already in apiCall.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiCall, clearCsrfToken } from "../api";

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });

describe("apiCall — empty-body (204) responses", () => {
  beforeEach(() => {
    clearCsrfToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(response: Response): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/csrf-token")) {
          return jsonResponse({ csrfToken: "test-csrf" });
        }
        return response;
      }),
    );
  }

  it("resolves to undefined for a 204 DELETE instead of throwing on an empty body", async () => {
    // A real 204 Response — .json() on this rejects, which is the bug.
    stubFetch(new Response(null, { status: 204 }));

    await expect(
      apiCall<void>("/ai/conversations/abc", { method: "DELETE" }),
    ).resolves.toBeUndefined();
  });

  it("still parses and returns the body for a 200 response", async () => {
    stubFetch(jsonResponse({ success: true, data: { id: "1" } }));

    await expect(apiCall("/things")).resolves.toEqual({
      success: true,
      data: { id: "1" },
    });
  });

  it("still throws a status-carrying error for a failed request", async () => {
    stubFetch(
      jsonResponse(
        { success: false, error: { code: "NOT_FOUND", message: "Gone" } },
        404,
      ),
    );

    await expect(
      apiCall<void>("/ai/conversations/abc", { method: "DELETE" }),
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND", message: "Gone" });
  });
});
