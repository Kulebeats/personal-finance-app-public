/**
 * QA-01 (R20.2): the first-household journey through the real UI, from
 * sign-up to a report. Every write is submitted through the app, its response
 * is checked, and the result is read back in the UI and in the database.
 *
 * sign-up -> verify e-mail -> sign in -> household -> account -> transaction
 * -> budget -> goal -> report
 *
 * Tagged @phone, so it also runs on the 375 px phone project.
 *
 * E-mail verification: the raw token only leaves the server by e-mail, and this
 * profile has no SMTP sink. The spec therefore replaces the stored token hash
 * with the hash of a token it knows, then drives the real /verify-email page
 * and endpoint with it. That proves the verify path, not e-mail delivery.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, type Page } from "./protected-test";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { selectRadixOption } from "./utils/locators";
import { readBack, submitForData, type SubmitStep } from "./utils/submit";
import { testWithMutants } from "./utils/mutants";
import { BUDGETED_SEGMENT, escapeRegExp, exactKwacha, inputValue, kwacha, LAST_SEGMENT, labelPart, responseValue, shownText,
  storedMoney } from "./utils/observe";
import { amountOnly, moneyValue, renderedMoney } from "./utils/money-value";

export const JOURNEY_STEPS = {
  register: { name: "register", method: "POST", path: "/api/auth/register" },
  // The /verify-email page posts its token here (useVerifyEmail); the server
  // treats it as equivalent to /api/auth/verify-email.
  verify: { name: "verify", method: "POST", path: "/api/settings/security/email/verify" },
  household: { name: "household", method: "POST", path: "/api/household" },
  account: { name: "account", method: "POST", path: "/api/accounts" },
  transaction: { name: "transaction", method: "POST", path: "/api/transactions", corruptField: "amount" },
  // A new household starts on the flex system; per-category limits need the
  // Category Budget system, chosen in Budget Settings.
  budgetSystem: { name: "budget-system", method: "PUT", path: "/api/budgets/settings" },
  // An unbudgeted category's month-only limit is created with its budget.
  budget: { name: "budget", method: "POST", path: "/api/budgets", corruptField: "amount" },
  goal: { name: "goal", method: "POST", path: "/api/goals" },
} as const satisfies Record<string, SubmitStep>;

const CATEGORY = "Groceries (Home Food)";
/** The default spending report groups by category group; CATEGORY's group. */
const CATEGORY_GROUP = "Food & Groceries";
const SPENDING_BREAKDOWN = "/api/reports/spending/breakdown";

interface SpendingBreakdown {
  range: { baseCurrency: string };
  total: { amount: string; currency: string };
  items: { label: string; value: { amount: string; currency: string } }[];
}

async function oneRow<T>(sql: string, params: unknown[]): Promise<T> {
  const { rows } = await withFixtureClient((client) => client.query(sql, params));
  expect(rows).toHaveLength(1);
  return rows[0] as T;
}

async function signUpAndVerify(page: Page, email: string, password: string) {
  const suffix = email.split("@")[0];
  await page.goto("/login?mode=register");
  await page.getByLabel("Full Name").fill("Journey Tester");
  await page.getByLabel("Username").fill(suffix);
  await page.getByLabel("Email").fill(email);
  // The label reads "Password*" (an aria-hidden required star), so match the
  // field's accessible name, which is exactly "Password"; "Show password" is
  // the reveal button beside it. Playwright gives every input type it does
  // not map to another role (password included) the textbox role.
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
  await submitForData(page, JOURNEY_STEPS.register, () => page.getByRole("button", { name: "Create Account" }).click(), 201);

  const user = await oneRow<{ id: string; email_verified: boolean }>(
    "SELECT id, email_verified FROM users WHERE email=$1", [email]);
  expect(user.email_verified).toBe(false);
  const token = randomBytes(32).toString("hex");
  await withFixtureClient((client) => client.query(
    "UPDATE users SET email_verification_token=$1, email_verification_expiry=now() + interval '1 hour' WHERE id=$2",
    [createHash("sha256").update(token).digest("hex"), user.id]));
  await submitForData(page, JOURNEY_STEPS.verify, () => page.goto(`/verify-email?token=${token}`).then(() => undefined), 200);
  await expect(page.getByText("Email Verified!")).toBeVisible();
  expect((await oneRow<{ email_verified: boolean }>("SELECT email_verified FROM users WHERE id=$1", [user.id])).email_verified).toBe(true);
  return user.id;
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByPlaceholder(/enter your password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
}

async function runJourney(page: Page) {

  const suffix = `journey${randomUUID().slice(0, 8)}`;
  const email = `${suffix}@example.invalid`;
  const password = `Synthetic!9-${randomUUID()}`;

  const userId = await signUpAndVerify(page, email, password);
  await signIn(page, email, password);

  // Household
  await expect(page.getByRole("heading", { name: /create your household/i })).toBeVisible();
  await page.getByLabel("Household Name", { exact: true }).fill(`Journey ${suffix}`);
  const created = await submitForData<{ household: { id: string } }>(page, JOURNEY_STEPS.household,
    () => page.getByRole("button", { name: "Create Household", exact: true }).click());
  const householdId = created.household.id;
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  // NEW-27: first-household guidance points at the next step.
  await expect(page.getByRole("region", { name: "Get started with your household" })).toBeVisible();
  expect(await oneRow<{ role: string }>("SELECT role FROM household_members WHERE household_id=$1 AND user_id=$2",
    [householdId, userId])).toEqual({ role: "owner" });

  // Account
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add a new account", exact: true }).click();
  const accountDialog = page.getByRole("dialog");
  const accountName = `Journey cash ${suffix}`;
  await accountDialog.getByRole("button", { name: /^Cash Physical Cash$/ }).click();
  await accountDialog.getByLabel("Account Name", { exact: true }).fill(accountName);
  await accountDialog.locator("#balance").fill("500.00");
  const account = await submitForData<{ id: string }>(page, JOURNEY_STEPS.account,
    () => accountDialog.getByRole("button", { name: "Save Account", exact: true }).click());
  await expect(accountDialog.getByText("Account Created", { exact: true })).toBeVisible();
  expect(await oneRow("SELECT household_id, name, balance::text FROM accounts WHERE id=$1", [account.id]))
    .toEqual({ household_id: householdId, name: accountName, balance: "500.00" });

  // Transaction
  await page.goto("/transactions");
  await page.getByRole("button", { name: "Add Transaction", exact: true }).click();
  const txDialog = page.getByRole("dialog", { name: "Add Transaction", exact: true });
  await txDialog.getByPlaceholder("0.00", { exact: true }).fill("42.50");
  // An expense needs a merchant name (form schema); a typed new name is kept.
  await txDialog.getByRole("combobox").filter({ hasText: "Select merchant" }).click();
  await page.getByPlaceholder("Search merchants...", { exact: true }).fill("Journey corner shop");
  await page.getByPlaceholder("Search merchants...", { exact: true }).press("Escape");
  await txDialog.getByRole("combobox", { name: "Account", exact: true }).click();
  await page.getByRole("option", { name: accountName, exact: true }).click();
  await txDialog.getByRole("combobox", { name: "Category", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(`${CATEGORY.replace(/[()]/g, "\\$&")}$`) }).click();
  const transaction = await submitForData<{ id: string; amount: unknown }>(page, JOURNEY_STEPS.transaction,
    () => txDialog.getByRole("button", { name: "Add Transaction", exact: true }).click());
  await expect(txDialog).toBeHidden();
  await page.reload();
  // The household's only transaction row, in the chosen category.
  const txRow = page.getByRole("button", { name: /^View .+, / }).filter({ hasText: CATEGORY });
  // Amount and currency, everywhere: a ZMW expense shown as US$42.50 fails.
  await readBack(JOURNEY_STEPS.transaction, moneyValue("42.50", "ZMW"), {
    api: async () => responseValue(transaction.amount, "amount"),
    db: () => storedMoney("SELECT amount::text AS amount, currency FROM transactions WHERE id=$1", [transaction.id]),
    ui: async () => renderedMoney(await labelPart(txRow, LAST_SEGMENT)),
    // The painted amount cell too: the label is a separate expression.
    cell: async () => renderedMoney(await shownText(txRow.getByTestId("transaction-amount"))),
  });
  const storedTx = await oneRow<{ category_id: string }>(
    `SELECT t.category_id FROM transactions t JOIN categories c ON c.id=t.category_id
      WHERE t.id=$1 AND t.household_id=$2 AND t.account_id=$3 AND t.type='expense' AND c.name=$4`,
    [transaction.id, householdId, account.id, CATEGORY]);

  // Budget: set a monthly limit on the category the expense used.
  await page.goto("/budget");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const budgetSettings = page.getByRole("dialog", { name: "Budget Settings" });
  await budgetSettings.getByRole("radio", { name: "Category Budget" }).click();
  await submitForData(page, JOURNEY_STEPS.budgetSystem,
    () => budgetSettings.getByRole("button", { name: "Save", exact: true }).click(), 200);
  await expect(budgetSettings).toBeHidden();
  // Category mode lists only budgeted categories until a section's
  // "Show N unbudgeted" toggle is opened, and a new household has none.
  await page.getByText("Expenses", { exact: true }).first().locator("..")
    .getByRole("button", { name: /^Show \d+ unbudgeted$/ }).click();
  const limit = page.getByRole("textbox", { name: `Budget amount for ${CATEGORY}` });
  await limit.fill("300");
  // Enter opens the "Edit Budget" panel prefilled with the amount; Save writes it.
  await limit.press("Enter");
  const editPanel = page.locator("form").filter({ has: page.getByLabel("Budget Amount") });
  await expect(page.getByRole("heading", { name: "Edit Budget" })).toBeVisible();
  await expect(editPanel.getByLabel("Budget Amount")).toHaveValue(/^300(\.00)?$/);
  // Chosen explicitly (the household default may be all future months), so
  // exactly one period, this month's, is expected below.
  await editPanel.getByRole("radio", { name: "This month only" }).check();
  const saved = await submitForData<{ id: string; categoryId: string; amount: null; currency: string }>(
    page, JOURNEY_STEPS.budget, () => editPanel.getByRole("button", { name: "Save", exact: true }).click(), 201);
  await expect(page.getByRole("heading", { name: "Edit Budget", exact: true })).toBeHidden();
  // The POST returns the created budget and its recurring default. The
  // month-only limit is stored on its period and is read back separately.
  expect(saved).toMatchObject({ id: expect.any(String), categoryId: storedTx.category_id, amount: null, currency: "ZMW" });
  expect(await oneRow(
    `SELECT id::text AS id, category_id::text AS "categoryId", amount::text AS amount, currency
     FROM budgets WHERE household_id=$1 AND category_id=$2`, [householdId, storedTx.category_id],
  )).toEqual({ id: saved.id, categoryId: storedTx.category_id, amount: null, currency: "ZMW" });
  await page.reload();
  const categoryRow = page.getByRole("button", { name: new RegExp(`^${escapeRegExp(CATEGORY)} budget category, `) });
  await readBack(JOURNEY_STEPS.budget, moneyValue("300", "ZMW"), {
    db: () => storedMoney(`SELECT p.budget_amount::text AS amount, p.currency FROM budget_periods p JOIN budgets b ON b.id=p.budget_id
      WHERE b.id=$1 AND b.household_id=$2 AND b.category_id=$3`, [saved.id, householdId, storedTx.category_id]),
    // The amount field shows no currency; the row and the database do.
    field: async () => amountOnly(await inputValue(page.getByRole("textbox", { name: `Budget amount for ${CATEGORY}` }))),
    row: async () => renderedMoney(await labelPart(categoryRow, BUDGETED_SEGMENT)),
  });
  await expect(categoryRow).toHaveAttribute("aria-label", new RegExp(
    `, ${kwacha("300.00")} budgeted, ${kwacha("42.50")} spent, ${kwacha("257.50")} remaining$`));
  // Spent and remaining as painted in the row's cells, not only in its label.
  await expect(categoryRow.getByTestId("budget-actual")).toHaveText(exactKwacha("42.50"));
  await expect(categoryRow.getByRole("button", { name: /^Move money for / })).toHaveText(exactKwacha("257.50"));
  // "This month only": exactly one period, this calendar month from its first
  // day to its last, at the new limit.
  const budgetRows = await withFixtureClient((client) => client.query<{ isMonthStart: boolean; isMonthEnd: boolean; amount: string; currency: string }>(
    `SELECT p.start_date = date_trunc('month', current_date)::date AS "isMonthStart",
        p.end_date = (date_trunc('month', current_date) + interval '1 month - 1 day')::date AS "isMonthEnd",
        p.budget_amount::text AS amount, p.currency
      FROM budget_periods p JOIN budgets b ON b.id=p.budget_id
      WHERE b.household_id=$1 AND b.category_id=$2`, [householdId, storedTx.category_id]));
  expect(budgetRows.rows).toEqual([{ isMonthStart: true, isMonthEnd: true, amount: "300.00", currency: "ZMW" }]);

  // Goal
  await page.goto("/goals");
  await page.getByRole("button", { name: "New Goal" }).click();
  const goalDialog = page.getByRole("dialog", { name: /create a goal/i });
  const goalName = `Journey goal ${suffix}`;
  await goalDialog.getByLabel("Goal name").fill(goalName);
  await selectRadixOption(page, goalDialog.getByLabel("Goal type"), "Vacation");
  await goalDialog.getByLabel("Target amount").fill("1000");
  await goalDialog.getByRole("button", { name: "Continue" }).click();
  const goal = await submitForData<{ id: string }>(page, JOURNEY_STEPS.goal,
    () => goalDialog.getByRole("button", { name: "Create goal" }).click());
  await expect(goalDialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: goalName, level: 3 })).toBeVisible();
  expect(await oneRow("SELECT household_id, name, target_amount::text AS target, currency FROM goals WHERE id=$1", [goal.id]))
    .toEqual({ household_id: householdId, name: goalName, target: "1000.00", currency: "ZMW" });
  // And as the goal list paints it ("of K1,000.00"), in full.
  await expect(page.getByText(new RegExp(`^of ${kwacha("1,000.00")}$`))).toBeVisible();

  // Report: the spending report counts the expense in its category.
  await page.goto("/reports");
  // A new household always gets the one-time reports onboarding dialog. It is
  // modal, so the page behind it (and its heading) is hidden from the
  // accessibility tree until it is dismissed.
  const onboarding = page.getByRole("dialog", { name: /welcome to your reports dashboard/i });
  await expect(onboarding).toBeVisible();
  await onboarding.getByRole("button", { name: /skip for now/i }).click();
  await expect(onboarding).toBeHidden();
  await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
  // The spending tab draws only a pie chart, so its category and amount are
  // read together from the breakdown it renders: the one expense, in its
  // category's group, for 42.50, and nothing else.
  const breakdownResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === SPENDING_BREAKDOWN && response.request().method() === "GET");
  await page.getByRole("button", { name: /^spending report tab/i }).click();
  const breakdown = await breakdownResponse;
  expect(breakdown.status()).toBe(200);
  const envelope = await breakdown.json() as { success: boolean; data: SpendingBreakdown };
  expect(envelope.success).toBe(true);
  // In kwacha: the household's base currency, the item and the total.
  expect(envelope.data.range.baseCurrency).toBe("ZMW");
  expect(envelope.data.items.map((item) => ({ label: item.label, value: item.value })))
    .toEqual([{ label: CATEGORY_GROUP, value: { amount: expect.stringMatching(/^42\.50*$/), currency: "ZMW" } }]);
  expect(envelope.data.total).toEqual({ amount: expect.stringMatching(/^42\.50*$/), currency: "ZMW" });
  await expect(page.getByRole("img", { name: "Spending breakdown chart" })).toBeVisible();
  // The displayed value too. The reports summary cards format money as the rest
  // of the app does (reportFormatters -> lib/money), in the kwacha symbol to
  // the ngwee: exactly "K 42.50" (no-break space), never rounded to "ZMW 43".
  const expensesCard = page.getByText("Total Expenses", { exact: true }).locator("..");
  await expect(expensesCard.getByText(/^K\s42\.50$/)).toBeVisible();
}

const JOURNEY_TIMEOUT_MS = 240_000;

// R20.2 mutation check: the transaction and budget writes are each sent with
// a wrong amount; each mutant must go red in that step's declared read-back.
testWithMutants("first household: sign-up to report through the real UI @phone", {
  corrupt: [JOURNEY_STEPS.transaction, JOURNEY_STEPS.budget],
  timeoutMs: JOURNEY_TIMEOUT_MS,
}, runJourney);
