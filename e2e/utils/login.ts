import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { getTestUser } from "./testUser";

/**
 * Shared login helper for E2E specs.
 *
 * Mirrors the selector pattern used by the working specs (auth, transactions,
 * accounts, budget, dashboard, organization): the real login form has no
 * `name` attributes, so it must be targeted via label/placeholder/role, not
 * `input[name="email"]` / `input[name="password"]` / `button[type="submit"]`.
 */
export async function login(page: Page): Promise<void> {
  const testUser = getTestUser();
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(testUser.email);
  await page.getByPlaceholder(/enter your password/i).fill(testUser.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
}
