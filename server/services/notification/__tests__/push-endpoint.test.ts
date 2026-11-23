// OPS-008 / R16.1: endpoint guard, connect-time address check, and the send
// path skipping a stored bad endpoint without touching the network.
import type dns from "node:dns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendNotification, warn, subscriptions } = vi.hoisted(() => ({
  sendNotification: vi.fn(), warn: vi.fn(), subscriptions: vi.fn(),
}));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification } }));
vi.mock("../../../db", () => ({ db: { select: () => ({ from: () => ({ where: subscriptions }) }) } }));
// The stored-row and live-session checks are real-DB tests (push-subscription-revocation).
vi.mock("../push-subscriptions", () => ({ isDispatchableSubscription: vi.fn().mockResolvedValue(true), saveSessionSubscription: vi.fn() }));
vi.mock("../../../utils/logger", () => ({ logger: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() } }));

import { checkPushEndpoint, createSafeLookup, describePushEndpoint, isPublicAddress, pushAgent } from "../push-endpoint";
import { PushNotificationService } from "../push";

const keys = { p256dh: "synthetic-p256dh", auth: "synthetic-auth" };

describe("checkPushEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://wns2-db5p.notify.windows.com/w/?token=abc",
    "https://web.push.apple.com/abc",
    "https://FCM.googleapis.com:443/fcm/send/abc",
  ])("accepts %s", (endpoint) => {
    expect(checkPushEndpoint(endpoint)).toEqual({ ok: true });
  });

  it.each([
    ["http://169.254.169.254/x", "https"],
    ["https://10.0.0.5/x", "IP address"],
    ["https://[::1]/x", "IP address"],
    ["https://localhost/x", "known push service"],
    ["https://evil.example/x", "known push service"],
    ["https://notify.windows.com.evil.example/x", "known push service"],
    ["https://.notify.windows.com/x", "known push service"],
    ["https://fcm.googleapis.com:8443/x", "default port"],
    ["https://a:b@fcm.googleapis.com/x", "credentials"],
    ["not a url", "not a URL"],
  ])("rejects %s", (endpoint, reason) => {
    const check = checkPushEndpoint(endpoint);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain(reason);
  });

  it("logs the origin only", () => {
    expect(describePushEndpoint("https://fcm.googleapis.com/fcm/send/secret-token?x=1")).toBe("https://fcm.googleapis.com");
  });
});

describe("connect-time address check", () => {
  it.each(["127.0.0.1", "10.1.2.3", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1"])(
    "treats %s as non-public", (address) => expect(isPublicAddress(address)).toBe(false));

  it.each(["142.250.185.10", "2a00:1450:4001:80b::200a"])("treats %s as public", (address) => expect(isPublicAddress(address)).toBe(true));

  const resolverFor = (addresses: dns.LookupAddress[]) =>
    (_host: string, _options: dns.LookupAllOptions, callback: (error: NodeJS.ErrnoException | null, result: dns.LookupAddress[]) => void) => callback(null, addresses);

  it("refuses a host that resolves to any private address (DNS rebinding)", async () => {
    const lookup = createSafeLookup(resolverFor([{ address: "142.250.185.10", family: 4 }, { address: "10.0.0.5", family: 4 }]));
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => lookup("fcm.googleapis.com", {}, (err) => resolve(err)));
    expect(error?.code).toBe("EPUSHADDR");
  });

  it("passes public addresses through in both callback shapes", async () => {
    const lookup = createSafeLookup(resolverFor([{ address: "142.250.185.10", family: 4 }]));
    const single = await new Promise<unknown[]>((resolve) => lookup("fcm.googleapis.com", {}, (...args) => resolve(args)));
    expect(single).toEqual([null, "142.250.185.10", 4]);
    const all = await new Promise<unknown[]>((resolve) => lookup("fcm.googleapis.com", { all: true }, (...args) => resolve(args)));
    expect(all).toEqual([null, [{ address: "142.250.185.10", family: 4 }]]);
  });
});

describe("PushNotificationService.sendPushNotification", () => {
  beforeEach(() => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "synthetic-public");
    vi.stubEnv("VAPID_PRIVATE_KEY", "synthetic-private");
    sendNotification.mockReset().mockResolvedValue({});
    subscriptions.mockReset().mockResolvedValue([]);
    warn.mockReset();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("skips a stored bad endpoint, never calls the network, logs no path, and disables the row", async () => {
    const service = new PushNotificationService();
    const bad = "http://169.254.169.254/latest/meta-data/secret-path?q=1";
    vi.spyOn(service, "getUserSubscriptions").mockResolvedValue([{ endpoint: bad, keys }]);
    const remove = vi.spyOn(service, "removeSubscription").mockResolvedValue();

    expect(await service.sendPushNotification("user-1", "budget_exceeded", "t", "b")).toBe(false);

    expect(sendNotification).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith(bad, "user-1");
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("http://169.254.169.254");
    expect(logged).not.toContain("secret-path");
    expect(logged).not.toContain("q=1");
  });

  it("sends a valid endpoint through the guarded agent with a timeout", async () => {
    const service = new PushNotificationService();
    const good = "https://fcm.googleapis.com/fcm/send/abc";
    vi.spyOn(service, "getUserSubscriptions").mockResolvedValue([{ endpoint: good, keys }]);

    expect(await service.sendPushNotification("user-1", "budget_exceeded", "t", "b")).toBe(true);

    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0][0]).toEqual({ endpoint: good, keys });
    expect(sendNotification.mock.calls[0][2]).toMatchObject({ agent: pushAgent, timeout: expect.any(Number) });
  });

  it("refuses to save a bad endpoint even when called past the controller", async () => {
    const service = new PushNotificationService();
    await expect(service.saveSubscription("user-1", "synthetic-sid", { endpoint: "https://10.0.0.5/x", keys })).rejects.toMatchObject({ statusCode: 400 });
  });

  const device = (id: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys });
  const scheduledPush = (service: PushNotificationService, authorize?: () => Promise<boolean>) =>
    Reflect.apply(service.sendPushDetailed, service, [
      "user-1", "recurring_due", "t", "b", undefined, authorize, { retryBeforeDispatch: true },
    ]);

  it("treats a subscription read and first device authorization fault as definite pre-dispatch failures", async () => {
    const service = new PushNotificationService();
    subscriptions.mockRejectedValueOnce(new Error("Synthetic subscription lookup failed")).mockResolvedValue([device("first")]);
    await expect(scheduledPush(service)).resolves.toMatchObject({ status: "failed", reason: "pre_dispatch_failed" });
    const authorize = vi.fn().mockRejectedValueOnce(new Error("Synthetic authorization failure")).mockResolvedValue(true);
    await expect(scheduledPush(service, authorize)).resolves.toMatchObject({ status: "failed", reason: "pre_dispatch_failed" });
    expect(sendNotification).not.toHaveBeenCalled();
    await expect(scheduledPush(service, authorize)).resolves.toMatchObject({ status: "sent" });
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it.each(["sent", "unknown", "failed"] as const)("preserves %s when a later device authorization faults", async outcome => {
    const service = new PushNotificationService();
    subscriptions.mockResolvedValue([device("first"), device("second")]);
    const authorize = vi.fn().mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("Synthetic authorization failure"));
    if (outcome === "unknown") sendNotification.mockRejectedValueOnce(new Error("Synthetic lost response"));
    if (outcome === "failed") sendNotification.mockRejectedValueOnce(Object.assign(new Error("Synthetic rejected response"), { statusCode: 503 }));

    await expect(scheduledPush(service, authorize)).resolves.toMatchObject({
      status: outcome, ...(outcome === "failed" ? { reason: "push_rejected" } : {}),
    });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0][0]).toEqual(device("first"));
  });
});
