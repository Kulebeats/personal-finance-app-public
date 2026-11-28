import { randomUUID } from "node:crypto";
import { expect } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { signInAs } from "./utils/fixture-session";
import { readBack, submitForData, type SubmitStep } from "./utils/submit";
import { testWithMutants } from "./utils/mutants";
import { responseValue, storedMoney } from "./utils/observe";
import { moneyValue } from "./utils/money-value";

/** The dialog's create write; its corrupt mutant saves a different amount (QA-01, scripts/e2e-mutation-check.mjs). */
const CREATE_TRANSACTION: SubmitStep = { name: "transaction", method: "POST", path: "/api/transactions", corruptField: "amount" };

/**
 * FIN-17: the Transactions summary is never stale after a write. A transaction
 * added through the page's own dialog shows in the summary without a reload, and
 * the new totals come from a summary read made after the write committed.
 */
testWithMutants("the transaction summary refreshes after a transaction is added", { corrupt: [CREATE_TRANSACTION] }, async (page) => {
  const fixture = await createCompletionFixture();
  const accountName = `FIN17 cash ${randomUUID().slice(0, 8)}`;
  await withFixtureClient(client => client.query(
    "INSERT INTO accounts (id, household_id, name, type, balance, currency, is_private) VALUES ($1, $2, $3, 'checking', 0, 'ZMW', false)",
    [randomUUID(), fixture.householdId, accountName]));
  await signInAs(page, fixture);

  // Responses in arrival order, so "a summary read after the write" needs no clock.
  const responses: string[] = [];
  page.on("response", response => {
    const { pathname } = new URL(response.url());
    if (pathname === "/api/transactions/summary" && response.ok()) responses.push("summary");
    if (pathname === "/api/transactions" && response.request().method() === "POST") responses.push("write");
  });

  await page.goto("/transactions");
  const summary = page.getByRole("region", { name: "Transaction summary" });
  // The count has its own element. Matching it exactly keeps the date range out of
  // the match, and "10 transactions" does not pass for "0 transactions".
  await expect(summary.getByText("0 transactions", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add Transaction", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add Transaction", exact: true });
  await dialog.getByRole("button", { name: "CREDIT (Income)", exact: true }).click();
  await dialog.getByPlaceholder("0.00", { exact: true }).fill("20.00");
  await dialog.getByRole("combobox", { name: "Account", exact: true }).click();
  await page.getByRole("option", { name: accountName, exact: true }).click();
  await dialog.getByRole("combobox", { name: "Category", exact: true }).click();
  await page.getByRole("option", { name: "Golden Income", exact: true }).click();
  const created = await submitForData<{ id: string; amount: unknown }>(page, CREATE_TRANSACTION,
    () => dialog.getByRole("button", { name: "Add Transaction", exact: true }).click());
  await expect(dialog).toBeHidden();
  // The saved amount, before the summary checks below, which a wrong amount would also fail.
  await readBack(CREATE_TRANSACTION, moneyValue("20.00", "ZMW"), {
    api: async () => responseValue(created.amount, "amount"),
    db: () => storedMoney("SELECT amount::text AS amount, currency FROM transactions WHERE id=$1 AND household_id=$2",
      [created.id, fixture.householdId]),
  });

  // No reload: the open page must pick up the write by itself.
  await expect(summary.getByText("1 transaction", { exact: true })).toBeVisible();
  await expect(summary).toContainText("20.00");
  expect(responses.slice(responses.indexOf("write") + 1)).toContain("summary");
});
