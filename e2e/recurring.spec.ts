/**
 * Recurring E2E (QA-01 rewrite).
 *
 * The previous version branched on what it found (`if (isEmpty) ... else
 * ...`, `if (itemCount === 0) ...`), so either branch passed and a page that
 * lost its rules, or lost its empty state, stayed green. Each test now builds
 * the state it asserts: an empty synthetic household for the empty states, and
 * one with a known rule due tomorrow for the list and the Upcoming Bills card.
 */
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "./protected-test";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { signInAs } from "./utils/fixture-session";
import { confirmZmwDenomination } from "./utils/recurring-seed";
import { selectRadixOption } from "./utils/locators";
import { readBack, submitForData, type SubmitStep } from "./utils/submit";
import { testWithMutants } from "./utils/mutants";
import { kwacha, responseValue, shownText, storedMoney } from "./utils/observe";
import { moneyValue, renderedMoney } from "./utils/money-value";

const RULE_NAME = "Synthetic water bill";
const ACCOUNT_NAME = "Synthetic bills account";
/** The Add Recurring form's one write: the rule and its first transaction together (NEW-10). */
const CREATE_RULE: SubmitStep = { name: "recurring-create", method: "POST", path: "/api/recurring/transaction", corruptField: "amount" };
/** Typed as a user would; no digits, since the form drops numeric tokens from merchant names. */
const TYPED_NAME = "Raven water delivery";
/** What the form's merchant cleaner saves: each word capitalised. */
const CREATED_NAME = "Raven Water Delivery";

interface CreatedRule { id: string; name: string; frequency: string; amount: unknown }

async function householdWithAccount(): Promise<{ fixture: CompletionFixture; accountId: string }> {
  const fixture = await createCompletionFixture();
  const accountId = randomUUID();
  await withFixtureClient((client) => client.query(
    "INSERT INTO accounts (id, household_id, name, type, balance, currency, is_private) VALUES ($1, $2, $3, 'checking', 500, 'ZMW', false)",
    [accountId, fixture.householdId, ACCOUNT_NAME]));
  return { fixture, accountId };
}

async function householdWithRule(): Promise<CompletionFixture> {
  const fixture = await createCompletionFixture();
  const accountId = randomUUID();
  await withFixtureClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("INSERT INTO accounts (id, household_id, name, type, balance, currency, is_private) VALUES ($1, $2, 'Synthetic bills account', 'checking', 500, 'ZMW', false)",
        [accountId, fixture.householdId]);
      const ruleId = randomUUID();
      await client.query(`INSERT INTO recurring_transactions
          (id, household_id, account_id, name, amount, type, frequency, start_date, next_due_date)
        VALUES ($1, $2, $3, $4, 45.50, 'expense', 'monthly', CURRENT_DATE, CURRENT_DATE + 1)`,
      [ruleId, fixture.householdId, accountId, RULE_NAME]);
      await confirmZmwDenomination(client, [ruleId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  });
  return fixture;
}

async function openRecurring(page: Page, fixture: CompletionFixture) {
  await signInAs(page, fixture);
  await page.goto("/recurring");
  await expect(page.getByRole("heading", { name: "Recurring", level: 1 })).toBeVisible({ timeout: 30_000 });
}

test.describe("Recurring create form", () => {
  // QA-01: mutation-checked by scripts/e2e-mutation-check.mjs (a corrupt amount must turn the read-back red).
  testWithMutants("Add Recurring submits a weekly rule that the list, the API and the database read back", { corrupt: [CREATE_RULE] }, async (page) => {
    const { fixture, accountId } = await householdWithAccount();
    await openRecurring(page, fixture);
    await page.getByRole("button", { name: /add recurring/i }).click();
    const dialog = page.getByRole("dialog", { name: "Add Transaction", exact: true });
    await expect(dialog.getByRole("checkbox", { name: "Recurring Transaction" })).toBeChecked();
    await dialog.getByRole("button", { name: "DEBIT (Expense)", exact: true }).click();
    await dialog.getByPlaceholder("0.00", { exact: true }).fill("37.25");
    await dialog.getByRole("combobox").filter({ hasText: "Select merchant" }).click();
    await page.getByPlaceholder("Search merchants...", { exact: true }).fill(TYPED_NAME);
    await page.getByPlaceholder("Search merchants...", { exact: true }).press("Escape");
    await selectRadixOption(page, dialog.getByRole("combobox", { name: "Account", exact: true }), new RegExp(`^${ACCOUNT_NAME}$`));
    await selectRadixOption(page, dialog.getByRole("combobox", { name: "Category", exact: true }), /^Golden Expense$/);
    // Not the monthly default, so a dropped choice shows.
    await selectRadixOption(page, dialog.getByRole("combobox", { name: "Frequency", exact: true }), /^Weekly$/);
    const created = await submitForData<{ recurringRule: CreatedRule }>(page, CREATE_RULE,
      () => dialog.getByRole("button", { name: "Add Transaction", exact: true }).click());
    await expect(dialog).toBeHidden();
    const rule = created.recurringRule;
    expect(rule).toMatchObject({ name: CREATED_NAME, frequency: "weekly" });

    await page.reload();
    await page.getByLabel("List view").click();
    const row = page.getByTestId("recurring-rule-row").filter({ hasText: CREATED_NAME });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("Weekly", { exact: true })).toBeVisible();
    const cell = row.getByTestId("recurring-rule-amount");
    const readRule = await page.request.get(`/api/recurring/${rule.id}`);
    expect(readRule.status()).toBe(200);
    const readBody = (await readRule.json()) as { data: CreatedRule };
    expect(readBody.data).toMatchObject({ id: rule.id, name: CREATED_NAME, frequency: "weekly" });
    await readBack(CREATE_RULE, moneyValue("37.25", "ZMW"), {
      created: async () => responseValue(rule.amount, "amount"),
      api: async () => responseValue(readBody.data.amount, "amount"),
      db: () => storedMoney(`SELECT r.amount::text AS amount, h.new_state->>'currency' AS currency
          FROM recurring_transactions r JOIN recurring_transaction_history h
            ON h.recurring_transaction_id = r.id AND h.action = 'denomination_confirmed_v1'
         WHERE r.id = $1 AND r.household_id = $2`, [rule.id, fixture.householdId]),
      // The painted amount without its expense sign; the full cell, sign included, is checked below.
      cell: async () => renderedMoney((await shownText(cell)).replace(/^-/, "")),
    });
    // The painted cell in full, after the read-back so a corrupt amount fails there first:
    // an expense sign, then exactly K37.25.
    await expect(cell).toHaveText(new RegExp(`^-${kwacha("37.25")}$`));
    const { rows } = await withFixtureClient((client) => client.query(
      `SELECT name, account_id, category_id, frequency::text AS frequency, type FROM recurring_transactions
        WHERE id = $1 AND household_id = $2`, [rule.id, fixture.householdId]));
    expect(rows).toEqual([{ name: CREATED_NAME, account_id: accountId, category_id: fixture.expenseCategoryId, frequency: "weekly", type: "expense" }]);
  });
});

const upcomingCard = (page: Page) => page.getByTestId("upcoming-bills-list");

test.describe("Recurring with no rules", () => {
  test("the list view shows the empty state and its call to action", async ({ page }) => {
    await openRecurring(page, await createCompletionFixture());
    await page.getByLabel("List view").click();
    await expect(page.getByRole("heading", { name: "No recurring rules" })).toBeVisible();
    await expect(page.getByRole("button", { name: /add your first rule/i })).toBeVisible();
  });

  test("the Upcoming Bills card says there are none", async ({ page }) => {
    await openRecurring(page, await createCompletionFixture());
    await expect(page.getByRole("heading", { name: "Upcoming Bills" })).toBeVisible();
    await expect(upcomingCard(page).getByText("No upcoming bills")).toBeVisible();
    await expect(page.getByTestId("upcoming-bill-item")).toHaveCount(0);
  });
});

test.describe("Recurring with a rule due tomorrow", () => {
  test("shows the header, total and view toggle", async ({ page }) => {
    await openRecurring(page, await householdWithRule());
    // The total sums every rule proven in the household currency (FIN-05):
    // the seeded bill is counted, and none is left out.
    const heading = page.getByRole("heading", { name: "Total Recurring" });
    const totalCard = heading.locator("..");
    // Exactly K45.50 as the card's headline amount, the line under its heading
    // (not 145.50, not another currency; the Bills line below repeats it).
    await expect(heading.locator("xpath=following-sibling::div[1]")).toHaveText(/^K\s?45\.50$/);
    await expect(totalCard).not.toContainText(/not included/);
    await expect(page.getByLabel("Calendar view")).toBeVisible();
    await expect(page.getByLabel("List view")).toBeVisible();
  });

  test("the list view shows the rule under its column headers", async ({ page }) => {
    await openRecurring(page, await householdWithRule());
    await page.getByLabel("List view").click();
    await expect(page.getByText("Merchant", { exact: true })).toBeVisible();
    await expect(page.getByText("Frequency", { exact: true })).toBeVisible();
    // Scoped to the list's own rows: the sidebar and Upcoming Bills also show the name.
    const row = page.getByTestId("recurring-rule-row");
    await expect(row).toHaveCount(1);
    await expect(row.getByText(RULE_NAME, { exact: true })).toBeVisible();
    await expect(row.getByText(/monthly/i)).toBeVisible();
    // The amount cell in full (lib/format: sign, then K, no space): not
    // 145.50, not another currency.
    await expect(row.getByText(/^-K\s?45\.50$/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "No recurring rules" })).toHaveCount(0);
  });

  test("the Upcoming Bills card lists the rule", async ({ page }) => {
    await openRecurring(page, await householdWithRule());
    const item = page.getByTestId("upcoming-bill-item");
    await expect(item).toHaveCount(1);
    await expect(item.getByText(RULE_NAME, { exact: true })).toBeVisible();
    await expect(item.getByText(/^K\s?45\.50$/)).toBeVisible();
    await expect(upcomingCard(page).getByText("No upcoming bills")).toHaveCount(0);
  });

  test("navigates to the next and previous month", async ({ page }) => {
    await openRecurring(page, await householdWithRule());
    const monthHeading = page.getByRole("heading", { level: 2 });
    const initialMonth = (await monthHeading.textContent()) ?? "";
    expect(initialMonth.trim()).not.toBe("");
    await page.getByLabel("Next month").click();
    await expect(monthHeading).not.toHaveText(initialMonth);
    await page.getByLabel("Previous month").click();
    await expect(monthHeading).toHaveText(initialMonth);
  });

  test("opens the Add Recurring transaction dialog", async ({ page }) => {
    await openRecurring(page, await householdWithRule());
    await page.getByRole("button", { name: /add recurring/i }).click();
    await expect(page.getByRole("dialog", { name: /add transaction/i })).toBeVisible();
  });

  test("opens the recurring pattern scan dialog", async ({ page }) => {
    await openRecurring(page, await householdWithRule());
    await page.getByRole("button", { name: /^scan$/i }).click();
    const dialog = page.getByRole("dialog", { name: /recurring patterns/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/scan your history to find potential recurring/i)).toBeVisible();
  });
});
