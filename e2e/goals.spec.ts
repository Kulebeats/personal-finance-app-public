/**
 * Goals E2E Tests
 *
 * Exercises the goals feature as it is actually shipped
 * (client/src/pages/Goals.tsx + client/src/features/goals/**):
 * - Viewing the Save Up / Pay Down tabs
 * - Creating a save-up goal through the real wizard (Radix Select, not a
 *   native <select>) and confirming it renders in the list, with its target
 *   amount and currency read back from GET /api/goals and the list row
 *   (QA-01: mutation-checked by scripts/e2e-mutation-check.mjs)
 * - Opening the goal detail dialog and confirming its real tabs
 * - Opening the "Goal accounts" and "Create goal transfer" dialogs
 *
 * The previous version of this file asserted on fictional selectors
 * (`input[name="goalType"]`, `[data-testid="goal-card"]`, "K5,000" text,
 * a debt-payoff creation flow with no matching form, archive/complete
 * lifecycle actions that do not exist, keyboard/ARIA assertions against
 * markup that isn't there) and none of it matched the shipped UI.
 */

import { test, expect, type Page } from "./protected-test";
import { login } from "./utils/login";
import { selectRadixOption } from "./utils/locators";
import { readBack, submitForData, type SubmitStep } from "./utils/submit";
import { testWithMutants } from "./utils/mutants";
import { responseValue, shownText } from "./utils/observe";
import { moneyValue, renderedMoney } from "./utils/money-value";

/** The wizard's create write; its corrupt mutant saves a different target amount. */
const CREATE_GOAL: SubmitStep = { name: "goal", method: "POST", path: "/api/goals", corruptField: "targetAmount" };

/** The target amount the wizard enters, and the currency it sends it in (the e2e household is ZMW, e2e/global-setup.ts). */
const TARGET_AMOUNT = "500";
const TARGET_CURRENCY = "ZMW";

interface CreatedGoal { name: string; targetAmount: string; currency: string }

/**
 * Creates a save-up goal through the real wizard and returns what it entered.
 * The wizard is a two-step flow: fill details -> "Continue" -> assignment
 * step (no account assignment required) -> "Create goal". The create POST
 * must answer 201 with a success envelope (submitForData).
 */
async function createSaveUpGoal(page: Page): Promise<CreatedGoal> {
  const goalName = `E2E Save Goal ${Date.now()}`;

  await page.getByRole("button", { name: "New Goal" }).click();
  const dialog = page.getByRole("dialog", { name: /create a goal/i });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Goal name").fill(goalName);
  // Default goal type is "other", which requires an extra free-text field.
  // Picking a concrete type keeps the form to the fields under test.
  await selectRadixOption(page, dialog.getByLabel("Goal type"), "Vacation");
  await dialog.getByLabel("Target amount").fill(TARGET_AMOUNT);

  await dialog.getByRole("button", { name: "Continue" }).click();
  await submitForData<unknown>(page, CREATE_GOAL,
    () => dialog.getByRole("button", { name: "Create goal" }).click());

  await expect(dialog).not.toBeVisible();
  return { name: goalName, targetAmount: TARGET_AMOUNT, currency: TARGET_CURRENCY };
}

/** The one goal named `name` in GET /api/goals (V7 envelope, MoneyDto amounts). */
async function listedGoal(page: Page, name: string): Promise<Record<string, unknown>> {
  const response = await page.request.get("/api/goals");
  if (response.status() !== 200) throw new Error(`GET /api/goals returned ${response.status()}`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("success" in body) || body.success !== true
    || !("data" in body) || !Array.isArray(body.data)) {
    throw new Error("GET /api/goals is not a success envelope with a goal list");
  }
  const matches = body.data.filter((goal: unknown): goal is Record<string, unknown> =>
    !!goal && typeof goal === "object" && "name" in goal && goal.name === name);
  if (matches.length !== 1) throw new Error(`expected one listed goal named ${JSON.stringify(name)}, found ${matches.length}`);
  return matches[0];
}

/** The goal's list row (GoalListItem, a role="button" card holding its h3). */
const goalRow = (page: Page, name: string) =>
  page.locator('[role="button"]').filter({ has: page.getByRole("heading", { name, level: 3, exact: true }) });

/** The row's target money text ("of K500.00"), as a money value. */
async function shownTarget(page: Page, name: string): Promise<string> {
  const text = await shownText(goalRow(page, name).getByText(/^of /));
  const match = /^of\s+(.+)$/.exec(text.trim());
  if (!match) throw new Error(`target text ${JSON.stringify(text)} is not "of <amount>"`);
  return renderedMoney(match[1]);
}

test.describe("Goals", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/goals");
    await expect(page).toHaveURL(/\/goals/);
  });

  test("displays the Save Up / Pay Down tabs with summary cards", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Goals", level: 1 }),
    ).toBeVisible();

    await expect(
      page.getByRole("tab", { name: "Save Up" }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Pay Down" })).toBeVisible();

    // The Save Up tab is selected by default and always renders these
    // summary cards, regardless of whether any goals exist yet.
    await expect(page.getByText("Total Saved")).toBeVisible();
    await expect(page.getByText("Monthly Projection")).toBeVisible();
  });

  test("switching to Pay Down shows the debt summary cards", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: "Pay Down" }).click();

    await expect(page.getByText("Total Debt")).toBeVisible();
    await expect(page.getByText("Monthly Payments")).toBeVisible();
  });

  testWithMutants("creates a save-up goal through the wizard and shows it in the list", { corrupt: [CREATE_GOAL] }, async (page) => {
    // Signed in and on /goals by the describe's beforeEach.
    const created = await createSaveUpGoal(page);

    // The goal name also appears in the success toast ("X has been added."),
    // so scope to the card's own heading rather than a bare text match.
    await expect(
      page.getByRole("heading", { name: created.name, level: 3 }),
    ).toBeVisible();

    // Reload so the row is painted from the server, not the mutation's cache.
    await page.reload();
    await expect(page.getByRole("heading", { name: created.name, level: 3 })).toBeVisible();
    await readBack(CREATE_GOAL, moneyValue(created.targetAmount, created.currency), {
      api: async () => responseValue((await listedGoal(page, created.name)).targetAmount, "targetAmount"),
      ui: () => shownTarget(page, created.name),
    });
    const stored = await listedGoal(page, created.name);
    expect(stored.type).toBe("save_up");
    expect(stored.currency).toBe(created.currency);
  });

  test("opens the goal detail dialog with the real tabs", async ({
    page,
  }) => {
    const { name: goalName } = await createSaveUpGoal(page);

    await page.getByRole("heading", { name: goalName, level: 3 }).click();

    const detailDialog = page.getByRole("dialog", { name: /goal details/i });
    await expect(detailDialog).toBeVisible();
    await expect(
      detailDialog.getByRole("tab", { name: "Overview" }),
    ).toBeVisible();
    await expect(
      detailDialog.getByRole("tab", { name: "Assignments" }),
    ).toBeVisible();
    await expect(
      detailDialog.getByRole("tab", { name: "Transfers" }),
    ).toBeVisible();
    await expect(
      detailDialog.getByRole("tab", { name: "Activity" }),
    ).toBeVisible();
  });

  test("opens the goal accounts dialog", async ({ page }) => {
    await page.getByRole("button", { name: "Goal accounts" }).click();

    await expect(
      page.getByRole("dialog", { name: /edit goal accounts/i }),
    ).toBeVisible();
  });

  test("opens the create goal transfer dialog", async ({ page }) => {
    await page.getByRole("button", { name: "Create goal transfer" }).click();

    await expect(
      page.getByRole("dialog", { name: /transfer.*contribute/i }),
    ).toBeVisible();
  });
});
