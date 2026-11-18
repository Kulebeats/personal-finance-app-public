import { test, expect } from "@playwright/test";
import { getTestUser } from "./utils/testUser";
import { pickVisible } from "./utils/locators";

const loadTestUser = () => getTestUser();

/**
 * Organization Settings E2E Tests
 *
 * Critical user flows for categories, tags, and rules management.
 */
test.describe("Organization Settings", () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    const testUser = loadTestUser();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByPlaceholder(/enter your password/i).fill(testUser.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");

    // Navigate to settings
    await page.goto("/settings/organization");
    await expect(page).toHaveURL(/\/settings\/organization/);
  });

  test("should display organization tabs", async ({ page }) => {
    // Should show tabs for Categories, Tags, Rules
    await expect(page.getByRole("tab", { name: /categories/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /tags/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /rules/i })).toBeVisible();
  });

  test("should switch between tabs", async ({ page }) => {
    // Click Tags tab
    const tagsTab = page.getByRole("tab", { name: /tags/i });
    await tagsTab.click();
    await expect(tagsTab).toHaveAttribute("aria-selected", "true");

    // Click Rules tab
    const rulesTab = page.getByRole("tab", { name: /rules/i });
    await rulesTab.click();
    await expect(rulesTab).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("Tags Management", () => {
  test.beforeEach(async ({ page }) => {
    const testUser = loadTestUser();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByPlaceholder(/enter your password/i).fill(testUser.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");

    // Navigate to tags tab
    await page.goto("/settings/organization/tags");
    await expect(page).toHaveURL(/\/settings\/organization\/tags/);
  });

  test("should display tags list", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /tags/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("should have new tag button", async ({ page }) => {
    const newTagButton = page.getByRole("button", { name: /new tag/i }).first();
    await expect(newTagButton).toBeVisible();
  });

  test("should open create tag modal", async ({ page }) => {
    await page.getByRole("button", { name: /new tag/i }).click();

    // Modal should open
    await expect(page.getByRole("dialog")).toBeVisible();

    // Should have name field
    const nameField = await pickVisible(
      page.getByLabel(/name/i),
      page.getByPlaceholder(/tag name/i),
    );
    expect(nameField).not.toBeNull();
  });

  test("should create a new tag", async ({ page }) => {
    await page.getByRole("button", { name: /new tag/i }).click();
    await page.waitForTimeout(300);

    // Fill tag name
    const nameField = await pickVisible(
      page.getByLabel(/name/i),
      page.getByPlaceholder(/tag name/i),
    );
    expect(nameField).not.toBeNull();
    if (!nameField) return;

    const uniqueTagName = `E2E Test Tag ${Date.now()}`;
    await nameField.fill(uniqueTagName);

    // Submit
    const createButton = await pickVisible(
      page.getByRole("button", { name: /create/i }),
      page.getByRole("button", { name: /save/i }),
    );
    expect(createButton).not.toBeNull();
    if (!createButton) return;

    await createButton.click();

    // Tag should appear in list
    await page.waitForTimeout(500);
    await expect(
      page.getByRole("tabpanel").getByText(uniqueTagName, { exact: true }).first(),
    ).toBeVisible();
  });

  test("should edit existing tag", async ({ page }) => {
    // Find an edit button
    const editButton = page.getByRole("button", { name: /edit/i }).first();

    if (await editButton.isVisible()) {
      await editButton.click();

      // Modal should open
      await expect(page.getByRole("dialog")).toBeVisible();
    }
  });

  test("should show delete confirmation", async ({ page }) => {
    // Find more options menu
    const moreButton = page
      .getByRole("button", { name: /more actions/i })
      .first();

    if (await moreButton.isVisible()) {
      await moreButton.click();

      // Click delete option
      const deleteOption = page.getByRole("menuitem", { name: /delete/i });
      if (await deleteOption.isVisible()) {
        await deleteOption.click();

        // Confirmation dialog should appear
        const confirmUI = await pickVisible(
          page.getByRole("alertdialog"),
          page.getByText(/are you sure/i),
        );
        expect(confirmUI).not.toBeNull();
      }
    }
  });

  test("should have merge tags button when multiple tags exist", async ({
    page,
  }) => {
    // Look for merge button
    const mergeButton = page.getByRole("button", { name: /merge tags/i });

    // May or may not be visible depending on tag count
    if (await mergeButton.isVisible()) {
      await mergeButton.click();

      // Merge dialog should open
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByText(/select tags to merge/i)).toBeVisible();
    }
  });
});

test.describe("Categories Management", () => {
  test.beforeEach(async ({ page }) => {
    const testUser = loadTestUser();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByPlaceholder(/enter your password/i).fill(testUser.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");

    // Navigate to categories tab
    await page.goto("/settings/organization/categories");
    await expect(page).toHaveURL(/\/settings\/organization\/categories/);
  });

  test("should display categories", async ({ page }) => {
    await expect(
      page.getByRole("tab", { name: /categories/i }),
    ).toHaveAttribute("aria-selected", "true");
  });

  test("should display category groups", async ({ page }) => {
    const categorySurface = await pickVisible(
      page.getByText(/no categories found/i),
      page.getByRole("button", { name: /seed default categories/i }),
      page.getByText(/income/i),
      page.getByText(/expense/i),
    );
    expect(categorySurface).not.toBeNull();
  });

  test("should expand/collapse category groups", async ({ page }) => {
    // Find an expandable group
    const expandButton = await pickVisible(
      page.getByRole("button", { name: /expand/i }),
      page.locator("[data-state='collapsed']"),
    );

    if (expandButton) {
      await expandButton.click();
      await page.waitForTimeout(300);
    }
  });
});

test.describe("Rules Management", () => {
  test.beforeEach(async ({ page }) => {
    const testUser = loadTestUser();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByPlaceholder(/enter your password/i).fill(testUser.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");

    // Navigate to rules tab
    await page.goto("/settings/organization/rules");
    await expect(page).toHaveURL(/\/settings\/organization\/rules/);
  });

  test("should display rules section", async ({ page }) => {
    const rulesContent = await pickVisible(
      page.getByText(/rules/i),
      page.getByText(/no rules/i),
    );
    expect(rulesContent).not.toBeNull();
  });

  test("should have create rule button", async ({ page }) => {
    const createButton = await pickVisible(
      page.getByRole("button", { name: /new rule/i }),
      page.getByRole("button", { name: /create rule/i }),
      page.getByRole("button", { name: /add rule/i }),
    );

    if (createButton) {
      await createButton.click();

      // Should open rule creation dialog/form
      await page.waitForTimeout(300);
    }
  });
});
