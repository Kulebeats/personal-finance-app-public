import { randomUUID } from "node:crypto";
import { test, expect } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { signInAs } from "./utils/fixture-session";

/**
 * FIN-17: the Transactions summary is never stale after a write. A transaction
 * added through the page's own dialog shows in the summary without a reload, and
 * the new totals come from a summary read made after the write committed.
 */
test("the transaction summary refreshes after a transaction is added", async ({ page }) => {
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
  await expect(summary).toContainText(/\b0 transactions\b/);

  await page.getByRole("button", { name: "Add Transaction", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add Transaction", exact: true });
  await dialog.getByRole("button", { name: "CREDIT (Income)", exact: true }).click();
  await dialog.getByPlaceholder("0.00", { exact: true }).fill("20.00");
  await dialog.getByRole("combobox", { name: "Account", exact: true }).click();
  await page.getByRole("option", { name: accountName, exact: true }).click();
  await dialog.getByRole("combobox", { name: "Category", exact: true }).click();
  await page.getByRole("option", { name: "Golden Income", exact: true }).click();
  const created = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/transactions" && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Add Transaction", exact: true }).click();
  expect((await created).status()).toBe(201);
  await expect(dialog).toBeHidden();

  // No reload: the open page must pick up the write by itself.
  await expect(summary).toContainText(/\b1 transaction\b/);
  await expect(summary).toContainText("20.00");
  expect(responses.slice(responses.indexOf("write") + 1)).toContain("summary");
});
