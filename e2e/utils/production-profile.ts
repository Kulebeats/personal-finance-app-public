/**
 * Shared steps for the production-mode profile specs (playwright.production.config.ts,
 * server/testing/production-profile.ts).
 */
import type { APIRequestContext, Browser, BrowserContext } from "@playwright/test";
import { expect } from "../protected-test";

/**
 * Fails unless the running app has left test mode, so a spec in this profile
 * can never pass against a server whose CSRF and limiters skip themselves.
 */
export async function expectProductionProfile(request: APIRequestContext): Promise<void> {
  const response = await request.get("/__test/profile");
  expect(response.status(), "the server is not running the production-mode profile").toBe(200);
  expect(await response.json()).toEqual({ profile: "production", nodeEnv: "development", client: "built", trustProxy: "1" });
}

/**
 * A browser context with its own client address. The profile trusts one proxy
 * hop (TRUST_PROXY=1, as in production), so the per-IP credential limiter keys
 * each context by this header and one spec cannot spend another's budget.
 * Addresses are from TEST-NET-3 (RFC 5737), reserved for documentation.
 */
export async function contextFrom(browser: Browser, lastOctet: number): Promise<BrowserContext> {
  return browser.newContext({ extraHTTPHeaders: { "X-Forwarded-For": `203.0.113.${lastOctet}` } });
}
