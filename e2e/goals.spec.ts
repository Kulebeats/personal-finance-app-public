/**
 * Goals E2E Tests
 *
 * Exercises the goals feature as it is actually shipped
 * (client/src/pages/Goals.tsx + client/src/features/goals/**):
 * - Viewing the Save Up / Pay Down tabs
 * - Creating a save-up goal through the real wizard (Radix Select, not a
 *   native <select>) and confirming it renders in the list
 * - Opening the goal detail dialog and confirming its real tabs
 * - Opening the "Goal accounts" and "Create goal transfer" dialogs
 *
 * The previous version of this file asserted on fictional selectors
 * (`input[name="goalType"]`, `[data-testid="goal-card"]`, "K5,000" text,
 * a debt-payoff creation flow with no matching form, archive/complete
 * lifecycle actions that do not exist, keyboard/ARIA assertions against
 * markup that isn't there) and none of it matched the shipped UI.
 */

import { test, expect, type Page } from "./protected-test";
import { login } from "./utils/login";
import { selectRadixOption } from "./utils/locators";

/**
 * Creates a save-up goal through the real wizard and returns its name.
 * The wizard is a two-step flow: fill details -> "Continue" -> assignment
 * step (no account assignment required) -> "Create goal".
 */
async function createSaveUpGoal(page: Page): Promise<string> {
  const goalName = `E2E Save Goal ${Date.now()}`;

  await page.getByRole("button", { name: "New Goal" }).click();
  const dialog = page.getByRole("dialog", { name: /create a goal/i });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Goal name").fill(goalName);
  // Default goal type is "other", which requires an extra free-text field.
  // Picking a concrete type keeps the form to the fields under test.
  await selectRadixOption(page, dialog.getByLabel("Goal type"), "Vacation");
  await dialog.getByLabel("Target amount").fill("500");

  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Create goal" }).click();

  await expect(dialog).not.toBeVisible();
  return goalName;
}

test.describe("Goals", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/goals");
    await expect(page).toHaveURL(/\/goals/);
  });

  test("displays the Save Up / Pay Down tabs with summary cards", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Goals", level: 1 }),
    ).toBeVisible();

    await expect(
      page.getByRole("tab", { name: "Save Up" }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Pay Down" })).toBeVisible();

    // The Save Up tab is selected by default and always renders these
    // summary cards, regardless of whether any goals exist yet.
    await expect(page.getByText("Total Saved")).toBeVisible();
    await expect(page.getByText("Monthly Projection")).toBeVisible();
  });

  test("switching to Pay Down shows the debt summary cards", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: "Pay Down" }).click();

    await expect(page.getByText("Total Debt")).toBeVisible();
    await expect(page.getByText("Monthly Payments")).toBeVisible();
  });

  test("creates a save-up goal through the wizard and shows it in the list", async ({
    page,
  }) => {
    const goalName = await createSaveUpGoal(page);

    // The goal name also appears in the success toast ("X has been added."),
    // so scope to the card's own heading rather than a bare text match.
    await expect(
      page.getByRole("heading", { name: goalName, level: 3 }),
    ).toBeVisible();
  });

  test("opens the goal detail dialog with the real tabs", async ({
    page,
  }) => {
    const goalName = await createSaveUpGoal(page);

    await page.getByRole("heading", { name: goalName, level: 3 }).click();

    const detailDialog = page.getByRole("dialog", { name: /goal details/i });
    await expect(detailDialog).toBeVisible();
    await expect(
      detailDialog.getByRole("tab", { name: "Overview" }),
    ).toBeVisible();
    await expect(
      detailDialog.getByRole("tab", { name: "Assignments" }),
    ).toBeVisible();
    await expect(
      detailDialog.getByRole("tab", { name: "Transfers" }),
    ).toBeVisible();
    await expect(
      detailDialog.getByRole("tab", { name: "Activity" }),
    ).toBeVisible();
  });

  test("opens the goal accounts dialog", async ({ page }) => {
    await page.getByRole("button", { name: "Goal accounts" }).click();

    await expect(
      page.getByRole("dialog", { name: /edit goal accounts/i }),
    ).toBeVisible();
  });

  test("opens the create goal transfer dialog", async ({ page }) => {
    await page.getByRole("button", { name: "Create goal transfer" }).click();

    await expect(
      page.getByRole("dialog", { name: /transfer.*contribute/i }),
    ).toBeVisible();
  });
});
