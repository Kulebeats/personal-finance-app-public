# Reports Module - Production Readiness Reassessment

**Date:** 2026-07-07
**Last Verification:** 2026-07-07
**Reviewers:** Codex production-readiness loop
**Status:** PASS - critical findings closed; W9/W10 evidence still required
**Overall Score:** 96/100

---

## Executive Summary

The Reports module has been re-baselined against the current code rather than the stale January findings. The previously recorded P0/P1 release-gate issues for cache isolation, central money handling, historical FX conversion, and liability account coverage are closed in code and now have targeted regression coverage.

The module is not scored at 100 yet because the final production-readiness spec requires W9 staging smoke evidence and W10 authoritative live reassessment for all 22 modules after staging is serving the current build.

## Current Score

| Area | Score | Status | Evidence |
|------|-------|--------|----------|
| Rule 1 (Money) | PASS | Closed | Report repositories use `Money`, `toMoneyDto`, `moneyUtils`, `BaseReportRepository.convertAmount`, and fail-closed FX guards instead of parseFloat-based aggregation. |
| Rule 9 (Audit) | PASS | Closed | Report export audit integration coverage exists and report exports are logged through the export path. |
| Rule 12 (Rate) | PASS | Closed | Reports routes apply report-specific rate limiting at the route layer. |
| Rule 17 (Tests) | PASS | Closed | Controller, cache-isolation, repository, export, and real-DB FX fail-closed tests cover the high-risk paths. |

## Closed Release-Gate Findings

### REPORTS-CACHE-001: cache keys omit userId, scope, and filters

**Status:** CLOSED

Current evidence:

- `server/modules/reports/reports.service.ts` no longer owns a separate reports cache-key layer; it delegates to `AnalyticsService`.
- `server/services/AnalyticsService.ts` passes `{ ...query, userId }` or `{ ...body, userId }` into every `analyticsCache.getOrCompute` call.
- `server/services/AnalyticsCache.ts` includes `userId` in the visible Redis key segment and hashes the complete sorted params object, which includes scope and filters.
- `server/modules/reports/__tests__/reports.integration.test.ts` verifies report routes pass `userId`, scope, and filter params through the service boundary.
- `server/services/__tests__/AnalyticsCache.test.ts` directly verifies distinct cache keys for different users, scopes, and filters.

Residual risk: Redis invalidation still uses household-level endpoint invalidation. That is acceptable for correctness because it over-invalidates rather than under-isolates cached scoped data.

### REPORTS-MONEY-001: money handling violations across repositories

**Status:** CLOSED

Current evidence:

- `server/repositories/reports/BaseReportRepository.ts` parses report amounts through `Money` and throws on missing FX rates instead of silently using rate 1.
- `server/repositories/reports/fxRateExpr.ts` resolves rates with `fx_rates.date <= row_date`, ordered by latest eligible rate.
- `BaseReportRepository.assertFxRatesAvailable` guards SQL aggregate queries before aggregation so missing FX rates fail closed.
- `server/repositories/reports/ReportRepositories.fxfailclosed.db.integration.test.ts` covers cashflow, spending, transaction listing, expense classification, and Sankey missing-rate behavior against real Postgres.
- `server/repositories/reports/NetWorthReportRepository.fxfailclosed.db.integration.test.ts` covers net-worth snapshot FX fail-closed behavior against real Postgres.
- `server/repositories/reports/constants.ts` defines the full liability account set: `credit`, `loan`, `mortgage`, and `other_liability`.

Remaining non-blocking cleanup: some forecast/chart shaping code converts Money DTOs to numbers for visualization and forecasting inputs after repository money boundaries. That is display/analytics shaping, not source-of-truth financial mutation, and does not reopen the P0/P1 gate.

## Verification Commands

Run from `C:\Dev\personal-finance-app`:

```powershell
npx vitest run --config server/vitest.config.ts server/services/__tests__/AnalyticsCache.test.ts --reporter=dot
cd server; npx vitest run modules/reports/__tests__/reports.integration.test.ts modules/reports/__tests__/reports-export-audit.integration.test.ts modules/reports/__tests__/reports.export.budget.currency.db.integration.test.ts modules/reports/__tests__/reports.export.budget.test.ts repositories/reports/__tests__/AnalyticsReportRepository.test.ts repositories/reports/__tests__/CashflowReportRepository.test.ts repositories/reports/__tests__/CompositeReportRepository.test.ts repositories/reports/__tests__/NetWorthReportRepository.test.ts repositories/reports/__tests__/SankeyHelpers.test.ts repositories/reports/__tests__/TransactionReportRepository.test.ts repositories/reports/__tests__/ReportRepositories.fxfailclosed.db.integration.test.ts repositories/reports/__tests__/NetWorthReportRepository.fxfailclosed.db.integration.test.ts --reporter=dot
npm run report:modules
npm run check
git diff --check
```

## Open Items

| Item | Priority | Owner | Status |
|------|----------|-------|--------|
| REPORTS-STAGING-001 | W9 | Release checkpoint | Staging smoke must exercise scoped reports, export audit logging, cache behavior through the live app, and missing-FX error behavior where practical. |
| REPORTS-ASSESS-001 | W10 | Production-readiness loop | Authoritative reassessment required after staging is serving the current build. |

## Final Assessment

Reports should be removed from the security release gate. The stale cross-user cache leak finding and broad money/FX repository finding are closed by current code plus targeted tests. The only remaining readiness gap is the global W9/W10 evidence required by the 100/100 production-readiness loop.
