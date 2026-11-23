# R05 personal account filter migration candidate

Status: authored only. No database migration, upgrade, rollback, or restoration
has been run by this packet. The target and execution window belong to the
campaign owner.

## Forward change

`migrations/0014_r05_personal_account_filter.sql` adds
`user_preferences.default_account_filter varchar(10) NOT NULL DEFAULT 'all'`
with the `all`/`mine`/`shared` check. The Drizzle declaration, snapshot and
journal use the same column, default and constraint. This is an additive schema
change. PostgreSQL supplies `all` to preexisting rows; there is no inferred
ownership backfill or update to the nine nullable legacy fields.

Before applying, independently verify the disposable target identity and
current journal head, record row count and any existing invalid legacy enum
values, and inspect the exact SQL and snapshot diff. Rehearse an empty upgrade
and a populated upgrade with an existing `user_preferences` row. Confirm the
populated row keeps its nine fields and timestamps byte-for-byte while the new
filter reads `all`. Then prove `mine` and `shared` persist and invalid values
are rejected by the database check. Preserve the before/after observations in
the owner evidence packet.

## Rollback and compatibility

The previous binary ignores the added column and can run against the expanded
schema. That compatible binary rollback preserves saved filter values for a
later retry. If physical schema reversal is needed on a disposable target,
capture the filter values first; dropping the column destroys user choices.
The inverse DDL is:

```sql
ALTER TABLE "user_preferences" DROP CONSTRAINT "chk_user_preferences_default_account_filter";
ALTER TABLE "user_preferences" DROP COLUMN "default_account_filter";
```

Production recovery requires the operations owner's reviewed forward migration
or restore procedure, not editing an already applied `0014` journal entry.
