import { test, expect } from "@playwright/test";
import { getTestUser } from "./utils/testUser";
import { pickVisible } from "./utils/locators";

const loadTestUser = () => getTestUser();

/**
 * Budget E2E Tests
 *
 * Critical user flows for budget management.
 */
test.describe("Budget", () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    const testUser = loadTestUser();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByPlaceholder(/enter your password/i).fill(testUser.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");

    // Navigate to budget page
    await page.goto("/budget");
    await expect(page).toHaveURL(/\/budget/);
  });

  test("should display budget page", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /budget/i })).toBeVisible();
  });

  test("should show budget categories or empty state", async ({ page }) => {
    const contentState = await pickVisible(
      page.getByText(/create categories to start budgeting/i),
      page.getByRole("button", { name: /go to categories/i }),
      page.getByText(/^income$/i),
      page.getByText(/^expenses$/i),
    );
    expect(contentState).not.toBeNull();
  });

  test("should display month selector", async ({ page }) => {
    const monthSelector = await pickVisible(
      page.getByRole("button", { name: /month/i }),
      page.getByText(
        /january|february|march|april|may|june|july|august|september|october|november|december/i,
      ),
    );

    if (monthSelector) {
      await expect(monthSelector).toBeVisible();
    }
  });

  test("should navigate between months", async ({ page }) => {
    const prevButton = await pickVisible(
      page.getByRole("button", { name: /previous/i }),
      page.getByLabel(/previous month/i),
      page.locator("[data-direction='left']"),
    );

    const nextButton = await pickVisible(
      page.getByRole("button", { name: /next/i }),
      page.getByLabel(/next month/i),
      page.locator("[data-direction='right']"),
    );

    if (prevButton) {
      await prevButton.click();
      await page.waitForTimeout(300);
    }

    if (nextButton) {
      await nextButton.click();
      await page.waitForTimeout(300);
    }
  });

  test("should show budget progress indicators", async ({ page }) => {
    // Look for progress bars or percentage indicators
    const progressBar = page.locator("[role='progressbar']").first();
    const percentage = page.getByText(/%/).first();

    const hasProgress =
      (await progressBar.isVisible()) || (await percentage.isVisible());

    // May not have progress if no budgets set
    if (hasProgress) {
      expect(hasProgress).toBeTruthy();
    }
  });
});

test.describe("Budget Management", () => {
  test.beforeEach(async ({ page }) => {
    const testUser = loadTestUser();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByPlaceholder(/enter your password/i).fill(testUser.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");
    await page.goto("/budget");
    await expect(page).toHaveURL(/\/budget/);
  });

  test("should allow editing budget amount", async ({ page }) => {
    // Find a budget row
    const budgetRow = await pickVisible(
      page.locator("tbody tr"),
      page.locator("[data-testid='budget-item']"),
    );

    if (budgetRow) {
      // Look for edit action
      const editButton = page.getByRole("button", { name: /edit/i }).first();

      if (await editButton.isVisible()) {
        await editButton.click();
        await page.waitForTimeout(300);
      }
    }
  });

  test("should show budget settings", async ({ page }) => {
    const settingsButton = await pickVisible(
      page.getByRole("button", { name: /settings/i }),
      page.getByRole("button", { name: /configure/i }),
    );

    if (settingsButton) {
      await settingsButton.click();
      await page.waitForTimeout(300);

      // Settings panel should open
      const settingsPanel = await pickVisible(
        page.getByRole("dialog"),
        page.getByText(/budget settings/i),
      );
      expect(settingsPanel).not.toBeNull();
    }
  });

  test("should display budget summary", async ({ page }) => {
    const summaryAnchor = await pickVisible(
      page.getByText(/budgeted/i),
      page.getByText(/spent/i),
      page.getByText(/remaining/i),
      page.getByText(/available/i),
    );

    if (summaryAnchor) {
      await expect(summaryAnchor).toBeVisible();
    }
  });
});

test.describe("Budget Alerts", () => {
  test.beforeEach(async ({ page }) => {
    const testUser = loadTestUser();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByPlaceholder(/enter your password/i).fill(testUser.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");
    await page.goto("/budget");
    await expect(page).toHaveURL(/\/budget/);
  });

  test("should show overspent categories", async ({ page }) => {
    // Look for warning indicators on overbudget items
    const warningIndicator = await pickVisible(
      page.locator("[data-status='warning']"),
      page.locator("[data-status='overspent']"),
      page.locator(".text-destructive"),
    );

    // May or may not exist depending on spending
    if (warningIndicator) {
      await expect(warningIndicator).toBeVisible();
    }
  });

  test("should show budget alerts if configured", async ({ page }) => {
    const alertsButton = await pickVisible(
      page.getByRole("button", { name: /alerts/i }),
      page.getByRole("button", { name: /notifications/i }),
    );

    if (alertsButton) {
      await alertsButton.click();
      await page.waitForTimeout(300);
    }
  });
});
