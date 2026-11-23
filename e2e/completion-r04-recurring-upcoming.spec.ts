import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { confirmZmwDenomination } from "./utils/recurring-seed";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email, { timeout: 30_000 });
  await page.getByPlaceholder(/enter your password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
}

test("recurring page shows each household member only their visible upcoming payments and total", async ({ page, browser }) => {
  const owner = await createCompletionFixture();
  const memberId = randomUUID();
  const memberEmail = `upcoming-${memberId}@example.invalid`;
  const sharedId = randomUUID(), privateId = randomUUID();
  const sharedRule = randomUUID(), privateRule = randomUUID();
  const memberContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    await withFixtureClient(async client => {
      await client.query("BEGIN");
      try {
        await client.query(`INSERT INTO users (id, username, email, password_hash, timezone, email_verified)
          SELECT $1, $2, $3, password_hash, timezone, true FROM users WHERE id = $4`,
        [memberId, `member-${memberId}`, memberEmail, owner.userId]);
        await client.query("INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'member')", [owner.householdId, memberId]);
        await client.query("INSERT INTO user_display_settings (user_id) VALUES ($1)", [memberId]);
        await client.query(`INSERT INTO accounts (id, household_id, owner_user_id, name, type, is_private)
          VALUES ($1, $3, NULL, 'Shared cash', 'checking', false), ($2, $3, $4, 'Personal cash', 'checking', true)`,
        [sharedId, privateId, owner.householdId, owner.userId]);
        await client.query(`INSERT INTO recurring_transactions
          (id, household_id, account_id, name, amount, type, frequency, start_date, next_due_date)
          VALUES ($1, $3, $4, 'Shared fare', 11.11, 'expense', 'monthly', CURRENT_DATE, CURRENT_DATE + 1),
                 ($2, $3, $5, 'Private dues', 777.77, 'expense', 'monthly', CURRENT_DATE, CURRENT_DATE + 2)`,
        [sharedRule, privateRule, owner.householdId, sharedId, privateId]);
        await confirmZmwDenomination(client, [sharedRule, privateRule]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });

    const memberPage = await memberContext.newPage();
    for (const viewer of [
      { page, email: owner.email, userId: owner.userId, ids: [sharedRule, privateRule], total: "788.88" },
      { page: memberPage, email: memberEmail, userId: memberId, ids: [sharedRule], total: "11.11" },
    ]) {
      await signIn(viewer.page, viewer.email, owner.password);
      const origin = new URL(viewer.page.url()).origin;
      const [response] = await Promise.all([
        viewer.page.waitForResponse(res => res.url() === `${origin}/api/recurring/upcoming?days=30` && res.request().method() === "GET"),
        viewer.page.goto("/recurring"),
      ]);
      expect(response.status()).toBe(200);
      expect(response.request().headers()["x-capital-subject"]).toBe(viewer.userId);
      expect(response.request().headers()["x-capital-household"]).toBe(owner.householdId);
      const { data } = await response.json() as { data: Array<{ id: string }> };
      expect(data.map(rule => rule.id)).toEqual(viewer.ids);
      const list = viewer.page.getByTestId("upcoming-bills-list");
      await expect(list.getByTestId("upcoming-bill-item")).toHaveCount(viewer.ids.length);
      await expect(list.getByText("Shared fare", { exact: true })).toBeVisible();
      await expect(list.getByText("Private dues", { exact: true })).toHaveCount(viewer.ids.includes(privateRule) ? 1 : 0);
      const header = viewer.page.getByText(/upcoming payments totaling/);
      await expect(header).toContainText(`${viewer.ids.length} upcoming payments totaling`);
      await expect(header).toContainText(viewer.total);
    }
  } finally {
    await memberContext.close();
    await withFixtureClient(async client => {
      await client.query("DELETE FROM recurring_transactions WHERE household_id = $1 AND id IN ($2, $3)", [owner.householdId, sharedRule, privateRule]);
      await client.query("DELETE FROM accounts WHERE household_id = $1 AND id IN ($2, $3)", [owner.householdId, sharedId, privateId]);
      await client.query('DELETE FROM "session" WHERE sess->>\'userId\' = ANY($1::text[])', [[owner.userId, memberId]]);
      await client.query("DELETE FROM households WHERE id = $1", [owner.householdId]);
      await client.query("DELETE FROM users WHERE id IN ($1, $2)", [owner.userId, memberId]);
    });
  }
});
