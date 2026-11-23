import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";

function budgetState(householdId: string) {
  return withFixtureClient(async client => (await client.query(`
    select (select jsonb_agg(to_jsonb(b) order by b.id) from budgets b where b.household_id=$1) as budgets,
      (select jsonb_agg(to_jsonb(p) order by p.id) from budget_periods p
       join budgets b on b.id=p.budget_id where b.household_id=$1) as periods,
      (select count(*)::int from audit_logs where household_id=$1 and entity_type='budget') as audits`,
    [householdId])).rows[0]);
}

async function seedPreview(withManualLimit: boolean) {
  const fixture = await createCompletionFixture();
  const { householdId, expenseCategoryId, userId } = fixture;
  const accountId = randomUUID(), budgetId = randomUUID();
  await withFixtureClient(async client => {
    await client.query("BEGIN");
    try {
      await client.query("insert into accounts(id,household_id,name,type,balance,currency,is_private) values($1,$2,'Cash','checking',1000,'ZMW',false)", [accountId, householdId]);
      await client.query("update categories set include_in_budget=true where id=$1 and household_id=$2", [expenseCategoryId, householdId]);
      if (withManualLimit) {
        await client.query("insert into budgets(id,household_id,name,category_id,amount) values($1,$2,'Manual limit',$3,500)", [budgetId, householdId, expenseCategoryId]);
      }
      await client.query(`insert into transactions(household_id,account_id,category_id,owner_user_id,name,amount,currency,type,date)
        values($1,$2,$3,$4,'Historical expense',550,'ZMW','expense',(date_trunc('month',now() at time zone 'UTC') - interval '1 day')::date)`,
        [householdId, accountId, expenseCategoryId, userId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  });
  return { fixture, budgetId };
}

async function openBudgetSettings(page: Page, fixture: Awaited<ReturnType<typeof createCompletionFixture>>) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByPlaceholder(/enter your password/i).fill(fixture.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/budget");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
}

test("signed budget preview preserves the manual limit after dismissal and reload", async ({ page }) => {
  const { fixture, budgetId } = await seedPreview(true);
  const { householdId, userId, expenseCategoryId } = fixture;
  await openBudgetSettings(page, fixture);
  const before = await budgetState(householdId);
  const path = "/api/budgets/recalculate";
  const writes: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith(path) && request.method() !== "GET") writes.push(request.method());
  });
  // Accept the old confirmation in the negative control so an unintended writer is observable.
  page.on("dialog", dialog => dialog.accept());
  const [response] = await Promise.all([
    page.waitForResponse(candidate => new URL(candidate.url()).pathname.startsWith(path)),
    page.getByRole("button", { name: /^(Preview averages|Recalculate)$/i }).click(),
  ]);
  expect(response.request().method()).toBe("GET");
  expect(new URL(response.url()).pathname).toBe(`${path}/preview`);
  expect(new URL(response.url()).searchParams.get("months")).toBe("3");
  expect(response.request().headers()["x-capital-household"]).toBe(householdId);
  expect(response.request().headers()["x-capital-subject"]).toBe(userId);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.data.suggestions).toContainEqual(expect.objectContaining({ categoryId: expenseCategoryId,
    historicalTotal: { amount: "550.00", currency: "ZMW" }, amount: { amount: "183.33", currency: "ZMW" },
    currentBudget: expect.objectContaining({ id: budgetId, amount: { amount: "500.00", currency: "ZMW" } }) }));
  const dialog = page.getByRole("dialog", { name: "Budget suggestions" });
  await expect(dialog).toContainText("Golden Expense");
  await expect(dialog).toContainText("183.33");
  await expect(dialog).toContainText("500.00");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  expect(writes).toEqual([]);
  expect(await budgetState(householdId)).toEqual(before);
});

test("confirmed suggestion creates a limit only for the selected month", async ({ page }) => {
  const { fixture } = await seedPreview(false);
  await openBudgetSettings(page, fixture);
  await page.getByRole("button", { name: "Preview averages" }).click();
  const dialog = page.getByRole("dialog", { name: "Budget suggestions" });
  const select = dialog.getByRole("checkbox", { name: "Select Golden Expense" });
  await expect(select).not.toBeChecked();
  await select.check();
  await dialog.getByRole("button", { name: "Review selected changes" }).click();
  const before = await budgetState(fixture.householdId);
  expect(before.budgets).toBeNull();
  expect(before.periods).toBeNull();
  const [response] = await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname === "/api/budgets/recalculate/apply" && r.request().method() === "POST"),
    dialog.getByRole("button", { name: /^Confirm changes for / }).click(),
  ]);
  expect(response.status()).toBe(200);
  const { targetPeriod, operationId } = response.request().postDataJSON();
  expect((await response.json()).data).toMatchObject({ operationId, targetPeriod, appliedCount: 1 });
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Preview averages" }).click();
  await expect(dialog).toContainText("Golden Expense");
  const after = await budgetState(fixture.householdId);
  expect(after.budgets).toHaveLength(1);
  expect(after.budgets[0]).toMatchObject({ category_id: fixture.expenseCategoryId, amount: null });
  expect(after.periods).toHaveLength(1);
  expect(after.periods[0]).toMatchObject({ budget_id: after.budgets[0].id, start_date: `${targetPeriod}-01`, budget_amount: 183.33, currency: "ZMW" });
  expect(after.audits).toBe(before.audits + 1);
});

test("a lost apply response can be retried after closing settings without a second monthly change", async ({ page }) => {
  const { fixture } = await seedPreview(false);
  const initial = await budgetState(fixture.householdId);
  await openBudgetSettings(page, fixture);
  await page.getByRole("button", { name: "Preview averages" }).click();
  const dialog = page.getByRole("dialog", { name: "Budget suggestions" });
  await dialog.getByRole("checkbox", { name: "Select Golden Expense" }).check();
  await dialog.getByRole("button", { name: "Review selected changes" }).click();

  const submissions: string[] = [];
  let committedStatus: number | undefined;
  await page.route("**/api/budgets/recalculate/apply", async route => {
    const body = route.request().postData();
    if (body === null) throw new Error("Confirmed change must have a body");
    submissions.push(body);
    if (submissions.length === 1) {
      const response = await route.fetch({ maxRetries: 0 });
      committedStatus = response.status();
      await response.dispose();
      await route.abort("connectionreset");
    } else {
      await route.continue();
    }
  });
  await dialog.getByRole("button", { name: /^Confirm changes for / }).click();
  await expect(dialog.getByRole("button", { name: "Retry the same confirmed changes" })).toBeVisible();
  expect(committedStatus).toBe(200);
  const persisted = await budgetState(fixture.householdId);
  expect(persisted.audits).toBe(initial.audits + 1);
  expect(persisted.periods).toHaveLength(1);
  expect(persisted.budgets[0].amount).toBeNull();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Preview averages" }).click();
  await expect(dialog).not.toContainText("Golden Expense");
  await expect(dialog).not.toContainText("183.33");
  await dialog.getByRole("button", { name: "Retry the same confirmed changes" }).click();
  await expect(dialog).toContainText("Applied 1 budget change");
  expect(submissions).toEqual([submissions[0], submissions[0]]);
  expect(await budgetState(fixture.householdId)).toEqual(persisted);
});
