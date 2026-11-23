/**
 * Investments E2E (QA-01 rewrite).
 *
 * The previous version branched on whether the shared test account happened
 * to hold anything (`if (isEmpty) ... else ...`) and skipped the tab test
 * outright when it did not, so the populated page was never checked in CI.
 * Each test now builds its own state: an empty synthetic household for the
 * empty state and the add-holding dialog, and one with a known holding for
 * the holdings table and the tab set. Creating a holding through the dialog
 * is covered end to end by completion-r13-holding-delete.spec.ts.
 */
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "./protected-test";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { signInAs } from "./utils/fixture-session";

interface Seeded { fixture: CompletionFixture; securityName: string }

async function householdWithHolding(): Promise<Seeded> {
  const fixture = await createCompletionFixture();
  const accountId = randomUUID(), securityId = randomUUID();
  // Unique to this household's seed: securities are shared across households,
  // so a fixed name could match another fixture's holding.
  const securityName = `Synthetic Copperbelt Shares ${securityId.slice(0, 8)}`;
  await withFixtureClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("INSERT INTO accounts (id, household_id, name, type, currency) VALUES ($1, $2, 'Synthetic custody', 'checking', 'ZMW')",
        [accountId, fixture.householdId]);
      await client.query("INSERT INTO securities (id, symbol, name, type, currency, current_price) VALUES ($1, $2, $3, 'stock', 'ZMW', 12.5)",
        [securityId, `S${securityId.slice(0, 8)}`, securityName]);
      await client.query("INSERT INTO holdings (id, household_id, security_id, account_id, quantity, cost_basis) VALUES ($1, $2, $3, $4, 4, 40)",
        [randomUUID(), fixture.householdId, securityId, accountId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  });
  return { fixture, securityName };
}

async function openInvestments(page: Page, fixture: CompletionFixture) {
  await signInAs(page, fixture);
  await page.goto("/investments");
  await expect(page).toHaveURL(/\/investments(?:[?#]|$)/);
  await expect(page.getByRole("heading", { name: "Investments", level: 1 })).toBeVisible({ timeout: 30_000 });
}

test.describe("Investments with no holdings", () => {
  test("shows the empty state and its call to action", async ({ page }) => {
    await openInvestments(page, await createCompletionFixture());
    await expect(page.getByRole("heading", { name: "No Holdings Yet" })).toBeVisible();
    await expect(page.getByRole("button", { name: /add your first holding/i })).toBeVisible();
  });

  test("opens the add-holding dialog at the security search step", async ({ page }) => {
    await openInvestments(page, await createCompletionFixture());
    // Waiting for the empty state first means the entry button is the settled
    // one; while the holdings query loads, a different "Add Holding" renders.
    await expect(page.getByRole("heading", { name: "No Holdings Yet" })).toBeVisible();
    await page.getByRole("button", { name: "Add Your First Holding", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /add investment holding/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByPlaceholder(/search securities/i)).toBeVisible();
    await expect(dialog.getByRole("button", { name: /add new security/i })).toBeVisible();
  });
});

test.describe("Investments with a holding", () => {
  test("lists the holding in the holdings table", async ({ page }) => {
    const { fixture, securityName } = await householdWithHolding();
    await openInvestments(page, fixture);
    await expect(page.getByRole("tab", { name: "Holdings", selected: true })).toBeVisible();
    // Inside the Holdings table only: one body row, and its name cell is exactly the seeded security.
    const table = page.getByRole("table", { name: "Holdings", exact: true });
    const row = table.locator("tbody tr");
    await expect(row).toHaveCount(1);
    await expect(row.getByText(securityName, { exact: true })).toBeVisible();
    // Price, quantity and value in full, in kwacha (seed: 4 units at K12.50).
    const cells = row.locator("td");
    await expect(cells.nth(2)).toHaveText(/^K12\.50$/);
    await expect(cells.nth(3)).toHaveText(/^4$/);
    await expect(cells.nth(4)).toHaveText(/^K50\.00$/);
    await expect(page.getByRole("heading", { name: "No Holdings Yet" })).toHaveCount(0);
  });

  test("switches between the investment tabs", async ({ page }) => {
    await openInvestments(page, (await householdWithHolding()).fixture);
    for (const name of ["Government (GRZ)", "Performance", "Holdings"]) {
      await page.getByRole("tab", { name }).click();
      await expect(page.getByRole("tab", { name, selected: true })).toBeVisible();
    }
  });
});
