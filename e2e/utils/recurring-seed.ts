import type { Client } from "pg";

/**
 * Every real recurring-rule creation path records a ZMW denomination receipt;
 * without one a directly seeded rule's unit is unproven and the page leaves it
 * out of its totals (FIN-05). Seeds the receipt for each rule, mirroring
 * server/modules/recurring/__tests__/recurring-proven-zmw.fixture.ts. Call inside the
 * seed's transaction, after the rules are inserted.
 */
export async function confirmZmwDenomination(client: Client, ruleIds: readonly string[]): Promise<void> {
  await client.query(`INSERT INTO recurring_transaction_history (recurring_transaction_id, action, new_state, created_at)
    SELECT id, 'denomination_confirmed_v1', jsonb_build_object('version', 1, 'currency', 'ZMW',
      'amount', amount::text, 'accountId', account_id::text, 'source', 'manual_creation'), clock_timestamp()
    FROM recurring_transactions WHERE id = ANY($1::uuid[])`, [ruleIds]);
}
