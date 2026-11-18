/**
 * Recurring E2E Tests
 *
 * Exercises the recurring feature as it is actually shipped
 * (client/src/pages/Recurring.tsx + client/src/features/recurring/**):
 * - The header (heading, upcoming total, calendar/list view toggle)
 * - Switching to list view and seeing either rules or the real empty state
 * - The "Upcoming Bills" sidebar, which always renders (with content or a
 *   real empty message)
 * - Month navigation
 * - The real "Add Recurring" transaction dialog
 * - The real pattern-detection ("Scan") dialog - this is the shipped
 *   equivalent of what the old spec called "Pattern Detection"
 *
 * The previous version of this file asserted on fictional `data-testid`
 * attributes (`detected-patterns`, `recurring-rule`, `paused-badge`,
 * `recurring-calendar`, ...) and native `<select>` filters that do not
 * exist on this page. None of that matched the shipped UI. The month-nav
 * buttons had no accessible name in the shipped markup (icon-only, no
 * `aria-label`); `aria-label="Previous/Next month"` was added to
 * `client/src/pages/Recurring.tsx` so this suite (and screen readers) can
 * target them without a brittle CSS/icon selector. Two real `data-testid`s
 * (`upcoming-bill-item`, `upcoming-bills-list`) were added to
 * `RecurringSummary.tsx` so the sidebar test can tell "has bills" from
 * "empty" apart without depending on wording of unrelated always-visible
 * controls.
 */

import { test, expect } from "@playwright/test";
import { login } from "./utils/login";

test.describe("Recurring", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/recurring");
    await expect(page).toHaveURL(/\/recurring/);
  });

  test("shows the header with total recurring and the view toggle", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Recurring", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("Total Recurring")).toBeVisible();
    await expect(page.getByLabel("Calendar view")).toBeVisible();
    await expect(page.getByLabel("List view")).toBeVisible();
  });

  test("switches to list view and shows rules or the real empty state", async ({
    page,
  }) => {
    await page.getByLabel("List view").click();

    const emptyState = page.getByRole("heading", {
      name: "No recurring rules",
    });
    const isEmpty = await emptyState.isVisible().catch(() => false);

    if (isEmpty) {
      await expect(
        page.getByRole("button", { name: /add your first rule/i }),
      ).toBeVisible();
    } else {
      // Real list header rendered by RecurringList once items exist.
      await expect(page.getByText("Merchant")).toBeVisible();
      await expect(page.getByText("Frequency")).toBeVisible();
    }
  });

  test("shows upcoming bills or the real empty message in the sidebar", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Upcoming Bills" }),
    ).toBeVisible();

    const itemCount = await page.getByTestId("upcoming-bill-item").count();
    if (itemCount === 0) {
      await expect(page.getByText("No upcoming bills")).toBeVisible();
    } else {
      expect(itemCount).toBeGreaterThan(0);
      await expect(page.getByText("No upcoming bills")).not.toBeVisible();
    }
  });

  test("navigates to the next and previous month", async ({ page }) => {
    const monthHeading = page.getByRole("heading", { level: 2 });
    const initialMonth = await monthHeading.textContent();

    await page.getByLabel("Next month").click();
    await expect(monthHeading).not.toHaveText(initialMonth ?? "");

    await page.getByLabel("Previous month").click();
    await expect(monthHeading).toHaveText(initialMonth ?? "");
  });

  test("opens the Add Recurring transaction dialog", async ({ page }) => {
    await page.getByRole("button", { name: /add recurring/i }).click();

    await expect(
      page.getByRole("dialog", { name: /add transaction/i }),
    ).toBeVisible();
  });

  test("opens the recurring pattern scan dialog", async ({ page }) => {
    await page.getByRole("button", { name: /^scan$/i }).click();

    const dialog = page.getByRole("dialog", { name: /recurring patterns/i });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/scan your history to find potential recurring/i),
    ).toBeVisible();
  });
});
