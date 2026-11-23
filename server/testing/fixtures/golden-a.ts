import assert from "node:assert/strict";
import { withFixtureClient } from "./fixture-context";
import type { CompletionFixture } from "./completion-fixtures";

// Independent literal oracle from the governing Golden A prefix, not app math.
export const GOLDEN_A = Object.freeze({
  accountName: "Golden A Cash", opening: "1000.00", income: "200.00", expense: "125.50",
  balance: "1074.50", omittedExpenseBalance: "1200.00", date: "2026-10-15", currency: "ZMW",
});

export async function readGoldenA(fixture: CompletionFixture) {
  return withFixtureClient(async (client) => {
    const accounts = await client.query(`SELECT id, household_id, name, type, initial_balance, balance, currency,
      deleted_at FROM accounts WHERE household_id = $1 ORDER BY id`, [fixture.householdId]);
    const transactions = await client.query(`SELECT id, household_id, account_id, type, amount, currency,
      date::text, category_id, is_pending, status, deleted_at FROM transactions
      WHERE household_id = $1 ORDER BY type::text, id`, [fixture.householdId]);
    return { accounts: accounts.rows, transactions: transactions.rows };
  });
}

export function assertGoldenAPrefix(snapshot: Awaited<ReturnType<typeof readGoldenA>>, fixture: CompletionFixture,
  ids: { account: string; income: string; expense: string }) {
  assert.equal(snapshot.accounts.length, 1, "Golden A requires exactly one UI-created account");
  const account = snapshot.accounts[0];
  assert.deepEqual(account, { id: ids.account, household_id: fixture.householdId, name: GOLDEN_A.accountName,
    type: "cash", initial_balance: GOLDEN_A.opening, balance: GOLDEN_A.balance, currency: GOLDEN_A.currency, deleted_at: null },
  "Golden A persisted account/balance differs");
  assert.equal(snapshot.transactions.length, 2, "Golden A requires exactly two UI-submitted transactions");
  assert.deepEqual(snapshot.transactions, [
    { id: ids.expense, household_id: fixture.householdId, account_id: ids.account, type: "expense",
      amount: GOLDEN_A.expense, currency: GOLDEN_A.currency, date: GOLDEN_A.date,
      category_id: fixture.expenseCategoryId, is_pending: false, status: "cleared", deleted_at: null },
    { id: ids.income, household_id: fixture.householdId, account_id: ids.account, type: "income",
      amount: GOLDEN_A.income, currency: GOLDEN_A.currency, date: GOLDEN_A.date,
      category_id: fixture.incomeCategoryId, is_pending: false, status: "cleared", deleted_at: null },
  ], "Golden A persisted transaction identity/values differ");
}
