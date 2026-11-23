import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authApi } from "@/lib/api";
import { clearCsrfToken } from "@/lib/csrf";
import { retireOperationLifetime } from "@/lib/operation-lifetime";

/**
 * Signing out stops pushes to this browser: the server removes the
 * subscription registered from the session, and the client unsubscribes the
 * browser's push subscription too, so the push service drops it.
 */
function installPushSubscription() {
  const unsubscribe = vi.fn().mockResolvedValue(true);
  const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue({ endpoint: "https://fcm.googleapis.com/fcm/send/synthetic", unsubscribe }) } };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: vi.fn().mockResolvedValue(registration) },
  });
  return unsubscribe;
}

describe("sign-out and the browser's push subscription", () => {
  beforeEach(() => { clearCsrfToken(); });
  afterEach(() => {
    retireOperationLifetime();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("unsubscribes this browser when sign-out succeeds", async () => {
    const unsubscribe = installPushSubscription();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/csrf-token"
      ? new Response(JSON.stringify({ csrfToken: "token" }))
      : new Response(JSON.stringify({ success: true, data: null }))));

    await authApi.logout();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("signs out normally in a browser without a service worker", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/csrf-token"
      ? new Response(JSON.stringify({ csrfToken: "token" }))
      : new Response(JSON.stringify({ success: true, data: null }))));

    await expect(authApi.logout()).resolves.toBeUndefined();
  });
});
