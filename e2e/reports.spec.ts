/**
 * Reports E2E Tests
 *
 * Exercises the reports feature as it is actually shipped
 * (client/src/pages/Reports.tsx + client/src/features/reports/**):
 * - The annual dashboard, which is the default (and only registered)
 *   `/reports` route - there are no `/reports/annual`, `/reports/spending`,
 *   `/reports/cashflow`, `/reports/net-worth`, etc. sub-routes; those tabs
 *   are client-side state on a single page (see client/src/App.tsx, which
 *   only registers `/reports`)
 * - Switching tabs (Spending, Net Worth) and seeing the real summary cards
 * - The Customize and Export dropdown menus
 * - The Export History panel toggle
 *
 * The previous version of this file asserted on fictional `data-testid`
 * attributes (`annual-income`, `spending-chart`, `cashflow-chart`, ...) and
 * navigated to routes that return the 404 page. None of that matched the
 * shipped UI or router.
 *
 * Each test signs in as a fresh synthetic household (an account, an expense
 * and an income this month, so the summary cards have figures). A new
 * household has not finished widget setup, so the one-time "Welcome to Your
 * Reports Dashboard" onboarding dialog always opens; each test asserts it and
 * dismisses it the way a user would ("Skip for Now"). Nothing is optional: a
 * missing dialog, heading or card fails the test.
 *
 * Gated in `test:e2e:smoke` (QA-01). The annual dashboard is the heaviest
 * bundle in the app, so the first paint gets a long timeout rather than a
 * best-effort warm-up whose failure was ignored.
 */

import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "./protected-test";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { signInAs } from "./utils/fixture-session";

/** The annual dashboard is the heaviest first paint; a cold server can take this long. */
const FIRST_PAINT_MS = 90_000;

async function householdWithActivity(): Promise<CompletionFixture> {
  const fixture = await createCompletionFixture();
  const accountId = randomUUID();
  await withFixtureClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("INSERT INTO accounts (id, household_id, name, type, balance, currency, is_private) VALUES ($1, $2, 'Synthetic reports account', 'checking', 1000, 'ZMW', false)",
        [accountId, fixture.householdId]);
      await client.query(`INSERT INTO transactions (household_id, account_id, category_id, owner_user_id, name, amount, currency, type, date)
        VALUES ($1, $2, $3, $4, 'Synthetic groceries', 120.00, 'ZMW', 'expense', current_date)`,
      [fixture.householdId, accountId, fixture.expenseCategoryId, fixture.userId]);
      await client.query(`INSERT INTO transactions (household_id, account_id, owner_user_id, name, amount, currency, type, date)
        VALUES ($1, $2, $3, 'Synthetic salary', 900.00, 'ZMW', 'income', current_date)`,
      [fixture.householdId, accountId, fixture.userId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  });
  return fixture;
}

async function skipOnboarding(page: Page): Promise<void> {
  // It opens after the widget-preferences query resolves, not on first paint.
  const onboarding = page.getByRole("dialog", { name: /welcome to your reports dashboard/i });
  await expect(onboarding).toBeVisible({ timeout: FIRST_PAINT_MS });
  await onboarding.getByRole("button", { name: /skip for now/i }).click();
  await expect(onboarding).toBeHidden();
}

test.describe("Reports", () => {
  test.describe.configure({ timeout: FIRST_PAINT_MS * 2 });

  test.beforeEach(async ({ page }) => {
    await signInAs(page, await householdWithActivity());
    await page.goto("/reports");
    // The onboarding dialog is modal: until it closes the page behind it, h1 included, is out of the accessibility tree.
    await skipOnboarding(page);
    await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
  });

  test("loads the Annual Dashboard tab by default", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Reports", level: 1 }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: /annual dashboard report tab/i }),
    ).toHaveAttribute("aria-current", "page");

    // Real content rendered only by AnnualDashboard.
    await expect(
      page.getByRole("heading", { name: "Overview" }),
    ).toBeVisible();
  });

  test("switches to the Spending tab and shows the summary cards", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /^spending report tab/i }).click();

    await expect(
      page.getByRole("button", { name: /^spending report tab/i }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Total Income")).toBeVisible();
    await expect(page.getByText("Total Expenses")).toBeVisible();
    await expect(page.getByText("Savings Rate")).toBeVisible();
  });

  test("switches to the Net Worth tab and shows the summary cards", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /net worth report tab/i }).click();

    await expect(
      page.getByRole("button", { name: /net worth report tab/i }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Total Income")).toBeVisible();
    await expect(page.getByText("Total Net Income")).toBeVisible();
  });

  test("opens the Export options menu", async ({ page }) => {
    await page.getByRole("button", { name: "Export report options" }).click();

    await expect(
      page.getByRole("menuitem", { name: /export current view/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /view export history/i }),
    ).toBeVisible();
  });

  test("toggles the export history panel", async ({ page }) => {
    await page.getByRole("button", { name: "Export report options" }).click();
    await page.getByRole("menuitem", { name: /view export history/i }).click();

    await expect(
      page.getByRole("heading", { name: "Export history" }),
    ).toBeVisible();
  });

  test("opens the Customize menu and shows year/period settings", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: "Customize report settings" })
      .click();

    await expect(page.getByText("View Settings")).toBeVisible();
    await expect(page.getByText("Year:")).toBeVisible();
    await expect(page.getByText("Period:")).toBeVisible();
  });
});
