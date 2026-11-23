/**
 * Organization settings E2E: categories, tags, rules (QA-01 rewrite).
 *
 * The previous version wrapped edit, delete, merge and rule creation in
 * `if (await x.isVisible())`, so it passed with those controls gone. Each
 * test now runs on its own synthetic household with two known tags. A missing
 * control fails the test, and every tag write is submitted and read back in
 * the UI and in the database.
 */
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "./protected-test";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { readBack, submitStep, type SubmitStep } from "./utils/submit";
import { testWithMutants } from "./utils/mutants";
import { escapeRegExp, labelPart, storedValue } from "./utils/observe";

/** The tag rename write; its corrupt mutant saves a different name. */
const RENAME_TAG: SubmitStep = { name: "tag-edit", method: "PUT", path: /^\/api\/tags\/[0-9a-f-]+$/, corruptField: "name" };
import { signInAs } from "./utils/fixture-session";

interface Seeded { fixture: CompletionFixture; tagA: string; tagB: string }

async function seededHousehold(): Promise<Seeded> {
  const fixture = await createCompletionFixture();
  const suffix = randomUUID().slice(0, 6);
  const tagA = `Synthetic travel ${suffix}`, tagB = `Synthetic family ${suffix}`;
  await withFixtureClient((client) => client.query(
    "INSERT INTO tags (household_id, name, color) VALUES ($1, $2, '#3B82F6'), ($1, $3, '#22C55E')",
    [fixture.householdId, tagA, tagB]));
  return { fixture, tagA, tagB };
}

async function open(page: Page, fixture: CompletionFixture, path: string) {
  await signInAs(page, fixture);
  await page.goto(path);
}

const tagRows = (householdId: string) => withFixtureClient(async (client) =>
  (await client.query<{ name: string }>("SELECT name FROM tags WHERE household_id=$1 ORDER BY name", [householdId])).rows.map((row) => row.name));

test.describe("Organization Settings", () => {
  test("switches between the Categories, Tags and Rules tabs", async ({ page }) => {
    const { fixture } = await seededHousehold();
    await open(page, fixture, "/settings/organization");
    for (const name of ["Tags", "Rules", "Categories"]) {
      const tab = page.getByRole("tab", { name: new RegExp(`^${name}`) });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
    }
  });

  test("lists the household's category groups and categories", async ({ page }) => {
    const { fixture } = await seededHousehold();
    await open(page, fixture, "/settings/organization/categories");
    await expect(page.getByText("Golden Expense", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Golden Income", { exact: true }).first()).toBeVisible();
  });
});

test.describe("Tags Management", () => {
  test("lists the household's tags", async ({ page }) => {
    const { fixture, tagA, tagB } = await seededHousehold();
    await open(page, fixture, "/settings/organization/tags");
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByText(tagA, { exact: true })).toBeVisible();
    await expect(panel.getByText(tagB, { exact: true })).toBeVisible();
  });

  test("creates a tag and reads it back", async ({ page }) => {
    const { fixture, tagA, tagB } = await seededHousehold();
    await open(page, fixture, "/settings/organization/tags");
    await page.getByRole("button", { name: /new tag/i }).first().click();
    const dialog = page.getByRole("dialog", { name: "New tag" });
    const name = `E2E tag ${randomUUID().slice(0, 6)}`;
    await dialog.getByLabel("Color & Name").fill(name);
    const response = await submitStep(page, { name: "tag", method: "POST", path: "/api/tags" },
      () => dialog.getByRole("button", { name: "Save" }).click());
    expect(response.status()).toBe(201);
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.getByRole("tabpanel").getByText(name, { exact: true })).toBeVisible();
    expect(await tagRows(fixture.householdId)).toEqual([name, tagB, tagA].sort());
  });

  testWithMutants("renames a tag and reads it back", { corrupt: [RENAME_TAG] }, async (page) => {
    const { fixture, tagA, tagB } = await seededHousehold();
    await open(page, fixture, "/settings/organization/tags");
    await page.getByRole("button", { name: `Edit ${tagA} tag` }).click();
    const dialog = page.getByRole("dialog", { name: "Edit tag" });
    const renamed = `${tagA} renamed`;
    await dialog.getByLabel("Color & Name").fill(renamed);
    const response = await submitStep(page, RENAME_TAG,
      () => dialog.getByRole("button", { name: "Save" }).click());
    expect(response.ok()).toBe(true);
    const tagId = new URL(response.url()).pathname.split("/").pop();
    await page.reload();
    // The edited tag's own Edit button: the one that is not tagB's.
    const editedTag = page.getByRole("button", { name: new RegExp(`^Edit (?!${escapeRegExp(tagB)} tag$).+ tag$`) });
    await readBack(RENAME_TAG, renamed, {
      db: () => storedValue("SELECT name AS value FROM tags WHERE id=$1 AND household_id=$2", [tagId, fixture.householdId]),
      ui: () => labelPart(editedTag, /^Edit (.+) tag$/),
    });
    await expect(page.getByRole("tabpanel").getByText(renamed, { exact: true })).toBeVisible();
    expect(await tagRows(fixture.householdId)).toEqual([renamed, tagB].sort());
  });

  test("deletes a tag only after confirmation", async ({ page }) => {
    const { fixture, tagA, tagB } = await seededHousehold();
    await open(page, fixture, "/settings/organization/tags");
    await page.getByRole("button", { name: `More actions for ${tagA}` }).click();
    await page.getByRole("menuitem", { name: /delete/i }).click();
    const confirm = page.getByRole("alertdialog", { name: "Delete tag?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    expect(await tagRows(fixture.householdId)).toEqual([tagA, tagB].sort());

    await page.getByRole("button", { name: `More actions for ${tagA}` }).click();
    await page.getByRole("menuitem", { name: /delete/i }).click();
    const response = await submitStep(page, { name: "tag-delete", method: "DELETE", path: /^\/api\/tags\/[0-9a-f-]+$/ },
      () => confirm.getByRole("button", { name: "Delete" }).click());
    expect(response.ok()).toBe(true);
    await page.reload();
    await expect(page.getByRole("tabpanel").getByText(tagA, { exact: true })).toHaveCount(0);
    expect(await tagRows(fixture.householdId)).toEqual([tagB]);
  });

  test("offers a merge dialog when the household has several tags", async ({ page }) => {
    const { fixture } = await seededHousehold();
    await open(page, fixture, "/settings/organization/tags");
    await page.getByRole("button", { name: /merge tags/i }).click();
    const dialog = page.getByRole("dialog", { name: "Merge Tags" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Select tags to merge", { exact: true })).toBeVisible();
  });
});

test.describe("Rules Management", () => {
  test("opens the rule editor from the Rules tab", async ({ page }) => {
    const { fixture } = await seededHousehold();
    await open(page, fixture, "/settings/organization/rules");
    await page.getByRole("button", { name: "New Rule (Editor)", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});
