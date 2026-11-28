import { test, expect } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { signInAs } from "./utils/fixture-session";

/**
 * AH-08 (d): a synthetic user erases their own account from Settings >
 * Security. The screen asks for the password and the typed word DELETE, the
 * server then demands a fresh step-up, and after the erasure the browser is on
 * the sign-in page. Signing in again with the same address and password fails,
 * and the database holds no trace of the address or the household.
 */
test("a user erases their account and can no longer sign in", async ({ page }) => {
  const fixture = await createCompletionFixture();
  await signInAs(page, fixture);
  await page.goto("/settings/security");

  await expect(page.getByText(/This cannot be undone/)).toBeVisible();
  await page.getByRole("button", { name: "Delete my account", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete your account permanently?" });
  await dialog.getByLabel("Current password", { exact: true }).fill(fixture.password);
  await dialog.getByLabel("Type DELETE to confirm", { exact: true }).fill("DELETE");

  const erased = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/settings/account/delete" && response.status() !== 401);
  await dialog.getByRole("button", { name: "Permanently delete account", exact: true }).click();

  // The route needs a DESTRUCTIVE step-up that a fresh sign-in does not give.
  const stepUp = page.getByRole("dialog", { name: "Confirm it's you" });
  await stepUp.getByLabel("Password", { exact: true }).fill(fixture.password);
  await stepUp.getByRole("button", { name: "Confirm", exact: true }).click();
  expect((await erased).status()).toBe(200);
  await expect(page).toHaveURL(/\/login$/);

  const stored = await withFixtureClient(async (client) => ({
    users: (await client.query("SELECT 1 FROM users WHERE lower(email) = lower($1)", [fixture.email])).rowCount,
    household: (await client.query("SELECT 1 FROM households WHERE id = $1", [fixture.householdId])).rowCount,
  }));
  expect(stored).toEqual({ users: 0, household: 0 });

  await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByPlaceholder(/enter your password/i).fill(fixture.password);
  const login = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/auth/login");
  await page.getByRole("button", { name: /sign in/i }).click();
  expect((await login).status()).toBe(401);
  await expect(page).toHaveURL(/\/login$/);
});
