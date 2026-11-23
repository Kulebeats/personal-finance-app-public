import { test as base, expect, type BrowserContext, type Route } from "@playwright/test";
import { loadTestTarget } from "../server/testing/test-target.mjs";
import { prepareBrowserClient } from "../server/testing/browser-client.mjs";

const origin = loadTestTarget().server?.origin;
if (!origin) throw new Error("Protected browser tests require a manifest server origin");
await prepareBrowserClient(origin);

/** How long a failed fulfil waits for its teardown to become observable. */
const TEARDOWN_EVIDENCE_WAIT_MS = 2_000;
const TEARDOWN_POLL_MS = 50;

/**
 * The browser's own cancellation of a request, per engine: Chromium
 * net::ERR_ABORTED, Firefox NS_BINDING_ABORTED, WebKit "cancelled". Any other
 * failure (including this harness's own blockedbyclient abort) is not
 * teardown evidence.
 */
const CANCELLATION_ERROR = /^net::ERR_ABORTED$|^NS_BINDING_ABORTED$|cancel/i;

/**
 * The only fulfil errors a teardown can cause: the context's fetched response
 * was disposed with it, or the page/context/browser target is closed.
 */
const CLOSED_TARGET_ERROR = /Fetch response has been disposed|Target page, context or browser has been closed/;

/**
 * Evidence that a request has nobody left to receive it: its context closed,
 * the browser cancelled it, its frame detached (navigation away), or its page
 * closed. A request whose frame cannot be read (no frame) is not evidence of
 * anything.
 */
function isTornDown(route: Route, isContextClosed: () => boolean): boolean {
  if (isContextClosed()) return true;
  const request = route.request();
  const failure = request.failure();
  if (failure !== null && CANCELLATION_ERROR.test(failure.errorText)) return true;
  try {
    const frame = request.frame();
    return frame.isDetached() || frame.page().isClosed();
  } catch {
    return false;
  }
}

/** Teardown evidence can trail the fulfil error by a moment; wait briefly for it. */
async function awaitTeardownEvidence(route: Route, isContextClosed: () => boolean): Promise<boolean> {
  const deadline = Date.now() + TEARDOWN_EVIDENCE_WAIT_MS;
  while (!isTornDown(route, isContextClosed)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, TEARDOWN_POLL_MS));
  }
  return true;
}

/**
 * Closed failure categories only: fetch errors can include credentials, query
 * parameters, or request headers in their raw message.
 */
function fetchFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /timeout|timed out/i.test(message) ? "timeout" :
    /ECONNRESET|socket hang up/i.test(message) ? "connection-reset" :
    /ECONNREFUSED/i.test(message) ? "connection-refused" : "fetch-failed";
}

function routeKindOf(route: Route): string {
  const pathname = new URL(route.request().url()).pathname;
  return pathname === "/@vite/client" ? "vite-client" :
    pathname.startsWith("/@fs/") ? "vite-file" :
    pathname.startsWith("/src/") ? "source-module" :
    pathname.startsWith("/api/") ? "api" : "other";
}

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD"]);
/** Dev-server module routes; never "api" or "other". */
const RETRYABLE_ROUTE_KINDS = new Set(["vite-client", "vite-file", "source-module"]);

function isRetryableReset(route: Route, error: unknown): boolean {
  return fetchFailureReason(error) === "connection-reset" &&
    IDEMPOTENT_METHODS.has(route.request().method()) &&
    RETRYABLE_ROUTE_KINDS.has(routeKindOf(route));
}

/**
 * A retried first-attempt failure stays visible: a log line, a GitHub
 * Actions warning annotation (the workflow command must start its own line),
 * and a `fetch-retried` annotation on the running test in the report.
 */
function surfaceRetry(routeKind: string): void {
  const detail = JSON.stringify({ routeKind, reason: "connection-reset" });
  console.error("TEST BROWSER FETCH RETRIED", detail);
  if (process.env.GITHUB_ACTIONS === "true") {
    process.stdout.write(`\n::warning title=E2E dev-module fetch retried::A ${routeKind} GET was reset once and retried\n`);
  }
  let testInfo;
  try {
    testInfo = base.info();
  } catch {
    // No test is running (fixture setup or teardown); the log line and the
    // CI warning above still record the retry.
    return;
  }
  testInfo.annotations.push({ type: "fetch-retried", description: detail });
}

/**
 * Fetches the request from the allowed origin. Browsers bypass route
 * interception for later redirect hops, so ordinary foundation tests refuse
 * redirects (maxRedirects 0) instead of following them.
 *
 * A connection reset on a dev-server module GET is retried once: the fetch
 * can pick up a pooled keep-alive socket the dev server has just closed after
 * an idle gap between tests, and denying a module request for that leaves the
 * app unmounted (a blank page). An API request is never retried, so an API
 * reset still fails the gate; a write is never retried; a second reset is
 * denied like any other failure.
 */
async function fetchAllowed(route: Route) {
  try {
    return await route.fetch({ maxRedirects: 0 });
  } catch (error) {
    if (!isRetryableReset(route, error)) throw error;
    surfaceRetry(routeKindOf(route));
    return route.fetch({ maxRedirects: 0 });
  }
}

async function protectContext(context: BrowserContext) {
  let isClosed = false;
  context.on("close", () => { isClosed = true; });
  const isContextClosed = () => isClosed;
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== origin) return route.abort("blockedbyclient");
    let response;
    const startedAt = Date.now();
    try {
      response = await fetchAllowed(route);
    } catch (error) {
      console.error("TEST BROWSER FETCH DENIED", JSON.stringify({
        routeKind: routeKindOf(route),
        reason: fetchFailureReason(error), elapsedMs: Date.now() - startedAt,
      }));
      return route.abort("blockedbyclient");
    }
    if ([301, 302, 303, 307, 308].includes(response.status())) {
      console.error("TEST BROWSER REDIRECT DENIED: ordinary foundation profile does not support HTTP redirects");
      return route.abort("blockedbyclient");
    }
    try {
      await route.fulfill({ response });
    } catch (error) {
      // Dropped only when the error is the closed-target/disposed-response
      // error AND there is proof nobody is left to deliver it to (the context
      // closed, the browser cancelled the request, its frame detached or its
      // page closed). The request was already fetched from the allowed origin
      // only, so dropping it denies nothing. Any other fulfil error, or one
      // without that proof, is a real harness failure and is rethrown.
      const message = error instanceof Error ? error.message : "";
      if (CLOSED_TARGET_ERROR.test(message) && await awaitTeardownEvidence(route, isContextClosed)) return;
      throw error;
    }
  });
  await context.routeWebSocket("**/*", (socket) => {
    const url = new URL(socket.url());
    url.protocol = url.protocol === "ws:" ? "http:" : "https:";
    if (url.origin === origin) socket.connectToServer();
    else socket.close();
  });
}

export const test = base.extend({
  browser: async ({ browser }, use) => {
    const newContext = browser.newContext.bind(browser);
    const newPage = browser.newPage.bind(browser);
    browser.newContext = async (options) => {
      const context = await newContext({ ...options, serviceWorkers: "block" });
      await protectContext(context);
      return context;
    };
    browser.newPage = async (options) => {
      const page = await newPage({ ...options, serviceWorkers: "block" });
      await protectContext(page.context());
      return page;
    };
    try { await use(browser); }
    finally { browser.newContext = newContext; browser.newPage = newPage; }
  },
});
export { expect };
export type { Page } from "@playwright/test";
