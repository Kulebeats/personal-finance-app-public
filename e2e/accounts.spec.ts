/**
 * Accounts E2E (QA-01 rewrite).
 *
 * The previous version returned early whenever a control was missing
 * (`if (!addButton) return;`) and filled the create form without saving it.
 * Each test now runs on its own synthetic household with known accounts. A
 * required control that is missing fails, and creation is submitted and read
 * back in the UI and in the database.
 */
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "./protected-test";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { readBack, submitForData, type SubmitStep } from "./utils/submit";
import { testWithMutants } from "./utils/mutants";
import { responseValue, shownText, storedValue } from "./utils/observe";

/** The create write; its corrupt mutant saves a different name. */
const CREATE_ACCOUNT: SubmitStep = { name: "account", method: "POST", path: "/api/accounts", corruptField: "name" };
import { signInAs } from "./utils/fixture-session";

interface Seeded { fixture: CompletionFixture; accountId: string; accountName: string }

async function seededHousehold(): Promise<Seeded> {
  const fixture = await createCompletionFixture();
  const accountId = randomUUID();
  const accountName = `Synthetic current ${randomUUID().slice(0, 6)}`;
  await withFixtureClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("INSERT INTO accounts (id, household_id, name, type, balance, currency, is_private) VALUES ($1, $2, $3, 'checking', 1234.56, 'ZMW', false)",
        [accountId, fixture.householdId, accountName]);
      await client.query(`INSERT INTO transactions (household_id, account_id, category_id, owner_user_id, name, amount, currency, type, date)
        VALUES ($1, $2, $3, $4, 'Synthetic market stall', 30.00, 'ZMW', 'expense', current_date)`,
      [fixture.householdId, accountId, fixture.expenseCategoryId, fixture.userId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  });
  return { fixture, accountId, accountName };
}

/** The account's card on /accounts (AccountCard links to its detail page). */
const accountCard = (page: Page, id: string) => page.locator(`a[href="/accounts/${id}"]`);
/**
 * The card's name line. Not just the first bold div: the bank logo before it
 * is a bold initial ("S") when the account has no institution logo.
 */
const accountName = (page: Page, id: string) => accountCard(page, id).locator("div.font-bold.text-foreground.text-sm");
/** The card's balance, the bold line on its right. */
const accountBalance = (page: Page, id: string) => accountCard(page, id).locator(".text-right > div.font-bold");

async function openAccounts(page: Page, fixture: CompletionFixture) {
  await signInAs(page, fixture);
  await page.goto("/accounts");
  await expect(page.getByRole("button", { name: "Add a new account", exact: true })).toBeVisible({ timeout: 30_000 });
}

test.describe("Accounts", () => {
  test("lists the household's accounts with their balance", async ({ page }) => {
    const { fixture, accountId, accountName: name } = await seededHousehold();
    await openAccounts(page, fixture);
    // The seeded account's own card: its name, and exactly its balance (not a
    // group total or summary that happens to contain the digits).
    await expect(accountName(page, accountId)).toHaveText(name);
    await expect(accountBalance(page, accountId)).toHaveText(/^K\s?1,234\.56$/);
  });

  test("an account opens its detail page with its transactions", async ({ page }) => {
    const { fixture, accountId, accountName } = await seededHousehold();
    await openAccounts(page, fixture);
    await page.getByText(accountName, { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/accounts/${accountId}$`));
    await expect(page.getByRole("heading", { name: accountName })).toBeVisible();
    await expect(page.getByText("Synthetic market stall").first()).toBeVisible();
  });
});

test.describe("Account Creation", () => {
  test("an account needs a name before it can be saved", async ({ page }) => {
    const { fixture } = await seededHousehold();
    await openAccounts(page, fixture);
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/accounts") posts.push(request.url());
    });
    await page.getByRole("button", { name: "Add a new account", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /^Cash Physical Cash$/ }).click();
    // Whether the form disables Save or rejects the click, no request may leave
    // and the dialog must stay open. `force` clicks even a disabled button so
    // both designs are exercised the same way, without a branch.
    await dialog.getByRole("button", { name: "Save Account", exact: true }).click({ force: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Account Created", { exact: true })).toHaveCount(0);
    expect(posts).toEqual([]);
  });

  testWithMutants("creates a cash account and reads it back", { corrupt: [CREATE_ACCOUNT] }, async (page) => {
    const { fixture } = await seededHousehold();
    await openAccounts(page, fixture);
    await page.getByRole("button", { name: "Add a new account", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const name = `E2E cash ${randomUUID().slice(0, 6)}`;
    await dialog.getByRole("button", { name: /^Cash Physical Cash$/ }).click();
    await dialog.getByLabel("Account Name", { exact: true }).fill(name);
    await dialog.locator("#balance").fill("1000.00");
    const created = await submitForData<{ id: string; name: unknown }>(page, CREATE_ACCOUNT,
      () => dialog.getByRole("button", { name: "Save Account", exact: true }).click());
    await expect(dialog.getByText("Account Created", { exact: true })).toBeVisible();
    await page.goto("/accounts");
    await readBack(CREATE_ACCOUNT, name, {
      api: async () => responseValue(created.name, "name"),
      db: () => storedValue("SELECT name AS value FROM accounts WHERE id=$1", [created.id]),
      ui: () => shownText(accountName(page, created.id)),
    });
    await expect(accountBalance(page, created.id)).toHaveText(/^K\s?1,000\.00$/);
    const stored = await withFixtureClient((client) => client.query(
      "SELECT household_id, balance::text, currency FROM accounts WHERE id=$1", [created.id]));
    expect(stored.rows).toEqual([{ household_id: fixture.householdId, balance: "1000.00", currency: "ZMW" }]);
  });
});
