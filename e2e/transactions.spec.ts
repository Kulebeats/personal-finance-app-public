/**
 * Transactions E2E (QA-01 rewrite).
 *
 * The previous version guarded every step with `if (control)` or `if (await
 * x.isVisible())` and filled the add form without submitting, so it stayed
 * green with the controls missing or the save broken. Each test now runs on
 * its own synthetic household with known rows. A required control that is
 * missing fails the test, and the write test submits and reads the row back
 * in the UI and in the database.
 */
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "./protected-test";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { readBack, submitForData, type SubmitStep } from "./utils/submit";
import { testWithMutants } from "./utils/mutants";
import { LAST_SEGMENT, labelPart, responseValue, storedMoney } from "./utils/observe";
import { moneyValue, renderedMoney } from "./utils/money-value";

/** The create write; its corrupt mutant saves a different amount. */
const CREATE_TRANSACTION: SubmitStep = { name: "transaction", method: "POST", path: "/api/transactions", corruptField: "amount" };
import { signInAs } from "./utils/fixture-session";

interface Seeded { fixture: CompletionFixture; accountId: string; accountName: string }

async function seededHousehold(): Promise<Seeded> {
  const fixture = await createCompletionFixture();
  const accountId = randomUUID();
  const accountName = `Synthetic wallet ${randomUUID().slice(0, 6)}`;
  await withFixtureClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("INSERT INTO accounts (id, household_id, name, type, balance, currency, is_private) VALUES ($1, $2, $3, 'checking', 1000, 'ZMW', false)",
        [accountId, fixture.householdId, accountName]);
      await client.query(`INSERT INTO transactions (household_id, account_id, category_id, owner_user_id, name, amount, currency, type, date) VALUES
        ($1, $2, $3, $4, 'Synthetic coffee', 12.00, 'ZMW', 'expense', current_date),
        ($1, $2, $5, $4, 'Synthetic payroll', 900.00, 'ZMW', 'income', current_date)`,
      [fixture.householdId, accountId, fixture.expenseCategoryId, fixture.userId, fixture.incomeCategoryId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  });
  return { fixture, accountId, accountName };
}

async function openTransactions(page: Page, fixture: CompletionFixture, query = "") {
  await signInAs(page, fixture);
  await page.goto(`/transactions${query}`);
  await expect(page.getByRole("heading", { name: "Transactions", level: 1 })).toBeVisible({ timeout: 30_000 });
}

const row = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^View ${name}, `) });

test.describe("Transactions", () => {
  test("lists the household's transactions", async ({ page }) => {
    const { fixture } = await seededHousehold();
    await openTransactions(page, fixture);
    await expect(row(page, "Synthetic coffee")).toBeVisible();
    await expect(row(page, "Synthetic payroll")).toBeVisible();
    await expect(row(page, "Synthetic coffee").getByText("Golden Expense", { exact: true })).toBeVisible();
  });

  test("search narrows the list on the server", async ({ page }) => {
    const { fixture } = await seededHousehold();
    await openTransactions(page, fixture);
    await expect(row(page, "Synthetic payroll")).toBeVisible();
    const searched = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/transactions" && url.searchParams.get("search") === "coffee";
    });
    await page.getByRole("textbox", { name: "Search transactions" }).fill("coffee");
    const response = await searched;
    expect(response.status()).toBe(200);
    // The server filtered: the response itself holds only the coffee row, so a
    // client that hides payroll over an unfiltered response does not pass.
    const body = await response.json() as { success: boolean; data: { name: string }[] };
    expect(body.success).toBe(true);
    expect(body.data.map((transaction) => transaction.name)).toEqual(["Synthetic coffee"]);
    await expect(row(page, "Synthetic coffee")).toBeVisible();
    await expect(row(page, "Synthetic payroll")).toHaveCount(0);
  });

  test("a category filter in the URL shows only that category", async ({ page }) => {
    const { fixture } = await seededHousehold();
    await openTransactions(page, fixture, `?categoryId=${fixture.incomeCategoryId}`);
    await expect(row(page, "Synthetic payroll")).toBeVisible();
    await expect(row(page, "Synthetic coffee")).toHaveCount(0);
  });

  test("a row opens its detail panel", async ({ page }) => {
    const { fixture, accountName } = await seededHousehold();
    await openTransactions(page, fixture);
    await row(page, "Synthetic coffee").click();
    const detail = page.getByRole("dialog", { name: "Transaction details" });
    await expect(detail).toBeVisible();
    await expect(detail.getByRole("heading", { name: "Synthetic coffee", level: 2 })).toBeVisible();
    await expect(detail.getByRole("link", { name: accountName })).toBeVisible();
    await detail.getByRole("button", { name: "Close" }).click();
    await expect(detail).toBeHidden();
  });
});

test.describe("Transaction Creation", () => {
  test("an empty submit is refused with a visible error and no request", async ({ page }) => {
    const { fixture } = await seededHousehold();
    await openTransactions(page, fixture);
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/transactions") posts.push(request.url());
    });
    await page.getByRole("button", { name: "Add Transaction", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add Transaction", exact: true });
    await dialog.getByRole("button", { name: "Add Transaction", exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[aria-invalid=true]").first()).toBeVisible();
    expect(posts).toEqual([]);
  });

  testWithMutants("creates an expense and reads it back", { corrupt: [CREATE_TRANSACTION] }, async (page) => {
    const { fixture, accountId, accountName } = await seededHousehold();
    await openTransactions(page, fixture);
    await page.getByRole("button", { name: "Add Transaction", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add Transaction", exact: true });
    await dialog.getByPlaceholder("0.00", { exact: true }).fill("25.00");
    // An expense needs a merchant name (form schema); a typed new name is kept.
    await dialog.getByRole("combobox").filter({ hasText: "Select merchant" }).click();
    await page.getByPlaceholder("Search merchants...", { exact: true }).fill("Synthetic corner shop");
    await page.getByPlaceholder("Search merchants...", { exact: true }).press("Escape");
    await dialog.getByRole("combobox", { name: "Account", exact: true }).click();
    await page.getByRole("option", { name: accountName, exact: true }).click();
    await dialog.getByRole("combobox", { name: "Category", exact: true }).click();
    await page.getByRole("option", { name: /Golden Expense$/ }).click();
    const created = await submitForData<{ id: string; amount: unknown }>(page, CREATE_TRANSACTION,
      () => dialog.getByRole("button", { name: "Add Transaction", exact: true }).click());
    await expect(dialog).toBeHidden();
    await page.reload();
    // The new row is the one that is neither seeded transaction.
    const newRow = page.getByRole("button", { name: /^View (?!Synthetic coffee, |Synthetic payroll, ).+, / });
    // Amount and currency, everywhere: a ZMW expense shown as US$25.00 fails.
    await readBack(CREATE_TRANSACTION, moneyValue("25.00", "ZMW"), {
      api: async () => responseValue(created.amount, "amount"),
      db: () => storedMoney("SELECT amount::text AS amount, currency FROM transactions WHERE id=$1", [created.id]),
      ui: async () => renderedMoney(await labelPart(newRow, LAST_SEGMENT)),
    });
    await expect(newRow.getByText("Golden Expense", { exact: true })).toBeVisible();
    const stored = await withFixtureClient((client) => client.query(
      "SELECT household_id, account_id, category_id, type FROM transactions WHERE id=$1", [created.id]));
    expect(stored.rows).toEqual([{ household_id: fixture.householdId, account_id: accountId,
      category_id: fixture.expenseCategoryId, type: "expense" }]);
  });
});
