# Enterprise Refactoring Phase 2-3 Audit Findings

Date: 2026-01-11
Scope: Code, security, maintainability, and documentation status for Phase 2-3 per spec and TODO
Sources:
- docs/enterprise-refactoring-specification.md
- docs/refactoring-todo.md
- docs/deep-code-review-2026-01-11.md

## Executive Summary

Phase 2-3 is partially complete. Core module scaffolding exists and some infrastructure is live (API versioning, health checks, caching, outbox table), but critical gaps remain for fintech correctness, event processing, auditability, and true modularization. Documentation is also out of sync with current implementation.

## Verified Completed (Evidence-Based)

- API versioning for /api and /api/v1 paths is implemented. `server/routes.ts:111` `server/middleware/apiVersion.ts:1`
- Health endpoints exist and are wired. `server/routes/health.ts:1` `server/routes.ts:84`
- Outbox table and outbox service exist. `shared/schema.ts:2445` `server/core/events/outbox.ts:7`
- Reports service uses caching wrapper. `server/modules/reports/reports.service.ts:1`
- Auth module migration exists (controller/routes/service). `server/modules/auth/auth.routes.ts:1`
- Transactions, accounts, goals routes are wired in the main router. `server/routes.ts:144` `server/routes.ts:185` `server/routes.ts:195`

## Prioritized Findings and Recommendations

### Critical

1) Deterministic money is not implemented; monetary values still use number types and there is no core money module.
   - Evidence: Spec requires decimal-safe money. `docs/enterprise-refactoring-specification.md:131`
   - Evidence: Money module does not exist. `server/core/money`
   - Evidence: Shared and module report types use number. `shared/reports.ts:30` `server/modules/reports/reports.types.ts:45`
   - Impact: Rounding errors and inconsistent currency handling in a fintech domain.
   - Recommendation: Implement `server/core/money` per spec and migrate API and calculation types to `{ amount: string, currency: string }` or Money DTOs. Update validation schemas to accept decimal strings.

2) Outbox processor and job runner are never started, so events and jobs are never executed.
   - Evidence: Processors exist but no startup integration. `server/core/events/processor.ts:125` `server/core/jobs/runner.ts:63` `server/startup.ts:1`
   - Evidence: Transaction service publishes outbox events. `server/services/TransactionService.ts:236`
   - Impact: Event-driven workflows and background jobs do not run, causing stale or missing side effects.
   - Recommendation: Start processors in `server/startup.ts` with feature flags and graceful shutdown hooks. Document deployment expectations for background workers.

### High

3) Modular monolith migration is incomplete; several modules re-export legacy services and do not provide module repositories.
   - Evidence: Re-export only service. `server/modules/budgets/budgets.service.ts:7` `server/modules/recurring/recurring.service.ts:5` `server/modules/investments/investments.service.ts:10`
   - Evidence: Services exceed size targets in legacy layer. `docs/enterprise-refactoring-specification.md:42`
   - Impact: Harder testing, unclear ownership boundaries, and violates spec targets.
   - Recommendation: Move business logic into module services, add repositories, and reduce large service files to <500 LOC.

4) Audit logging is not integrated for transaction/budget/recurring operations.
   - Evidence: Audit service used in auth/admin/security, not in transaction flows. `server/modules/auth/auth.service.ts:19` `server/services/TransactionService.ts:1`
   - Impact: Missing audit trail for financial mutations.
   - Recommendation: Add auditService logging at create/update/delete for critical financial entities.

### Medium

5) Centralized validation module is not adopted by controllers; module validation files sit unused.
   - Evidence: Core validation exists. `server/core/validation/index.ts:1`
   - Evidence: Controllers still use legacy schemas. `server/modules/transactions/transactions.controller.ts:17` `server/modules/budgets/budgets.controller.ts:14`
   - Evidence: Module validation files exist but not used. `server/modules/budgets/budgets.validation.ts:1`
   - Impact: Inconsistent request validation and error formatting across modules.
   - Recommendation: Adopt `core/validation` middleware and module validation schemas in all module routes.

6) Documentation is out of date relative to the codebase.
   - Evidence: TODO says accounts/goals not wired, but they are wired. `docs/refactoring-todo.md:293` `server/routes.ts:144`
   - Evidence: Deep review says health/date utilities missing, but they exist. `docs/deep-code-review-2026-01-11.md:31` `server/routes/health.ts:1` `client/src/lib/dates.ts:1`
   - Impact: Team confusion and mis-prioritized work.
   - Recommendation: Update TODO and deep review docs to reflect current state; fix encoding corruption.

### Low

7) Client LOC targets remain above spec for key pages.
   - Evidence: Reports page remains above <300 LOC target. `client/src/pages/Reports.tsx`
   - Evidence: Accounts page remains above <300 LOC target. `client/src/pages/Accounts.tsx`
   - Impact: Maintainability risk on high-change pages.
   - Recommendation: Continue client decomposition where required by spec.

## Phase 2-3 Completion Checklist (Suggested)

- Money module implemented and monetary types migrated.
- Outbox processor + job runner started and monitored.
- Transaction/budget/recurring audit logging added.
- Module services moved from legacy services into module layer with repositories.
- Core validation middleware adopted in all module routes.
- Documentation updated to match current code.

