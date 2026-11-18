# Codebase Audit & Progress Report (Plan v7)
Generated: 2025-12-18

This report audits the repo implementation against `docs/implementation-plan-v7-final.md` (and the Phase 2 analytics spec `docs/phase-2-analytics-implementation.md`) and assigns **estimated completeness % per phase**, plus an evaluation of **coding**, **database**, and **architecture** standards (including “microservices vs monolith”).

> Notes / limitations:
> - This is a static code audit (file + test review). It does not include production runtime verification.
> - I ran `npm run test:server:run` and it fails (many client settings tests + some server test failures), which impacts “test readiness” scoring.

---

## 1) Completeness by Phase (Estimated)

Percentages below are an evidence-based estimate, computed using a simple rubric:

- **Done** = fully implemented in code and reachable via routes/hooks
- **Partial** = exists but incomplete vs plan (stubs, missing wiring, missing constraints, missing privacy, etc.)
- **Missing** = not found in codebase

Scoring is weighted by the plan’s “Required” phases: **0A, 1, 2, 3** from `docs/implementation-plan-v7-final.md`.

| Phase | Scope | Backend | Frontend | Tests/Verification | Overall |
|---|---|---:|---:|---:|---:|
| Phase 0A | Core schema + infra | 80% | N/A | 55% | **75%** |
| Phase 1 | Core financial data | 90% | 70% | 70% | **85%** |
| Phase 2 | Analytics & reporting | 60% | 80% | 40% | **65%** |
| Phase 3 | Budgets & planning | 55% | 20% | 20% | **40%** |

### How to interpret these numbers
- “Backend” measures the presence and correctness of routes/services/repositories + key invariants.
- “Frontend” measures whether the UI is actually wired to the backend (not just mock data).
- “Tests/Verification” measures presence + whether the test suite currently passes for that area (it currently does not overall).

---

## 2) Phase 0A — Foundation (Estimated 75%)

### What matches Plan v7

- **Households + roles exist** in schema: `shared/schema.ts` defines roles and household member records (`owner`/`admin`/`member`/`view_only`).
- **Tenancy boundary enforced at API layer**:
  - `householdGuard` resolves membership and attaches `req.householdContext`.
  - `validateEntity` checks referenced entity household ownership before main query.
  - `requireRole` enforces role hierarchy.
- **Enums + initial schema exist**: enums are created in migrations and used in Drizzle schema.
- **Redis wiring exists**: `server/config/redis.ts` (Redis is optional, caches disabled if `REDIS_URL` missing).
- **Rate limiting exists**: general + analytics tiers (`server/middleware/rateLimit.ts`).
- **Request ID + structured logger exist**: `server/utils/logger.ts`.

### Where Phase 0A is not “complete”

- **Postgres RLS is not implemented.** No RLS policies (`ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`) were found in `migrations/*.sql`. Tenancy is enforced in app logic instead.
- **`household_members.role` is not an enum at the DB layer.** In `shared/schema.ts` it is currently a `varchar(...)` with a TODO to migrate to the `household_role` enum.
- **Security middleware hardening is incomplete** vs plan:
  - Plan lists `helmet` + `cors`; they are not present/used in `server/app.ts`.
  - `server/app.ts` still contains an insecure fallback `SESSION_SECRET` default if env validation is bypassed.
- **Observability foundation is partial**:
  - Health endpoint exists as `/api/health` (plan mentions `/healthz`).
  - No Prometheus metrics endpoint and no OTEL/tracing bootstrap.
- **Queues baseline not implemented**:
  - Plan calls out BullMQ baseline; no BullMQ usage exists.

---

## 3) Phase 1 — Core Financial Data (Estimated 85%)

### Implemented (Backend)

- **Accounts CRUD** exists with household scoping, privacy, soft delete, archive/unarchive.
- **Authoritative balance enforcement** exists:
  - Direct balance update is blocked in the service layer.
  - Balance changes happen via transaction mutations and `adjust-balance` endpoint.
- **Transactions CRUD** exists:
  - Create/update/delete (soft delete) with balance updates.
  - Filtering/pagination exists on list endpoints.
- **Transfers use the canonical two-row model**:
  - Implemented in repository via atomic transaction, with uniqueness index for pairing.
- **Splits exist and are persisted**:
  - API supports splits on create, validates sum, and persists `transaction_splits`.
- **Idempotency exists**:
  - `idempotency_key` uniqueness exists in DB, and service checks for duplicates.
- **Optimistic concurrency exists**:
  - Update endpoints accept `updatedAt`, repository enforces `updated_at` match and returns 409.

### Gaps vs Plan v7

- **`transactions.currency` is missing**:
  - Plan canonical invariant requires a per-transaction currency that matches household currency (v1).
  - Current schema has currency on household/accounts, but not on transactions.
- **Reconciliation/audit job is missing**:
  - Plan calls out a daily reconciliation job writing to `audit_logs`; this is not present.

### Frontend state

- Accounts/Transactions pages appear wired to server-backed hooks and API calls.
- However, the hooks mostly invalidate/refetch; they are not truly “optimistic UI” in the strict sense (no `onMutate` optimistic cache updates).

---

## 4) Phase 2 — Analytics & Reporting (Estimated 65%)

### Implemented (Surface area)

- Analytics endpoints exist in `server/routes/reports.ts`:
  - Annual, cashflow, sankey, spending breakdown, spending trend, income, savings rate, net worth, transactions drilldown, export.
- Hard caps exist:
  - 5-year date range maximum, `limit <= 200`, `maxNodes <= 200`.
- Redis caching exists:
  - Cache wrapper is used by AnalyticsService for all endpoints.
- Snapshots worker exists:
  - Net worth snapshots + Redis lock key + completion marker exist (conceptually aligned).
- Frontend charts exist (Nivo) and call analytics endpoints via `client/src/hooks/use-reports.ts`.

### Major “not complete” items vs Plan v7

1) **Analytics cache invalidation is not production-ready and not wired**
- Plan v7 calls for per-household/per-endpoint version counters; current caching uses:
  - a global `CACHE_VERSION`, and
  - scan+delete invalidation (`scanStream`) when invalidating.
- A mapping exists (`server/services/CacheInvalidation.ts`) but it is not invoked by transaction/account/category mutations.

2) **Snapshots are not scheduled/exposed**
- Worker exists, but there is no cron endpoint like plan suggests, and no code path triggers it.

3) **Several report implementations are stubbed/partial**
- Spending trend is explicitly “stub”.
- Annual report is explicitly “stub” (breakdowns are empty arrays).
- Sankey implementation is simplified and does not cover the richer “flow modes” implied in docs/spec.

4) **Drilldown pagination is incomplete**
- Cursor is parsed but not applied to the query (no cursor-based filtering).
- The query ignores several available filters (e.g., `search`, `categoryGroupId`, `tagId`).

5) **Privacy enforcement is incomplete/inconsistent in analytics**
- Canonical invariant requires filtering on both:
  - `transactions.is_private` + owner, and
  - account privacy.
- Some report queries check account privacy, but transaction privacy is not enforced.
- Drilldown query does not enforce account privacy at all.

6) **CSV export is currently incompatible with analytics hard caps**
- Export endpoint tries to call drilldown with `limit: 10000`, but analytics validation caps limit at 200.

---

## 5) Phase 3 — Budgets, Goals & Recurring (Estimated 40%)

### Backend reality

**Budgets**
- CRUD exists, plus `/progress` and `/alerts`.
- Progress uses real transaction sums and respects `isExcludedFromBudget`.
- **Rollover logic (as described in plan v7) is not implemented**:
  - There is no “closeBudgetPeriod” operation that writes/rolls `budget_periods`.
  - Current “rollover” is effectively a stored field `budgets.rolloverAmount` added to limit.

**Goals**
- CRUD exists.
- Contribution ledger exists (`goal_contributions`) and updates goal progress.
- Prevents direct editing of `currentAmount` (must use contribute).

**Recurring**
- CRUD exists + “upcoming” endpoint.
- “Process” endpoint exists and generates transactions for due rules.
- Missing the plan’s richer “upcoming instances” concept + “post one instance” workflow; current model is “rules” + “process all due”.

### Frontend reality

- The Plan pages (`/budget`, `/goals`, `/recurring`) are currently mock-data UIs.
- The real API hooks already exist (`client/src/hooks/useBudgets.ts`, `useGoals.ts`, `useRecurring.ts`) but are not integrated into those pages/widgets.

This is consistent with “backend mostly done, frontend integration pending”.

---

## 6) Coding Standards Assessment

### Strengths

- Clear layering on backend: `routes/` → `services/` → `repositories/` → `db/schema`.
- Strong use of TypeScript + Zod validation.
- Uses transactions for multi-step DB operations (`withTransaction`) and includes property-based tests for some security/invariant behaviors.
- Error responses generally follow a `{ success, data?, error? }` envelope.

### Gaps / inconsistencies

- Error handling style is inconsistent across routes (some use centralized `asyncHandler`, some do manual try/catch).
- Analytics repository has “stub” implementations and partial filtering; this is a correctness and security risk.
- Some code paths rely on optional env behavior (e.g., Redis optional, session secret fallback); plan expects fail-fast for production.
- Test suite currently fails, which lowers confidence in regression safety.

---

## 7) Database Standards Assessment

### Strengths

- Uses Postgres enums for core domains.
- Uses `NUMERIC(15,2)` for monetary values.
- Has foreign keys and many helpful indexes (including analytics hot-path indexes).
- Uses soft delete for key entities (accounts, transactions, categories).

### Gaps / risks

- **No DB-level RLS policies** (tenancy is app-enforced).
- Missing DB-level check constraints (e.g., `amount >= 0`, transfer pairing constraints) beyond what the service layer enforces.
- Schema/seed mismatch risk: `server/scripts/seedAnalyticsData.ts` uses `credit_card` as an account type which is not in the enum.
- `transactions.currency` missing vs plan invariants.

---

## 8) Architecture Standards & Microservices vs Monolith

### Current architecture in this repo

- This is a **single Node/Express backend** plus a **single React frontend** in one repository (a monorepo), with `shared/` types.
- There is no evidence of separately deployable “microservices” (no service boundaries, no independent deploy configs, no inter-service messaging, no service discovery, etc.).

### “Microservice adherence”

- **Not microservices.** This is best described as a **modular monolith**:
  - Modules are separated by domain (accounts/transactions/reports/budgets/goals/recurring) via routes/services/repositories.
  - Shared schema/types are centrally located.

### “No large monolith codebase” concern

- The codebase is not yet “large monolith” scale, but Phase 2/3 gaps show where it can become fragile:
  - Analytics correctness/security issues in one repository can affect multiple features.
  - Missing job scheduling/invalidation wiring creates runtime drift between data and analytics.

Recommended standards to keep it from becoming an unmaintainable monolith:
- Enforce strict module boundaries (one “domain folder” per feature: accounts, transactions, analytics, budgets, goals, recurring).
- Formalize “shared contracts” (request/response types) and keep enforcement in one layer (prefer validation + repository predicates, not scattered).
- Add a single centralized policy for tenant/visibility filtering usable by all report queries.

---

## 9) Priority Findings (High Impact)

1) Analytics privacy enforcement incomplete (transaction privacy + drilldown account visibility missing).
2) Drilldown cursor pagination not implemented (cursor parsed but unused).
3) Cache invalidation not wired and not versioned per household/endpoint (plan deviation).
4) Snapshots worker not scheduled/exposed.
5) Export endpoint requests `limit=10000` which conflicts with analytics hard caps.
6) Budgets rollover (plan-defined budget periods) not implemented; frontend planning pages still mock.

---

## 10) Suggested Next Steps (If Goal = “Plan v7 Complete”)

Phase 2 (Analytics correctness + safety):
- Implement consistent visibility filtering for analytics (transaction privacy + account privacy).
- Implement cursor-based drilldown pagination + search and missing filters.
- Replace scan/delete cache invalidation with per-household/per-endpoint version counters and wire invalidation into mutations.
- Add a secured cron endpoint and wire snapshot worker execution.
- Fix CSV export to use pagination/caps (or implement export jobs).

Phase 3 (Frontend integration):
- Replace mock Budget/Goals/Recurring pages with the already-built hooks.
- Add UI for budgets progress/alerts, goals contributions, and recurring upcoming list.
