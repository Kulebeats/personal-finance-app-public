# Merchants Module - Production Readiness Reassessment

**Date:** 2026-07-07
**Last Verification:** 2026-07-07
**Reviewers:** Codex production-readiness loop
**Status:** PASS - critical findings closed; W9/W10 evidence still required
**Overall Score:** 96/100

---

## Executive Summary

The Merchants module has been re-baselined against current code and tests. The stale assessment still described stubbed tests, production `as any` casts, hardcoded merchant analytics currency, and incomplete settings compatibility routes. Current code closes those findings: Merchant CRUD, duplicate detection, seed, autocomplete, merge history, merge, and undo merge are implemented; merge operations are transaction-safe; server and client tests are real; and merchant detail transaction rows now use the configured settings currency.

The module is not scored at 100 yet because the final production-readiness spec requires W9 staging smoke evidence and W10 authoritative live reassessment for all 22 modules after staging is serving the current build.

## Current Score

| Area | Score | Status | Evidence |
|------|-------|--------|----------|
| Rule 1 (Money) | PASS | Closed | Merchant metadata is non-financial; display-only merchant analytics and transaction rows format through app currency helpers using settings currency. |
| Rule 9 (Audit) | PASS | Closed | Create, update, delete, merge, merge-by-source, and undo-merge paths write business audit rows. |
| Rule 10 (Transactions) | PASS | Closed | Merchant merge and undo-merge use `withTransaction` and preserve rollback behavior. |
| Rule 12 (Rate) | PASS | Closed | `server/modules/merchants/merchants.routes.ts` mounts `generalLimiter` before merchant endpoints and has a router-stack regression test. |
| Rule 17 (Tests) | PASS | Closed | Real server integration tests and client merchant component/settings tests cover CRUD, isolation, merge, undo, route order, currency formatting, and UI behavior. |

## Closed Release-Gate Findings

### MERCHANTS-TEST-001: server tests were stubs

**Status:** CLOSED

Current evidence:

- `server/modules/merchants/__tests__/merchants.integration.test.ts` contains implemented real-DB tests for create, list, get, update, delete, seed, duplicates, autocomplete, merge history, merge, undo merge, cross-household isolation, audit logging, and rate limiter mounting.
- The suite passed locally with 28 tests.

### MERCHANTS-TYPE-001: production `as any` casts

**Status:** CLOSED

Current evidence:

- `server/modules/merchants/MerchantService.ts` uses typed input interfaces and Drizzle inferred row types.
- The remaining `as any` usage found in Merchants is test-only assertion plumbing, not production code.

### MERCHANTS-MONEY-001: hardcoded currency in merchant detail display

**Status:** CLOSED

Current evidence:

- `MerchantStatsCards` formats analytics using settings currency.
- `MerchantCategoryBreakdown` formats category totals using settings currency.
- `MerchantTransactionsList` now formats recent transaction rows using settings currency rather than hardcoded `ZMW`.
- `MerchantDetailComponents.test.tsx` asserts transaction rows render with the mocked settings currency and not the ZMW fallback.

## Verification Commands

Run from `C:\Dev\personal-finance-app`:

```powershell
cd server; npx vitest run modules/merchants/__tests__/merchants.integration.test.ts --reporter=dot
npx vitest run --config client/vitest.config.ts client/src/components/merchants/__tests__/MerchantDetailComponents.test.tsx client/src/components/merchants/__tests__/MerchantStatsCards.test.tsx client/src/components/merchants/__tests__/MerchantDetailView.test.tsx client/src/components/merchants/__tests__/MerchantCombobox.test.tsx client/src/components/merchants/__tests__/MerchantAvatar.test.tsx client/src/pages/settings/sections/MerchantsSection/__tests__/MerchantsSection.test.tsx --reporter=dot
npm run report:modules
npm run check
git diff --check
```

## Open Items

| Item | Priority | Owner | Status |
|------|----------|-------|--------|
| MERCHANTS-STAGING-001 | W9 | Release checkpoint | Staging smoke must exercise merchant CRUD, duplicate detection, merge/undo merge, seed, autocomplete, and merchant detail currency formatting. |
| MERCHANTS-ASSESS-001 | W10 | Production-readiness loop | Authoritative reassessment required after staging is serving the current build. |

## Final Assessment

Merchants should no longer be tracked as missing a canonical assessment. Current code and tests close the stale P1 findings; the remaining gap is the global W9/W10 evidence required by the 100/100 production-readiness loop.
