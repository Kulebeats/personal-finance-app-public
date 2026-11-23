import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PushNotificationSetup } from "../PushNotificationSetup";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";
import { clearCsrfToken } from "@/lib/csrf";

/**
 * A browser that already holds a push subscription sends it to the server
 * again when the settings page loads, so the server row is bound to this
 * session (after an expiry, a new sign-in, or a row saved before sessions
 * were recorded). The page says push is on only once the server has it.
 */
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/synthetic-resend";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

function installBrowserSubscription() {
  const subscription = { endpoint: ENDPOINT, toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "p256dh-synthetic", auth: "auth-synthetic" } }) };
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => subscription } }) } });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", { permission: "granted", requestPermission: async () => "granted" });
}

function stubServer(subscribeStatus: number) {
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    if (String(input) === "/api/csrf-token") return json({ csrfToken: "token" });
    return subscribeStatus === 200
      ? json({ success: true, data: null })
      : json({ success: false, error: { code: "INTERNAL", message: "Synthetic failure" } }, subscribeStatus);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

const subscribeCalls = (fetcher: ReturnType<typeof stubServer>) =>
  fetcher.mock.calls.filter(([input]) => String(input) === "/api/notifications/push/subscribe");

describe("the settings page re-sends this browser's push subscription", () => {
  beforeEach(() => { clearCsrfToken(); activateOperationLifetime(createOperationLifetime()); });
  afterEach(() => { cleanup(); retireOperationLifetime(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("posts the existing subscription to the server and then shows push as on", async () => {
    installBrowserSubscription();
    const fetcher = stubServer(200);

    render(<PushNotificationSetup />);

    await waitFor(() => expect(subscribeCalls(fetcher)).toHaveLength(1));
    const [, init] = subscribeCalls(fetcher)[0];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body)).subscription.endpoint).toBe(ENDPOINT);
    expect(await screen.findByText("Active")).toBeInTheDocument();
  });

  it("does not say push is on when the server did not take the subscription", async () => {
    installBrowserSubscription();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = stubServer(500);

    render(<PushNotificationSetup />);

    await waitFor(() => expect(subscribeCalls(fetcher)).toHaveLength(1));
    expect(await screen.findByRole("button", { name: "Subscribe" })).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });
});
