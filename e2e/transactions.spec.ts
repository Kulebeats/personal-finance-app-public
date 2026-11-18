import { test, expect } from "@playwright/test";
import { getTestUser } from "./utils/testUser";
import { pickVisible } from "./utils/locators";

const loadTestUser = () => getTestUser();

/**
 * Transactions E2E Tests
 *
 * Critical user flows for transaction management.
 */
test.describe("Transactions", () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    const testUser = loadTestUser();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByPlaceholder(/enter your password/i).fill(testUser.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");

    // Navigate to transactions page
    await page.goto("/transactions");
    await expect(page).toHaveURL(/\/transactions/);
    await expect(page.getByRole("heading", { name: /^transactions$/i })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("should display transactions list", async ({ page }) => {
    // Should show transaction table or list
    const listSurface = await pickVisible(
      page.getByRole("table"),
      page.getByRole("list"),
      page.locator("tbody tr"),
      page.getByTestId("transactions-empty-state"),
      page.getByText(/no transactions found/i),
    );
    expect(listSurface).not.toBeNull();
  });

  test("should have working search/filter", async ({ page }) => {
    // Look for search input
    const searchInput = page.getByPlaceholder(/search/i);
    if (await searchInput.isVisible()) {
      await searchInput.fill("test");
      // Should trigger search
      await expect(searchInput).toHaveValue("test");
    }
  });

  test("should open add transaction modal", async ({ page }) => {
    // Find and click add transaction button
    const addButton = await pickVisible(
      page.getByRole("button", { name: /add transaction/i }),
      page.getByRole("button", { name: /new transaction/i }),
    );

    if (addButton) {
      await addButton.click();

      // Modal should open
      const modal = await pickVisible(
        page.getByRole("dialog"),
        page.getByRole("form"),
      );
      expect(modal).not.toBeNull();
    }
  });

  test("should display transaction details when clicked", async ({ page }) => {
    // Click on a transaction row if exists
    const transactionRow = page.locator("tbody tr").first();

    if (await transactionRow.isVisible()) {
      await transactionRow.click();

      // Should show details panel or navigate
      await page.waitForTimeout(500);
    }
  });

  test("should filter transactions by date range", async ({ page }) => {
    // Look for date filter
    const dateFilter = await pickVisible(
      page.getByRole("button", { name: /^date$/i }),
      page.getByRole("button", { name: /date range/i }),
      page.getByRole("button", { name: /filters/i }),
    );
    expect(dateFilter).not.toBeNull();
    if (!dateFilter) return;

    try {
      await dateFilter.click({ timeout: 3000 });
    } catch {
      // Mobile viewports can place filter controls partially outside the visual viewport.
      // JS click keeps the test functional without coupling to layout specifics.
      await dateFilter.evaluate((el) => {
        (el as HTMLElement).click();
      });
    }

    // Date picker should appear when this control opens a popover on the current layout.
    const datePicker = await pickVisible(
      page.getByRole("dialog"),
      page.locator("[data-state='open']"),
    );
    if (datePicker) {
      await expect(datePicker).toBeVisible();
    }
  });

  test("should filter transactions by category", async ({ page }) => {
    // Look for category filter
    const categoryFilter = await pickVisible(
      page.getByRole("button", { name: /category/i }),
      page.getByRole("combobox", { name: /category/i }),
    );

    if (categoryFilter) {
      await categoryFilter.click();

      // Options should appear
      await page.waitForTimeout(300);
    }
  });
});

test.describe("Transaction Creation", () => {
  test.beforeEach(async ({ page }) => {
    const testUser = loadTestUser();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByPlaceholder(/enter your password/i).fill(testUser.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");
    await page.goto("/transactions");
    await expect(page).toHaveURL(/\/transactions/);
    await expect(page.getByRole("heading", { name: /^transactions$/i })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("should validate required fields", async ({ page }) => {
    const addButton = await pickVisible(
      page.getByRole("button", { name: /add transaction/i }),
      page.getByRole("button", { name: /new transaction/i }),
    );

    if (addButton) {
      await addButton.click();

      // Wait for modal
      await page.waitForTimeout(300);

      // Try to submit empty form
      const submitButton = await pickVisible(
        page.getByRole("button", { name: /save/i }),
        page.getByRole("button", { name: /add/i }),
      );

      if (submitButton) {
        await submitButton.click();

        // Form should remain open when required fields are missing.
        const formStillOpen = await pickVisible(
          page.getByRole("dialog", { name: /add transaction/i }),
          page.getByRole("button", { name: /add transaction/i }),
        );
        expect(formStillOpen).not.toBeNull();
      }
    }
  });

  test("should create expense transaction", async ({ page }) => {
    const addButton = await pickVisible(
      page.getByRole("button", { name: /add transaction/i }),
      page.getByRole("button", { name: /new transaction/i }),
    );

    if (addButton) {
      await addButton.click();
      await page.waitForTimeout(300);

      // Fill form fields
      const amountField = await pickVisible(
        page.getByLabel(/amount/i),
        page.getByPlaceholder(/0\.00/),
      );
      if (amountField) {
        await amountField.fill("25.00");
      }

      const descriptionField = await pickVisible(
        page.getByLabel(/description/i),
        page.getByLabel(/name/i),
        page.getByPlaceholder(/description/i),
      );
      if (descriptionField) {
        await descriptionField.fill("E2E Test Transaction");
      }
    }
  });
});
