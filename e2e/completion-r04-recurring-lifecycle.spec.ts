import { randomUUID } from "node:crypto";
import { expect, test } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";

test("the recurring list skips and pauses a saved rule through the signed routes", async ({ page }) => {
  const owner = await createCompletionFixture();
  const accountId = randomUUID();
  const ruleId = randomUUID();
  try {
    await withFixtureClient(async client => {
      await client.query("INSERT INTO accounts (id, household_id, name, type, balance) VALUES ($1,$2,'Lifecycle cash','checking',100)",
        [accountId, owner.householdId]);
      await client.query(`INSERT INTO recurring_transactions
        (id,household_id,account_id,name,amount,type,frequency,start_date,next_due_date)
        VALUES ($1,$2,$3,'Monthly fare',11.11,'expense','monthly','2027-01-15','2027-01-15')`,
        [ruleId, owner.householdId, accountId]);
    });
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(owner.email, { timeout: 30_000 });
    await page.getByPlaceholder(/enter your password/i).fill(owner.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");
    await page.goto("/recurring");
    await page.getByRole("button", { name: "List view" }).click();
    await expect(page.getByText("Monthly fare", { exact: true }).first()).toBeVisible();
    for (const [menuItem, action] of [["Skip next", "skip"], ["Pause", "pause"]] as const) {
      await page.getByRole("button", { name: "Actions", exact: true }).click();
      const [response] = await Promise.all([
        page.waitForResponse(res => new URL(res.url()).pathname === `/api/recurring/${ruleId}/${action}` && res.request().method() === "POST"),
        page.getByRole("menuitem", { name: menuItem, exact: true }).click(),
      ]);
      expect(response.status()).toBe(200);
      expect(response.request().headers()["x-capital-subject"]).toBe(owner.userId);
      expect(response.request().headers()["x-capital-household"]).toBe(owner.householdId);
      const { data } = await response.json();
      expect(data).toMatchObject({ id: ruleId, nextDueDate: "2027-02-15", isPaused: action === "pause" });
    }
    await expect(page.getByText("Rule paused", { exact: true }).first()).toBeVisible();
    await withFixtureClient(async client => {
      const { rows } = await client.query(`SELECT r.is_paused, r.next_due_date::text, a.balance::text
        FROM recurring_transactions r JOIN accounts a ON a.id=r.account_id WHERE r.id=$1 AND r.household_id=$2`, [ruleId, owner.householdId]);
      expect(rows).toEqual([{ is_paused: true, next_due_date: "2027-02-15", balance: "100.00" }]);
      const history = await client.query("SELECT action, performed_by FROM recurring_transaction_history WHERE recurring_transaction_id=$1 ORDER BY action", [ruleId]);
      expect(history.rows).toEqual(["paused", "skipped"].map(action => ({ action, performed_by: owner.userId })));
    });
  } finally {
    await withFixtureClient(async client => {
      await client.query("DELETE FROM outbox_events WHERE aggregate_id=$1 AND household_id=$2", [ruleId, owner.householdId]);
      await client.query("DELETE FROM audit_logs WHERE user_id=$1", [owner.userId]);
      await client.query("DELETE FROM recurring_transactions WHERE id=$1 AND household_id=$2", [ruleId, owner.householdId]);
      await client.query("DELETE FROM accounts WHERE id=$1 AND household_id=$2", [accountId, owner.householdId]);
      await client.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1', [owner.userId]);
      await client.query("DELETE FROM households WHERE id=$1", [owner.householdId]);
      await client.query("DELETE FROM users WHERE id=$1", [owner.userId]);
    });
  }
});
