import { randomUUID } from "node:crypto";
import { expect } from "./protected-test";
import { loadTestTarget } from "../server/testing/test-target.mjs";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { readBack, submitStep, type SubmitStep } from "./utils/submit";
import { testWithMutants } from "./utils/mutants";
import { storedMoney } from "./utils/observe";
import { moneyValue } from "./utils/money-value";

/** The card's create write; its corrupt mutant saves a different opening balance (QA-01, scripts/e2e-mutation-check.mjs). */
const CREATE_CARD: SubmitStep = { name: "card", method: "POST", path: "/api/accounts", corruptField: "initialBalance" };

const origin = loadTestTarget().server?.origin;
if (!origin) throw new Error("R08 reconciliation requires the protected owned server origin");

testWithMutants("account detail previews a card statement and posts one reviewed correction", { corrupt: [CREATE_CARD] }, async (page) => {
  const fixture = await createCompletionFixture();
  try {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(fixture.email);
    await page.getByPlaceholder(/enter your password/i).fill(fixture.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");
    await page.goto("/accounts");
    await page.getByRole("button", { name: "Add a new account", exact: true }).click();
    const create = page.getByRole("dialog");
    await create.getByRole("button", { name: /^Credit Card Visa, Mastercard$/ }).click();
    await create.getByLabel("Account Name", { exact: true }).fill("R08 Statement " + randomUUID().slice(0, 8));
    await create.locator("#balance").fill("110.00");
    const account = await submitStep(page, CREATE_CARD, () => create.getByRole("button", { name: "Save Account", exact: true }).click());
    expect(account.status()).toBe(201);
    const accountId: string = (await account.json()).data.id;
    // The opening and current balance as stored, before the statement preview, which a wrong opening balance would also fail.
    await readBack(CREATE_CARD, moneyValue("110.00", "ZMW"), {
      opening: () => storedMoney("SELECT initial_balance::text AS amount, currency FROM accounts WHERE id=$1 AND household_id=$2", [accountId, fixture.householdId]),
      balance: () => storedMoney("SELECT balance::text AS amount, currency FROM accounts WHERE id=$1 AND household_id=$2", [accountId, fixture.householdId]),
    });
    const endpoint = origin + "/api/accounts/" + accountId + "/reconcile";
    const read = () => withFixtureClient(async client => ({
      account: (await client.query("SELECT balance, initial_balance, currency FROM accounts WHERE id=$1 AND household_id=$2", [accountId, fixture.householdId])).rows,
      postings: (await client.query("SELECT id, amount, posted_balance_delta, currency, notes FROM transactions WHERE account_id=$1 AND type='balance_adjustment' ORDER BY id", [accountId])).rows,
    }));
    await page.goto("/accounts/" + accountId);
    const before = await read();
    expect(before.account).toEqual([{ balance: "110.00", initial_balance: "110.00", currency: "ZMW" }]);
    expect(before.postings).toEqual([]);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("menuitem", { name: "Reconcile balance" }).click();
    const dialog = page.getByRole("dialog", { name: "Reconcile balance" });
    await dialog.getByLabel(/Statement balance/).fill("105.75");
    await dialog.getByLabel("Reason").fill("November card statement");
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    const verify = page.getByRole("dialog", { name: "Confirm it's you" });
    await verify.getByLabel("Password").fill(fixture.password);
    const previewed = page.waitForResponse(r => r.url() === endpoint && r.status() === 200 && r.request().postDataJSON().mode === "preview");
    await verify.getByRole("button", { name: "Confirm", exact: true }).click();
    const preview = await previewed;
    const headers = await preview.request().allHeaders();
    expect(headers["x-capital-subject"]).toBe(fixture.userId);
    expect(headers["x-capital-household"]).toBe(fixture.householdId);
    const draft = preview.request().postDataJSON();
    const quote = (await preview.json()).data;
    await expect(dialog.getByText("ZMW -4.25", { exact: true })).toBeVisible();
    expect(await read()).toEqual(before);
    const posted = page.waitForResponse(r => r.url() === endpoint && r.request().postDataJSON().mode === "apply");
    await dialog.getByRole("button", { name: "Apply adjustment", exact: true }).click();
    const applied = await posted;
    expect(applied.status()).toBe(200);
    expect(applied.request().postDataJSON()).toEqual({ ...draft, mode: "apply", previewToken: quote.previewToken });
    const id = (await applied.json()).data.transactionId;
    await expect(dialog.getByRole("status")).toContainText(id);
    const after = await read();
    expect(after.account).toEqual([{ balance: "105.75", initial_balance: "110.00", currency: "ZMW" }]);
    expect(after.postings).toEqual([{ id, amount: "4.25", posted_balance_delta: "-4.25", currency: "ZMW", notes: "November card statement" }]);
    await dialog.getByRole("button", { name: "Close" }).click();
    await page.reload();
    await expect(page.getByRole("heading", { name: /105\.75/ })).toBeVisible();
    expect(await read()).toEqual(after);
  } finally {
    await withFixtureClient(async client => {
      await client.query("BEGIN");
      try {
        await client.query("DELETE FROM outbox_events WHERE household_id=$1 OR payload->>'userId'=$2", [fixture.householdId, fixture.userId]);
        await client.query("DELETE FROM audit_logs WHERE household_id=$1 OR user_id=$2", [fixture.householdId, fixture.userId]);
        await client.query("DELETE FROM security_audit_logs WHERE user_id=$1 OR target_user_id=$1", [fixture.userId]);
        await client.query(`DELETE FROM "session" WHERE sess->>'userId'=$1 OR sess->>'mfaPendingUserId'=$1`, [fixture.userId]);
        await client.query("DELETE FROM households WHERE id=$1", [fixture.householdId]);
        await client.query("DELETE FROM users WHERE id=$1", [fixture.userId]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    });
  }
});
