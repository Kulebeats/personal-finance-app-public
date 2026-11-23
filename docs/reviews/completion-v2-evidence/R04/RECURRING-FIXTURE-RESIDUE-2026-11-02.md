# Recurring protected-run fixture residue

Product checkpoint: `435d70a92195ee7392296579f8156f7bae91c9f2`.
The coordinator passed all 513 tests across 22 recurring suites. The retained
`.local/r04-rec-compat09l/postflight.txt` is non-clean:
`pfa_completion_scope_compat09l_test|0|0|1|1|1|0`.
The previous recproof09a packet has the same recurring counts and is also retained.
Neither packet is retroactively reclassified as an empty target.

The source trace identifies a fixture leak, rather than an expected baseline.
`recurring_concurrency.integration.test.ts` created one `Concurrent Test Rule`,
one `Concurrent Test Transaction` and five idempotent successful link calls that
persisted one link and one linked-history event. It had a beforeEach TRUNCATE and
no afterEach/afterAll. The coordinator independently ran the read-only diagnostic
below and reported the exact expected fixture, one occurrence and synthetic user.
This worker performed no database access or deletion.

The trusted atomicity fixture creates `scp330-rule` rows with denomination and
processed history and has household-scoped afterAll cleanup. The materialization
fixture creates `r5-rule` rows and has both afterEach and afterAll cleanup. Their
source shapes and teardown do not match the one-rule/one-linked-history residue.
Their existing cleanup catches now rethrow so teardown failures cannot be hidden.

The scoped repair registers randomly allocated household/user UUIDs before any
insert, removes the concurrency fixture's TRUNCATE, and installs unconditional
afterEach/afterAll cleanup. Household FK cascades remove only that household's
transactions, accounts, categories/groups, tag labels, recurring rules/links/
history and other owned rows; user cleanup follows. A new interrupted-body test
checks those exact identities disappear while a separate sentinel's account,
category and label survive unchanged. The original concurrent linking assertions
remain one persisted link, five fulfilled calls and no rejected call.

The older database integration suite additionally registers both household UUIDs
and every created user UUID, including its extra second-user mock before insertion.
Unconditional teardown removes only those household identities and their cascaded
rows, their sessions by exact user ID, and those users. It propagates errors. An
assertion failure can no longer bypass the extra mock user's cleanup.

The repair does not identify or delete old residue by name, prefix, or table-wide
TRUNCATE. Run its focused tests on a fresh marked target. Leave original failed
and non-clean evidence untouched.

## Coordinator-only read-only diagnosis of the old compat09l target

Use the explicitly marked target connection after its existing guard checks.
This SQL performs no writes; an unexpected database name yields no fixture rows.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT current_database();
SELECT r.id, r.name, r.household_id, h.name AS household_name,
       a.name AS account_name, r.total_occurrences,
       (SELECT count(*) FROM recurring_transaction_links l
        WHERE l.recurring_transaction_id = r.id) AS link_count,
       (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'action', x.action, 'linked_transaction_id', x.linked_transaction_id)
          ORDER BY x.created_at, x.id), '[]'::jsonb)
        FROM recurring_transaction_history x
        WHERE x.recurring_transaction_id = r.id) AS history,
       (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', t.id, 'name', t.name, 'is_recurring', t.is_recurring,
          'pointer', t.recurring_transaction_id,
          'synthetic_user', u.username LIKE 'test-concurrency-user-%')), '[]'::jsonb)
        FROM transactions t LEFT JOIN users u ON u.id = t.owner_user_id
        WHERE t.household_id = r.household_id) AS household_transactions
FROM recurring_transactions r
LEFT JOIN households h ON h.id = r.household_id
LEFT JOIN accounts a ON a.id = r.account_id
WHERE current_database() = 'pfa_completion_scope_compat09l_test'
ORDER BY r.id;

SELECT * FROM (
  SELECT 'account' AS kind, id, household_id, name AS label FROM accounts
  UNION ALL SELECT 'category', id, household_id, name FROM categories
  UNION ALL SELECT 'category_group', id, household_id, name FROM category_groups
  UNION ALL SELECT 'tag_label', id, household_id, name FROM tags
) inventory
WHERE current_database() = 'pfa_completion_scope_compat09l_test'
ORDER BY kind, household_id, id;
ROLLBACK;
```

Old expected signature: `Concurrent Test Rule` / `Test Household` / `Test Account`,
one occurrence, one link, sole history action `linked`, `Concurrent Test Transaction`
and `synthetic_user=true`. New fixtures use distinct Concurrency primary/sentinel
labels but cleanup remains UUID-based. If other identities appear, retain them for
separate ownership diagnosis rather than deleting by a broad fixture name match.
