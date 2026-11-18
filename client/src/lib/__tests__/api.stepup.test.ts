import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  accountsApi,
  securityApi,
  registerStepUpHandler,
  clearCsrfToken,
} from "../api";

describe("apiCall step-up retry", () => {
  beforeEach(() => {
    registerStepUpHandler(null);
    clearCsrfToken();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    registerStepUpHandler(null);
    vi.unstubAllGlobals();
  });

  it("prompts for step-up on 401 and retries the original request", async () => {
    let deleteCalls = 0;
    let stepUpCalls = 0;

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      if (url.includes("/api/csrf-token")) {
        return new Response(JSON.stringify({ csrfToken: "test-token" }), {
          status: 200,
        });
      }
      if (url.includes("/api/settings/security/step-up")) {
        stepUpCalls++;
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (url.includes("/api/accounts/acc-1") && method === "DELETE") {
        deleteCalls++;
        if (deleteCalls === 1) {
          return new Response(
            JSON.stringify({
              success: false,
              error: { code: "STEP_UP_REQUIRED", message: "needs step-up" },
              requiresStepUp: true,
              level: "DESTRUCTIVE",
            }),
            { status: 401 },
          );
        }
        return new Response(
          JSON.stringify({ success: true, data: { message: "deleted" } }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let promptedLevel: string | null = null;
    registerStepUpHandler(async (level) => {
      promptedLevel = level;
      await securityApi.stepUp({ password: "pw" });
      return true;
    });

    await expect(accountsApi.delete("acc-1")).resolves.toBeUndefined();

    expect(promptedLevel).toBe("DESTRUCTIVE");
    expect(stepUpCalls).toBe(1);
    expect(deleteCalls).toBe(2); // original + retry
  });

  it("does not retry when the user cancels step-up", async () => {
    let deleteCalls = 0;

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      if (url.includes("/api/csrf-token")) {
        return new Response(JSON.stringify({ csrfToken: "t" }), { status: 200 });
      }
      if (url.includes("/api/accounts/acc-1") && method === "DELETE") {
        deleteCalls++;
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: "STEP_UP_REQUIRED", message: "needs step-up" },
            requiresStepUp: true,
            level: "DESTRUCTIVE",
          }),
          { status: 401 },
        );
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    registerStepUpHandler(async () => false); // user cancels

    await expect(accountsApi.delete("acc-1")).rejects.toMatchObject({
      code: "STEP_UP_REQUIRED",
      status: 401,
    });
    expect(deleteCalls).toBe(1); // no retry
  });
});
