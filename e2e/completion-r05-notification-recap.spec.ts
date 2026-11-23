import type { Route } from "@playwright/test";
import { test, expect, type Page } from "./protected-test";
import { loadTestTarget } from "../server/testing/test-target.mjs";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";

const ownedOrigin = loadTestTarget().server?.origin;
if (!ownedOrigin) throw new Error("R05 browser acceptance requires the protected owned server origin");
const notificationPath = "/api/settings/notifications";
const recapPath = "/api/weekly-recap/settings";
const displayPath = "/api/settings/display";
const notificationSuccess = "Notification preferences updated successfully";
const recapSuccess = "Your submitted weekly recap preferences have been saved.";
// OPS-007: no saved day reads as Monday, the day the recap e-mail uses.
const defaultRecap = {
  enabled: true, emailEnabled: false, dayOfWeek: 1, includeGoals: true, includeRecurring: true,
};

// As in the existing completion specs, retain synthetic fixtures for the
// coordinator's independent readback and owned-target cleanup. Never use an
// ambient DB: every fixture and SQL read goes through withFixtureClient's guard.
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

async function openSettings(page: Page, section: string, path: string) {
  const pending = responseFor(page, path, "GET");
  await page.goto(`/settings/${section}`);
  expect((await pending).status()).toBe(200);
}

async function freshGet(page: Page, path: string) {
  const response = await page.request.get(`${ownedOrigin}${path}`, { headers: { "Cache-Control": "no-cache" } });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.success).toBe(true);
  return body.data;
}

async function reloadSettings(page: Page, path: string) {
  const pending = responseFor(page, path, "GET");
  await page.reload();
  expect((await pending).status()).toBe(200);
}

async function save(page: Page, path: string, method: string, name: string, patch: unknown, success: string) {
  const pending = responseFor(page, path, method);
  await page.getByRole("button", { name, exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual(patch);
  expect(Boolean(response.request().headers()["x-csrf-token"])).toBe(true);
  expect((await response.json()).success).toBe(true);
  await expect(page.getByText(success, { exact: true })).toBeVisible();
}

type NotificationRow = {
  id: string; user_id: string; notification_type: string; in_app_enabled: boolean;
  email_enabled: boolean; push_enabled: boolean; threshold_amount: string | null;
  updated_at: string;
};

async function readNotification(fixture: CompletionFixture, type = "large_transaction") {
  return withFixtureClient(async client => (await client.query<NotificationRow>(`SELECT id, user_id,
    notification_type, in_app_enabled, email_enabled, push_enabled, threshold_amount::text,
    updated_at::text FROM user_notification_preferences
    WHERE user_id=$1 AND notification_type=$2 ORDER BY id`, [fixture.userId, type])).rows);
}

async function readDisplay(fixture: CompletionFixture) {
  return withFixtureClient(async client => (await client.query<{
    user_id: string; first_day_of_week: string; theme: string;
    dashboard_widgets: { weeklyRecap?: { dayOfWeek: number; includeGoals: boolean; includeRecurring: boolean } } | null;
    updated_at: string;
  }>(`SELECT user_id, first_day_of_week, theme, dashboard_widgets, updated_at::text
    FROM user_display_settings WHERE user_id=$1`, [fixture.userId])).rows);
}

async function choose(page: Page, name: string, option: string) {
  await page.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

type SyntheticReply = { status: number; body: unknown };

async function interceptOneSave(page: Page, path: string, method: string, reply: SyntheticReply) {
  const exactUrl = `${ownedOrigin}${path}`;
  let intercepted = 0;
  const handler = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== ownedOrigin || url.pathname !== path || url.search ||
      request.method() !== method || intercepted !== 0) return route.fallback();
    expect(url.href).toBe(exactUrl);
    intercepted++;
    // Page handlers precede the protected context handler. Fulfill locally
    // BEFORE dispatch; never fetch/continue a write and then fabricate failure.
    // All other requests fall back to the existing origin/redirect/egress guard.
    await route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) });
  };
  await page.route(exactUrl, handler);
  return async () => {
    await page.unroute(exactUrl, handler);
    expect(intercepted).toBe(1);
  };
}

test("notification threshold, independent recap day and display saves persist through fresh reads and reloads", async ({ page }) => {
  const fixture = await createCompletionFixture();
  await signIn(page, fixture);
  await openSettings(page, "notifications", notificationPath);
  const threshold = page.getByRole("spinbutton", { name: "Amount threshold for Large Transactions", exact: true });
  const inApp = page.getByRole("switch", { name: "Enable Large Transactions in-app notifications", exact: true });
  await expect(threshold).toHaveValue("");
  await expect(inApp).toBeChecked();
  await threshold.fill("250.50");
  await save(page, notificationPath, "PUT", "Save notification preferences", {
    preferences: [{ notificationType: "large_transaction", thresholdAmount: "250.50" }],
  }, notificationSuccess);
  expect(await readNotification(fixture)).toEqual([expect.objectContaining({
    user_id: fixture.userId, notification_type: "large_transaction", threshold_amount: "250.50",
    in_app_enabled: true, email_enabled: false, push_enabled: false,
  })]);

  // A new document removes the previous success toast and reloads the baseline.
  await reloadSettings(page, notificationPath);
  await expect(threshold).toHaveValue("250.50");
  await inApp.click();
  await save(page, notificationPath, "PUT", "Save notification preferences", {
    preferences: [{ notificationType: "large_transaction", inAppEnabled: false }],
  }, notificationSuccess);
  const notificationBeforeDisplay = await readNotification(fixture);
  expect(notificationBeforeDisplay).toEqual([expect.objectContaining({ threshold_amount: "250.50", in_app_enabled: false })]);
  expect((await freshGet(page, notificationPath)).preferences).toContainEqual(expect.objectContaining({
    userId: fixture.userId, notificationType: "large_transaction", thresholdAmount: "250.50", inAppEnabled: false,
  }));

  await openSettings(page, "display", displayPath);
  await choose(page, "Select first day of week", "Monday");
  await choose(page, "Select theme preference", "Dark");
  const displayWrite = responseFor(page, displayPath, "PUT");
  await page.getByRole("button", { name: "Save display settings", exact: true }).click();
  const displayResponse = await displayWrite;
  expect(displayResponse.status()).toBe(200);
  expect(displayResponse.request().postDataJSON()).toMatchObject({ firstDayOfWeek: "Monday", theme: "dark" });
  await expect(page.getByText("Display settings updated successfully", { exact: true })).toBeVisible();
  expect(await readDisplay(fixture)).toEqual([expect.objectContaining({ first_day_of_week: "Monday", theme: "dark" })]);
  expect(await readNotification(fixture)).toEqual(notificationBeforeDisplay);

  await openSettings(page, "weekly-recap", recapPath);
  await expect(page.getByRole("combobox", { name: "Recap Day", exact: true })).toContainText("Monday");
  await choose(page, "Recap Day", "Wednesday");
  await page.getByRole("switch", { name: "Include Goals Progress", exact: true }).click();
  await page.getByRole("switch", { name: "Include Upcoming Bills", exact: true }).click();
  const recapPatch = { dayOfWeek: 3, includeGoals: false, includeRecurring: false };
  await save(page, recapPath, "PATCH", "Save Changes", recapPatch, recapSuccess);
  const displayAfterRecap = await readDisplay(fixture);
  expect(displayAfterRecap).toEqual([expect.objectContaining({
    first_day_of_week: "Monday", theme: "dark", dashboard_widgets: { weeklyRecap: recapPatch },
  })]);
  const recapNotification = await readNotification(fixture, "weekly_recap");
  expect(recapNotification).toEqual([expect.objectContaining({
    in_app_enabled: true, email_enabled: false, push_enabled: false, threshold_amount: null,
  })]);
  expect(await readNotification(fixture)).toEqual(notificationBeforeDisplay);
  const expectedRecap = { ...defaultRecap, ...recapPatch };
  expect(await freshGet(page, recapPath)).toEqual(expectedRecap);
  await reloadSettings(page, recapPath);
  await expect(page.getByRole("combobox", { name: "Recap Day", exact: true })).toContainText("Wednesday");
  await expect(page.getByRole("switch", { name: "Include Goals Progress", exact: true })).not.toBeChecked();
  await expect(page.getByRole("switch", { name: "Include Upcoming Bills", exact: true })).not.toBeChecked();

  await openSettings(page, "display", displayPath);
  await expect(page.getByRole("combobox", { name: "Select first day of week", exact: true })).toContainText("Monday");
  await choose(page, "Select first day of week", "Sunday");
  const secondDisplayWrite = responseFor(page, displayPath, "PUT");
  await page.getByRole("button", { name: "Save display settings", exact: true }).click();
  const secondDisplayResponse = await secondDisplayWrite;
  expect(secondDisplayResponse.status()).toBe(200);
  expect(secondDisplayResponse.request().postDataJSON()).toMatchObject({ firstDayOfWeek: "Sunday", theme: "dark" });
  await expect(page.getByText("Display settings updated successfully", { exact: true })).toBeVisible();
  expect(await readDisplay(fixture)).toEqual([expect.objectContaining({
    first_day_of_week: "Sunday", theme: "dark", dashboard_widgets: displayAfterRecap[0].dashboard_widgets,
  })]);
  expect(await readNotification(fixture)).toEqual(notificationBeforeDisplay);
  expect(await readNotification(fixture, "weekly_recap")).toEqual(recapNotification);
  expect((await freshGet(page, displayPath)).settings).toMatchObject({ firstDayOfWeek: "Sunday", theme: "dark" });
  expect(await freshGet(page, recapPath)).toEqual(expectedRecap);
  await openSettings(page, "weekly-recap", recapPath);
  await expect(page.getByRole("combobox", { name: "Recap Day", exact: true })).toContainText("Wednesday");
  await expect(page.getByRole("switch", { name: "Include Goals Progress", exact: true })).not.toBeChecked();

  await openSettings(page, "notifications", notificationPath);
  await expect(threshold).toHaveValue("250.50");
  await expect(inApp).not.toBeChecked();
  await threshold.fill("");
  await save(page, notificationPath, "PUT", "Save notification preferences", {
    preferences: [{ notificationType: "large_transaction", thresholdAmount: null }],
  }, notificationSuccess);
  expect(await readNotification(fixture)).toEqual([expect.objectContaining({ threshold_amount: null, in_app_enabled: false })]);
  expect(await readNotification(fixture, "weekly_recap")).toEqual(recapNotification);
  expect(await freshGet(page, recapPath)).toEqual(expectedRecap);
  await reloadSettings(page, notificationPath);
  await expect(threshold).toHaveValue("");
  await expect(inApp).not.toBeChecked();
  expect((await freshGet(page, notificationPath)).preferences).toContainEqual(expect.objectContaining({
    notificationType: "large_transaction", thresholdAmount: null, inAppEnabled: false,
  }));
});

for (const failure of ["HTTP failure", "malformed success", "contradictory success"] as const) {
  test(`notification ${failure} retains the draft without persistence or false success, then retries`, async ({ page }) => {
    const fixture = await createCompletionFixture();
    await signIn(page, fixture);
    await openSettings(page, "notifications", notificationPath);
    const before = await readNotification(fixture);
    expect(before).toEqual([]);
    const threshold = page.getByRole("spinbutton", { name: "Amount threshold for Large Transactions", exact: true });
    const inApp = page.getByRole("switch", { name: "Enable Large Transactions in-app notifications", exact: true });
    await threshold.fill("250.50");
    await inApp.click();
    const patch = { preferences: [{ notificationType: "large_transaction", thresholdAmount: "250.50", inAppEnabled: false }] };
    const error = failure === "HTTP failure" ? "Synthetic notification save failure" : "Invalid notification preferences response";
    // The toast shows plain copy (client/src/lib/errorCopy.ts), never the server's or the validator's own text.
    const shown = failure === "HTTP failure"
      ? "Something went wrong on our side. Try again in a moment."
      : "Your change may not have been saved. Check it and try again.";
    const reply = failure === "HTTP failure" ? { status: 503, body: {
      success: false, error: { code: "SYNTHETIC_R05_FAILURE", message: error },
    } } : { status: 200, body: { success: true, data: { preferences: failure === "malformed success" ? {} : [{
      id: fixture.userId, userId: fixture.userId, notificationType: "large_transaction",
      inAppEnabled: true, emailEnabled: false, pushEnabled: false, thresholdAmount: "250.50",
      createdAt: "2026-10-31T00:00:00.000Z", updatedAt: "2026-10-31T00:00:00.000Z",
    }] } } };
    const release = await interceptOneSave(page, notificationPath, "PUT", reply);
    try {
      const rejected = responseFor(page, notificationPath, "PUT");
      await page.getByRole("button", { name: "Save notification preferences", exact: true }).click();
      const response = await rejected;
      expect(response.status()).toBe(reply.status);
      expect(response.request().postDataJSON()).toEqual(patch);
      await expect(page.getByText("Action failed", { exact: true })).toBeVisible();
      await expect(page.getByText(shown, { exact: true })).toBeVisible();
      await expect(page.getByText(error, { exact: true })).toHaveCount(0);
      await expect(page.getByText(notificationSuccess, { exact: true })).toHaveCount(0);
      await expect(threshold).toHaveValue("250.50");
      await expect(inApp).not.toBeChecked();
      await expect(page.getByRole("button", { name: "Save notification preferences", exact: true })).toBeEnabled();
      expect(await readNotification(fixture)).toEqual(before);
      expect((await freshGet(page, notificationPath)).preferences.filter(
        (row: { notificationType: string }) => row.notificationType === "large_transaction")).toEqual([]);
    } finally { await release(); }

    await save(page, notificationPath, "PUT", "Save notification preferences", patch, notificationSuccess);
    expect(await readNotification(fixture)).toEqual([expect.objectContaining({
      user_id: fixture.userId, notification_type: "large_transaction", threshold_amount: "250.50",
      in_app_enabled: false, email_enabled: false, push_enabled: false,
    })]);
    await reloadSettings(page, notificationPath);
    await expect(threshold).toHaveValue("250.50");
    await expect(inApp).not.toBeChecked();
    expect((await freshGet(page, notificationPath)).preferences).toContainEqual(expect.objectContaining({
      userId: fixture.userId, notificationType: "large_transaction", thresholdAmount: "250.50", inAppEnabled: false,
    }));
  });

  test(`recap ${failure} retains the draft without persistence or false success, then retries`, async ({ page }) => {
    const fixture = await createCompletionFixture();
    await signIn(page, fixture);
    await openSettings(page, "weekly-recap", recapPath);
    const displayBefore = await readDisplay(fixture);
    const notificationBefore = await readNotification(fixture, "weekly_recap");
    expect(notificationBefore).toEqual([]);
    expect(await freshGet(page, recapPath)).toEqual(defaultRecap);
    await choose(page, "Recap Day", "Wednesday");
    await page.getByRole("switch", { name: "Include Goals Progress", exact: true }).click();
    const patch = { dayOfWeek: 3, includeGoals: false };
    const error = failure === "HTTP failure" ? "Synthetic recap save failure" : "Invalid weekly recap settings response. Please try again.";
    const reply = failure === "HTTP failure" ? { status: 503, body: {
      success: false, error: { code: "SYNTHETIC_R05_FAILURE", message: error },
    } } : { status: 200, body: { success: true, data: failure === "malformed success"
      ? { dayOfWeek: 3 } : { ...defaultRecap, dayOfWeek: 2, includeGoals: false } } };
    const release = await interceptOneSave(page, recapPath, "PATCH", reply);
    try {
      const rejected = responseFor(page, recapPath, "PATCH");
      await page.getByRole("button", { name: "Save Changes", exact: true }).click();
      const response = await rejected;
      expect(response.status()).toBe(reply.status);
      expect(response.request().postDataJSON()).toEqual(patch);
      await expect(page.getByRole("alert")).toHaveText(error);
      await expect(page.getByText(recapSuccess, { exact: true })).toHaveCount(0);
      await expect(page.getByRole("combobox", { name: "Recap Day", exact: true })).toContainText("Wednesday");
      await expect(page.getByRole("switch", { name: "Include Goals Progress", exact: true })).not.toBeChecked();
      await expect(page.getByRole("button", { name: "Save Changes", exact: true })).toBeEnabled();
      expect(await readDisplay(fixture)).toEqual(displayBefore);
      expect(await readNotification(fixture, "weekly_recap")).toEqual(notificationBefore);
      expect(await freshGet(page, recapPath)).toEqual(defaultRecap);
    } finally { await release(); }

    await save(page, recapPath, "PATCH", "Save Changes", patch, recapSuccess);
    expect(await readDisplay(fixture)).toEqual([expect.objectContaining({
      first_day_of_week: "Sunday", dashboard_widgets: {
        weeklyRecap: { dayOfWeek: 3, includeGoals: false, includeRecurring: true },
      },
    })]);
    expect(await readNotification(fixture, "weekly_recap")).toEqual([expect.objectContaining({
      user_id: fixture.userId, notification_type: "weekly_recap", in_app_enabled: true,
      email_enabled: false, push_enabled: false, threshold_amount: null,
    })]);
    expect(await freshGet(page, recapPath)).toEqual({ ...defaultRecap, ...patch });
    await reloadSettings(page, recapPath);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Recap Day", exact: true })).toContainText("Wednesday");
    await expect(page.getByRole("switch", { name: "Include Goals Progress", exact: true })).not.toBeChecked();
  });
}
