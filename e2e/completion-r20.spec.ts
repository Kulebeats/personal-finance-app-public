import assert from "node:assert/strict";
import { test, expect, type Page } from "./protected-test";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { loadTestTarget } from "../server/testing/test-target.mjs";
import { GOLDEN_A, readGoldenA, assertGoldenAPrefix } from "../server/testing/fixtures/golden-a";

async function createdId(page: Page, pathname: string, submit: () => Promise<void>) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === pathname && response.request().method() === "POST");
  await submit();
  const response = await pending;
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.success).toBe(true);
  expect(body.data.id).toMatch(/^[0-9a-f-]{36}$/i);
  return body.data.id as string;
}

async function loginAndCreateAccount(page: Page, fixture: CompletionFixture) {
  await page.clock.setFixedTime(new Date(`${GOLDEN_A.date}T10:00:00+02:00`));
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByPlaceholder(/enter your password/i).fill(fixture.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/accounts");
  await page.getByRole("button", { name: /add account/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Cash Physical Cash$/ }).click();
  await dialog.getByLabel("Account Name", { exact: true }).fill(GOLDEN_A.accountName);
  await dialog.locator("#balance").fill(GOLDEN_A.opening);
  const id = await createdId(page, "/api/accounts", () => dialog.getByRole("button", { name: "Save Account", exact: true }).click());
  await expect(dialog.getByText("Account Created", { exact: true })).toBeVisible();
  await page.goto("/transactions");
  return id;
}

async function fillTransaction(page: Page, type: "income" | "expense") {
  await page.getByRole("button", { name: "Add Transaction", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add Transaction", exact: true });
  await dialog.getByRole("button", { name: type === "income" ? "CREDIT (Income)" : "DEBIT (Expense)", exact: true }).click();
  await dialog.getByPlaceholder("0.00", { exact: true }).fill(GOLDEN_A[type]);
  await dialog.getByRole("combobox", { name: "Account", exact: true }).click();
  await page.getByRole("option", { name: GOLDEN_A.accountName, exact: true }).click();
  await dialog.getByRole("combobox", { name: "Category", exact: true }).click();
  await page.getByRole("option", { name: type === "income" ? "Golden Income" : "Golden Expense", exact: true }).click();
  if (type === "expense") {
    await dialog.getByRole("combobox").filter({ hasText: "Select merchant" }).click();
    await page.getByPlaceholder("Search merchants...", { exact: true }).fill("Golden Expense Merchant");
    await page.getByPlaceholder("Search merchants...", { exact: true }).press("Escape");
  }
  return dialog;
}

async function enterTransaction(page: Page, type: "income" | "expense", omitSubmit = false) {
  const dialog = await fillTransaction(page, type);
  if (omitSubmit) {
    // Mutation probe: the filled form must never count as a persisted expense.
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    return "not-submitted";
  }
  const id = await createdId(page, "/api/transactions", () => dialog.getByRole("button", { name: "Add Transaction", exact: true }).click());
  await expect(dialog).toBeHidden();
  return id;
}

test("retrying an expense after a lost committed response debits cash once", async ({ page }) => {
  const fixture = await createCompletionFixture();
  const accountId = await loginAndCreateAccount(page, fixture);
  const dialog = await fillTransaction(page, "expense");
  const origin = loadTestTarget().server?.origin;
  if (!origin) throw new Error("A protected server origin is required");
  const endpoint = new URL("/api/transactions", origin).href;
  let originalBody: unknown;
  let committedStatus: number | undefined;
  await page.route(endpoint, async route => {
    if (route.request().method() !== "POST" || originalBody !== undefined) {
      return route.fallback();
    }
    originalBody = route.request().postDataJSON();
    try {
      const response = await route.fetch({ maxRedirects: 0 });
      committedStatus = response.status();
      await response.dispose();
    } catch {
      return route.abort("failed");
    }
    await route.abort("connectionreset");
  });
  const submit = dialog.getByRole("button", { name: /^(Add Transaction|Retry original transaction|Retry entered details)$/ });
  await Promise.all([
    page.waitForEvent("requestfailed", request => request.method() === "POST" && request.url() === endpoint),
    submit.click(),
  ]);
  expect(committedStatus).toBe(201);
  const committed = await readGoldenA(fixture);
  expect(committed.accounts).toEqual([expect.objectContaining({ id: accountId, balance: "874.50" })]);
  expect(committed.transactions).toEqual([expect.objectContaining({ account_id: accountId, amount: "125.50" })]);
  expect(originalBody).toMatchObject({ accountId, idempotencyKey: expect.any(String) });

  const [replay] = await Promise.all([
    page.waitForResponse(response => response.request().method() === "POST" && response.url() === endpoint),
    submit.click(),
  ]);
  const afterRetry = await readGoldenA(fixture);
  expect(afterRetry).toEqual(committed);
  expect(replay.request().postDataJSON()).toEqual(originalBody);
  expect(replay.status()).toBe(200);
  const id = committed.transactions[0].id;
  expect(await replay.json()).toMatchObject({ isDuplicate: true, data: { id } });
  await expect(dialog).toBeHidden();
  await expect.poll(async () => withFixtureClient(async client => (await client.query(
    `SELECT (SELECT count(*)::int FROM audit_logs WHERE entity_id=$1 AND action='CREATE') AS audits,
            (SELECT count(*)::int FROM outbox_events WHERE aggregate_id=$1 AND event_type='transaction.created') AS events`,
    [id])).rows[0])).toEqual({ audits: 1, events: 1 });
});

for (const omitExpense of [false, true]) {
  test(omitExpense ? "Golden A oracle rejects an omitted expense submit" : "Golden A UI submissions persist through reload", async ({ page }) => {
    const fixture = await createCompletionFixture();
    expect(await readGoldenA(fixture)).toEqual({ accounts: [], transactions: [] });
    const account = await loginAndCreateAccount(page, fixture);
    const income = await enterTransaction(page, "income");
    const expense = await enterTransaction(page, "expense", omitExpense);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Transactions", exact: true })).toBeVisible();
    const incomeRow = page.getByRole("button", { name: /^View Income, .*200\.00$/ });
    const expenseRow = page.getByRole("button", { name: /^View Golden Expense Merchant, .*125\.50$/ });
    await expect(incomeRow).toBeVisible();
    await expect(incomeRow.getByText("Golden Income", { exact: true })).toBeVisible();
    const snapshot = await readGoldenA(fixture);
    if (omitExpense) {
      await expect(expenseRow).toHaveCount(0);
      expect(snapshot.transactions).toHaveLength(1);
      expect(snapshot.transactions[0].id).toBe(income);
      expect(snapshot.accounts[0].balance).toBe(GOLDEN_A.omittedExpenseBalance);
      assert.throws(() => assertGoldenAPrefix(snapshot, fixture, { account, income, expense }), /Golden A persisted account\/balance differs/);
    } else {
      await expect(expenseRow).toBeVisible();
      await expect(expenseRow.getByText("Golden Expense", { exact: true })).toBeVisible();
      assertGoldenAPrefix(snapshot, fixture, { account, income, expense });
      const response = await page.request.get(`/api/accounts/${account}`);
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data.id).toBe(account);
      expect(body.data.balance).toBe(GOLDEN_A.balance);
    }
  });
}
