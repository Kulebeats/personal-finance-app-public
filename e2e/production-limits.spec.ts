/**
 * NEW-08 on the production-mode profile: the limiters are live in the browser.
 *
 * - Ordinary signed-in navigation across the primary pages is never answered
 *   429, its API responses carry the general tier (600 per minute), and the
 *   session reads the app makes on every page carry that tier too, not the
 *   credential tier.
 * - The per-IP credential limiter (10 per minute) answers the eleventh sign-in
 *   attempt from one address with 429 and Retry-After, the sign-in page says
 *   so, and another address is still answered normally.
 *
 * Under NODE_ENV=test every limiter skips itself, so both tests fail there:
 * there are no RateLimit headers and no 429 (and expectProductionProfile
 * refuses that server first).
 */
import { randomUUID } from "node:crypto";
import type { Page, Response } from "@playwright/test";
import { test, expect } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { signInAs } from "./utils/fixture-session";
import { contextFrom, expectProductionProfile } from "./utils/production-profile";

const PRIMARY_PAGES = ["/", "/transactions", "/accounts", "/budget", "/goals", "/reports", "/settings", "/"];
const GENERAL_LIMIT = "600";
const CREDENTIAL_LIMIT = 10;
const INVALID_CREDENTIALS = "Invalid email or password.";
const RATE_LIMITED_COPY = "Too many attempts. Wait a few minutes and try again.";
/** Enough API traffic that "no 429" is about real navigation, not an idle page. */
const MIN_API_RESPONSES = 20;

interface ApiResponse { path: string; status: number; limit: string | undefined }

function recordApi(page: Page): ApiResponse[] {
  const seen: ApiResponse[] = [];
  page.on("response", (response) => {
    const { pathname } = new URL(response.url());
    if (pathname.startsWith("/api/")) {
      seen.push({ path: pathname, status: response.status(), limit: response.headers()["ratelimit-limit"] });
    }
  });
  return seen;
}

async function attemptSignIn(page: Page, email: string): Promise<Response> {
  const response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname === "/api/auth/login" && candidate.request().method() === "POST");
  await page.getByLabel(/email/i).fill(email);
  await page.getByPlaceholder(/enter your password/i).fill(`Wrong!9-${randomUUID()}`);
  await page.getByRole("button", { name: /sign in/i }).click();
  return response;
}

/** Sign-in failures are sonner toasts, which stack, so match the first toast with this copy. */
function toast(page: Page, copy: string) {
  return page.locator("[data-sonner-toast]").filter({ hasText: copy }).first();
}

test.beforeEach(async ({ request }) => {
  await expectProductionProfile(request);
});

test("ordinary signed-in navigation is never rate limited, and session reads use the general tier", async ({ browser }) => {
  const fixture = await createCompletionFixture();
  const context = await contextFrom(browser, 80);
  const page = await context.newPage();
  await signInAs(page, fixture);
  const responses = recordApi(page);

  for (const path of PRIMARY_PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }

  expect(responses.length).toBeGreaterThanOrEqual(MIN_API_RESPONSES);
  expect(responses.filter((response) => response.status === 429)).toEqual([]);
  // The general limiter is live on the API (express-rate-limit draft-6 headers).
  expect(responses.filter((response) => response.limit === GENERAL_LIMIT).length).toBeGreaterThan(0);
  const sessionReads = responses.filter((response) => response.path === "/api/auth/session");
  expect(sessionReads.length).toBeGreaterThan(0);
  expect(sessionReads.map((response) => response.limit)).toEqual(sessionReads.map(() => GENERAL_LIMIT));
  await context.close();
});

test("the eleventh sign-in attempt from one address is answered 429 and the page says so", async ({ browser }) => {
  const context = await contextFrom(browser, 81);
  const page = await context.newPage();
  await page.goto("/login");
  const unknownEmail = `limit-${randomUUID().slice(0, 8)}@example.invalid`;

  for (let attempt = 1; attempt <= CREDENTIAL_LIMIT; attempt += 1) {
    const response = await attemptSignIn(page, unknownEmail);
    expect(response.status(), `attempt ${attempt}`).toBe(401);
    expect(response.headers()["ratelimit-limit"]).toBe(String(CREDENTIAL_LIMIT));
    await expect(toast(page, INVALID_CREDENTIALS)).toBeVisible();
  }

  const limited = await attemptSignIn(page, unknownEmail);
  expect(limited.status()).toBe(429);
  expect(limited.headers()["retry-after"]).toBe("60");
  expect(await limited.json()).toMatchObject({ success: false, error: { code: "RATE_LIMITED" } });
  await expect(toast(page, RATE_LIMITED_COPY)).toBeVisible();

  // The budget is per address: another client is still answered normally.
  const other = await contextFrom(browser, 82);
  const otherPage = await other.newPage();
  await otherPage.goto("/login");
  expect((await attemptSignIn(otherPage, unknownEmail)).status()).toBe(401);
  await expect(toast(otherPage, INVALID_CREDENTIALS)).toBeVisible();
  await other.close();
  await context.close();
});
