# Implementation Plan: Personal Finance App (v7 - FINAL)

Aligned with:

- `docs\architecture\architecture-requirements.md`
- `docs/analytics-reporting-architecture.md`

This v7 plan replaces the v6 draft in the prompt and resolves conflicts introduced by the updated architecture documents. Once **Phase 0A** is complete, the **Canonical Invariants** below become the "schema + behavior contract" for the app; changing them later requires an explicit migration.

---

## Audit Summary (v6 -> v7)

Key updates driven by the two updated documents:

1. **Transfers**: Standardize on the analytics doc’s transfer pairing approach (`transfer_transaction_id` + `is_transfer_in` + `transfer_account_id`) instead of the v6-only `transfer_pair_id` self-reference.
2. **Privacy + Roles**: Add "private" visibility for accounts/transactions and household roles (Admin/Editor/Viewer) as first-class requirements (Epic 10 + Security).
3. **Analytics limits**: Align hard caps to the analytics spec (date range up to **5 years**, `maxNodes` up to **200**, `limit` up to **200**).
4. **Snapshots**: Align snapshot locking to the analytics spec (Redis distributed lock with **5 minute TTL** + "completed" marker).
5. **Caching**: Keep multi-layer caching, but make Redis versioning **safe for production** (no `KEYS` scans); use per-household (and per-endpoint) version counters.
6. **Balance adjustments**: Remove v6 inconsistency ("amount always positive" vs "balance_adjustment can be negative") by introducing an explicit adjustment direction.

---

## Canonical Invariants (Testable, Immutable after Phase 0A)

### 1) Tenant + Visibility Scoping (Non-Negotiable)

1. **Household-first filtering**: Every DB read/write MUST constrain `household_id = ?` before any other condition.
2. **Soft delete filtering**: All "active" queries MUST include `deleted_at IS NULL` (or equivalent) before other filters.
3. **Visibility**:
   - `accounts.is_private=false` -> visible to all household members.
   - `accounts.is_private=true` -> visible ONLY to `accounts.owner_user_id`.
   - `transactions.is_private=false` -> visible to all household members (subject to account privacy).
   - `transactions.is_private=true` -> visible ONLY to `transactions.owner_user_id`.
   - A transaction is visible iff:
     - `transactions.household_id = $householdId`
     - `transactions.deleted_at IS NULL`
     - `(transactions.is_private IS FALSE OR transactions.owner_user_id = $userId)`
     - AND the referenced account is visible:
       `(accounts.is_private IS FALSE OR accounts.owner_user_id = $userId)`.
4. **Entity validation**: If a request references `accountId/categoryId/merchantId/tagId/...`, the server MUST validate membership in the same household (and visibility) BEFORE running the main query.

### 2) Money Storage + Currency

1. All money values are stored as `NUMERIC(15,2)` (Drizzle `decimal({ precision: 15, scale: 2 })`).
2. **Amount invariant**: `transactions.amount >= 0` ALWAYS (no negative money stored).
3. `transactions.currency` is required and MUST match the household currency in v1 (`households.currency`), unless/until multi-currency is introduced.

### 3) Transaction Types + Sign Convention

1. Allowed `transactions.type` values (PostgreSQL enum): `income | expense | transfer | balance_adjustment`.
2. Sign/direction is NEVER encoded by negative amounts:
   - `income` -> adds to balance
   - `expense` -> subtracts from balance
   - `transfer` -> direction determined by `is_transfer_in`
   - `balance_adjustment` -> direction determined by `is_balance_adjustment_increase`

### 4) Transfer Representation (Canonical Two-Row Model)

Creating a transfer from Account A -> Account B for K100 produces **two rows**:

- **Row 1 (outflow)**:
  - `type='transfer'`
  - `is_transfer_in=false`
  - `account_id = A`
  - `transfer_account_id = B`
  - `transfer_transaction_id = <same uuid for both rows>`
- **Row 2 (inflow)**:
  - `type='transfer'`
  - `is_transfer_in=true`
  - `account_id = B`
  - `transfer_account_id = A`
  - `transfer_transaction_id = <same uuid for both rows>`

Rules (enforced in service layer + constraints where possible):

1. Both rows MUST have identical `amount` and `currency`.
2. Both rows MUST have the same `household_id` and `owner_user_id`.
3. For `type='transfer'`: `transfer_transaction_id` and `transfer_account_id` MUST be non-null.
4. Uniqueness: at most one `is_transfer_in=true` row and one `is_transfer_in=false` row per `(household_id, transfer_transaction_id)` for non-deleted transfers.
5. **Analytics default**: transfers are excluded unless `includeTransfers=true`:
   - default filter: `type <> 'transfer'`

### 5) Split Rules (Income/Expense Only)

1. Splits are allowed ONLY when parent `transactions.type IN ('income','expense')`.
2. Sum constraint: `SUM(transaction_splits.amount) = transactions.amount` (enforced in service layer; verified nightly).
3. Splits inherit parent attributes by default (merchant, account, tags, privacy), unless explicitly overridden.
4. Reporting aggregates splits, not parents (prevents double counting).
5. Query pattern for reporting:
   - `LEFT JOIN transaction_splits s ON s.transaction_id = t.id`
   - Aggregate using `COALESCE(s.amount, t.amount)` and "split override" fields via `COALESCE(s.merchant_id, t.merchant_id)` etc.

### 6) Balance Integrity (Authoritative Balance)

1. `accounts.balance` is the source of truth (never computed on read).
2. Account balances are updated ONLY via the service layer on transaction create/update/delete.
3. Balance delta multiplier:
   - income: `+amount`
   - expense: `-amount`
   - transfer: `+amount` if `is_transfer_in`, else `-amount`
   - balance_adjustment: `+amount` if `is_balance_adjustment_increase`, else `-amount`
4. Reconciliation: nightly job verifies `accounts.balance == computed_balance` and logs discrepancies to `audit_logs`.
5. Balance adjustments are represented by `type='balance_adjustment'` transactions and excluded from spending/income analytics by default.

### 7) Analytics Semantics (v1)

Defaults (unless overridden by query params):

1. Pending excluded unless `includePending=true` (`is_pending IS FALSE`).
2. Exclude from reports always: `is_excluded_from_reports IS FALSE`.
3. Exclude transfers unless `includeTransfers=true`.
4. Exclude `balance_adjustment` from income/spending totals.
5. **Stable drilldown IDs**: all breakdown items MUST include `{ entityType, entityId }` so the UI can request `/api/reports/transactions` deterministically.
6. **Drilldown pagination**: `/api/reports/transactions` MUST use cursor pagination (e.g., `base64(date|id)`).
7. **Drilldown safety**: `/api/reports/transactions` MUST reject requests with no filters/search/type (prevents "export everything" scans).
8. Savings:
   - `savings = income - expenses`
   - `savingsRate = income === 0 ? 0 : (savings / income) * 100`
9. Date storage: `transactions.date` is stored as `DATE` and used for bucketing.
10. Response rounding: all money outputs are rounded deterministically to 2 decimals.

### 8) Caching (Production-Ready)

1. L1 (client): React Query caching (30-60s staleness per user).
2. L2 (server): Redis shared across instances (NodeCache allowed only for local/dev single-instance).
3. Redis key format:
   - `analytics:{endpoint}:{householdId}:v{version}:{paramsHash}`
4. Versioning:
   - `analytics_version:{householdId}:{endpoint}` (integer counter)
   - keys MUST embed the current version so bumps invalidate without deletes.
5. Invalidation triggers bump only the endpoints impacted (see invalidation map in analytics doc).
6. TTLs (server-side, per endpoint - tuneable):
   - dashboard: 5 min
   - cashflow: 5 min
   - spending breakdown: 5 min
   - spending trend: 3 min
   - annual: 15 min
   - net worth: 10 min
   - sankey: 10 min
   - transactions drilldown: 1 min

### 9) Rate Limiting + Hard Caps

Per-user rate limiting (session user id; IP only for logging/fallback):

- General API: 100 req/min/user
- Analytics: 30 req/min/user
- Sankey: 10 req/min/user
- Receipt uploads: 50/day/user
- WhatsApp inbound: 20/day/connection

Hard caps (validated via Zod before query execution):

- `limit <= 200`
- `maxNodes <= 200`
- maximum analytics date range: **5 years**
- maximum "single drilldown request" rows: 200 (pagination required beyond)

### 10) Snapshots (Idempotent + Concurrent-Safe)

1. Snapshots are idempotent via UPSERT with unique constraints:
   - `net_worth_snapshots(household_id, date)` unique
   - `account_balance_snapshots(account_id, date)` unique
2. Concurrency lock:
   - Redis lock key: `snapshot:lock:{householdId}:{date}`
   - TTL: 300 seconds
   - separate marker: `snapshot:completed:{householdId}:{date}` (7 day TTL)
3. Backfill:
   - edits older than 7 days enqueue async recompute job
   - recompute from edit date forward only

### 11) Offline Support

1. Supported offline endpoints: Accounts + Transactions (read/create/update); analytics always server-only.
2. Optimistic concurrency: update requests MUST include `updated_at`; server enforces "match or 409 CONFLICT".
3. Idempotency: mutation requests MUST include `idempotency_key` (UUID v4). Server deduplicates safely.

---

## Phase Plan (Updated)

### Phase 0A - Core Schema + Infrastructure (2-3 days) (Required)

#### 0A.1 - Schema hardening (Drizzle + SQL migrations)

- Convert critical type columns to PostgreSQL enums (`account_type`, `transaction_type`, `transaction_source`, `transaction_status`, `recurring_frequency`).
- Add/align required columns and constraints:
  - `accounts`: `initial_balance`, `balance`, `currency`, `is_private`, `owner_user_id`, `deleted_at`, partial indexes.
  - `transactions`: `type` enum incl. `balance_adjustment`, `currency`, `idempotency_key` (unique), `is_transfer_in`, `transfer_transaction_id`, `transfer_account_id`, `is_balance_adjustment_increase`, `is_private`, `deleted_at`.
    - Check constraints (recommended):
      - `amount >= 0`
      - if `type='transfer'`: `transfer_transaction_id IS NOT NULL` and `transfer_account_id IS NOT NULL`
      - uniqueness for transfer pairing: one in-flow and one out-flow row per `(household_id, transfer_transaction_id)` (non-deleted)
  - `transaction_tags`: enforce uniqueness (composite key or unique index).
  - `transaction_splits`: `amount >= 0`, index `(transaction_id, display_order)`.
  - `net_worth_snapshots`: unique `(household_id, date)`.
  - `account_balance_snapshots`: unique `(account_id, date)`.
- Add critical partial indexes per analytics doc (household/date/type, merchant, pending, cursor, etc).
  Recommended index set (SQL migration):

  ```sql
  -- TRANSACTIONS (analytics hot path)
  CREATE INDEX idx_transactions_household_date
    ON transactions(household_id, date DESC)
    WHERE deleted_at IS NULL;

  CREATE INDEX idx_transactions_household_type_date
    ON transactions(household_id, type, date DESC)
    WHERE deleted_at IS NULL;

  CREATE INDEX idx_transactions_category_date
    ON transactions(category_id, date DESC)
    WHERE deleted_at IS NULL AND is_excluded_from_reports = FALSE;

  CREATE INDEX idx_transactions_merchant_date
    ON transactions(merchant_id, date DESC)
    WHERE deleted_at IS NULL;

  CREATE INDEX idx_transactions_account_date
    ON transactions(account_id, date DESC)
    WHERE deleted_at IS NULL;

  CREATE INDEX idx_transactions_owner_date
    ON transactions(owner_user_id, date DESC)
    WHERE deleted_at IS NULL;

  CREATE INDEX idx_transactions_pending
    ON transactions(household_id, is_pending)
    WHERE deleted_at IS NULL AND is_pending = TRUE;

  CREATE INDEX idx_transactions_cursor
    ON transactions(date DESC, id DESC)
    WHERE deleted_at IS NULL;

  -- Transfers: enforce one in + one out per transfer_transaction_id (non-deleted)
  CREATE UNIQUE INDEX uniq_transactions_transfer_pair
    ON transactions(household_id, transfer_transaction_id, is_transfer_in)
    WHERE deleted_at IS NULL AND type = 'transfer';

  -- SNAPSHOTS
  CREATE INDEX idx_net_worth_snapshots_household_date
    ON net_worth_snapshots(household_id, date DESC);

  CREATE INDEX idx_account_balance_snapshots_account_date
    ON account_balance_snapshots(account_id, date DESC);

  -- ACCOUNTS
  CREATE INDEX idx_accounts_household
    ON accounts(household_id, display_order)
    WHERE deleted_at IS NULL AND is_archived = FALSE;

  CREATE INDEX idx_accounts_household_asset
    ON accounts(household_id, is_asset)
    WHERE deleted_at IS NULL AND is_hidden = FALSE;

  -- CATEGORIES
  CREATE INDEX idx_categories_group
    ON categories(group_id, display_order)
    WHERE deleted_at IS NULL;

  -- BUDGETS
  CREATE INDEX idx_budget_periods_budget_date
    ON budget_periods(budget_id, start_date, end_date);

  CREATE INDEX idx_budgets_household_active
    ON budgets(household_id)
    WHERE is_active = TRUE;

  -- SPLITS + TAGS
  CREATE INDEX idx_transaction_splits_transaction
    ON transaction_splits(transaction_id, display_order);

  CREATE INDEX idx_transaction_tags_transaction
    ON transaction_tags(transaction_id);

  CREATE INDEX idx_transaction_tags_tag
    ON transaction_tags(tag_id);
  ```

#### 0A.2 - Environment + startup validation

- Add `dotenv-safe` (or equivalent) + required `.env.example` keys.
- Fail fast on missing secrets (DB, Redis, session secrets, cron secret, encryption key).

#### 0A.3 - Redis + queues baseline

- Implement `server/config/redis.ts` with connection + startup ping.
- Establish BullMQ connection config (required for snapshots backfill + AI jobs).

#### 0A.4 - Error handling + API envelope

- Implement standard `{ success, data?, error? }` envelope and analytics-specific error codes.
- Centralized error middleware with structured logging.

#### 0A.5 - Security middleware foundation

- `requireAuth`
- `householdGuard` (resolve active household)
- `validateEntity` middleware (account/category/merchant/tag ownership + visibility)
- `roleGuard` (Admin/Editor/Viewer enforcement for writes)
- `helmet`, `cors`, `express-rate-limit`

#### 0A.6 - Observability foundation

- Request ID generation and propagation.
- Structured JSON logs with PII redaction.
- Prometheus metrics (`/metrics`) + OTEL tracing bootstrap.
- Health check endpoint (`GET /healthz`).

---

### Phase 0B - Extended Schema (1-2 days) (Optional/Deferrable)

Add tables required for later phases (from `docs\architecture\architecture-requirements.md`):

- `import_batches`
- `receipts`
- `ai_insights`, `ai_conversations`
- `whatsapp_connections`, `whatsapp_messages`
- `notifications`, `notification_queue`
- `holdings`
- `audit_logs`, `transaction_comments`, `financial_plans` (if not included in 0A)

---

### Phase 1 - Core Financial Data (1-2 weeks) (Required)

#### Backend

- Accounts CRUD:
  - soft delete, privacy support, optimistic concurrency
  - `POST /api/accounts/:id/adjust-balance` creates `balance_adjustment` transaction(s)
- Transactions CRUD:
  - create/update/delete with balance updates
  - transfer creation (two-row model)
  - split create/update validation
  - idempotency handling for offline duplicates
- Daily balance reconciliation job writes to `audit_logs`.

#### Frontend

- Replace localStorage prototype with server-backed hooks:
  - `useAccounts`, `useTransactions`
  - idempotency key generation on mutations
  - conflict resolution UI for 409s

#### Tests

- Transfer creation (two rows, linked, balanced)
- Balance delta multipliers (all transaction types)
- Split sum validation + analytics aggregation pattern
- Idempotency key deduplication
- Optimistic concurrency conflicts

---

### Phase 2 - Analytics & Reporting (1-2 weeks) (Required)

Implement endpoints (per analytics doc contracts):

- `GET /api/reports/annual`
- `GET /api/reports/cashflow`
- `GET /api/reports/sankey`
- `GET /api/reports/spending/breakdown`
- `GET /api/reports/spending/trend`
- `GET /api/reports/income`
- `GET /api/reports/net-worth`
- `GET /api/reports/savings-rate`
- `GET /api/reports/transactions` (drilldown)
- optional: `GET /api/reports/dashboard` composite

#### Backend

- ReportRepository query patterns:
  - base filters: household + deleted + exclusions + privacy + scope
  - splits-first aggregation (`COALESCE(split.amount, txn.amount)`)
  - exclude transfers + balance_adjustments by default
- Cache orchestration with Redis versioning + TTLs per endpoint.
- Rate limiting + Zod validation (caps and max date range).
- Snapshot worker + secured cron endpoint:
  - `POST /api/cron/snapshot` protected by secret/HMAC
  - Redis lock + idempotent upserts
  - historical backfill queue for edits > 7 days

#### Observability

- Analytics metrics: cache hit/miss, query duration, rows scanned, dateRangeDays.
- Structured logs for reports (no PII; hash household id if needed).

#### Phase 2 Verification

- Seed script (10k transactions / 2 years).
- EXPLAIN ANALYZE on slow queries.
- Validate target P95s per analytics doc.
- Optional: validate responses against Zod response schemas in dev/test to prevent contract drift.

---

### Phase 3 - Budgets & Planning (1 week) (Required)

#### 3A: Budgets Architecture

- **Schema**: `budgets` (definitions) + `budget_periods` (historical/rollover tracking).
- **Logic**:
  - **Current Period**: Calculated LIVE from `transactions` table.
    - Filter: `household_id`, `category_id/group_id`, `date >= start`, `date <= end`.
    - Exclude: `is_excluded_from_budget = true`.
  - **Historical Periods**: Stored in `budget_periods` for performance and freezing history.
  - **Rollover**:
    - Job/Action `closeBudgetPeriod` runs at month end.
    - Calculates `remaining = amount - spent`.
    - Creates next `budget_period` with `rolloverIn = rolloverEnabled ? remaining : 0`.
- **Service**: `BudgetService`
  - `getBudgetStatus(budgetId, month)`: Returns { limit, spent, remaining, percent, rollover }.
  - `checkBudgets(householdId)`: Returns all active budgets statuses.
- **Repository**:
  - `BudgetRepository`: Specialized queries for aggregating spend by category/group.

#### 3B: Goals

- **Schema**: `goals` (targets) + `goal_contributions` (ledger).
- **Logic**:
  - Manual contributions or linked transactions.
  - "Savings Rate" report can feed into Goals visualization.

#### 3C: Recurring & Planning

- **Recurring Engine**:
  - `RecurringTransactionService`: Generates "upcoming" instances for UI.
  - "Post" action: Converts an upcoming instance into a real transaction.
- **Forecasting**:
  - Use recurring instances + active budget limits to project "Safe to Spend".

---

### Phase 4 - AI Integration (1-2 weeks) (Required)

- Receipt scanning pipeline (upload -> queue -> Gemini Vision -> user confirm -> transaction create).
- AI insights generation jobs (anomalies, opportunities).
- Safe prompt templates + redaction; strict timeouts and retries.

---

### Phase 5 - Polish & Testing (1 week) (Required)

- Integration tests across all APIs.
- E2E tests (Playwright) for critical flows.
- Performance and load testing against benchmark dataset.
- Production deployment checklist verification.

---

### Phase 6 - PWA & Offline Support (1 week) (Required)

- PWA install + service worker.
- TanStack Query persistence (IndexedDB).
- Offline mutation queue with idempotency keys.
- Conflict resolution UX for concurrent edits.

---

### Phase 7 - Imports + WhatsApp (1-2 weeks) (WhatsApp optional)

- CSV import:
  - parse/preview/mapping UI
  - duplicate detection + batch rollback
  - import auditing into `import_batches` + `audit_logs`
- WhatsApp integration (optional):
  - webhook + connection management
  - intent parsing + confirmation flow
  - notifications delivery

---

## Production Readiness Checklist (Updated)

Data model + integrity:

- Transfer tests pass (two linked rows, unique constraints).
- Split sum checks (service + nightly verifier) pass.
- Reconciliation job runs nightly and logs discrepancies.
- Snapshot cron is idempotent and lock-safe.

Performance:

- All critical partial indexes exist.
- Analytics endpoints meet target P95s on 10k/2y dataset.
- Cache hit ratio >60% for dashboard endpoints under steady state.

Security:

- Household + visibility scoping enforced everywhere.
- Entity validation happens before queries.
- Rate limits are per-user for all routes (IP only for logging).
- 2FA + session management requirements met.
- Error responses conform to the standard API envelope + documented error codes.

Observability:

- Request ID correlates logs/traces.
- Prometheus metrics exported and dashboards available.
- PII redaction verified (no raw user-entered strings in logs).

