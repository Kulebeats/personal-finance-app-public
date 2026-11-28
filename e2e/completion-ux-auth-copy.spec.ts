/**
 * UX misc: sign-in and registration failures show the client's own plain copy
 * (client/src/pages/Login/authErrorCopy.ts, authFieldErrors.ts,
 * client/src/lib/errorCopy.ts), never the server's error text.
 *
 * Two failures come from the real server (a wrong password, a username the
 * server's schema refuses). Two are synthetic replies fulfilled before the
 * request is sent, so nothing is written: a 400 naming a field the form does
 * not have, and a 500 carrying internal detail. In each case the server's own
 * message is checked absent from the page.
 */
import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import { test, expect } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { loadTestTarget } from "../server/testing/test-target.mjs";

const origin = loadTestTarget().server?.origin;
if (!origin) throw new Error("A protected server origin is required");

const LOGIN_PATH = "/api/auth/login";
const REGISTER_PATH = "/api/auth/register";
const WRONG_PASSWORD_COPY = "Invalid email or password.";
const HIGHLIGHTED_FIELDS_COPY = "Please correct the highlighted fields.";
const INVALID_INPUT_COPY = "Some of the details aren't valid. Check them and try again.";
const SIGN_IN_FAILED_COPY = "Sign-in failed. Please try again.";
/** Passes the client's password rules, so the form submits and the server decides. */
const SYNTHETIC_PASSWORD = "Synthetic-Pass-123!";

interface ServerError { code?: string; message?: string; fields?: { field: string; message: string }[] }

function isPost(page: Page, path: string) {
  return page.waitForResponse((response) =>
    new URL(response.url()).pathname === path && response.request().method() === "POST");
}

async function serverError(response: Awaited<ReturnType<typeof isPost>>): Promise<ServerError> {
  const body = await response.json() as { error?: ServerError };
  expect(body.error, "the failure carries the V7 error envelope").toBeDefined();
  return body.error!;
}

/** Fulfils the one POST to `path` locally, before it is sent, with `body`; returns the unroute. */
async function replyOnce(page: Page, path: string, status: number, body: unknown) {
  const url = new URL(path, origin).href;
  let replied = 0;
  const handler = async (route: Route) => {
    if (route.request().method() !== "POST" || replied !== 0) return route.fallback();
    replied += 1;
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  };
  await page.route(url, handler);
  return async () => {
    await page.unroute(url, handler);
    expect(replied, `exactly one POST ${path} was answered synthetically`).toBe(1);
  };
}

async function submitLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByPlaceholder(/enter your password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
}

async function submitRegistration(page: Page, username: string) {
  await page.goto("/login?mode=register");
  await page.locator("#fullName").fill("Synthetic Copy Person");
  await page.locator("#username").fill(username);
  await page.locator("#registerEmail").fill(`ux-auth-copy-${randomUUID().slice(0, 8)}@example.test`);
  await page.locator("#registerPassword").fill(SYNTHETIC_PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
}

test("a wrong password shows the plain sign-in copy, not the server's message", async ({ page }) => {
  const fixture = await createCompletionFixture();
  const failed = isPost(page, LOGIN_PATH);
  await submitLogin(page, fixture.email, `${fixture.password}-wrong`);
  const response = await failed;
  expect(response.status()).toBe(401);
  const error = await serverError(response);
  expect(error.code).toBe("INVALID_CREDENTIALS");

  await expect(page.getByText(WRONG_PASSWORD_COPY, { exact: true })).toBeVisible();
  expect(error.message, "the server's message differs from the copy, so its absence below means something")
    .not.toBe(WRONG_PASSWORD_COPY);
  await expect(page.getByText(error.message!, { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/login/);
});

test("a username the server refuses is marked on its field; the toast is plain copy", async ({ page }) => {
  const failed = isPost(page, REGISTER_PATH);
  // A space passes the input's own minLength but not the server's username pattern.
  await submitRegistration(page, "bad name");
  const response = await failed;
  expect(response.status()).toBe(400);
  const error = await serverError(response);
  expect(error.code).toBe("VALIDATION_ERROR");
  expect(error.fields?.map((field) => field.field)).toContain("username");

  await expect(page.getByText(HIGHLIGHTED_FIELDS_COPY, { exact: true })).toBeVisible();
  await expect(page.getByText(error.message!, { exact: true })).toHaveCount(0);
  const username = page.locator("#username");
  await expect(username).toHaveAttribute("aria-invalid", "true");
  await expect(username).toHaveAttribute("aria-describedby", /username-error/);
  await expect(page.locator("#username-error")).toBeVisible();
});

test("a 400 naming a field the form does not have shows fixed copy, never the server's text", async ({ page }) => {
  const topMessage = "Synthetic internal detail: relation tenant_scope rejected the row";
  const fieldMessage = "Synthetic constraint tenant_scope_fk violated";
  const release = await replyOnce(page, REGISTER_PATH, 400, {
    success: false,
    error: { code: "VALIDATION_ERROR", message: topMessage, fields: [{ field: "tenantScope", message: fieldMessage }] },
  });
  await submitRegistration(page, "synthetic_copy_user");
  await expect(page.getByText(INVALID_INPUT_COPY, { exact: true })).toBeVisible();
  await expect(page.getByText(topMessage)).toHaveCount(0);
  await expect(page.getByText(fieldMessage)).toHaveCount(0);
  await release();
});

test("a sign-in 500 with internal detail shows the generic sign-in copy only", async ({ page }) => {
  const fixture = await createCompletionFixture();
  const internal = "Synthetic stack: at AuthService.login (auth.service.ts:270)";
  const release = await replyOnce(page, LOGIN_PATH, 500, {
    success: false, error: { code: "INTERNAL_ERROR", message: internal },
  });
  await submitLogin(page, fixture.email, fixture.password);
  await expect(page.getByText(SIGN_IN_FAILED_COPY, { exact: true })).toBeVisible();
  await expect(page.getByText(internal)).toHaveCount(0);
  await expect(page).toHaveURL(/\/login/);
  await release();
});
