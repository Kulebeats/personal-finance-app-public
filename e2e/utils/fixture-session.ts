/**
 * Signs in as a synthetic completion fixture through the real login form.
 * Used by the QA-01 specs, which each create their own household instead of
 * sharing one long-lived test account.
 */
import { expect, type Page } from "../protected-test";
import type { CompletionFixture } from "../../server/testing/fixtures/completion-fixtures";

export async function signInAs(page: Page, fixture: CompletionFixture): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByPlaceholder(/enter your password/i).fill(fixture.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
}
