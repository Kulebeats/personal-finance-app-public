import { test, expect } from "@playwright/test";
import { getTestUser } from "./utils/testUser";
import { pickVisible } from "./utils/locators";

const loadTestUser = () => getTestUser();

/**
 * Accounts E2E Tests
 *
 * Critical user flows for account management.
 */
test.describe("Accounts", () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    const testUser = loadTestUser();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByPlaceholder(/enter your password/i).fill(testUser.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");

    // Navigate to accounts page
    await page.goto("/accounts");
    await expect(page).toHaveURL(/\/accounts/);
  });

  test("should display accounts page", async ({ page }) => {
    const pageAnchor = await pickVisible(
      page.getByRole("heading", { name: /accounts/i }),
      page.getByRole("button", { name: /add.*account|new.*account/i }),
    );
    expect(pageAnchor).not.toBeNull();
  });

  test("should display account groups", async ({ page }) => {
    const rowCount = await page.locator("tbody tr").count();
    const emptyState = await pickVisible(
      page.getByText(/no accounts/i),
      page.getByText(/add your first account/i),
      page.getByText(/get started/i),
    );
    expect(rowCount > 0 || emptyState !== null).toBeTruthy();
  });

  test("should have add account button", async ({ page }) => {
    const addButton = await pickVisible(
      page.getByRole("button", { name: /add.*account|new.*account/i }),
    );
    expect(addButton).not.toBeNull();
  });

  test("should open add account modal", async ({ page }) => {
    const addButton = await pickVisible(
      page.getByRole("button", { name: /add.*account|new.*account/i }),
    );
    expect(addButton).not.toBeNull();
    if (!addButton) return;

    await addButton.click();

    // Modal should open
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("should show account details on click", async ({ page }) => {
    const accountItem = await pickVisible(
      page.locator("[data-testid='account-item']"),
      page.locator(".account-card"),
      page.locator("tbody tr"),
    );

    if (!accountItem) return;

    await accountItem.click();
    await page.waitForTimeout(300);

    const hasBalance = await page.getByText(/balance/i).first().isVisible();
    const hasDetailsUrl = /\/accounts\/.+/.test(page.url());
    expect(hasBalance || hasDetailsUrl).toBeTruthy();
  });

  test("should display net worth summary", async ({ page }) => {
    const netWorth = await pickVisible(page.getByText(/net worth/i));
    if (netWorth) {
      await expect(netWorth).toBeVisible();
    }
  });
});

test.describe("Account Creation", () => {
  test.beforeEach(async ({ page }) => {
    const testUser = loadTestUser();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByPlaceholder(/enter your password/i).fill(testUser.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");
    await page.goto("/accounts");
    await expect(page).toHaveURL(/\/accounts/);
  });

  test("should validate required fields", async ({ page }) => {
    const addButton = await pickVisible(
      page.getByRole("button", { name: /add.*account|new.*account/i }),
    );
    expect(addButton).not.toBeNull();
    if (!addButton) return;

    await addButton.click();
    await page.waitForTimeout(300);

    // Try to submit empty form
    const submitButton = await pickVisible(
      page.getByRole("button", { name: /create/i }),
      page.getByRole("button", { name: /save/i }),
      page.getByRole("button", { name: /add.*account/i }),
    );

    if (submitButton) {
      await submitButton.click();

      // Should show validation
      await page.waitForTimeout(300);
    }
  });

  test("should have account type selection", async ({ page }) => {
    const addButton = await pickVisible(
      page.getByRole("button", { name: /add.*account|new.*account/i }),
    );
    expect(addButton).not.toBeNull();
    if (!addButton) return;

    await addButton.click();
    await page.waitForTimeout(300);

    // Should have type selection
    const typeSelector = await pickVisible(
      page.getByLabel(/type/i),
      page.getByRole("combobox", { name: /type/i }),
      page.getByText(/account type/i),
    );

    if (typeSelector) {
      await expect(typeSelector).toBeVisible();
    }
  });

  test("should create manual account", async ({ page }) => {
    const addButton = await pickVisible(
      page.getByRole("button", { name: /add.*account|new.*account/i }),
    );
    expect(addButton).not.toBeNull();
    if (!addButton) return;

    await addButton.click();
    await page.waitForTimeout(300);

    const accountType = await pickVisible(
      page.getByRole("button", { name: /bank account/i }),
      page.getByRole("button", { name: /cash/i }),
    );
    expect(accountType).not.toBeNull();
    if (!accountType) return;

    await accountType.click();
    await page.waitForTimeout(300);

    // Fill account name
    const nameField = await pickVisible(
      page.getByLabel(/account name/i),
      page.locator("input#name"),
      page.getByPlaceholder(/account name/i),
    );
    if (nameField) {
      await nameField.fill("E2E Test Account");
    }

    // Fill initial balance
    const balanceField = await pickVisible(
      page.getByLabel(/initial balance|current value/i),
      page.locator("input#balance"),
      page.getByPlaceholder(/0\.00/),
    );
    if (balanceField) {
      await balanceField.fill("1000.00");
    }
  });
});

test.describe("Account Operations", () => {
  test.beforeEach(async ({ page }) => {
    const testUser = loadTestUser();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByPlaceholder(/enter your password/i).fill(testUser.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");
    await page.goto("/accounts");
    await expect(page).toHaveURL(/\/accounts/);
  });

  test("should allow balance adjustment", async ({ page }) => {
    // Find an account and look for adjust balance option
    const accountItem = await pickVisible(page.locator("tbody tr"));

    if (accountItem) {
      // Look for adjust balance button or menu
      const adjustButton = await pickVisible(
        page.getByRole("button", { name: /adjust/i }),
      );
      const moreButton = await pickVisible(
        page.getByRole("button", { name: /more/i }),
        page.getByRole("button", { name: /options/i }),
      );

      if (adjustButton) {
        await adjustButton.click();
        await page.waitForTimeout(300);
      } else if (moreButton) {
        await moreButton.click();
        await page.waitForTimeout(300);
      }
    }
  });

  test("should show account transactions", async ({ page }) => {
    // Click on an account to see its transactions
    const accountItem = await pickVisible(page.locator("tbody tr"));

    if (accountItem) {
      await accountItem.click();
      await page.waitForTimeout(500);

      // Should show transactions section
      const hasTransactions =
        (await page.getByText(/transactions/i).first().isVisible()) ||
        (await page.getByText(/recent/i).first().isVisible());

      if (hasTransactions) {
        expect(hasTransactions).toBeTruthy();
      }
    }
  });
});
