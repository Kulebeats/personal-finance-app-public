import { test, expect } from "./protected-test";
import { getTestUser } from "./utils/testUser";
import { pickVisible } from "./utils/locators";

const loadTestUser = () => getTestUser();

/**
 * Dashboard E2E Tests
 *
 * Critical user flows for the main dashboard.
 */
test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    const testUser = loadTestUser();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByPlaceholder(/enter your password/i).fill(testUser.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");
  });

  test("should display dashboard widgets", async ({ page }) => {
    const dashboardAnchor = await pickVisible(
      page.getByRole("heading", { name: /dashboard/i }),
      page.getByText(/^net worth$/i),
      page.getByText(/^recent transactions$/i),
    );
    expect(dashboardAnchor).not.toBeNull();

    // Check for common widgets
    await expect(page.getByText(/^net worth$/i)).toBeVisible();
    await expect(page.getByText(/^recent transactions$/i)).toBeVisible();
  });

  test("should navigate to transactions page", async ({ page }) => {
    const sidebar = page.locator("aside nav").first();
    await sidebar
      .getByRole("link", { name: "Transactions", exact: true })
      .click();
    await expect(page).toHaveURL("/transactions");
  });

  test("should navigate to budget page", async ({ page }) => {
    const sidebar = page.locator("aside nav").first();
    await sidebar.getByRole("link", { name: "Budget", exact: true }).click();
    await expect(page).toHaveURL("/budget");
  });

  test("should navigate to reports page", async ({ page }) => {
    const sidebar = page.locator("aside nav").first();
    await sidebar.getByRole("link", { name: "Reports", exact: true }).click();
    await expect(page).toHaveURL("/reports");
  });
});

test.describe("Navigation", () => {
  test.beforeEach(async ({ page }) => {
    const testUser = loadTestUser();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByPlaceholder(/enter your password/i).fill(testUser.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");
  });

  test("should have working sidebar navigation", async ({ page }) => {
    const sidebar = page.locator("aside nav").first();
    await expect(sidebar).toBeVisible();

    // Check main navigation links exist
    await expect(
      sidebar.getByRole("link", { name: "Dashboard", exact: true })
    ).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: "Transactions", exact: true })
    ).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: "Accounts", exact: true })
    ).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: "Budget", exact: true })
    ).toBeVisible();
  });

  test("should highlight active navigation item", async ({ page }) => {
    await page.goto("/transactions");

    const sidebar = page.locator("aside nav").first();
    const transactionsLink = sidebar.getByRole("link", {
      name: "Transactions",
      exact: true,
    });
    // The active styling and aria-current now sit on the link itself; the
    // inner wrapper div was removed so the link is the only focus target.
    await expect(transactionsLink).toHaveAttribute("aria-current", "page");
    await expect(transactionsLink).toHaveClass(/(^|\s)bg-sidebar-accent(\s|$)/);
  });
});
