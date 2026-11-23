<!-- Subagent inventory report saved verbatim by the lead (bold markers removed). Source: code-explorer agent, read-only, 2026-10-13, HEAD 381e943. -->

# Data model and migration inventory (read-only)

Scope: `shared/schema.ts` (3307 lines, read in full), `drizzle.config.ts`, `migrations/*.sql` (0000 only grepped), `migrations/meta/_journal.json`, `migrations-legacy/` (listed), `server/db.ts`, `server/dbSsl.ts`, plus `package.json`, `.github/workflows/ci.yml`, `render.yaml` and `scripts/verify-deploy-readiness.mjs`. Nothing under `docs/reviews/` was opened. `docs/runbooks/deploy.md` lines 95-106 were read only to compare its claims with the code.

Headline findings:
- There are 79 tables, and every money column is `decimal`.
- The migration chain and the schema agree by name on every table, index and check constraint.
- Only two migrations are not applied on a fresh database, but the real drift risks are in the notes at the end of section 4.
- Seven FK names exceed 63 characters.
- `tags` and the other name-bearing tables have no uniqueness on `(household_id, name)`.
- `household_members` can still hold duplicate rows when its columns are NULL.
- `transactions.idempotency_key` is globally unique, not per-household.
- `server/routes/admin.ts` queries a table (`calculation_logs`) that exists in no migration.

## 1. Table catalogue

Schema has 79 `pgTable`s; the migrations create 79 (76 in 0000, 2 in 0004, 1 in 0010). A name diff of schema tables against `CREATE TABLE` names shows no differences.

Scope key: HH = `household_id` column; via X = scoped only through a parent FK; USER = `user_id` only; NONE = global.

### Identity, auth, session

| Table (schema.ts line) | Purpose | PK | Scope | Notes |
|---|---|---|---|---|
| `users` (253) | Accounts, profile, MFA, lockout | uuid `id` | NONE | `annual_income` decimal(15,2) at 297. Verification token column holds a SHA-256 hash (262-265). `salary_range_encrypted` is text (302). |
| `password_history` (341) | Previous password hashes | `id` | USER | FK cascade to users |
| `password_reset_tokens` (358) | Single-use reset tokens (hash only) | `id` | USER | Explicit FK name `password_reset_tokens_user_id_fk` (379) |
| `user_display_settings` (384) | Currency, locale, widgets | `user_id` | USER | Default currency "ZMW" (389); GIN index on jsonb (407) |
| `user_notification_preferences` (411) | Per-type notification toggles | `id` | USER (nullable `user_id`) | `threshold_amount` decimal(15,2) at 420; no unique on (user, type) |
| `user_push_subscriptions` (426) | Web push endpoints | `id` | USER | `endpoint` unique (431) |
| `user_quiet_hours` (443), `user_preferences` (454), `user_ai_preferences` (484), `user_two_factor_auth` (498) | Per-user settings | `user_id` | USER | Cascade from users |
| `user_sessions` (510), `user_login_history` (526) | Device tracking | `id` | USER | `session_token` unique (513) |
| `session` (538) | connect-pg-simple store | `sid` varchar | NONE | `createTableIfMissing: true` at `server/app.ts:152`. Also in migration 0000:835 and in the schema. |
| `system_roles` (194), `user_system_roles` (202) | Admin RBAC | `id` | NONE | `user_system_roles.user_id` and `role_id` have no FK (206-207), only indexes |
| `security_audit_logs` (225) | Auth/security events | `id` | NONE (`user_id`, `target_user_id`, no FK) | See section 3 |
| `notifications` (548) | In-app notifications | `id` | USER notNull plus HH nullable (`set null`, 553) | Partial unique `idx_notifications_dedupe` (576) |

### Household and reference data

| Table | Purpose | PK | Scope | Notes |
|---|---|---|---|---|
| `households` (585) | Tenant root | `id` | itself | `currency` varchar(3), nullable, default ZMW (588). `ai_consent_*` at 594-598. CHECK currency length (603). |
| `household_members` (609) | Membership and role | `id` | HH (nullable, 611) | Role enum includes `professional` |
| `household_preferences` (631) | Budget behaviour | `household_id` | HH | `review_threshold_amount` decimal(15,2) at 639 |
| `household_invitations` (657) | Invites | `id` | HH notNull | `invite_code` unique (664) |
| `category_groups` (687), `categories` (704) | Category tree | `id` | HH nullable | `categories.deleted_at` (725) is a soft delete. `rollover_start_balance` decimal(15,2) at 717. |
| `merchants` (737) | Merchant master | `id` | HH nullable | No soft delete; `is_active` flag |
| `merchant_aliases` (768), `merchant_logo_uploads` (777), `merchant_merge_history` (798) | Merchant children | `id` | via merchants | `source_merchant_id` has no FK (801) |
| `tags` (829) | Tags | `id` | HH nullable | `member_specific` and `member_id` (837-838) act as privacy-ish scope. `is_archived`. |
| `rules` (872), `rule_execution_log` (891) | Rules engine | `id` | rules: HH nullable; log: via rule | `rule_execution_log.transaction_id` has no FK (894) |
| `data_exports` (904) | Export records | `id` | HH nullable plus USER | See section 3 |
| `data_imports` (929) | Import records | `id` | USER only (no HH) | |
| `filter_presets` (953) | Saved filters | `id` | HH notNull plus USER notNull | `is_shared` (965) governs visibility |

### Core financial tables

| Table | Purpose | Scope | Owner / privacy | Soft delete | Money columns | Currency |
|---|---|---|---|---|---|---|
| `accounts` (1159) | Accounts | HH notNull | `is_private` (1191), `owner_user_id` (1192, set null) | `deleted_at` (1216), also `is_archived`, `is_hidden` | `balance`, `initial_balance` (1173-1177), `available_balance`, `credit_limit`, `estimated_value`: decimal(15,2). `apr`: decimal(5,2). | `currency` varchar(3) notNull, default ZMW (1187) |
| `transactions` (1238) | Ledger | HH notNull | `is_private` (1303), `owner_user_id` (1248) | `deleted_at` (1322) | `amount` decimal(15,2) notNull (1256), `converted_amount` decimal(15,2) (1281), `fx_rate` decimal(18,8) (1276) | `currency` varchar(3) nullable (1257), plus `fx_base_currency` and `fx_quote_currency` |
| `transaction_attachments` (1373) | Receipts on transactions | via transaction | `uploaded_by` | none | `ocr_confidence` decimal(5,2) | none (`ocr_data` jsonb) |
| `transaction_tags` (1417), `transaction_splits` (1445), `transaction_comments` (2133) | Transaction children | via transaction | none | none | splits `amount` decimal(15,2) (1452) | none |
| `net_worth_snapshots` (1481) | Daily household net worth | HH notNull | none | none | `total_assets`, `total_liabilities`, `net_worth`: decimal(15,2) (1490-1495) | varchar(3) (1504) |
| `account_balance_snapshots` (1525) | Daily account balance | via account | none | none | `balance`, `available_balance`: decimal(15,2) | none |
| `budgets` (1554) | Budgets | HH notNull | none | none (`is_active`) | `amount`, `rollover_amount`: decimal(15,2) | varchar(3) notNull (1589) |
| `budget_periods` (1631) | Period cache | via budget | none | none | `budget_amount`, `spent_amount`, `rollover_in`: decimal(15,2) | varchar(3) notNull (1648) |
| `goals` (1695) | Goals | HH notNull | `created_by` only, no private flag | none (`is_archived`) | `target_amount`, `current_amount`, `monthly_projection`, `original_balance`, `minimum_payment`, `monthly_payment`, `one_time_payment`: decimal(15,2). Rates: decimal(5,2). | varchar(3) notNull (1715) |
| `goal_contributions` (1783), `goal_account_assignments` (1807), `goal_activity_log` (1899) | Goal children | via goal | none | none | decimal(15,2) | none |
| `goal_transfers` (1843) | Moves between goals | HH notNull | `created_by` | none | `amount` decimal(15,2) | none |
| `transaction_goal_links` (1873) | Links transactions to goals | via transaction and goal | `linked_by` | none | `amount` decimal(15,2) | none |
| `goal_image_uploads` (1919) | Goal images | HH notNull | `uploaded_by` | none | none | none |
| `recurring_transactions` (1944) | Recurring templates | HH notNull | none | none (`is_active`, `is_paused`) | `amount` decimal(15,2) (1955) | none (no currency column) |
| `recurring_transaction_links` (2022), `recurring_transaction_history` (2065) | Recurring children | via recurring | `performed_by` | none | link expected/actual amounts: decimal(15,2) | none |
| `pending_receipts` (2172) | OCR inbox | HH notNull | `uploaded_by` | none | `ocr_confidence` decimal(5,2) | none (currency only inside `ocr_data` jsonb) |
| `audit_logs` (2105) | DPA audit trail | HH nullable | `user_id` set null | none | none | none |

### Investments, GRZ, pension, platform

| Table | Scope | Money columns | Currency |
|---|---|---|---|
| `securities` (2415) | NONE (global) | `current_price` decimal(15,4); `withholding_tax_rate` decimal(5,2) | varchar(3) |
| `holdings` (2448) | HH notNull | `quantity` decimal(18,8); `cost_basis`, `cost_basis_zmw` decimal(15,2); `acquisition_fx_rate` decimal(10,4) | none |
| `security_prices` (2486) | via security | `price` decimal(15,4) | none |
| `investment_transactions` (2513) | HH notNull | `amount`, `fees`, `withholding_tax`, `amount_zmw` decimal(15,2); `fx_rate` decimal(10,4) | varchar(3) notNull |
| `price_alerts` (2571) | HH notNull | `threshold` decimal(15,4) | none |
| `tax_lots` (2591), `tax_lot_disposals` (2622) | HH notNull | decimal(15,2) / (18,8) | none |
| `fx_rates` (2654) | NONE (global) | `rate` decimal(10,4) | `from_currency`, `to_currency` varchar(3) |
| `currency_accounts` (2670) | via account | `opening_balance`, `current_balance` decimal(15,2) | varchar(3) |
| `portfolio_benchmarks` (2694), `benchmark_values` (2706) | NONE | `value` decimal(15,4) | varchar(3) nullable |
| `csd_accounts` (2786) | USER notNull | none | none |
| `grz_auction_results` (2803) | NONE (public market data, the household column was removed on purpose, 2801) | amounts decimal(15,2); yields decimal(6,4) | none |
| `grz_bonds` (2833), `grz_tbills` (2893) | HH notNull | `face_value`, `purchase_price`, `sold_price`, `discount_amount` decimal(15,2); `coupon_rate`, yields decimal(6,4) | none |
| `grz_bond_payments` (2869) | via bond | `gross_amount`, `withholding_tax`, `net_amount` decimal(15,2) | none |
| `pension_holdings` (3017), `pension_contributions` (3039) | HH / via holding | decimal(15,2) | none |
| `recurring_investments` (3066), `recurring_execution_log` (3089) | HH / via investment | `amount` decimal(15,2) | varchar(3) on `recurring_investments` only |
| `outbox_events` (3147) | HH nullable | none | none |
| `jobs` (3201) | NONE | none | none |
| `ai_conversations` (3252), `ai_messages` (3282) | HH notNull plus USER notNull / via conversation | none | none |

Timestamps. Every table has `created_at`. Most have `updated_at`; the log-style tables do not (for example `transaction_tags`, `transaction_splits`, `security_prices`, `audit_logs`, `fx_rates`). All timestamps are `timestamp` without time zone.

Money column types. `shared/schema.ts` imports only `decimal` (line 10), with no `real`, `doublePrecision`, `numeric` or `bigint` (imports at lines 2-20). Every money column found is `decimal(p,s)`, so there is no float money column to flag in the DB schema.

Precision inconsistencies, all still decimal:
- FX rates use three different shapes: `transactions.fx_rate` (18,8) at 1276, `investment_transactions.fx_rate` (10,4) at 2536, and `fx_rates.rate` (10,4) at 2659.
- `holdings.acquisition_fx_rate` is (10,4) at 2467.

Money-adjacent values stored outside typed decimal columns:
- `net_worth_snapshots.assets_by_type`, `liabilities_by_type` and `account_balances` are jsonb (1498-1502). The comments show raw numbers.
- `OcrExtractedData` amounts are strings inside jsonb (2151-2162).
- Rule `actions`/`conditions` and `split_config` are jsonb (880-885).

Currency column gaps. These monetary tables carry no `currency` column and rely on a parent or household: `recurring_transactions`, `goal_contributions`, `goal_transfers`, `transaction_splits`, `transaction_goal_links`, `grz_bonds`, `grz_tbills`, `grz_bond_payments`, `holdings`, `tax_lots`, `pension_*`, `account_balance_snapshots`. CHECK constraints on currency length exist only for `households`, `accounts` and `transactions` (lines 603, 1228, 1363). `transactions.currency`, `households.currency` and `fx_base_currency`/`fx_quote_currency` are nullable.

## 2. Integrity constraints

### Unique indexes and constraints

- `transactions.idempotency_key`: `uuid(...).unique()` (schema 1306), created as constraint `transactions_idempotency_key_unique` (0000:990). It is globally unique, not per-household.
- `pending_receipts.idempotency_key`: varchar(255) `.unique()` (2208; 0000:635). A redundant non-unique partial index `pending_receipts_idempotency_idx` also exists (2221).
- `jobs.idempotency_key` (3213): no unique constraint.
- `household_members`: unique index `household_members_household_user_unique` on `(household_id, user_id)` (schema 625-628; migration 0005:32). Both columns are nullable (611, 614). Postgres treats NULLs as distinct, so a row with a NULL `household_id` or `user_id` is not constrained. There is no constraint limiting a household to one owner.
- `budget_periods`: unique index `budget_periods_budget_id_start_date_end_date_unique` on `(budget_id, start_date, end_date)` (schema 1686-1688; 0002:13). Four other indexes cover the same leading columns:
  - `idx_budget_periods_budget_date` and `idx_budget_periods_lookup` are identical (1657-1666).
  - `idx_budget_periods_budget_date_range` is a partial index on the same columns (1667).
  - `idx_budget_periods_covering` (1671) leads with the same columns.

  There is no `budgets` uniqueness on `(household_id, category_id)`; only the flex bucket is unique per household (`idx_budgets_flex_unique`, 1610).
- `filter_presets`:
  - `filter_presets_one_default_per_scope` is unique on `(household_id, user_id, context) WHERE is_default = true` (970-972).
  - `filter_presets_name_unique_per_scope` is unique on `(household_id, user_id, context, name)` (973-978).
- `tags` (829-843): there are no unique indexes at all. Tag names are not unique per household, and `member_specific` and `member_id` are not constrained. `usage_count` is a maintained counter (839). `transaction_tags` has `unique_transaction_tag` on `(transaction_id, tag_id)` (1435; migration 0003).
- Other uniqueness on the tables named: `categories`, `merchants` and `accounts` have no uniqueness on name. `user_notification_preferences` has no uniqueness on `(user_id, notification_type)`. `users.username` and `users.email` are unique (256-257) but plain varchar, so email case-sensitivity is not handled.
- Other unique indexes in the schema: `uniq_transactions_transfer_pair` on `(household_id, transfer_transaction_id, is_transfer_in)`, partial (1356); `uniq_net_worth_snapshots_household_date` (1511); `uniq_account_balance_snapshots_account_date` (1540); `uniq_security_prices_security_date` (2503); `unique_goal_account_idx` (1825); `uq_goal_account_full_balance`, partial (1833); `uq_transaction_goal` (1893); `uq_recurring_link_transaction_recurring` (2055); `unique_auction_result_idx` (2824); `unique_user_role` (212); `idx_password_reset_tokens_token_hash` (371); `idx_notifications_dedupe`, partial (576); `idx_budgets_flex_unique`, partial (1610).

### Foreign keys and ON DELETE

Totals in migration 0000: 132 FKs, comprising 85 `cascade`, 29 `set null` and 18 `no action`. Migration 0004 adds 3 cascade FKs and 0010 adds 1.

Patterns:
- Cascade: nearly every `household_id` FK and the transaction children.
- `set null`: `owner_user_id` (accounts 1192, transactions 1248), `audit_logs.user_id` (2110), and the `uploaded_by`/`created_by` columns.
- `no action` (these block parent deletes, which matters for account erasure and household deletion):
  - `household_invitations.invited_by` and `accepted_by` (665, 670)
  - `tags.member_id` (838)
  - `merchants.default_category_id` (745)
  - `merchant_merge_history.merged_by` (808)
  - `transactions.reviewed_by` (1311)
  - `pending_receipts.uploaded_by` (2177) and `matched_transaction_id` (2200)
  - `csd_accounts.user_id` (2789)
  - all GRZ FKs: `grz_bonds.household_id`/`account_id` (2836, 2838), `grz_bond_payments.bond_id` and its two transaction FKs (2872, 2884, 2887), and `grz_tbills.household_id`/`account_id`/`maturity_*` (2896, 2898, 2915, 2918)

  So a household with any GRZ bond or T-bill cannot be deleted by cascade.
- Columns that look like FKs but have none: `transactions.transfer_transaction_id` (1272, intentional per the comment) and `transactions.recurring_transaction_id` (1292); `rule_execution_log.transaction_id` (894); `merchant_merge_history.source_merchant_id` (801); `grz_tbills.rollover_to_id` (2914); `user_system_roles.user_id` and `role_id` (206-207); `security_audit_logs.user_id` (228); `outbox_events.aggregate_id` (3151).

### FK names over 63 characters

Seven generated names in migration 0000 exceed Postgres's 63-byte limit:

| Length | Name |
|---|---|
| 83 | `recurring_transaction_history_recurring_transaction_id_recurring_transactions_id_fk` |
| 81 | `recurring_transaction_links_recurring_transaction_id_recurring_transactions_id_fk` |
| 75 | `recurring_execution_log_recurring_investment_id_recurring_investments_id_fk` |
| 73 | `grz_bond_payments_investment_transaction_id_investment_transactions_id_fk` |
| 70 | `recurring_transaction_history_linked_transaction_id_transactions_id_fk` |
| 66 | `grz_tbills_maturity_investment_tx_id_investment_transactions_id_fk` |
| 64 | `investment_transactions_linked_transaction_id_transactions_id_fk` |

Example: 0000:1247. `pension_contributions_pension_holding_id_pension_holdings_id_fk` is exactly 63, within the limit. The runbook (`docs/runbooks/deploy.md`, around lines 100-106) also says 7, and says this is harmless under `migrate`. The schema does not set explicit names for these (only `password_reset_tokens_user_id_fk`, schema 379), so `db:push` or `generate` could churn on these constraints.

### Check constraints (all present in migrations)

- `chk_household_currency_length` (603), `chk_account_currency_length` (1228), `chk_transaction_currency_length` (1363), `chk_transaction_amount_nonzero` (1359).
- Budgets: `chk_budget_amount_positive` (1613), `chk_budgets_period_monthly` (1617), `chk_budget_warning_threshold` (1621), `chk_budget_alert_threshold` (1625).
- Goals: `chk_goal_target_positive` (1773), `chk_goal_current_nonnegative` (1777), `chk_partial_no_auto` (1836), `chk_different_goals` (1866), `chk_positive_amount` (1870).
- `chk_recurring_amount_positive` (2012).

There are no checks on `accounts.balance`, investments, GRZ, holdings or tax lots, and none on budget/goal currency length.

### Optimistic locking

Only `budget_periods.version` (integer notNull default 1, schema 1651); it is also in the covering index (1678). No other table has a version column.

## 3. Audit and consent anchors

- `audit_logs` (2105-2127): `id`, `household_id` (nullable, cascade), `user_id` (set null), `action` varchar(50) notNull, `entity_type` varchar(50) notNull, `entity_id` uuid (no FK), `details` jsonb, `ip_address` inet, `created_at`. Indexes: `(household_id, created_at desc)` and `(entity_type, entity_id)`. Because `household_id` has an FK and cascades, deleting a household deletes its audit trail.
- `security_audit_logs` (225-247): `event_type` varchar(50), `user_id`, `target_user_id` (neither has an FK), `ip_address` varchar(45), `user_agent`, `details` jsonb, `created_at`. Four indexes and no household column.
- `households.ai_consent_given` boolean default false, `ai_consent_date` timestamp, `ai_consent_version` varchar(10) default "v1.0" (593-598). Household-level consent, with no per-user consent column; `user_ai_preferences` (484) holds `allow_data_training` and the like.
- `data_exports` (904-927): `user_id` and `household_id` are nullable with cascade, `parameters` jsonb, `status` varchar(20) default "pending", and `file_url` text. Indexes at 922-926.
- `pending_receipts.idempotency_key`: see section 2. `image_hash` varchar(64) with a partial index on `(household_id, image_hash)` (2209, 2224).
- Sessions: the connect-pg-simple `session` table has `sid`, `sess` jsonb and `expire` timestamp(6) (538-542). The session table has no index on `expire` in the schema, which connect-pg-simple normally creates itself (`IDX_session_expire`). The only `createTableIfMissing` path is in `server/app.ts:152`; runtime index presence unverified. `user_sessions` (510) is a separate device-tracking table. Session cookie maxAge is 30 days (`server/app.ts`, shortly after 152).

## 4. Migration history

`drizzle.config.ts` sets `out: "./migrations"` (line 11) and `schema: "./shared/schema.ts"` (12).

| File | Summary | Idempotent? |
|---|---|---|
| `0000_youthful_speed.sql` (1297 lines) | Baseline: 21 enums, 76 tables, 132 FKs, uniques | No. `CREATE TYPE`/`CREATE TABLE` have no `IF NOT EXISTS`. |
| `0001_curvy_matthew_murdock.sql` | Two snapshot unique indexes (net worth, account balance) | No |
| `0002_last_matthew_murdock.sql` | About 100 indexes plus 13 `ADD CONSTRAINT ... CHECK` | No |
| `0003_chilly_diamondback.sql` | Dedupe `transaction_tags` by ctid, then unique index | Dedupe is re-runnable, the index creation is not |
| `0004_massive_puck.sql` | `ai_conversations`, `ai_messages`, FKs, indexes | No |
| `0005_household_members_unique.sql` | Dedupe memberships, then unique index | Index creation is not |
| `0006_filter_presets_default_unique.sql` | Demote duplicate defaults, then partial unique index | Index creation is not |
| `0007_filter_presets_name_unique.sql` | Delete duplicate preset names, then unique index | Index creation is not |
| `0008_budget_period_monthly_check.sql` | Backfill `period='monthly'`, add check via `DO $$` guard | Yes (guarded) |
| `0009_reconcile_custom_migration_snapshots.sql` | Re-asserts 0007/0008 objects | Yes (`IF NOT EXISTS` and guard) |
| `0010_password_reset_tokens.sql` | `password_reset_tokens` table, FK, indexes | Yes (header comment 1-5 says it is for push-built DBs) |
| `0011_hash_email_verification_tokens.sql` | One-shot `UPDATE users` nulling verification token, expiry, `pending_email` | Re-runnable but destructive if applied twice; drizzle's tracking prevents that |

Details:
- Migrations 0001-0007 are not idempotent. A DB built by `db:push` fails at 0000 on `type already exists`. The 0010 comment ("Same pattern as 0009") only helps a DB whose earlier migrations were already tracked.
- Migration 0007 deletes duplicate-name presets without backup, and 0005 deletes duplicate membership rows. Both are destructive on populated DBs by design.

Journal consistency: `_journal.json` has 12 entries, idx 0-11 (lines 5-88), tags match the 12 files exactly, and `when` values are strictly increasing. Snapshots: `git ls-files migrations/meta` lists `0000`-`0006` and `0009`-`0011`; `0007_snapshot.json` and `0008_snapshot.json` do not exist. Those two are custom migrations, and 0009 was written to reconcile them. `0010_snapshot.json` and `0011_snapshot.json` are byte-identical in size (319934), consistent with 0011 being data-only. Snapshot contents were not diffed against the schema.

Schema vs migrations (by name): nothing is in the schema without a migration. The names that appeared only on the migration side are the 14 check constraints, the budget-period unique index and `uq_recurring_link_transaction_recurring`; they are in the schema too, written across several lines (tooling artifact, not drift). Table lists match (79 on both sides). Constraint definitions were not compared beyond names.

Legacy-only objects: `migrations-legacy/` has 56 entries; it is history-only per `docs/runbooks/deploy.md:~100`. These legacy objects exist in no current migration: `idx_calc_logs_function`, `idx_calc_logs_household`, `idx_calc_logs_timestamp`, `idx_grz_auction_results_household_id`, `idx_weekly_recap_household`, `idx_weekly_recap_user_week`, `uniq_transactions_idempotency_key`. The legacy files also create `calculation_parameters`, `calculation_logs` and `weekly_recap_feedback`, none of which is in `shared/schema.ts` or any current migration. But:
- `server/routes/admin.ts:36,45` runs raw SQL against `calculation_logs`.
- `server/core/calculations/design/parameterService.ts:102,139,171` queries `calculation_parameters`.

On a database built only from `migrations/`, those queries would fail (errors are caught at admin.ts:64 etc., so likely a 500 or empty response rather than a crash; not run).

## 5. Drift risk

Scripts (`package.json`): `db:push` = `drizzle-kit push` (20), `db:generate` = `drizzle-kit generate` (21), `db:migrate` = `drizzle-kit migrate` (22), `db:test:setup` = `node scripts/setup-test-db.mjs` (49).

Who uses what:
- CI (`.github/workflows/ci.yml`): `npm run db:migrate` in the server-test job (line 75) and the E2E job (146), both against a fresh `postgres:16`. No `db:generate`, no `--check` and no schema-drift step in any workflow, so nothing detects drift between `shared/schema.ts` and `migrations/`.
- Deploy (`render.yaml:21`): `preDeployCommand: npm run db:migrate`. `scripts/verify-deploy-readiness.mjs:33-34` asserts `db:migrate === "drizzle-kit migrate"` and lines 63-64 assert the pre-deploy command is present.
- Local test DB: `scripts/setup-test-db.mjs:70` uses `drizzle-kit push`, so the dev/test DB is push-built, not migration-built.
- Docs: `README.md:52` and several `scripts/windows/*.bat` still tell developers to run `db:push`. `CLAUDE.md:46,57` states `./migrations is inert because drizzle-kit generate is never run`, which is stale: the journal has 12 migrations and CI and Render run them.

Drift risks:
1. Push-built dev/test DBs and migration-built CI/prod DBs can diverge.
2. No CI gate on generate drift.
3. The 7 long FK names can make `push`/`generate` emit rename churn.
4. `drizzle-kit` is in `devDependencies` (package.json:185), as are `vite` (194) and `esbuild` (186). `render.yaml:26-27` sets `NODE_ENV=production`, and `buildCommand: npm ci && npm run build` (20) would omit dev dependencies under that value if Render applies the env var at build time. Unverified; worth a first-deploy check.
5. `drizzle.config.ts` passes only `url` in `dbCredentials` (14-16), so `drizzle-kit migrate` does not use `dbSsl.ts`. TLS for the migration step depends on `sslmode` in the URL.

## 6. Connection and TLS

`server/db.ts`: `new Pool({ connectionString, max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 2000, ssl: resolveDatabaseSsl() })` (14-20), exported alongside `db = drizzle(pool, { schema })` (23). The module throws if `DATABASE_URL` is unset (7-11). A 2s `connectionTimeoutMillis` is tight for a cold managed Postgres. No statement timeout anywhere (`statement_timeout`, `query_timeout`, `lock_timeout`, `idle_in_transaction` absent). A single pool serves requests, background workers and the session store (`server/app.ts:149`).

`server/dbSsl.ts` (`resolveDatabaseSsl`, 47-62): SSL is enabled when `DATABASE_SSL=true`, or when `NODE_ENV === "production"` unless `DATABASE_SSL=false` (50-52); otherwise undefined. `rejectUnauthorized` is false unless `DATABASE_SSL_REJECT_UNAUTHORIZED=true` (56-58), so certificate verification is off by default in production. A CA can be supplied via `DATABASE_SSL_CA_CERT` or `DATABASE_SSL_CA_FILE` (26-38). `render.yaml:51-56` documents that CA verification is intentionally left off until the W9 staging check.

## 7. Unverified items

- Snapshot JSON contents (0000-0011) were not compared with `shared/schema.ts`.
- Constraint definitions were compared by name only.
- No migrations or queries were run by this agent (the lead ran migrations separately; see EVIDENCE.md).
- Whether the `session` table gets its expire index at runtime was not confirmed.
- The Render dev-dependency question (section 5, risk 4) is unresolved.
- Whether the application treats `household_members` NULL columns as impossible was not checked.
