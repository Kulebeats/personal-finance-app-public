import { test, expect } from "@playwright/test";
import { getTestUser } from "./utils/testUser";
import { pickVisible } from "./utils/locators";

const loadTestUser = () => getTestUser();

/**
 * Authentication E2E Tests
 *
 * Critical user flows for login, session management, and logout.
 */
test.describe("Authentication", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
  });

  test("should display login form", async ({ page }) => {
    await expect(page.getByText(/welcome back/i)).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByPlaceholder(/enter your password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("should show validation errors for empty form", async ({ page }) => {
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.locator("input:invalid")).toHaveCount(2);
  });

  test("should show error for invalid credentials", async ({ page }) => {
    await page.getByLabel(/email/i).fill("invalid@example.com");
    await page.getByPlaceholder(/enter your password/i).fill("wrongpassword");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  });

  test("should redirect to dashboard after successful login", async ({
    page,
  }) => {
    // Use test credentials
    const testUser = loadTestUser();
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByPlaceholder(/enter your password/i).fill(testUser.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Should redirect to dashboard
    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: /dashboard/i })
    ).toBeVisible();
  });

  test("should remember email when Remember Me is checked", async ({
    page,
  }) => {
    const testUser = loadTestUser();
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByPlaceholder(/enter your password/i).fill(testUser.password);
    await page.getByLabel(/remember me/i).check();
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");
    await page.goto("/login");

    // Email should be pre-filled
    await expect(page.getByLabel(/email/i)).toHaveValue(testUser.email);
  });
});

test.describe("Session Management", () => {
  test("should redirect to login when not authenticated", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/login");
  });

  test("should maintain session across page navigation", async ({ page }) => {
    const testUser = loadTestUser();
    // Login first
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByPlaceholder(/enter your password/i).fill(testUser.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");

    // Navigate to different pages
    await page.goto("/transactions");
    await expect(page).toHaveURL(/\/transactions/);
    const transactionsAnchor = await pickVisible(
      page.getByRole("heading", { name: /transactions/i }),
      page.getByRole("button", { name: /add transaction/i }),
      page.getByPlaceholder(/search transactions/i),
      page.getByText(/no transactions/i),
    );
    expect(transactionsAnchor).not.toBeNull();

    await page.goto("/budget");
    await expect(page).toHaveURL(/\/budget/);
    const budgetAnchor = await pickVisible(
      page.getByText(/^budget$/i),
      page.getByText(/create categories to start budgeting/i),
      page.getByRole("button", { name: /go to categories/i }),
    );
    expect(budgetAnchor).not.toBeNull();
  });
});
