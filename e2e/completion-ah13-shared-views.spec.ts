import { test, expect } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { signInAs } from "./utils/fixture-session";

/**
 * AH-13: the old Premium panel is gone and "shared views" is a real feature. An
 * owner names a filter in Settings > Members, it is stored, it survives a reload,
 * and Apply opens the Transactions list with that filter in the URL.
 */
test("an owner saves a shared view that persists and applies to Transactions", async ({ page }) => {
  const fixture = await createCompletionFixture();
  await signInAs(page, fixture);

  await page.goto("/settings/members");
  await expect(page.getByText("Shared views", { exact: true }).first()).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/premium|upgrade|your plan|unlimited|advisor access/i);

  await page.getByRole("button", { name: "New view", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New shared view" });
  await dialog.getByLabel("Name", { exact: true }).fill("AH13 groceries");
  await dialog.getByLabel("Search text", { exact: true }).fill("ah13-market");
  const saved = page.waitForResponse(response =>
    response.request().method() === "POST" && new URL(response.url()).pathname.includes("saved-views"));
  await dialog.getByRole("button", { name: "Save view", exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(dialog).toBeHidden();

  const list = page.getByRole("list", { name: "Shared views" });
  await expect(list.getByText("AH13 groceries", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("list", { name: "Shared views" }).getByText("AH13 groceries", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Apply AH13 groceries", exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\?(?:.*&)?q=ah13-market(?:&|$)/);
});
