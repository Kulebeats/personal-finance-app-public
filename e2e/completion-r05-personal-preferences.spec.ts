import { randomUUID } from "node:crypto";
import type { Request, Response } from "@playwright/test";
import { test, expect, type Page } from "./protected-test";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";

const preferencePath = "/api/settings/user-preferences";

function redactDiagnostic(message: string) {
  return message.replace(/https?:\/\/[^\s)'"`]+/gi, value => {
    try { const url = new URL(value); return `${url.origin}${url.pathname}`; }
    catch { return "[url]"; }
  }).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(password|token|secret|cookie|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
}

async function signIn(page: Page, fixture: CompletionFixture) {
  const diagnostics: string[] = [];
  let documentStatus: number | null = null;
  const recordDiagnostic = (message: string) => {
    if (diagnostics.length < 12) diagnostics.push(message.slice(0, 300));
  };
  const onPageError = (error: Error) => recordDiagnostic(`pageerror ${redactDiagnostic(error.message)}`);
  const onRequestFailed = (request: Request) => {
    if (diagnostics.length >= 12) return;
    const pathname = new URL(request.url()).pathname.slice(0, 150);
    const failure = redactDiagnostic(request.failure()?.errorText ?? "unknown").slice(0, 120);
    recordDiagnostic(`requestfailed ${request.method()} ${pathname} ${failure}`);
  };
  page.on("pageerror", onPageError);
  page.on("requestfailed", onRequestFailed);
  try {
    documentStatus = (await page.goto("/login"))?.status() ?? null;
    // A cold client bundle must render the real login form before input actions begin.
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible({ timeout: 30_000 });
  } catch (error) {
    await test.info().attach("login-render-diagnostics", {
      body: `path=${new URL(page.url()).pathname.slice(0, 150)}\ndocumentStatus=${documentStatus ?? "no response"}\n${diagnostics.join("\n") || "No pageerror or requestfailed events"}`,
      contentType: "text/plain",
    });
    throw error;
  } finally {
    page.off("pageerror", onPageError);
    page.off("requestfailed", onRequestFailed);
  }
  await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByPlaceholder(/enter your password/i).fill(fixture.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
  const session = await page.request.get("/api/auth/session");
  expect(session.status()).toBe(200);
  expect((await session.json()).data).toMatchObject({
    state: "ready", subject: { id: fixture.userId }, household: { id: fixture.householdId },
  });
}

function responseFor(page: Page, path: string, method: string) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === path && response.request().method() === method;
  });
}

// The accounts page renders its rows from the account frame, the net-worth
// history read with includeAccounts (useAccountsData). "All" sends no
// ownerUserId; "Shared" sends ownerUserId=shared. `null` means absent.
const ACCOUNT_FRAME = "/api/accounts/net-worth/history";
function accountFrame(page: Page, owner: string | null) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === ACCOUNT_FRAME && response.request().method() === "GET" &&
      url.searchParams.get("includeAccounts") === "true" && url.searchParams.get("ownerUserId") === owner;
  });
}

async function frameAccounts(response: Response): Promise<unknown[]> {
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.data.accounts).toEqual(expect.any(Array));
  return body.data.accounts;
}

test("personal settings save all nine offered fields and survive a fresh server read", async ({ page }) => {
  const fixture = await createCompletionFixture();
  await signIn(page, fixture);

  const firstRead = responseFor(page, preferencePath, "GET");
  await page.goto("/settings/preferences");
  expect((await firstRead).status()).toBe(200);
  const save = page.getByRole("button", { name: "Save Preferences", exact: true });
  await expect(save).toBeDisabled();

  const changedSwitches = [
    "Remember last used account",
    "Remember category per merchant",
    "Auto-fill today's date",
    "Skip duplicate transactions",
    "Auto-assign categories from rules",
    "Auto-create transactions",
    "Require manual review",
  ];
  for (const label of changedSwitches) await page.getByRole("switch", { name: label }).click();
  await page.getByRole("combobox", { name: "Default Transaction Type" }).click();
  await page.getByRole("option", { name: "Income", exact: true }).click();
  await page.getByRole("slider", { name: "OCR Confidence Threshold" }).press("Home");
  await expect(page.getByText("0%", { exact: true })).toBeVisible();

  const expectedPatch = {
    rememberLastAccount: false,
    rememberLastCategoryPerMerchant: false,
    defaultTransactionType: "income",
    autoFillTodayDate: false,
    skipDuplicateImports: false,
    autoAssignCategoriesFromRules: false,
    autoCreateFromReceipt: true,
    requireOcrReview: false,
    ocrConfidenceThreshold: 0,
  };
  const saved = responseFor(page, preferencePath, "PUT");
  await expect(save).toBeEnabled();
  await save.click();
  const saveResponse = await saved;
  expect(saveResponse.status()).toBe(200);
  expect(saveResponse.request().postDataJSON()).toEqual(expectedPatch);
  expect((await saveResponse.json()).data.preferences).toMatchObject({
    userId: fixture.userId, ...expectedPatch, defaultAccountFilter: "all",
  });
  await expect(save).toBeDisabled();

  const persisted = await withFixtureClient(client => client.query(`SELECT user_id,
    remember_last_account, remember_last_category_per_merchant, default_transaction_type,
    auto_fill_today_date, skip_duplicate_imports, auto_assign_categories_from_rules,
    auto_create_from_receipt, require_ocr_review, ocr_confidence_threshold,
    default_account_filter FROM user_preferences WHERE user_id=$1`, [fixture.userId]));
  expect(persisted.rows).toEqual([{
    user_id: fixture.userId,
    remember_last_account: false,
    remember_last_category_per_merchant: false,
    default_transaction_type: "income",
    auto_fill_today_date: false,
    skip_duplicate_imports: false,
    auto_assign_categories_from_rules: false,
    auto_create_from_receipt: true,
    require_ocr_review: false,
    ocr_confidence_threshold: 0,
    default_account_filter: "all",
  }]);

  const reloaded = responseFor(page, preferencePath, "GET");
  await page.reload();
  const reloadResponse = await reloaded;
  expect(reloadResponse.status()).toBe(200);
  expect((await reloadResponse.json()).data.preferences).toMatchObject({ userId: fixture.userId, ...expectedPatch });
  for (const label of changedSwitches) {
    await expect(page.getByRole("switch", { name: label })).toBeChecked({ checked: label === "Auto-create transactions" });
  }
  await expect(page.getByRole("combobox", { name: "Default Transaction Type" })).toContainText("Income");
  await expect(page.getByRole("slider", { name: "OCR Confidence Threshold" })).toHaveAttribute("aria-valuenow", "0");
  await expect(save).toBeDisabled();
});

test("first personal account appears under default All, while saved Shared shows a filtered empty state", async ({ page }) => {
  const fixture = await createCompletionFixture();
  const accountName = `R05 personal cash ${randomUUID().slice(0, 8)}`;
  await signIn(page, fixture);

  const firstPreferences = responseFor(page, preferencePath, "GET");
  const firstAccounts = accountFrame(page, null);
  await page.goto("/accounts");
  const initialPreferencesResponse = await firstPreferences;
  expect(initialPreferencesResponse.status()).toBe(200);
  expect((await initialPreferencesResponse.json()).data.preferences).toMatchObject({
    userId: fixture.userId, defaultAccountFilter: "all",
  });
  expect(await frameAccounts(await firstAccounts)).toEqual([]);
  const ownerFilter = page.getByRole("combobox", { name: "Filter accounts by owner" });
  await expect(ownerFilter).toContainText("All Accounts");
  await expect(page.getByTestId("accounts-empty-state")).toContainText("No accounts yet");

  await page.getByRole("button", { name: "Add a new account", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Cash Physical Cash$/ }).click();
  await dialog.getByLabel("Account Name", { exact: true }).fill(accountName);
  await dialog.locator("#balance").fill("0");
  await dialog.getByRole("combobox").click();
  await page.getByRole("option", { name: /Me$/ }).click();
  const created = responseFor(page, "/api/accounts", "POST");
  await dialog.getByRole("button", { name: "Save Account", exact: true }).click();
  const createResponse = await created;
  expect(createResponse.status()).toBe(201);
  const createdAccount = (await createResponse.json()).data;
  expect(createdAccount).toMatchObject({ name: accountName, type: "cash", ownerUserId: fixture.userId });
  expect(createdAccount.id).toMatch(/^[0-9a-f-]{36}$/i);
  await expect(dialog.getByText("Account Created", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText(accountName, { exact: true })).toBeVisible();
  await expect(ownerFilter).toContainText("All Accounts");

  const accountRow = await withFixtureClient(client => client.query<{
    id: string; household_id: string; owner_user_id: string; name: string;
  }>("SELECT id, household_id, owner_user_id, name FROM accounts WHERE id=$1", [createdAccount.id]));
  expect(accountRow.rows).toEqual([{
    id: createdAccount.id, household_id: fixture.householdId,
    owner_user_id: fixture.userId, name: accountName,
  }]);

  await ownerFilter.click();
  const savedShared = responseFor(page, preferencePath, "PUT");
  const sharedAccounts = accountFrame(page, "shared");
  await page.getByRole("option", { name: /Shared Only$/ }).click();
  const sharedResponse = await savedShared;
  expect(sharedResponse.status()).toBe(200);
  expect(sharedResponse.request().postDataJSON()).toEqual({ defaultAccountFilter: "shared" });
  expect((await sharedResponse.json()).data.preferences).toMatchObject({
    userId: fixture.userId, defaultAccountFilter: "shared",
  });
  expect(await frameAccounts(await sharedAccounts)).toEqual([]);
  await expect(page.getByTestId("accounts-filtered-empty-state")).toContainText("No accounts match this filter");
  await expect(page.getByTestId("accounts-empty-state")).toHaveCount(0);
  await expect(page.getByText(accountName, { exact: true })).toHaveCount(0);
  await expect(ownerFilter).toContainText("Shared Only");

  const savedRow = await withFixtureClient(client => client.query<{ user_id: string; default_account_filter: string }>(
    "SELECT user_id, default_account_filter FROM user_preferences WHERE user_id=$1", [fixture.userId]));
  expect(savedRow.rows).toEqual([{ user_id: fixture.userId, default_account_filter: "shared" }]);

  const reloadedPreferences = responseFor(page, preferencePath, "GET");
  const reloadedShared = accountFrame(page, "shared");
  await page.reload();
  const reloadedPreferencesResponse = await reloadedPreferences;
  expect(reloadedPreferencesResponse.status()).toBe(200);
  expect((await reloadedPreferencesResponse.json()).data.preferences).toMatchObject({ defaultAccountFilter: "shared" });
  expect(await frameAccounts(await reloadedShared)).toEqual([]);
  await expect(ownerFilter).toContainText("Shared Only");
  await expect(page.getByTestId("accounts-filtered-empty-state")).toContainText("No accounts match this filter");

  const reset = responseFor(page, preferencePath, "PUT");
  await page.getByRole("button", { name: "Reset Filter to All", exact: true }).click();
  const resetResponse = await reset;
  expect(resetResponse.status()).toBe(200);
  expect(resetResponse.request().postDataJSON()).toEqual({ defaultAccountFilter: "all" });
  expect((await resetResponse.json()).data.preferences).toMatchObject({ defaultAccountFilter: "all" });
  await expect(ownerFilter).toContainText("All Accounts");
  await expect(page.getByText(accountName, { exact: true })).toBeVisible();
  expect((await withFixtureClient(client => client.query<{ default_account_filter: string }>(
    "SELECT default_account_filter FROM user_preferences WHERE user_id=$1", [fixture.userId]))).rows)
    .toEqual([{ default_account_filter: "all" }]);
  const reloadedAll = accountFrame(page, null);
  await page.reload();
  expect(await frameAccounts(await reloadedAll)).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: createdAccount.id, ownerUserId: fixture.userId, name: accountName }),
  ]));
  await expect(ownerFilter).toContainText("All Accounts");
  await expect(page.getByText(accountName, { exact: true })).toBeVisible();
});
