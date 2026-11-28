import { randomUUID } from "node:crypto";
import { expect, type Page } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { readBack, submitForData, type SubmitStep } from "./utils/submit";
import { testWithMutants } from "./utils/mutants";
import { LAST_SEGMENT, labelPart, responseValue, storedMoney } from "./utils/observe";
import { moneyValue, renderedMoney } from "./utils/money-value";

/** The category-picker transaction's write; its corrupt mutant saves a different amount (QA-01, scripts/e2e-mutation-check.mjs). */
const CREATE_TRANSACTION: SubmitStep = { name: "transaction", method: "POST", path: "/api/transactions", corruptField: "amount" };

async function submitCreated(page: Page, path: string, submit: () => Promise<void>) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === "POST");
  await submit();
  const response = await pending;
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.success).toBe(true);
  const id = path === "/api/household" ? body.data.household.id : body.data.id;
  expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  return id as string;
}

testWithMutants("new household defaults support a real category-picker transaction", { corrupt: [CREATE_TRANSACTION] }, async (page) => {
  const fixture = await createCompletionFixture();
  // Independently verified synthetic actor; this is not email-verification proof.
  // Keep the old household's Golden categories as an isolation control.
  await withFixtureClient(client => client.query(
    "DELETE FROM household_members WHERE user_id=$1 AND household_id=$2", [fixture.userId, fixture.householdId]));
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByPlaceholder(/enter your password/i).fill(fixture.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("heading", { name: /create your household/i })).toBeVisible();
  await page.getByLabel("Household Name", { exact: true }).fill(`Defaults ${randomUUID().slice(0, 8)}`);
  const householdId = await submitCreated(page, "/api/household", () =>
    page.getByRole("button", { name: "Create Household", exact: true }).click());
  expect(householdId).not.toBe(fixture.householdId);

  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add a new account", exact: true }).click();
  const accountDialog = page.getByRole("dialog");
  const accountName = `Default category account ${randomUUID().slice(0, 8)}`;
  await accountDialog.getByRole("button", { name: /^Cash Physical Cash$/ }).click();
  await accountDialog.getByLabel("Account Name", { exact: true }).fill(accountName);
  await accountDialog.locator("#balance").fill("0");
  const accountId = await submitCreated(page, "/api/accounts", () =>
    accountDialog.getByRole("button", { name: "Save Account", exact: true }).click());
  await expect(accountDialog.getByText("Account Created", { exact: true })).toBeVisible();

  await page.goto("/transactions");
  await page.getByRole("button", { name: "Add Transaction", exact: true }).click();
  const transactionDialog = page.getByRole("dialog", { name: "Add Transaction", exact: true });
  await transactionDialog.getByRole("button", { name: "CREDIT (Income)", exact: true }).click();
  await transactionDialog.getByPlaceholder("0.00", { exact: true }).fill("20.00");
  await transactionDialog.getByRole("combobox", { name: "Account", exact: true }).click();
  await page.getByRole("option", { name: accountName, exact: true }).click();
  await transactionDialog.getByRole("combobox", { name: "Category", exact: true }).click();
  await expect(page.getByRole("option", { name: "Golden Income", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: /Salary - Primary Job$/ }).click();
  const created = await submitForData<{ id: string; amount: unknown }>(page, CREATE_TRANSACTION, () =>
    transactionDialog.getByRole("button", { name: "Add Transaction", exact: true }).click());
  const transactionId = created.id;
  expect(transactionId).toMatch(/^[0-9a-f-]{36}$/i);
  await expect(transactionDialog).toBeHidden();
  await page.reload();
  // The amount everywhere, before the row and row checks below, which a wrong amount would also fail.
  await readBack(CREATE_TRANSACTION, moneyValue("20.00", "ZMW"), {
    api: async () => responseValue(created.amount, "amount"),
    db: () => storedMoney("SELECT amount::text AS amount, currency FROM transactions WHERE id=$1 AND household_id=$2",
      [transactionId, householdId]),
    ui: async () => renderedMoney(await labelPart(page.getByRole("button", { name: /^View Income, / }), LAST_SEGMENT)),
  });
  const incomeRow = page.getByRole("button", { name: /^View Income, .*20\.00$/ });
  await expect(incomeRow.getByText("Salary - Primary Job", { exact: true })).toBeVisible();

  const persisted = await withFixtureClient(client => client.query<{
    id: string; household_id: string; account_id: string; amount: string;
    category_id: string; category_household: string; category_name: string;
    group_household: string; group_name: string;
  }>(`SELECT t.id, t.household_id, t.account_id, t.amount::text, t.category_id,
      c.household_id AS category_household, c.name AS category_name,
      g.household_id AS group_household, g.name AS group_name
    FROM transactions t JOIN categories c ON c.id=t.category_id
    JOIN category_groups g ON g.id=c.group_id WHERE t.id=$1`, [transactionId]));
  expect(persisted.rows).toHaveLength(1);
  expect(persisted.rows[0]).toMatchObject({ id: transactionId, household_id: householdId,
    account_id: accountId, amount: "20.00", category_household: householdId,
    category_name: "Salary - Primary Job", group_household: householdId, group_name: "Income" });
  expect(persisted.rows[0].category_id).not.toBe(fixture.incomeCategoryId);
});
