/**
 * Budget E2E (QA-01 rewrite).
 *
 * The previous version wrapped nearly every assertion in `if (control)` via
 * `pickVisible`, so it passed with the month selector, the progress bars, the
 * edit path and the settings dialog all gone. Each test now runs on its own
 * synthetic household with a known budget (500.00) and a known expense
 * (120.00) this month, so every number on the row is fixed, and the edit test
 * submits a new limit and reads it back in the UI and in the database.
 */
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "./protected-test";
import type { Locator } from "@playwright/test";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { signInAs } from "./utils/fixture-session";
import { readBack, submitStep, type SubmitStep } from "./utils/submit";
import { testWithMutants } from "./utils/mutants";
import { BUDGETED_SEGMENT, exactKwacha, inputValue, kwacha, labelPart, storedMoney, storedValue } from "./utils/observe";
import { amountOnly, moneyValue, renderedMoney } from "./utils/money-value";

const CATEGORY = "Golden Expense";
/** This month's limit write; its corrupt mutant saves a different amount. */
const SAVE_LIMIT: SubmitStep = { name: "budget-limit", method: "PUT", path: /^\/api\/budgets\/forecast\/[0-9a-f-]+$/, corruptField: "amount" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];

async function budgetedHousehold(): Promise<CompletionFixture> {
  const fixture = await createCompletionFixture();
  const accountId = randomUUID();
  await withFixtureClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("INSERT INTO accounts (id, household_id, name, type, balance, currency, is_private) VALUES ($1, $2, 'Synthetic budget account', 'checking', 1000, 'ZMW', false)",
        [accountId, fixture.householdId]);
      await client.query("UPDATE categories SET include_in_budget=true WHERE id=$1 AND household_id=$2", [fixture.expenseCategoryId, fixture.householdId]);
      // Households default to the flex system, where an expense category is a
      // FlexibleRow with no per-category limit. This spec covers per-category budgets.
      await client.query("UPDATE household_preferences SET budget_system='category' WHERE household_id=$1", [fixture.householdId]);
      const budgetId = randomUUID();
      await client.query("INSERT INTO budgets (id, household_id, name, category_id, amount) VALUES ($1, $2, $3, $4, 500)",
        [budgetId, fixture.householdId, CATEGORY, fixture.expenseCategoryId]);
      // This month's period, so the shown limit is the period's, not a fallback.
      await client.query(`INSERT INTO budget_periods (budget_id, start_date, end_date, budget_amount, currency)
        VALUES ($1, date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 500, 'ZMW')`,
      [budgetId]);
      await client.query(`INSERT INTO transactions (household_id, account_id, category_id, owner_user_id, name, amount, currency, type, date)
        VALUES ($1, $2, $3, $4, 'Synthetic groceries', 120.00, 'ZMW', 'expense', current_date)`,
      [fixture.householdId, accountId, fixture.expenseCategoryId, fixture.userId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  });
  return fixture;
}

async function openBudget(page: Page, fixture: CompletionFixture) {
  await signInAs(page, fixture);
  await page.goto("/budget");
  await expect(page.getByRole("button", { name: "Budget", exact: true })).toBeVisible({ timeout: 30_000 });
}

/** "November 2026" for the browser's current month, shifted by `offset` months. */
function monthTitle(offset: number): string {
  const now = new Date();
  const shifted = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${MONTHS[shifted.getMonth()]} ${shifted.getFullYear()}`;
}

/** A phone-width, short viewport with the root text doubled (browser large-text setting). */
const SHORT_VIEWPORT = { width: 375, height: 560 };
const LARGE_TEXT = "html { font-size: 200% !important; }";

/**
 * Both footer buttons are fully on screen and fully inside the dialog's own
 * box (the dialog clips its overflow, so the viewport alone is not enough).
 */
async function expectFooterReachable(dialog: Locator) {
  for (const name of ["Cancel", "Save"]) {
    const button = dialog.getByRole("button", { name, exact: true });
    await expect(button).toBeInViewport({ ratio: 1 });
    const [box, frame] = await Promise.all([button.boundingBox(), dialog.boundingBox()]);
    expect(box && frame).toBeTruthy();
    if (!box || !frame) return;
    expect(box.x).toBeGreaterThanOrEqual(frame.x);
    expect(box.y).toBeGreaterThanOrEqual(frame.y);
    expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width);
    expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height);
  }
}

/**
 * With the open dialog's content taller than the viewport, its body scrolls
 * and Save and Cancel stay fully in view, before and after scrolling to the
 * last control; at 375px with doubled text the footer buttons wrap.
 */
async function expectSaveReachable(page: Page, dialogName: string, lastControl: string) {
  await page.setViewportSize(SHORT_VIEWPORT);
  await page.addStyleTag({ content: LARGE_TEXT });
  const dialog = page.getByRole("dialog", { name: dialogName });
  const body = dialog.getByTestId("budget-dialog-body");
  await expect.poll(() => body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await expectFooterReachable(dialog);
  // Scrolled again until the last control shows: content that loads after
  // the dialog opens (Budget Settings' recalculation preview) grows the body
  // and pushes the control back down after a single scroll.
  const last = dialog.getByText(lastControl, { exact: true });
  await expect(async () => {
    await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(last).toBeInViewport({ timeout: 1_000 });
  }).toPass();
  await expectFooterReachable(dialog);
}

interface PeriodRow { isMonthStart: boolean; isMonthEnd: boolean; amount: string; currency: string }

/** Every budget period of the seeded category: whether it is exactly this month, and its limit. */
async function periodRows(fixture: CompletionFixture): Promise<PeriodRow[]> {
  const { rows } = await withFixtureClient((client) => client.query<PeriodRow>(
    `SELECT p.start_date = date_trunc('month', current_date)::date AS "isMonthStart",
        p.end_date = (date_trunc('month', current_date) + interval '1 month - 1 day')::date AS "isMonthEnd",
        p.budget_amount::text AS amount, p.currency
      FROM budget_periods p JOIN budgets b ON b.id=p.budget_id
      WHERE b.household_id=$1 AND b.category_id=$2`, [fixture.householdId, fixture.expenseCategoryId]));
  return rows;
}

const categoryRow = (page: Page, pattern: string) =>
  page.getByRole("button", { name: new RegExp(`^${CATEGORY} budget category, ${pattern}`) });

// The row's label figures, each in kwacha to the ngwee: budgeted, spent, remaining.
const rowFigures = (budgeted: string, spent: string, remaining: string): string =>
  `${kwacha(budgeted)} budgeted, ${kwacha(spent)} spent, ${kwacha(remaining)} remaining$`;

// Spent and remaining as painted in the row's cells, not only in its
// aria-label (a separate expression). The budgeted figure is painted as the
// limit input, which the tests read directly.
async function expectPaintedFigures(page: Page, spent: string, remaining: string): Promise<void> {
  const row = categoryRow(page, "");
  await expect(row.getByTestId("budget-actual")).toHaveText(exactKwacha(spent));
  await expect(row.getByRole("button", { name: new RegExp(`^Move money for ${CATEGORY}, `) }))
    .toHaveText(exactKwacha(remaining));
}

test.describe("Budget", () => {
  test("shows the current month with the Budget and Forecast views", async ({ page }) => {
    await openBudget(page, await budgetedHousehold());
    await expect(page.getByRole("heading", { level: 1, name: monthTitle(0) })).toBeVisible();
    await expect(page.getByRole("button", { name: "Forecast", exact: true })).toBeVisible();
  });

  test("the budgeted category shows its limit, spending and what remains", async ({ page }) => {
    await openBudget(page, await budgetedHousehold());
    await expect(categoryRow(page, rowFigures("500.00", "120.00", "380.00"))).toBeVisible();
    await expectPaintedFigures(page, "120.00", "380.00");
    await expect(page.getByRole("textbox", { name: `Budget amount for ${CATEGORY}` })).toHaveValue(/^500(\.00)?$/);
    await expect(page.getByRole("button", { name: new RegExp(`^Move money for ${CATEGORY}, ${kwacha("380.00")} remaining$`) })).toBeEnabled();
  });

  test("moves to the next month and back to today", async ({ page }) => {
    await openBudget(page, await budgetedHousehold());
    await page.getByRole("button", { name: "Next month" }).click();
    await expect(page.getByRole("heading", { level: 1, name: monthTitle(1) })).toBeVisible();
    await page.getByRole("button", { name: "Previous month" }).click();
    await page.getByRole("button", { name: "Previous month" }).click();
    await expect(page.getByRole("heading", { level: 1, name: monthTitle(-1) })).toBeVisible();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: monthTitle(0) })).toBeVisible();
  });

  testWithMutants("a new limit is saved and read back", { corrupt: [SAVE_LIMIT] }, async (page) => {
    const fixture = await budgetedHousehold();
    await openBudget(page, fixture);
    const limit = page.getByRole("textbox", { name: `Budget amount for ${CATEGORY}` });
    await limit.fill("650");
    // Enter opens the "Edit Budget" panel; "This month only" is the default
    // scope, which writes only this month's period.
    await limit.press("Enter");
    await expect(page.getByRole("heading", { name: "Edit Budget" })).toBeVisible();
    const editPanel = page.locator("form").filter({ has: page.getByLabel("Budget Amount") });
    await expect(editPanel.getByLabel("Budget Amount")).toHaveValue(/^650(\.00)?$/);
    const response = await submitStep(page, SAVE_LIMIT,
      () => editPanel.getByRole("button", { name: "Save", exact: true }).click());
    expect(response.ok()).toBe(true);
    // The forecast PUT returns what it wrote ({ budgetId, scope, months }), not
    // the limit, so all of it is pinned here (the category's own budget, this
    // month only) and the limit is read back below.
    const saved = await response.json() as { success: boolean; data: unknown };
    const budgetId = await storedValue("SELECT id::text AS value FROM budgets WHERE household_id=$1 AND category_id=$2",
      [fixture.householdId, fixture.expenseCategoryId]);
    expect(saved).toEqual({ success: true, data: { budgetId, scope: "this_month", months: 1 } });
    await expect(page.getByRole("heading", { name: "Edit Budget" })).toHaveCount(0);
    await page.reload();
    await readBack(SAVE_LIMIT, moneyValue("650", "ZMW"), {
      db: () => storedMoney(`SELECT p.budget_amount::text AS amount, p.currency FROM budget_periods p JOIN budgets b ON b.id=p.budget_id
        WHERE b.household_id=$1 AND b.category_id=$2`, [fixture.householdId, fixture.expenseCategoryId]),
      // The amount field shows no currency; the row and the database do.
      field: async () => amountOnly(await inputValue(limit)),
      row: async () => renderedMoney(await labelPart(categoryRow(page, ""), BUDGETED_SEGMENT)),
    });
    await expect(categoryRow(page, rowFigures("650.00", "120.00", "530.00"))).toBeVisible();
    await expectPaintedFigures(page, "120.00", "530.00");
    // "This month only": the seeded month's period, start to end, holds the new
    // limit, and no other period was written (an all-future update would add or
    // change rows).
    expect(await periodRows(fixture)).toEqual([{ isMonthStart: true, isMonthEnd: true, amount: "650.00", currency: "ZMW" }]);
  });

  test("the Settings button opens the budget settings dialog", async ({ page }) => {
    await openBudget(page, await budgetedHousehold());
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Budget Settings" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("radiogroup", { name: "System" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeFocused();
  });

  test("Edit Budget keeps Save reachable on a short screen with large text", async ({ page }) => {
    await openBudget(page, await budgetedHousehold());
    const limit = page.getByRole("textbox", { name: `Budget amount for ${CATEGORY}` });
    await limit.fill("650");
    await limit.press("Enter");
    await expect(page.getByRole("dialog", { name: "Edit Budget" })).toBeVisible();
    await expectSaveReachable(page, "Edit Budget", "This and all future months");
  });

  // At 375px with doubled text the "Budget walkthrough" row wraps, so
  // "Start setup" stays inside the dialog (CI run 44742658729 caught it clipped).
  test("Budget Settings keeps Save reachable on a short screen with large text", async ({ page }) => {
    await openBudget(page, await budgetedHousehold());
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Budget Settings" })).toBeVisible();
    await expectSaveReachable(page, "Budget Settings", "Start setup");
  });
});
