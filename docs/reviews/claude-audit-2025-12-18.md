# Codebase Audit Report (Claude Code)

Generated: 2025-12-18

This report audits the repository implementation against `docs/implementation-plan-v7-final.md` and provides completeness estimates per phase, coding/database/architecture standards assessment, and prioritized findings.

> **Methodology**: Static code analysis with file/pattern searches. All claims include specific file paths and line numbers for verification.

---

## 1) Completeness by Phase

| Phase | Scope | Backend | Frontend | Tests | Overall |
|-------|-------|--------:|----------:|------:|--------:|
| Phase 0A | Core schema + infra | 80% | N/A | 55% | **75%** |
| Phase 1 | Core financial data | 90% | 70% | 70% | **85%** |
| Phase 2 | Analytics & reporting | 60% | 80% | 40% | **65%** |
| Phase 3 | Budgets & planning | 55% | 20% | 20% | **40%** |

**Weighted Overall: ~65%**

---

## 2) Phase 0A — Foundation (75%)

### Implemented

| Feature | Location | Status |
|---------|----------|--------|
| Household roles | `shared/schema.ts:24-29` | `owner/admin/member/view_only` enum defined |
| Household members | `shared/schema.ts:236-245` | Table with role column |
| householdGuard middleware | `server/middleware/householdGuard.ts` | Resolves membership, attaches context |
| validateEntity middleware | `server/middleware/validateEntity.ts` | Validates entity ownership before queries |
| requireRole middleware | `server/middleware/validateEntity.ts:150+` | Role hierarchy enforcement |
| Rate limiting | `server/middleware/rateLimit.ts` | General (100/min) + Analytics (30/min) tiers |
| Redis config | `server/config/redis.ts` | Optional Redis, disabled if no REDIS_URL |
| Structured logger | `server/utils/logger.ts` | Request ID + JSON logging |

### Not Implemented

| Gap | Evidence | Plan Requirement |
|-----|----------|------------------|
| PostgreSQL RLS | No `ENABLE ROW LEVEL SECURITY` in migrations | Phase 0A.5 |
| helmet middleware | Not in `server/app.ts` imports or `package.json` | Phase 0A.5 |
| cors middleware | Not in `server/app.ts` imports or `package.json` | Phase 0A.5 |
| SESSION_SECRET fallback | `server/app.ts:55` - `\|\| "your-secret-key-change-this"` | Security risk |
| Prometheus metrics | No `/metrics` endpoint | Phase 0A.6 |
| OTEL tracing | No tracing bootstrap | Phase 0A.6 |
| BullMQ queues | Comment only at `server/config/redis.ts:8`, no implementation | Phase 0A.3 |
| Health endpoint path | `/api/health` exists, plan specifies `/healthz` | Phase 0A.6 |

### Schema Issues

| Issue | Location |
|-------|----------|
| `household_members.role` is VARCHAR | `shared/schema.ts:242` - TODO comment to migrate to enum |

---

## 3) Phase 1 — Core Financial Data (85%)

### Implemented

| Feature | Location | Notes |
|---------|----------|-------|
| Accounts CRUD | `server/routes/accounts.ts` | Soft delete, privacy, archive |
| Authoritative balance | `server/services/AccountService.ts:148-156` | Direct balance modification blocked |
| Balance via transactions | `server/routes/accounts.ts:217-288` | `adjust-balance` creates balance_adjustment |
| Transactions CRUD | `server/routes/transactions.ts` | Create/update/delete with balance updates |
| Two-row transfer model | `server/repositories/TransactionRepository.ts:443-522` | Atomic with uniqueness index |
| Splits | `server/repositories/TransactionRepository.ts:281-290` | Sum validation enforced |
| Idempotency keys | `shared/schema.ts:603`, `server/services/TransactionService.ts:82-91` | Duplicate detection |
| Optimistic concurrency | Repository enforces `updated_at` match, returns 409 | Works correctly |

### Not Implemented

| Gap | Evidence | Plan Requirement |
|-----|----------|------------------|
| `transactions.currency` column | Not in `shared/schema.ts:544-620` | Canonical Invariant 2 |
| Reconciliation job | No reconciliation worker exists | Phase 1 verification |
| True optimistic UI | Hooks use `onSuccess` only, no `onMutate` | Frontend pattern |

---

## 4) Phase 2 — Analytics & Reporting (65%)

### Implemented (Surface Level)

| Endpoint | Location | Status |
|----------|----------|--------|
| `/api/reports/annual` | `server/routes/reports.ts` | **STUB** - breakdowns return `[]` |
| `/api/reports/cashflow` | `server/routes/reports.ts` | Works |
| `/api/reports/sankey` | `server/routes/reports.ts` | Simplified implementation |
| `/api/reports/spending/breakdown` | `server/routes/reports.ts` | Works (no "Other" grouping) |
| `/api/reports/spending/trend` | `server/routes/reports.ts` | **STUB** - comparison always `undefined` |
| `/api/reports/income` | `server/routes/reports.ts` | Delegates to cashflow |
| `/api/reports/net-worth` | `server/routes/reports.ts` | Works (snapshot-first) |
| `/api/reports/savings-rate` | `server/routes/reports.ts` | Works |
| `/api/reports/transactions` | `server/routes/reports.ts` | Cursor broken, privacy missing |
| `/api/reports/export` | `server/routes/reports.ts` | **BROKEN** - limit conflict |

### Critical Issues

| Issue | Evidence | Impact |
|-------|----------|--------|
| **Spending trend stub** | `server/repositories/ReportRepository.ts:469-475` - always returns `undefined` for comparison | Comparison feature non-functional |
| **Annual report stub** | `server/repositories/ReportRepository.ts:550-552` - returns `[]` for all breakdowns | No category breakdowns |
| **Cursor pagination broken** | `server/repositories/ReportRepository.ts:720` - `cursorData` parsed but never used in WHERE | Always starts from beginning |
| **Export limit conflict** | `server/routes/reports.ts:284` uses `limit: 10000`, but `server/validation/analyticsValidation.ts:11` caps at `MAX_LIMIT = 200` | Export throws validation error |
| **Transaction privacy missing** | No `is_private` filter in any analytics query | Private transactions leak |
| **Account privacy in drilldown missing** | `server/repositories/ReportRepository.ts:723` - no account visibility check | Private account data leaks |

### Caching Issues

| Issue | Evidence |
|-------|----------|
| Global version constant | `server/services/AnalyticsCache.ts:5` - `CACHE_VERSION = 1` |
| Scan+delete invalidation | `server/services/AnalyticsCache.ts:115` - uses `scanStream`, not version counters |
| Invalidation not wired | `server/services/CacheInvalidation.ts:33` - service exists but never called |

### Infrastructure Issues

| Issue | Evidence |
|-------|----------|
| Snapshot worker not scheduled | `server/jobs/snapshotWorker.ts:199` - `runDailySnapshots()` exists but no callers |
| No cron endpoint | Plan requires secured cron trigger |

---

## 5) Phase 3 — Budgets, Goals & Recurring (40%)

### Budgets (55% Backend, 20% Frontend)

| Feature | Status | Evidence |
|---------|--------|----------|
| CRUD | ✅ Works | `server/routes/budgets.ts` |
| Progress calculation | ✅ Works | Real transaction sums |
| Alerts | ✅ Works | Warning/alert thresholds |
| Category group budgets | ❌ Broken | `server/repositories/BudgetRepository.ts:193` ignores `categoryGroupId` |
| Period auto-rollover | ❌ Missing | No `closeBudgetPeriod` job |
| Frontend | ❌ Mock | `client/src/pages/Budget.tsx:82-680` - 600 lines of hardcoded data |

### Goals (100% Backend, 20% Frontend)

| Feature | Status | Evidence |
|---------|--------|----------|
| CRUD | ✅ Works | `server/routes/goals.ts` |
| Contribution ledger | ✅ Works | `goal_contributions` table |
| Progress calculation | ✅ Works | `GoalService.getGoalWithProgress()` |
| Direct amount edit blocked | ✅ Works | Must use contribute endpoint |
| Frontend | ❌ Mock | `client/src/pages/Goals.tsx:6-40` - hardcoded goals array |

### Recurring (65% Backend, 20% Frontend)

| Feature | Status | Evidence |
|---------|--------|----------|
| CRUD | ✅ Works | `server/routes/recurring.ts` |
| Upcoming bills | ✅ Works | `getUpcomingBills()` |
| Process endpoint | ✅ Works | Manual trigger at `/api/recurring/process` |
| Auto-processing | ❌ Missing | No cron job |
| Transfer support | ❌ Broken | Validation blocks at `server/validation/recurringSchemas.ts:16` |
| Frontend | ❌ Mock | `client/src/pages/Recurring.tsx:20-101` - hardcoded items |

### Frontend Hooks Exist But Not Integrated

| Hook | Location | Page Using It? |
|------|----------|----------------|
| useBudgets | `client/src/hooks/useBudgets.ts` | ❌ Not imported by Budget.tsx |
| useGoals | `client/src/hooks/useGoals.ts` | ❌ Not imported by Goals.tsx |
| useRecurring | `client/src/hooks/useRecurring.ts` | ❌ Not imported by Recurring.tsx |

---

## 6) Coding Standards Assessment

### Strengths

- Clear backend layering: `routes/` → `services/` → `repositories/` → `db`
- Strong TypeScript + Zod validation throughout
- Transactions used for multi-step operations (`withTransaction`)
- Error responses follow `{ success, data?, error? }` envelope
- Property-based tests exist for some invariants

### Gaps

| Issue | Impact |
|-------|--------|
| Inconsistent error handling | Some routes use `asyncHandler`, some manual try/catch |
| Stub implementations in production code | Correctness and security risk |
| Optional env fallbacks | Plan requires fail-fast in production |
| Test suite currently fails | Regression safety compromised |

---

## 7) Database Standards Assessment

### Strengths

- PostgreSQL enums for core domains
- `NUMERIC(15,2)` for monetary values
- Foreign keys and analytics indexes present
- Soft delete for key entities

### Gaps

| Issue | Evidence |
|-------|----------|
| No RLS policies | App-layer tenancy only |
| No DB check constraints | `amount >= 0` only enforced in service layer |
| Schema/seed mismatch | `server/scripts/seedAnalyticsData.ts` uses `credit_card` not in enum |
| Missing `transactions.currency` | Plan canonical invariant violation |

---

## 8) Architecture Assessment

### Current State

- **Modular monolith**: Single Express backend + React frontend in monorepo
- **Not microservices**: No service boundaries, no independent deploys, no inter-service messaging
- Domain separation via routes/services/repositories per feature

### Risks

- Analytics correctness issues affect multiple features
- Missing job scheduling creates runtime drift
- No centralized tenant/visibility policy for reports

---

## 9) Priority Findings

### Critical (Security)

1. **Privacy enforcement missing** - `is_private` not filtered in analytics
2. **SESSION_SECRET fallback** - Hardcoded default secret
3. **No helmet/cors** - Security headers missing

### High (Broken Features)

4. **Export endpoint broken** - limit 10000 vs cap 200 conflict
5. **Cursor pagination non-functional** - parsed but never applied
6. **Spending trend stub** - comparison always undefined
7. **Annual report stub** - breakdowns always empty

### Medium (Missing Automation)

8. **Snapshot worker not scheduled** - net worth history empty
9. **Cache invalidation not wired** - stale analytics data
10. **Recurring auto-processing missing** - requires manual trigger

### Low (Schema/Integration)

11. **Category group budgets broken** - repository ignores field
12. **Frontend Phase 3 pages all mock** - hooks exist but unused
13. **transactions.currency missing** - multi-currency foundation incomplete

---

## 10) Recommended Next Steps

### Immediate (Security)

```
1. Add privacy filtering to all analytics queries
2. Remove SESSION_SECRET fallback in server/app.ts:55
3. Install and configure helmet + cors middleware
```

### High Priority (Fix Broken Features)

```
4. Fix export: Use pagination or streaming instead of limit=10000
5. Implement cursor filtering in ReportRepository.getTransactions()
6. Complete spending trend comparison logic
7. Implement annual report category breakdowns
```

### Medium Priority (Automation)

```
8. Schedule snapshot worker (cron endpoint or BullMQ)
9. Wire CacheInvalidation.invalidateOnChange() to mutations
10. Schedule recurring transaction processing
```

### Frontend Integration

```
11. Replace Budget.tsx mock data with useBudgets hook
12. Replace Goals.tsx mock data with useGoals hook
13. Replace Recurring.tsx mock data with useRecurring hook
```

---

## Summary

| Metric | Value |
|--------|-------|
| Overall Completion | ~65% |
| Production Ready | No |
| Critical Blockers | 3 (security) |
| Broken Features | 4 |
| Missing Automation | 3 |

The core transactional engine (Phase 1) is solid. Analytics (Phase 2) has endpoint coverage but multiple stubs and security gaps. Planning features (Phase 3) have backend logic but no frontend integration.
