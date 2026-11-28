import { expect } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { signInAs } from "./utils/fixture-session";
import { readBack, submitForData, type SubmitStep } from "./utils/submit";
import { testWithMutants } from "./utils/mutants";
import { responseValue, storedValue } from "./utils/observe";

/** The dialog's create write; its corrupt mutant stores a different view name (QA-01, scripts/e2e-mutation-check.mjs). */
const CREATE_VIEW: SubmitStep = { name: "shared-view", method: "POST", path: "/api/settings/saved-views", corruptField: "name" };
const VIEW_NAME = "AH13 groceries";

/**
 * AH-13: the old Premium panel is gone and "shared views" is a real feature. An
 * owner names a filter in Settings > Members, it is stored, it survives a reload,
 * and Apply opens the Transactions list with that filter in the URL.
 */
testWithMutants("an owner saves a shared view that persists and applies to Transactions", { corrupt: [CREATE_VIEW] }, async (page) => {
  const fixture = await createCompletionFixture();
  await signInAs(page, fixture);

  await page.goto("/settings/members");
  await expect(page.getByText("Shared views", { exact: true }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/premium|upgrade|your plan|unlimited|advisor access/i);

  await page.getByRole("button", { name: "New view", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New shared view" });
  await dialog.getByLabel("Name", { exact: true }).fill(VIEW_NAME);
  await dialog.getByLabel("Search text", { exact: true }).fill("ah13-market");
  const saved = await submitForData<{ id: string; name: unknown }>(page, CREATE_VIEW,
    () => dialog.getByRole("button", { name: "Save view", exact: true }).click());
  await expect(dialog).toBeHidden();
  // The stored name, before the list and Apply checks below, which a wrong name would also fail.
  await readBack(CREATE_VIEW, VIEW_NAME, {
    created: async () => responseValue(saved.name, "name"),
    db: () => storedValue("SELECT name AS value FROM household_saved_views WHERE id=$1 AND household_id=$2", [saved.id, fixture.householdId]),
  });

  const list = page.getByRole("list", { name: "Shared views" });
  await expect(list.getByText("AH13 groceries", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("list", { name: "Shared views" }).getByText("AH13 groceries", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Apply AH13 groceries", exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\?(?:.*&)?q=ah13-market(?:&|$)/);
});
