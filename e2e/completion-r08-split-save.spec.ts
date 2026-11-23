import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "./protected-test";
import { loadTestTarget } from "../server/testing/test-target.mjs";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";

const ownedOrigin = loadTestTarget().server?.origin;
if (!ownedOrigin) throw new Error("R08 split browser acceptance requires the protected owned server origin");

function responseFor(page: Page, path: string, method: string) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === ownedOrigin && url.pathname === path && !url.search && response.request().method() === method;
  });
}
async function signIn(page: Page, fixture: CompletionFixture) {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByPlaceholder(/enter your password/i).fill(fixture.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
  const session = await page.request.get(`${ownedOrigin}/api/auth/session`);
  expect(session.status()).toBe(200);
  expect((await session.json()).data).toMatchObject({
    state: "ready", subject: { id: fixture.userId }, household: { id: fixture.householdId },
  });
}

for (const scenario of [
  { accountKind: "cash", typeLabel: /^Cash Physical Cash$/, balance: "899.99", delta: "-100.01", isAsset: true },
  { accountKind: "credit", typeLabel: /^Credit Card Visa, Mastercard$/, balance: "1100.01", delta: "100.01", isAsset: false },
]) {
test(`split save retains the recorded ${scenario.accountKind} balance impact after reopen and reload`, async ({ page }) => {
  const fixture = await createCompletionFixture();
  const accountName = `R08 Split ${scenario.accountKind} ` + randomUUID().slice(0, 8);
  const merchantName = "Raven Split Market";
  let accountId: string | null = null, transactionId: string | null = null;
  const readState = async () => withFixtureClient(async client => ({
    parent: (await client.query(`SELECT id,account_id,amount,currency,type,category_id,deleted_at,posting_mode,posted_balance_delta,posted_account_is_asset
      FROM transactions WHERE id=$1 AND household_id=$2`, [transactionId, fixture.householdId])).rows,
    children: (await client.query(`SELECT s.transaction_id,s.amount,s.category_id,s.notes,s.display_order
      FROM transaction_splits s JOIN transactions t ON t.id=s.transaction_id
      WHERE t.id=$1 AND t.household_id=$2 ORDER BY s.display_order,s.id`, [transactionId, fixture.householdId])).rows,
    account: (await client.query(`SELECT id,balance,initial_balance,currency FROM accounts
      WHERE id=$1 AND household_id=$2`, [accountId, fixture.householdId])).rows,
    audit: (await client.query(`SELECT action,user_id,entity_type,entity_id,details FROM audit_logs
      WHERE household_id=$1 AND entity_id=$2 AND entity_type='transaction' AND action='UPDATE' ORDER BY id`,
    [fixture.householdId, transactionId])).rows,
    events: (await client.query(`SELECT event_type,aggregate_type,aggregate_id,payload FROM outbox_events
      WHERE household_id=$1 AND aggregate_id=$2 AND event_type='transaction.updated' ORDER BY id`,
    [fixture.householdId, transactionId])).rows,
  }));

  try {
    await page.clock.setFixedTime(new Date("2026-11-02T10:00:00+02:00"));
    await signIn(page, fixture);

    // The protected fixture creates prerequisites only. Both economic records
    // below are admitted through the ordinary signed UI rather than seeded SQL.
    await page.goto("/accounts");
    await page.getByRole("button", { name: "Add a new account", exact: true }).click();
    const accountDialog = page.getByRole("dialog");
    await accountDialog.getByRole("button", { name: scenario.typeLabel }).click();
    await accountDialog.getByLabel("Account Name", { exact: true }).fill(accountName);
    await accountDialog.locator("#balance").fill("1000.00");
    const accountCreated = responseFor(page, "/api/accounts", "POST");
    await accountDialog.getByRole("button", { name: "Save Account", exact: true }).click();
    const accountResponse = await accountCreated;
    expect(accountResponse.status()).toBe(201);
    accountId = (await accountResponse.json()).data.id as string;
    await expect(accountDialog.getByText("Account Created", { exact: true })).toBeVisible();
    await accountDialog.getByRole("button", { name: "Done", exact: true }).click();

    await page.goto("/transactions");
    await page.getByRole("button", { name: "Add Transaction", exact: true }).click();
    const transactionDialog = page.getByRole("dialog", { name: "Add Transaction", exact: true });
    await transactionDialog.getByRole("button", { name: "DEBIT (Expense)", exact: true }).click();
    await transactionDialog.getByPlaceholder("0.00", { exact: true }).fill("100.01");
    await transactionDialog.getByRole("combobox", { name: "Account", exact: true }).click();
    await page.getByRole("option", { name: accountName, exact: true }).click();
    await transactionDialog.getByRole("combobox", { name: "Category", exact: true }).click();
    await page.getByRole("option", { name: "Golden Expense", exact: true }).click();
    await transactionDialog.getByRole("combobox").filter({ hasText: "Select merchant" }).click();
    await page.getByPlaceholder("Search merchants...", { exact: true }).fill(merchantName);
    await page.getByPlaceholder("Search merchants...", { exact: true }).press("Escape");
    const transactionCreated = responseFor(page, "/api/transactions", "POST");
    await transactionDialog.getByRole("button", { name: "Add Transaction", exact: true }).click();
    const transactionResponse = await transactionCreated;
    expect(transactionResponse.status()).toBe(201);
    const original = (await transactionResponse.json()).data as { id: string; name: string; updatedAt: string };
    transactionId = original.id;
    expect(original.name).toBe(merchantName);
    await expect(transactionDialog).toBeHidden();
    const before = await readState();
    expect(before.parent).toEqual([expect.objectContaining({ amount: "100.01", currency: "ZMW", category_id: fixture.expenseCategoryId })]);
    expect(before.account).toEqual([{ id: accountId, balance: scenario.balance, initial_balance: "1000.00", currency: "ZMW" }]);
    expect(before.children).toEqual([]);
    expect(before.audit).toEqual([]);
    expect(before.events).toEqual([]);

    const row = page.getByRole("button", { name: new RegExp("^View " + merchantName + ",") });
    await expect(row).toBeVisible();
    await row.click();
    const detail = page.getByRole("dialog", { name: "Transaction details", exact: true });
    await expect(detail).toBeVisible();
    await detail.getByRole("button", { name: "Split Transaction", exact: true }).click();
    const splitDialog = page.getByRole("dialog", { name: "Split Transaction", exact: true });
    await expect(splitDialog).toBeVisible();
    await expect(splitDialog.getByRole("spinbutton")).toHaveCount(2);
    await splitDialog.getByRole("spinbutton").nth(0).fill("60.01");
    await splitDialog.getByRole("spinbutton").nth(1).fill("40.00");
    await splitDialog.getByRole("combobox").nth(0).click();
    await page.getByRole("option", { name: "Golden Expense", exact: true }).click();
    await expect(splitDialog.getByRole("combobox").nth(1)).toContainText("Select category");
    await splitDialog.getByPlaceholder("Add a note...", { exact: true }).nth(0).fill("Categorized cents");
    await splitDialog.getByPlaceholder("Add a note...", { exact: true }).nth(1).fill("Uncategorized cents");
    const save = splitDialog.getByRole("button", { name: "Save Splits", exact: true });
    await expect(save).toBeEnabled();
    const savedResponse = responseFor(page, "/api/transactions/" + transactionId, "PUT");
    await save.click();
    const response = await savedResponse;
    expect(response.status()).toBe(200);
    const headers = response.request().headers();
    expect(headers["x-capital-subject"]).toBe(fixture.userId);
    expect(headers["x-capital-household"]).toBe(fixture.householdId);
    expect(Boolean(headers["x-csrf-token"])).toBe(true);
    const posted = response.request().postDataJSON() as {
      splits: Array<{ amount: { amount: string; currency: string }; categoryId?: string | null; notes?: string }>;
      expectedUpdatedAt?: string;
    };
    expect(Object.keys(posted).filter(key => key !== "expectedUpdatedAt")).toEqual(["splits"]);
    expect(posted.expectedUpdatedAt).toBe(original.updatedAt);
    expect(posted.expectedUpdatedAt).toEqual(expect.any(String));
    expect(posted.splits).toHaveLength(2);
    expect(posted.splits[0]).toMatchObject({ amount: { amount: "60.01", currency: "ZMW" }, categoryId: fixture.expenseCategoryId, notes: "Categorized cents" });
    expect(posted.splits[1]).toMatchObject({ amount: { amount: "40.00", currency: "ZMW" }, notes: "Uncategorized cents" });
    // Both omitted and explicit null are supported wire representations of a
    // blank category; neither permits dropping its positive allocation.
    expect(posted.splits[1].categoryId ?? null).toBeNull();
    expect(await response.json()).toMatchObject({ success: true, data: {
      id: transactionId, accountId, type: "expense", categoryId: null,
      amount: { amount: "100.01", currency: "ZMW" },
    } });
    await expect(splitDialog).toBeHidden();

    const saved = await readState();
    expect(saved.parent).toEqual([{ id: transactionId, account_id: accountId, amount: "100.01", currency: "ZMW", type: "expense", category_id: null, deleted_at: null,
      posting_mode: "posted", posted_balance_delta: scenario.delta, posted_account_is_asset: scenario.isAsset }]);
    expect(saved.account).toEqual(before.account);
    expect(saved.children).toEqual([
      { transaction_id: transactionId, amount: "60.01", category_id: fixture.expenseCategoryId, notes: "Categorized cents", display_order: 0 },
      { transaction_id: transactionId, amount: "40.00", category_id: null, notes: "Uncategorized cents", display_order: 1 },
    ]);
    expect(saved.audit).toHaveLength(1);
    expect(saved.audit[0]).toMatchObject({ action: "UPDATE", user_id: fixture.userId,
      entity_type: "transaction", entity_id: transactionId, details: { changes: { splits: expect.anything() } } });
    expect(saved.events).toHaveLength(1);
    expect(saved.events[0]).toMatchObject({ event_type: "transaction.updated", aggregate_type: "transaction",
      aggregate_id: transactionId, payload: { id: transactionId, changes: expect.arrayContaining(["splits"]) } });

    // Reopen immediately from the actual infinite list, before any page reload.
    await expect(detail).toBeHidden();
    const reloadedRow = page.getByRole("button", { name: new RegExp("^View " + merchantName + ",") });
    await expect(reloadedRow).toBeVisible();
    await expect(reloadedRow.getByText("Split (2)", { exact: true })).toBeVisible();
    await reloadedRow.click();
    await page.getByRole("dialog", { name: "Transaction details", exact: true })
      .getByRole("button", { name: "Split Transaction", exact: true }).click();
    const reloadedEditor = page.getByRole("dialog", { name: "Split Transaction", exact: true });
    await expect(reloadedEditor.getByRole("spinbutton")).toHaveCount(2);
    await expect(reloadedEditor.getByRole("spinbutton").nth(0)).toHaveValue("60.01");
    await expect(reloadedEditor.getByRole("spinbutton").nth(1)).toHaveValue("40.00");
    await expect(reloadedEditor.getByRole("combobox").nth(0)).toContainText("Golden Expense");
    await expect(reloadedEditor.getByRole("combobox").nth(1)).toContainText("Select category");
    await reloadedEditor.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.reload();
    await expect(row.getByText("Split (2)", { exact: true })).toBeVisible();
    expect(await readState()).toEqual(saved);
  } finally {
    await withFixtureClient(async client => {
      await client.query("BEGIN");
      try {
        await client.query("DELETE FROM outbox_events WHERE household_id=$1 OR payload->>'userId'=$2", [fixture.householdId, fixture.userId]);
        await client.query("DELETE FROM audit_logs WHERE household_id=$1 OR user_id=$2", [fixture.householdId, fixture.userId]);
        await client.query("DELETE FROM security_audit_logs WHERE user_id=$1 OR target_user_id=$1", [fixture.userId]);
        await client.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1 OR sess->>\'mfaPendingUserId\'=$1', [fixture.userId]);
        await client.query("DELETE FROM households WHERE id=$1", [fixture.householdId]);
        await client.query("DELETE FROM users WHERE id=$1", [fixture.userId]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    });
  }
});
}
