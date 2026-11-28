import type { Browser, Route } from "@playwright/test";
import { test, expect, type Page } from "./protected-test";
import { loadTestTarget } from "../server/testing/test-target.mjs";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import type { ReportWidgetPreferences } from "../shared/reports";
import { readBack, submitStep, type SubmitStep } from "./utils/submit";
import { testWithMutants } from "./utils/mutants";
import { responseValue } from "./utils/observe";

const ownedOrigin = loadTestTarget().server?.origin;
if (!ownedOrigin) throw new Error("R05 report browser acceptance requires the protected owned server origin");
const preferencesPath = "/api/settings/report-widgets";
const resetPath = `${preferencesPath}/reset`;
/**
 * The gallery's Category Breakdown switch save (QA-01, scripts/e2e-mutation-check.mjs):
 * its corrupt mutant saves the nested flag as true instead of false.
 */
const HIDE_CATEGORY: SubmitStep = { name: "hide-category", method: "PATCH", path: preferencesPath,
  corruptField: "optionalWidgets.categoryBreakdown.enabled" };

async function signIn(page: Page, fixture: CompletionFixture) {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByPlaceholder(/enter your password/i).fill(fixture.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
  const session = await page.request.get(`${ownedOrigin}/api/auth/session`);
  expect(session.status()).toBe(200);
  expect((await session.json()).data).toMatchObject({
    state: "ready", subject: { id: fixture.userId }, household: { id: fixture.householdId },
  });
}

function responseFor(page: Page, path: string, method: string) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === ownedOrigin && url.pathname === path && !url.search &&
      response.request().method() === method;
  });
}

async function openReports(page: Page) {
  const pending = responseFor(page, preferencesPath, "GET");
  await page.goto("/reports");
  expect((await pending).status()).toBe(200);
}

async function freshPreferences(page: Page): Promise<ReportWidgetPreferences> {
  const response = await page.request.get(`${ownedOrigin}${preferencesPath}`, {
    headers: { "Cache-Control": "no-cache" },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.success).toBe(true);
  return body.data.preferences;
}

async function storedPreferences(fixture: CompletionFixture): Promise<ReportWidgetPreferences | null> {
  return withFixtureClient(async client => {
    const rows = (await client.query<{ report_widget_preferences: ReportWidgetPreferences | null }>(
      "SELECT report_widget_preferences FROM user_display_settings WHERE user_id=$1", [fixture.userId],
    )).rows;
    expect(rows).toHaveLength(1);
    return rows[0].report_widget_preferences;
  });
}

async function openGallery(page: Page) {
  await page.getByRole("button", { name: "Customize report settings", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit Dashboard Widgets", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Customize Dashboard", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openLayoutEditor(page: Page) {
  await page.getByRole("button", { name: "Customize Layout", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Customize Dashboard", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function acceptedWrite(page: Page, path: string, method: string, action: () => Promise<void>) {
  const pending = responseFor(page, path, method);
  await action();
  const response = await pending;
  expect(response.status()).toBe(200);
  expect(Boolean(response.request().headers()["x-csrf-token"])).toBe(true);
  expect((await response.json()).success).toBe(true);
  return response.request().postDataJSON();
}

async function freshSignedInPage(browser: Browser, fixture: CompletionFixture) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signIn(page, fixture);
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

testWithMutants("report setup, customization and reset survive fresh login and stay within the user", { corrupt: [HIDE_CATEGORY] }, async (page) => {
  const browser = page.context().browser();
  if (!browser) throw new Error("R05 report isolation needs a browser to open fresh contexts");
  const owner = await createCompletionFixture();
  const other = await createCompletionFixture();
  await signIn(page, owner);
  await openReports(page);

  const onboarding = page.getByRole("dialog", { name: "Welcome to Your Reports Dashboard", exact: true });
  await expect(onboarding).toBeVisible();
  await onboarding.getByRole("checkbox", { name: "Category Breakdown", exact: true }).click();
  const setupPatch = await acceptedWrite(page, preferencesPath, "PATCH", async () => {
    await onboarding.getByRole("button", { name: "Save & Continue", exact: true }).click();
  });
  expect(setupPatch).toMatchObject({
    hasCompletedWidgetSetup: true,
    optionalWidgets: { categoryBreakdown: { enabled: true }, monthlyTrends: { enabled: false } },
  });
  await expect(onboarding).toBeHidden();
  expect((await storedPreferences(owner))?.optionalWidgets.categoryBreakdown.enabled).toBe(true);

  const gallery = await openGallery(page);
  const category = gallery.getByRole("switch", { name: "Show Category Breakdown", exact: true });
  await expect(category).toBeChecked();
  const customized = await submitStep(page, HIDE_CATEGORY, () => category.click());
  expect(customized.status()).toBe(200);
  // The saved flag, before the switch and fresh-login checks below, which a wrong flag would also fail.
  await readBack(HIDE_CATEGORY, "false", {
    db: async () => responseValue((await storedPreferences(owner))?.optionalWidgets.categoryBreakdown?.enabled, "categoryBreakdown.enabled"),
    api: async () => responseValue((await freshPreferences(page)).optionalWidgets.categoryBreakdown?.enabled, "categoryBreakdown.enabled"),
  });
  expect(Boolean(customized.request().headers()["x-csrf-token"])).toBe(true);
  expect((await customized.json()).success).toBe(true);
  const customizePatch = customized.request().postDataJSON();
  expect(customizePatch).toEqual({ optionalWidgets: { categoryBreakdown: { enabled: false } } });
  await expect(category).not.toBeChecked();
  await gallery.getByRole("button", { name: "Done", exact: true }).click();
  expect((await storedPreferences(owner))?.optionalWidgets.categoryBreakdown.enabled).toBe(false);

  // New protected browser contexts establish independent logins and caches.
  const ownerSession = await freshSignedInPage(browser, owner);
  const otherSession = await freshSignedInPage(browser, other);
  try {
    await openReports(ownerSession.page);
    await expect(ownerSession.page.getByRole("dialog", { name: "Welcome to Your Reports Dashboard" })).toHaveCount(0);
    const saved = await freshPreferences(ownerSession.page);
    expect(saved.hasCompletedWidgetSetup).toBe(true);
    expect(saved.optionalWidgets).toMatchObject({
      categoryBreakdown: { enabled: false }, monthlyTrends: { enabled: false },
    });
    const savedGallery = await openGallery(ownerSession.page);
    await expect(savedGallery.getByRole("switch", { name: "Show Category Breakdown" })).not.toBeChecked();

    await openReports(otherSession.page);
    await expect(otherSession.page.getByRole("dialog", { name: "Welcome to Your Reports Dashboard" })).toBeVisible();
    const isolated = await freshPreferences(otherSession.page);
    expect(isolated.hasCompletedWidgetSetup).toBe(false);
    expect(isolated.optionalWidgets.monthlyTrends.enabled).toBe(true);
    expect((await storedPreferences(other))?.optionalWidgets).toBeUndefined();

    const resetBody = await acceptedWrite(ownerSession.page, resetPath, "POST", async () => {
      await savedGallery.getByRole("button", { name: "Reset Defaults", exact: true }).click();
    });
    expect(resetBody).toEqual({});
    await expect(savedGallery).toBeHidden();
    const reset = await freshPreferences(ownerSession.page);
    expect(reset.hasCompletedWidgetSetup).toBe(true);
    expect(reset.optionalWidgets.monthlyTrends.enabled).toBe(true);
    expect(reset.optionalWidgets).not.toHaveProperty("categoryBreakdown");
    const resetStored = await storedPreferences(owner);
    expect(resetStored?.optionalWidgets.monthlyTrends.enabled).toBe(true);
    expect(resetStored?.optionalWidgets).not.toHaveProperty("categoryBreakdown");
    expect((await freshPreferences(otherSession.page)).hasCompletedWidgetSetup).toBe(false);
  } finally {
    await ownerSession.context.close();
    await otherSession.context.close();
  }
});

test("browser-injected report save HTTP 503 retains the layout draft and retries against the real server", async ({ page }) => {
  const fixture = await createCompletionFixture();
  await signIn(page, fixture);
  await openReports(page);
  const onboarding = page.getByRole("dialog", { name: "Welcome to Your Reports Dashboard", exact: true });
  await expect(onboarding).toBeVisible();
  const setupPatch = await acceptedWrite(page, preferencesPath, "PATCH", async () => {
    await onboarding.getByRole("button", { name: "Skip for Now", exact: true }).click();
  });
  expect(setupPatch).toEqual({ hasCompletedWidgetSetup: true });
  await expect(onboarding).toBeHidden();

  const editor = await openLayoutEditor(page);
  const monthly = editor.getByRole("checkbox", { name: "Enable Monthly Trends", exact: true });
  await expect(monthly).toBeChecked();
  await monthly.click();
  await expect(monthly).not.toBeChecked();
  const before = await storedPreferences(fixture);
  expect(before?.optionalWidgets.monthlyTrends.enabled).toBe(true);

  const exactUrl = `${ownedOrigin}${preferencesPath}`;
  let intercepted = 0;
  const handler = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== ownedOrigin || url.pathname !== preferencesPath || url.search ||
        request.method() !== "PATCH" || intercepted !== 0) return route.fallback();
    expect(url.href).toBe(exactUrl);
    intercepted++;
    // Synthetic failure is fulfilled before dispatch; no write reaches the server.
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({
      success: false, error: { code: "SYNTHETIC_R05_FAILURE", message: "Synthetic report save failure" },
    }) });
  };
  await page.route(exactUrl, handler);
  try {
    const rejected = responseFor(page, preferencesPath, "PATCH");
    await editor.getByRole("button", { name: "Save Changes", exact: true }).click();
    const response = await rejected;
    expect(response.status()).toBe(503);
    expect(response.request().postDataJSON()).toEqual({ optionalWidgets: { monthlyTrends: { enabled: false } } });
    await expect(editor.getByRole("alert")).toHaveText("Synthetic report save failure");
    await expect(editor).toBeVisible();
    await expect(monthly).not.toBeChecked();
    await expect(editor.getByRole("button", { name: "Retry Save", exact: true })).toBeEnabled();
    expect(await storedPreferences(fixture)).toEqual(before);
    expect((await freshPreferences(page)).optionalWidgets.monthlyTrends.enabled).toBe(true);
  } finally {
    await page.unroute(exactUrl, handler);
    expect(intercepted).toBe(1);
  }

  const retryPatch = await acceptedWrite(page, preferencesPath, "PATCH", async () => {
    await editor.getByRole("button", { name: "Retry Save", exact: true }).click();
  });
  expect(retryPatch).toEqual({ optionalWidgets: { monthlyTrends: { enabled: false } } });
  await expect(editor).toBeHidden();
  expect((await freshPreferences(page)).optionalWidgets.monthlyTrends.enabled).toBe(false);
  expect((await storedPreferences(fixture))?.optionalWidgets.monthlyTrends.enabled).toBe(false);
});
