import { test, expect } from "./protected-test";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { signInAs } from "./utils/fixture-session";

/**
 * AH-11: two-step verification is mandatory. Inside the grace a member works
 * normally and sees the deadline with a link to set it up; once the grace is
 * over, only enrolment is reachable and data routes answer MFA_ENROLMENT_REQUIRED.
 */
async function setGraceEnd(fixture: CompletionFixture, interval: string): Promise<void> {
  await withFixtureClient(client => client.query(
    "UPDATE users SET mfa_enabled = false, mfa_grace_ends_at = now() + $2::interval WHERE id = $1",
    [fixture.userId, interval]));
}

test("inside the grace the banner shows the days left and links to security settings", async ({ page }) => {
  const fixture = await createCompletionFixture();
  await setGraceEnd(fixture, "3 days");
  await signInAs(page, fixture);

  const banner = page.getByRole("region", { name: "Two-step verification" });
  await expect(banner).toContainText("Two-step verification will be required from");
  await expect(banner).toContainText("3 days left");
  await expect(page.getByRole("heading", { name: "Set up two-step verification", exact: true })).toHaveCount(0);

  await banner.getByRole("link", { name: "Set it up now", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/security$/);
});

test("after the grace only enrolment is reachable", async ({ page }) => {
  const fixture = await createCompletionFixture();
  await setGraceEnd(fixture, "-1 minute");
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByPlaceholder(/enter your password/i).fill(fixture.password);
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page.getByRole("heading", { name: "Set up two-step verification", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Two-step verification" })).toHaveCount(0);
  const denied = await page.request.get("/api/accounts");
  expect(denied.status()).toBe(403);
  expect((await denied.json()).error.code).toBe("MFA_ENROLMENT_REQUIRED");

  await page.goto("/transactions");
  await expect(page.getByRole("heading", { name: "Set up two-step verification", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
});
