import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "./protected-test";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";

async function signIn(page: Page, fixture: CompletionFixture) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByPlaceholder(/enter your password/i).fill(fixture.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
}

async function expectReady(page: Page, userId: string) {
  const response = await page.request.get("/api/auth/session");
  expect(response.status()).toBe(200);
  const { data } = await response.json();
  expect(data.state).toBe("ready");
  expect(data.subject.id).toBe(userId);
}

test("C2 rejected step-up and current-password checks preserve the security form and session", async ({ page }) => {
  const fixture = await createCompletionFixture();
  const before = await withFixtureClient(async client => (await client.query(
    "SELECT password_hash, security_generation FROM users WHERE id=$1", [fixture.userId])).rows[0]);
  await signIn(page, fixture);
  await page.goto("/settings/security");
  const newPassword = `Synthetic!8-${randomUUID()}`;
  await page.getByLabel("Current Password", { exact: true }).fill("Wrong!9-current");
  await page.getByLabel("New Password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm Password", { exact: true }).fill(newPassword);
  const gated = page.waitForResponse(response => new URL(response.url()).pathname === "/api/settings/security/password" && response.request().method() === "PUT");
  await page.getByRole("button", { name: "Update Password", exact: true }).click();
  expect((await (await gated).json()).error.code).toBe("STEP_UP_REQUIRED");
  const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Password", { exact: true }).fill("Wrong!9-stepup");
  const rejected = page.waitForResponse(response => new URL(response.url()).pathname === "/api/settings/security/step-up" && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  const denial = await rejected;
  expect(denial.status()).toBe(401);
  expect((await denial.json()).error.code).toBe("INVALID_CREDENTIALS");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/settings\/security$/);
  await expect(page.locator("#new-password")).toHaveValue(newPassword);
  await expectReady(page, fixture.userId);

  // A successful re-confirmation retries the original existing password caller.
  // Its separate wrong-current-password rejection must also preserve the form.
  await dialog.getByLabel("Password", { exact: true }).fill(fixture.password);
  const verified = page.waitForResponse(response => new URL(response.url()).pathname === "/api/settings/security/step-up" && response.status() === 200);
  const currentRejected = page.waitForResponse(response => new URL(response.url()).pathname === "/api/settings/security/password" && response.request().method() === "PUT");
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await verified;
  const currentDenial = await currentRejected;
  expect(currentDenial.status()).toBe(401);
  expect((await currentDenial.json()).error.code).toBe("INVALID_CREDENTIALS");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Update Password", exact: true })).toBeEnabled();
  await expect(page.locator("#current-password")).toHaveValue("Wrong!9-current");
  await expect(page.locator("#new-password")).toHaveValue(newPassword);
  await expect(page.locator("#confirm-password")).toHaveValue(newPassword);
  await expectReady(page, fixture.userId);
  const after = await withFixtureClient(async client => (await client.query(
    "SELECT password_hash, security_generation FROM users WHERE id=$1", [fixture.userId])).rows[0]);
  expect(after).toEqual(before);
});

test("C2 rejected login preserves another tab's draft while a successful identity change retires it", async ({ page, context }) => {
  const fixture = await createCompletionFixture();
  const replacement = await createCompletionFixture();
  await signIn(page, fixture);
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add a new account", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Cash Physical Cash$/ }).click();
  const draftName = `C2 retained draft ${randomUUID()}`;
  await dialog.getByLabel("Account Name", { exact: true }).fill(draftName);
  await dialog.locator("#balance").fill("0");
  const other = await context.newPage();
  try {
    const barrier = `c2-barrier-${randomUUID()}`;
    await page.evaluate(key => {
      window.addEventListener("storage", event => {
        if (event.key === key) document.documentElement.setAttribute("data-c2-storage-barrier", key);
      });
    }, barrier);
    await other.goto("/login");
    await other.getByLabel(/email/i).fill(replacement.email);
    await other.getByPlaceholder(/enter your password/i).fill("Wrong!9-login");
    const rejected = other.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/login" && response.request().method() === "POST");
    await other.getByRole("button", { name: /sign in/i }).click();
    expect((await rejected).status()).toBe(401);
    await expect(other.getByRole("button", { name: /sign in/i })).toBeEnabled();
    // A subsequent storage event proves the receiving tab processed this queue;
    // there is no arbitrary sleep or simulated session-invalidation event.
    await other.evaluate(key => localStorage.setItem(key, "processed"), barrier);
    await expect(page.locator("html")).toHaveAttribute("data-c2-storage-barrier", barrier);
    await expect(dialog.getByLabel("Account Name", { exact: true })).toHaveValue(draftName);
    await expect(page).toHaveURL(/\/accounts$/);
    await expectReady(page, fixture.userId);

    // Positive control: the real cross-tab listener must still retire old forms.
    await other.getByPlaceholder(/enter your password/i).fill(replacement.password);
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/session" && response.request().method() === "GET");
    await other.getByRole("button", { name: /sign in/i }).click();
    await expect(other).toHaveURL("/");
    expect((await (await refreshed).json()).data.subject.id).toBe(replacement.userId);
    await expect(dialog).not.toBeVisible();
    await expectReady(page, replacement.userId);
    const count = await withFixtureClient(async client => (await client.query(
      "SELECT count(*)::int AS count FROM accounts WHERE name=$1 AND household_id=ANY($2::uuid[])",
      [draftName, [fixture.householdId, replacement.householdId]])).rows[0].count);
    expect(count).toBe(0);
    await other.evaluate(key => localStorage.removeItem(key), barrier);
  } finally { await other.close(); }
});
