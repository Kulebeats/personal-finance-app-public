/**
 * AH-03 on the production-mode profile: the links the app actually mails work.
 *
 * The app sends through its real SMTP path to the profile's loopback sink
 * (server/testing/smtp-sink.ts). Each spec reads the message addressed to its
 * synthetic user, takes the one link in it, opens that link in a fresh browser
 * context that never held the requesting session, and reads the result back
 * from the database. Nothing here writes a token: the database only ever holds
 * the hash of the token that was mailed.
 */
import { createHash, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { extractAuthLink, type AuthLinkPath } from "../server/testing/mail-link";
import type { CapturedMail } from "../server/testing/smtp-sink";
import { contextFrom, expectProductionProfile } from "./utils/production-profile";
import { loadTestTarget } from "../server/testing/test-target.mjs";

const MAIL_WAIT_MS = 15_000;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const origin = loadTestTarget().server!.origin;

function linkIn(mail: CapturedMail, path: AuthLinkPath): URL | undefined {
  try { return extractAuthLink(mail.raw, origin, path); } catch { return undefined; }
}

/** The link of `path` in the one message of that kind mailed to `email`; waits for it to arrive. */
async function mailedLink(request: APIRequestContext, email: string, path: AuthLinkPath): Promise<URL> {
  let links: URL[] = [];
  await expect.poll(async () => {
    const { messages } = await (await request.get("/__test/mail")).json() as { messages: CapturedMail[] };
    links = messages.filter((mail) => mail.to.includes(email))
      .map((mail) => linkIn(mail, path)).filter((link): link is URL => link !== undefined);
    return links.length;
  }, { timeout: MAIL_WAIT_MS, message: `exactly one ${path} mail must reach the sink for the test user` }).toBe(1);
  return links[0];
}

async function signIn(page: Page, email: string, password: string): Promise<number> {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByPlaceholder(/enter your password/i).fill(password);
  const response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname === "/api/auth/login" && candidate.request().method() === "POST");
  await page.getByRole("button", { name: /sign in/i }).click();
  return (await response).status();
}

test.beforeEach(async ({ request }) => {
  await expectProductionProfile(request);
});

test("the mailed verification link verifies the account from a fresh browser, once", async ({ browser, request }) => {
  const suffix = `mail${randomUUID().slice(0, 8)}`;
  const email = `${suffix}@example.invalid`;
  const password = `Synthetic!9-${randomUUID()}`;

  const registering = await contextFrom(browser, 60);
  const page = await registering.newPage();
  await page.goto("/login?mode=register");
  await page.getByLabel("Full Name").fill("Mail Tester");
  await page.getByLabel("Username").fill(suffix);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
  const registered = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/auth/register" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create Account" }).click();
  expect((await registered).status()).toBe(201);
  await registering.close();

  const link = await mailedLink(request, email, "/verify-email");
  const token = link.searchParams.get("token")!;
  const { rows: [pending] } = await withFixtureClient((client) => client.query(
    "SELECT id, email_verified, email_verification_token FROM users WHERE email=$1", [email]));
  // Only the hash of the mailed token is stored.
  expect(pending).toMatchObject({ email_verified: false, email_verification_token: sha256(token) });

  const fresh = await contextFrom(browser, 61);
  const visitor = await fresh.newPage();
  const verified = visitor.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/settings/security/email/verify" && response.request().method() === "POST");
  await visitor.goto(link.href);
  expect((await verified).status()).toBe(200);
  await expect(visitor.getByText("Email Verified!")).toBeVisible();
  const { rows: [stored] } = await withFixtureClient((client) => client.query(
    "SELECT email_verified, email_verification_token FROM users WHERE id=$1", [pending.id]));
  expect(stored).toEqual({ email_verified: true, email_verification_token: null });
  expect(await signIn(visitor, email, password)).toBe(200);
  await fresh.close();

  // The link is single use: a second visitor is refused and nothing changes.
  const replay = await contextFrom(browser, 62);
  const second = await replay.newPage();
  const refused = second.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/settings/security/email/verify" && response.request().method() === "POST");
  await second.goto(link.href);
  expect((await refused).status()).toBe(400);
  await expect(second.getByText("Email Verified!")).toHaveCount(0);
  await replay.close();
});

test("the mailed reset link sets a new password from a fresh browser", async ({ browser, request }) => {
  const fixture = await createCompletionFixture();
  const requesting = await contextFrom(browser, 63);
  const page = await requesting.newPage();
  await page.goto("/forgot-password");
  await page.locator("#forgotEmail").fill(fixture.email);
  const requested = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/auth/forgot-password" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Send reset link" }).click();
  expect((await requested).status()).toBe(200);
  await expect(page.getByText("Check your email")).toBeVisible();
  await requesting.close();

  const link = await mailedLink(request, fixture.email, "/reset-password");
  const token = link.searchParams.get("token")!;
  const { rows: issued } = await withFixtureClient((client) => client.query(
    "SELECT token_hash, used_at FROM password_reset_tokens WHERE user_id=$1", [fixture.userId]));
  expect(issued).toEqual([{ token_hash: sha256(token), used_at: null }]);

  const newPassword = `Synthetic!9-new-${randomUUID()}`;
  const fresh = await contextFrom(browser, 64);
  const visitor = await fresh.newPage();
  await visitor.goto(link.href);
  await visitor.locator("#newPassword").fill(newPassword);
  await visitor.locator("#confirmPassword").fill(newPassword);
  const reset = visitor.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/auth/reset-password" && response.request().method() === "POST");
  await visitor.getByRole("button", { name: "Reset password" }).click();
  expect((await reset).status()).toBe(200);
  await expect(visitor.getByText("Password reset", { exact: true }).first()).toBeVisible();

  const { rows: [after] } = await withFixtureClient((client) => client.query<{ password_hash: string; used: boolean }>(
    `SELECT u.password_hash, t.used_at IS NOT NULL AS used FROM users u
       JOIN password_reset_tokens t ON t.user_id=u.id WHERE u.id=$1 AND t.token_hash=$2`, [fixture.userId, sha256(token)]));
  expect(after.used).toBe(true);
  expect(await bcrypt.compare(newPassword, after.password_hash)).toBe(true);
  expect(await bcrypt.compare(fixture.password, after.password_hash)).toBe(false);
  expect(await signIn(visitor, fixture.email, fixture.password)).toBe(401);
  expect(await signIn(visitor, fixture.email, newPassword)).toBe(200);
  await fresh.close();
});
