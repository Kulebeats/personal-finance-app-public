/**
 * NEW-07 on the production-mode profile: CSRF is live in the browser.
 *
 * - The app's own write carries the session's CSRF token and is stored. The
 *   same write sent from a second browser context that holds the signed-in
 *   session cookie but not the token (none, or the first context's token
 *   without its CSRF cookie) is refused 403 CSRF_INVALID, and nothing is
 *   written. The second context is genuinely signed in: its read succeeds.
 * - E-mail verification works from a fresh browser that never held the
 *   registering session (the NEW-07 defect: a token bound to the registering
 *   session's anonymous CSRF identity made this 403 everywhere else).
 *
 * The verification token here is planted by its hash, as in
 * journey-first-household.spec.ts: this spec is about CSRF, not delivery.
 * Under NODE_ENV=test CSRF is skipped, so the refusals would be stored writes.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { signInAs } from "./utils/fixture-session";
import { contextFrom, expectProductionProfile } from "./utils/production-profile";

const SESSION_COOKIE = "connect.sid";
const CSRF_HEADER = "x-csrf-token";

interface PageResponse { status: number; body: unknown }

/** A same-origin fetch made by the page itself, so it carries that context's cookies only. */
async function fetchFromPage(page: Page, method: string, path: string, body?: unknown,
  headers: Record<string, string> = {}): Promise<PageResponse> {
  return page.evaluate(async ({ method, path, body, headers }) => {
    const response = await fetch(path, {
      method, credentials: "same-origin",
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as unknown };
  }, { method, path, body, headers });
}

async function accountNamesIn(householdId: string): Promise<string[]> {
  const { rows } = await withFixtureClient((client) => client.query<{ name: string }>(
    "SELECT name FROM accounts WHERE household_id=$1 ORDER BY name", [householdId]));
  return rows.map((row) => row.name);
}

test.beforeEach(async ({ request }) => {
  await expectProductionProfile(request);
});

test("a write from a second browser context without the session's CSRF token is refused", async ({ browser }) => {
  const fixture = await createCompletionFixture();
  const first = await contextFrom(browser, 70);
  const page = await first.newPage();
  await signInAs(page, fixture);

  // The app's own write, through the UI.
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add a new account", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const accountName = `CSRF cash ${randomUUID().slice(0, 8)}`;
  await dialog.getByRole("button", { name: /^Cash Physical Cash$/ }).click();
  await dialog.getByLabel("Account Name", { exact: true }).fill(accountName);
  await dialog.locator("#balance").fill("120.00");
  const created = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/accounts" && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Save Account", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const token = response.request().headers()[CSRF_HEADER];
  expect(token, "the app's write carries its CSRF token").toBeTruthy();
  const sentBody = response.request().postDataJSON() as Record<string, unknown>;
  expect(await accountNamesIn(fixture.householdId)).toEqual([accountName]);

  // A second context holding only the signed-in session cookie.
  const session = (await first.cookies()).find((cookie) => cookie.name === SESSION_COOKIE);
  expect(session, "the first context is signed in").toBeTruthy();
  const second = await contextFrom(browser, 71);
  await second.addCookies([session!]);
  const other = await second.newPage();
  await other.goto("/__test/identity");
  expect((await fetchFromPage(other, "GET", "/api/accounts")).status, "the second context is signed in").toBe(200);

  const noToken = await fetchFromPage(other, "POST", "/api/accounts", { ...sentBody, name: `${accountName} replay` });
  expect(noToken).toEqual({ status: 403, body: { success: false, error: expect.objectContaining({ code: "CSRF_INVALID" }) } });
  const borrowedToken = await fetchFromPage(other, "POST", "/api/accounts",
    { ...sentBody, name: `${accountName} borrowed` }, { [CSRF_HEADER]: token! });
  expect(borrowedToken).toEqual({ status: 403, body: { success: false, error: expect.objectContaining({ code: "CSRF_INVALID" }) } });
  expect(await accountNamesIn(fixture.householdId)).toEqual([accountName]);

  await second.close();
  await first.close();
});

test("e-mail verification works from a fresh browser that never held the registering session", async ({ browser }) => {
  const suffix = `csrf${randomUUID().slice(0, 8)}`;
  const email = `${suffix}@example.invalid`;
  const password = `Synthetic!9-${randomUUID()}`;

  const registering = await contextFrom(browser, 72);
  const page = await registering.newPage();
  await page.goto("/login?mode=register");
  await page.getByLabel("Full Name").fill("CSRF Tester");
  await page.getByLabel("Username").fill(suffix);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
  const registered = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/auth/register" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create Account" }).click();
  expect((await registered).status()).toBe(201);
  await registering.close();

  const token = randomBytes(32).toString("hex");
  const { rows: [user] } = await withFixtureClient((client) => client.query<{ id: string }>(
    `UPDATE users SET email_verification_token=$1, email_verification_expiry=now() + interval '1 hour'
      WHERE email=$2 AND email_verified=false RETURNING id`, [createHash("sha256").update(token).digest("hex"), email]));
  expect(user, "the registration is stored unverified").toBeTruthy();

  const fresh = await contextFrom(browser, 73);
  const visitor = await fresh.newPage();
  const verified = visitor.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/settings/security/email/verify" && response.request().method() === "POST");
  await visitor.goto(`/verify-email?token=${token}`);
  expect((await verified).status()).toBe(200);
  await expect(visitor.getByText("Email Verified!")).toBeVisible();
  const { rows: [stored] } = await withFixtureClient((client) => client.query(
    "SELECT email_verified, email_verification_token FROM users WHERE id=$1", [user.id]));
  expect(stored).toEqual({ email_verified: true, email_verification_token: null });
  await fresh.close();
});
