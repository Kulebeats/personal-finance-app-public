/**
 * Push endpoint guard (OPS-008, spec R16.1).
 *
 * A browser hands us its push endpoint URL and the server later POSTs to it.
 * Unchecked, that is a server-side request forgery primitive (cloud metadata,
 * 10.x, 127.x, [::1], ...). Every endpoint is checked when it is saved and
 * again just before each send:
 *  - `https:` on the default port, no credentials, no IP-literal host;
 *  - the host belongs to a known browser push service (PUSH_SERVICE_HOSTS);
 *  - at connect time every address the host resolves to must be public
 *    (`pushAgent` uses `createSafeLookup`), which closes DNS rebinding.
 * web-push 3.x sends with a single `https.request` and treats any non-2xx
 * (3xx included) as an error, so redirects are never followed.
 *
 * @module services/notification/push-endpoint
 */

import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import { z } from "zod";

/**
 * Hosts of the browser push services we deliver to. `exact` must equal the
 * endpoint host; `suffix` matches any subdomain of the given domain.
 */
export const PUSH_SERVICE_HOSTS = {
  exact: [
    "fcm.googleapis.com", // Google FCM (Chrome, Chromium-based browsers, Android)
    "updates.push.services.mozilla.com", // Mozilla autopush (Firefox)
  ],
  suffix: [
    ".notify.windows.com", // Microsoft WNS (Edge on Windows): regional hosts such as wns2-db5p.notify.windows.com
    ".push.apple.com", // Apple web push (Safari 16+): web.push.apple.com; Apple documents *.push.apple.com
  ],
} as const;

export const MAX_PUSH_ENDPOINT_LENGTH = 2048;
const MAX_PUSH_KEY_LENGTH = 256;
export const PUSH_SEND_TIMEOUT_MS = 10_000;
const PUSH_MAX_SOCKETS = 16;

export type PushEndpointCheck = { ok: true } | { ok: false; reason: string };

function isAllowedPushHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if ((PUSH_SERVICE_HOSTS.exact as readonly string[]).includes(host)) return true;
  return PUSH_SERVICE_HOSTS.suffix.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

/** Pure syntactic + allow-list check. No DNS, no network. */
export function checkPushEndpoint(raw: unknown): PushEndpointCheck {
  if (typeof raw !== "string" || raw.length === 0) return { ok: false, reason: "endpoint missing" };
  if (raw.length > MAX_PUSH_ENDPOINT_LENGTH) return { ok: false, reason: "endpoint too long" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "endpoint is not a URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "endpoint must use https" };
  if (url.port !== "") return { ok: false, reason: "endpoint must use the default port" };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "endpoint must not contain credentials" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) !== 0) return { ok: false, reason: "endpoint host must not be an IP address" };
  if (!isAllowedPushHost(host)) return { ok: false, reason: "endpoint host is not a known push service" };
  return { ok: true };
}

/** Origin only, for logs: never the path or query (they carry the device token). */
export function describePushEndpoint(raw: unknown): string {
  if (typeof raw !== "string") return "<invalid>";
  try {
    return new URL(raw).origin;
  } catch {
    return "<unparseable>";
  }
}

export const pushEndpointSchema = z
  .string()
  .max(MAX_PUSH_ENDPOINT_LENGTH)
  .superRefine((value, ctx) => {
    const check = checkPushEndpoint(value);
    if (!check.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: check.reason });
  });

export const pushSubscribeBodySchema = z.object({
  subscription: z.object({
    endpoint: pushEndpointSchema,
    expirationTime: z.number().nullable().optional(),
    keys: z.object({
      p256dh: z.string().min(1).max(MAX_PUSH_KEY_LENGTH),
      auth: z.string().min(1).max(MAX_PUSH_KEY_LENGTH),
    }),
  }),
});

/** Unsubscribe is not allow-listed: a user must be able to remove an old, now-invalid row. */
export const pushUnsubscribeBodySchema = z.object({
  endpoint: z.string().min(1).max(MAX_PUSH_ENDPOINT_LENGTH),
});

const nonPublicAddresses = (() => {
  const list = new net.BlockList();
  const v4: Array<[string, number]> = [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
    ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
    ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
  ];
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) needs no entry: BlockList checks it
  // against the IPv4 rules above. Listing ::ffff:0:0/96 would block all IPv4.
  const v6: Array<[string, number]> = [
    ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48],
    ["100::", 64], ["2001::", 32], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7],
    ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
  ];
  for (const [address, prefix] of v4) list.addSubnet(address, prefix, "ipv4");
  for (const [address, prefix] of v6) list.addSubnet(address, prefix, "ipv6");
  return list;
})();

export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return false;
  return !nonPublicAddresses.check(address, family === 4 ? "ipv4" : "ipv6");
}

type Resolver = (
  hostname: string,
  options: dns.LookupAllOptions,
  callback: (error: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void,
) => void;

/**
 * A `lookup` for net/tls that resolves every address and refuses the
 * connection when any of them is not a public unicast address.
 */
export function createSafeLookup(resolve: Resolver = dns.lookup): net.LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, []);
      const blocked = addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address));
      if (blocked) {
        const refusal: NodeJS.ErrnoException = new Error("Push endpoint resolves to a non-public address");
        refusal.code = "EPUSHADDR";
        return callback(refusal, []);
      }
      if (options.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

/** The only agent push sends may use: public addresses only, bounded sockets. */
export const pushAgent = new https.Agent({
  lookup: createSafeLookup(),
  maxSockets: PUSH_MAX_SOCKETS,
  timeout: PUSH_SEND_TIMEOUT_MS,
});
