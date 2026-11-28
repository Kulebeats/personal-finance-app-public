import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "./protected-test";
import { loadTestTarget } from "../server/testing/test-target.mjs";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { readBack, submitStep, type SubmitStep } from "./utils/submit";
import { testWithMutants } from "./utils/mutants";
import { responseValue, storedValue } from "./utils/observe";

/** The rule modal's save; its corrupt mutant stores a different rule name (QA-01, scripts/e2e-mutation-check.mjs). */
const CREATE_RULE: SubmitStep = { name: "rule", method: "POST", path: "/api/rules", corruptField: "name" };

const ownedOrigin = loadTestTarget().server?.origin;
if (!ownedOrigin) throw new Error("R04 transaction-rule browser acceptance requires the protected owned server origin");

function responseFor(page: Page, path: string, method: string) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === ownedOrigin && url.pathname === path && !url.search &&
      response.request().method() === method;
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

testWithMutants("saved transaction creates a household rule with category and tag IDs", { corrupt: [CREATE_RULE] }, async (page) => {
  const fixture = await createCompletionFixture();
  // The transaction form removes numeric reference tokens from merchant names.
  // This household is unique, so the merchant can use a stable display name.
  const suffix = Number.parseInt(randomUUID().slice(0, 8), 16).toString(10);
  const accountName = `R04 Rule Cash ${suffix}`;
  const merchantName = "Raven Market";
  const tagName = `R04 Rule Tag ${suffix}`;
  const ruleName = `Auto: ${merchantName}`;
  let tagId: string | null = null;
  let accountId: string | null = null;
  let transactionId: string | null = null;
  let ruleId: string | null = null;

  try {
    tagId = await withFixtureClient(async client => {
      const { rows: [tag] } = await client.query<{ id: string }>(
        "INSERT INTO tags (household_id, name, usage_count) VALUES ($1, $2, 0) RETURNING id",
        [fixture.householdId, tagName],
      );
      return tag.id;
    });
    await page.clock.setFixedTime(new Date("2026-11-01T10:00:00+02:00"));
    await signIn(page, fixture);

    // Create the account and categorized expense through their ordinary UI.
    await page.goto("/accounts");
    await page.getByRole("button", { name: "Add a new account", exact: true }).click();
    const accountDialog = page.getByRole("dialog");
    await accountDialog.getByRole("button", { name: /^Cash Physical Cash$/ }).click();
    await accountDialog.getByLabel("Account Name", { exact: true }).fill(accountName);
    await accountDialog.locator("#balance").fill("100.00");
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
    await transactionDialog.getByPlaceholder("0.00", { exact: true }).fill("25.00");
    await transactionDialog.getByRole("combobox", { name: "Account", exact: true }).click();
    await page.getByRole("option", { name: accountName, exact: true }).click();
    await transactionDialog.getByRole("combobox", { name: "Category", exact: true }).click();
    await page.getByRole("option", { name: "Golden Expense", exact: true }).click();
    await transactionDialog.getByRole("combobox").filter({ hasText: "Select merchant" }).click();
    await page.getByPlaceholder("Search merchants...", { exact: true }).fill(merchantName);
    await page.getByPlaceholder("Search merchants...", { exact: true }).press("Escape");
    const ownerSelector = transactionDialog.getByRole("combobox").filter({ hasText: "Shared (Household)" });
    await ownerSelector.click();
    await page.getByRole("option").filter({ has: page.getByText("Me", { exact: true }) }).click();
    await transactionDialog.getByRole("combobox").filter({ has: page.getByText("Me", { exact: true }) }).click();
    await page.getByRole("option", { name: "Shared (Household)", exact: true }).click();
    const transactionCreated = responseFor(page, "/api/transactions", "POST");
    await transactionDialog.getByRole("button", { name: "Add Transaction", exact: true }).click();
    const transactionResponse = await transactionCreated;
    expect(transactionResponse.status()).toBe(201);
    expect(transactionResponse.request().postDataJSON()).toMatchObject({
      accountId, categoryId: fixture.expenseCategoryId, ownerUserId: null,
    });
    const savedTransaction = (await transactionResponse.json()).data as {
      id: string; name: string; merchantName?: string | null;
    };
    transactionId = savedTransaction.id;
    const owner = await withFixtureClient(client => client.query(
      "SELECT owner_user_id FROM transactions WHERE id=$1 AND household_id=$2", [transactionId, fixture.householdId],
    ));
    expect(owner.rows).toEqual([{ owner_user_id: null }]);
    expect(savedTransaction.name).toBe(merchantName);
    const savedMerchant = savedTransaction.merchantName || savedTransaction.name;
    expect(savedMerchant).toBe(merchantName);
    await expect(transactionDialog).toBeHidden();

    // The actual transaction detail hands its selected ID and visible label to
    // the rule modal; typing a saved tag resolves that tag to its household ID.
    const transactionRow = page.getByRole("button", { name: new RegExp(`^View ${savedMerchant},`) });
    await expect(transactionRow).toBeVisible();
    await expect(transactionRow.getByText("Golden Expense", { exact: true })).toBeVisible();
    await transactionRow.click();
    const detail = page.getByRole("dialog", { name: "Transaction details", exact: true });
    await expect(detail).toBeVisible();
    await expect(detail.getByRole("heading", { name: savedMerchant, level: 2 })).toBeVisible();
    await detail.getByRole("button", { name: "Create Rule", exact: true }).click();
    const ruleDialog = page.getByRole("dialog", { name: "New rule", exact: true });
    await expect(ruleDialog).toBeVisible();
    await expect(ruleDialog.getByRole("combobox", { name: "Update category" })).toContainText("Golden Expense");
    await ruleDialog.getByRole("switch", { name: "Add tags" }).click();
    await expect(ruleDialog.locator(`#rule-existing-tags option[value="${tagName}"]`)).toHaveCount(1);
    const tagInput = ruleDialog.getByRole("combobox", { name: "Existing tag name" });
    await tagInput.fill(tagName);
    await tagInput.press("Enter");
    await expect(ruleDialog.getByText(tagName, { exact: true })).toBeVisible();

    const ruleResponse = await submitStep(page, CREATE_RULE,
      () => ruleDialog.getByRole("button", { name: "Save", exact: true }).click());
    expect(ruleResponse.status()).toBe(201);
    const body = await ruleResponse.json();
    expect(body.success).toBe(true);
    ruleId = body.data.rule.id as string;
    // The stored name, before the request and row checks below, which a wrong name would also fail.
    await readBack(CREATE_RULE, ruleName, {
      api: async () => responseValue(body.data.rule.name, "name"),
      db: () => storedValue("SELECT name AS value FROM rules WHERE id=$1 AND household_id=$2", [ruleId, fixture.householdId]),
    });
    expect(ruleResponse.request().headers()["x-capital-subject"]).toBe(fixture.userId);
    expect(ruleResponse.request().headers()["x-capital-household"]).toBe(fixture.householdId);
    expect(Boolean(ruleResponse.request().headers()["x-csrf-token"])).toBe(true);
    const posted = ruleResponse.request().postDataJSON();
    expect(posted).toEqual({
      name: ruleName,
      conditions: [{ type: "merchant_name", operator: "equals", value: savedMerchant }],
      actions: [
        { type: "categorize", value: fixture.expenseCategoryId },
        { type: "add_tags", value: [tagId] },
      ],
      applyToPast: false,
    });
    expect(body.data.rule).toMatchObject({ id: ruleId, householdId: fixture.householdId, name: ruleName });
    // The author schema adds enabled=true defaults before storing JSONB.
    expect(body.data.rule.conditions).toEqual([{ ...posted.conditions[0], enabled: true }]);
    expect(body.data.rule.actions).toEqual(posted.actions.map((action: object) => ({ ...action, enabled: true })));
    await expect(ruleDialog).toBeHidden();

    const stored = await withFixtureClient(client => client.query<{
      id: string; household_id: string; name: string; conditions: unknown; actions: unknown; apply_to_past: boolean;
    }>(`SELECT id, household_id, name, conditions, actions, apply_to_past
        FROM rules WHERE household_id=$1 AND name=$2`, [fixture.householdId, ruleName]));
    expect(stored.rows).toEqual([{
      id: ruleId, household_id: fixture.householdId, name: ruleName,
      conditions: body.data.rule.conditions, actions: body.data.rule.actions, apply_to_past: false,
    }]);
  } finally {
    // Each cleanup predicate is bound to this synthetic fixture and its own IDs.
    await withFixtureClient(async client => {
      await client.query("BEGIN");
      try {
        await client.query("DELETE FROM rules WHERE household_id=$1 AND (name=$2 OR id=$3::uuid)", [fixture.householdId, ruleName, ruleId]);
        await client.query(`DELETE FROM transactions WHERE household_id=$1 AND
          (id=$2::uuid OR account_id IN (SELECT id FROM accounts WHERE household_id=$1 AND name=$3))`,
        [fixture.householdId, transactionId, accountName]);
        await client.query("DELETE FROM accounts WHERE household_id=$1 AND (id=$2::uuid OR name=$3)",
          [fixture.householdId, accountId, accountName]);
        await client.query("DELETE FROM tags WHERE household_id=$1 AND (id=$2::uuid OR name=$3)",
          [fixture.householdId, tagId, tagName]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  }
});

test("a privacy-only edit from the transaction list preserves the original expense and hides it from a household peer", async ({ page, request: peerApi }) => {
  const fixture = await createCompletionFixture();
  const peerId = randomUUID(), accountId = randomUUID(), transactionId = randomUUID(), tagId = randomUUID();
  const peer = { ...fixture, userId: peerId, email: `peer-${peerId}@example.invalid` };
  const name = "Rent payment 42";
  await withFixtureClient(async client => {
    await client.query("BEGIN");
    try {
      await client.query(`INSERT INTO users (id, username, email, password_hash, email_verified)
        SELECT $1, $2, $3, password_hash, true FROM users WHERE id=$4`, [peerId, peerId, peer.email, fixture.userId]);
      await client.query("INSERT INTO household_members (household_id,user_id,role) VALUES ($1,$2,'member')", [fixture.householdId, peerId]);
      await client.query(`INSERT INTO accounts (id,household_id,name,type,currency,initial_balance,balance)
        VALUES ($1,$2,'Rent account','cash','ZMW',100,75)`, [accountId, fixture.householdId]);
      await client.query(`INSERT INTO transactions (id,household_id,account_id,category_id,owner_user_id,date,name,amount,type,currency,is_private)
        VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,$6,25,'expense','ZMW',false)`,
        [transactionId, fixture.householdId, accountId, fixture.expenseCategoryId, fixture.userId, name]);
      await client.query("INSERT INTO tags (id,household_id,name,usage_count) VALUES ($1,$2,'Monthly',1)", [tagId, fixture.householdId]);
      await client.query("INSERT INTO transaction_tags (transaction_id,tag_id) VALUES ($1,$2)", [transactionId, tagId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });

  const path = `/api/transactions/${transactionId}`;
  const headersFor = (userId: string) => ({ "x-capital-subject": userId, "x-capital-household": fixture.householdId });
  // The peer keeps a separate signed session throughout the owner's edit.
  const signed = await peerApi.post(`${ownedOrigin}/api/auth/login`, {
    data: { email: peer.email, password: peer.password }, maxRedirects: 0,
  });
  expect(signed.status()).toBe(200);
  const peerSession = await peerApi.get(`${ownedOrigin}/api/auth/session`, { maxRedirects: 0 });
  expect((await peerSession.json()).data).toMatchObject({ subject: { id: peerId }, household: { id: fixture.householdId } });
  const before = await peerApi.get(path, { headers: headersFor(peerId), maxRedirects: 0 });
  expect(before.status()).toBe(200);
  const original = (await before.json()).data;
  expect(original).toMatchObject({ id: transactionId, name, isPrivate: false });

  await signIn(page, fixture);
  await page.goto("/transactions");
  await page.getByRole("button", { name: /^View Rent payment 42,/ }).click();
  await page.getByRole("button", { name: "Edit transaction", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Transaction", exact: true });
  await expect(editor.getByRole("combobox", { name: "Owner", exact: true })).toContainText("Me");
  await editor.getByRole("checkbox", { name: "Private transaction", exact: true }).check();
  const [response] = await Promise.all([
    responseFor(page, path, "PUT"), editor.getByRole("button", { name: "Save Changes", exact: true }).click(),
  ]);
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toMatchObject({ isPrivate: true, ownerUserId: fixture.userId, updatedAt: original.updatedAt });
  await expect(editor).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: /^View Rent payment 42,/ })).toBeVisible();
  const stored = await withFixtureClient(client => client.query(`SELECT t.name, t.is_private, t.amount::text, t.owner_user_id,
    a.balance::text, tt.tag_id FROM transactions t JOIN accounts a ON a.id=t.account_id
    LEFT JOIN transaction_tags tt ON tt.transaction_id=t.id WHERE t.id=$1 AND t.household_id=$2`, [transactionId, fixture.householdId]));
  expect(stored.rows).toEqual([{ name, is_private: true, amount: "25.00", owner_user_id: fixture.userId, balance: "75.00", tag_id: tagId }]);

  expect((await peerApi.get(path, { headers: headersFor(peerId), maxRedirects: 0 })).status()).toBe(404);
  const list = await peerApi.get(`/api/transactions?accountId=${accountId}`, { headers: headersFor(peerId), maxRedirects: 0 });
  expect(list.status()).toBe(200);
  expect((await list.json()).data).toEqual([]);
});
