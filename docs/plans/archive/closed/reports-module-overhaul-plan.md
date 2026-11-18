# Reports Module Overhaul Implementation Plan

**Date:** 2026-01-23
**Status:** COMPLETE (All phases implemented and verified)
**Scope:** `server/modules/reports/`, `server/repositories/reports/`, `server/routes/`, `client/src/components/reports/`, `client/src/features/reports/`, `client/src/index.css`  
**Inputs:** reports-senior-dev-review.md, reports-fintech-review.md, reports-functionality-review.md, reports-qa-review.md, reports-ux-review.md

---

## Status Update (2026-02-06)

This plan is closed. All items have been completed and consolidated in `docs/module-status/reports-module-status-2026-01-23.md`. The checklist below is retained for audit history.

---

## Goals

1. Resolve all P0/P1 issues across compliance, QA, functionality, and UX.
2. Improve reliability and performance for heavy reports and exports.
3. Raise accessibility to WCAG 2.1 AA for reports UI.
4. Expand test coverage with controller integration tests and error-path coverage.
5. Add optional enhancements that improve UX and operational confidence.

---

## Current State Summary

- Reports module is read-only, with strong Money class usage and rate limiting.
- Controller split work appears to be in place; verify and align routes.
- Missing: controller integration tests, strict date-range validation, export timeout handling.
- UX gaps: aria-labels, keyboard navigation for charts, non-color indicators, empty states.
- Theming gaps: hardcoded chart colors, tooltip background not theme-aware.
- QA gaps: rate limit tests, error path tests, pagination edge cases.
- Fintech: document multi-currency aggregation; optional audit logging for exports.

---

## Phase 0 - Verification and Scope Alignment (Immediate)

1. Verify controller split is in place and update `reports.routes.ts` to use sub-controllers.
2. Confirm current endpoints list (20) and route mapping.
3. Confirm current test counts and establish baseline CI evidence (commit SHA).

Deliverables:
- Updated route wiring if needed.
- Baseline verification note with commit SHA.

---

## Phase 1 - Architecture and Compliance (P1)

### Controller Structure (Senior Dev)
- Ensure controller split is complete and exported.
  - Files:  
    - `server/modules/reports/reports.annual.controller.ts`  
    - `server/modules/reports/reports.cashflow.controller.ts`  
    - `server/modules/reports/reports.spending.controller.ts`  
    - `server/modules/reports/reports.networth.controller.ts`  
    - `server/modules/reports/reports.analytics.controller.ts`  
    - `server/modules/reports/reports.custom.controller.ts`  
    - `server/modules/reports/reports.exports.controller.ts`
- Update `server/modules/reports/reports.controller.ts` to be barrel-only.
- Update `server/modules/reports/index.ts` exports (if needed).
- Update `server/modules/reports/reports.routes.ts` to map endpoints to the new controllers.

### Documentation (Fintech)
- Add `server/modules/reports/docs/AGGREGATION.md` describing:
  - Currency aggregation rules
  - Currency display assumptions (base vs original)
  - Handling of mixed-currency series

### Code Quality (Senior Dev)
- Add JSDoc to complex aggregation methods in `server/repositories/reports/*.ts`.

Deliverables:
- Controller split verified and wired.
- Aggregation documentation added.
- JSDoc annotations added.

---

## Phase 2 - Validation, Reliability, Performance (P1/P2)

### Validation (QA)
- Add a hard date range limit (max 2 years) to all date-range schemas.
- Enforce `startDate <= endDate`.
- Define behavior for future dates (reject or clamp).
- Files: `server/modules/reports/reports.validation.ts`

### Export Reliability (Functionality)
- Add export timeout handling (30s).
- On timeout: return 504 with a clear message.
- Optional: add export audit logging.
- File: `server/modules/reports/reports.export.service.ts`

### Performance and Freshness (Functionality)
- Add basic server-side cache for expensive endpoints (TTL, household scoped).
- Invalidate cache on transaction/account changes (or TTL-only if invalidation is not available).
- Add response metadata: `generatedAt`, `dataRange`, `currencyMode`.
- Add "Last Updated" timestamp to report UI header.

Deliverables:
- Date range safeguards in validation.
- Export timeout handling.
- Cache layer with TTL and metadata.
- Last updated indicator in UI.

---

## Phase 3 - Bug Fixes (P2)

### Sankey Negative Values (QA)
- Handle refunds/negative values by:
  - Absolute value mapping, or
  - Routing to a dedicated "Refunds" node.
- File: `server/modules/reports/SankeyHelpers.ts`

Deliverables:
- Sankey chart renders cleanly with refunds.

---

## Phase 4 - UX and Accessibility (P0/P1/P2)

### Accessibility (P0)
- Add aria-labels to all icon-only buttons.
- Add keyboard navigation for chart segments (tab, enter/space).
- Add non-color indicators in chart legends (patterns/labels).

### Theming (P2)
- Replace hardcoded chart colors with CSS variables.
- Make tooltips theme-aware (light/dark).
- Files: `client/src/components/reports/chartTheme.ts`, `ComboChart.tsx`, `TreemapChart.tsx`, `NivoTooltip.tsx`, `client/src/index.css`.

### Empty States and Tooltips (P1)
- Add reusable `ReportEmptyState` component with CTA.
- Add "What's this?" tooltips for complex metrics (ratios, forecast, sankey).

### Interactivity (P2)
- Add drill-down from chart segments to transactions list.
- Add reduce-motion support and chart animation toggle.

Deliverables:
- WCAG-compliant reports UI.
- Theme-aware chart colors and tooltips.
- Empty state UX and tooltips.
- Drill-down and reduce-motion support.

---

## Phase 5 - Testing and QA (P1/P2)

### Integration Tests (P1)
- Add `server/modules/reports/__tests__/reports.integration.test.ts` covering all 20 endpoints:
  - Auth and household scoping
  - Valid response shapes (MoneyDto)
  - Date range validation

### Additional QA Tests (P2)
- Rate limiting tests for `/api/reports/sankey`.
- Error path tests for invalid parameters.
- Pagination edge cases for transaction report endpoints.

Deliverables:
- Full controller integration test coverage.
- Rate limit, error path, pagination edge coverage.

---

## Enhancements (Optional, High Value)

1. Async export jobs with progress and download history.
2. Saved report presets and shareable links.
3. CSV column configuration and currency display options.
4. Performance budgets (max rows, max date span) with friendly error messaging.
5. Export audit trail (who/when/filters/format).

---

## Resolved TODO List (Historical)

All items in this list are resolved as of 2026-01-23. See `docs/module-status/reports-module-status-2026-01-23.md` for verification notes and evidence.

### Server - Controllers and Routes
- Verify split controllers and barrel exports.
- Update `reports.routes.ts` mapping to new controllers.

### Server - Validation and Reliability
- Add max 2-year date range validation.
- Add `startDate <= endDate` refinement.
- Add export timeout handling (30s) with clear response.
- Optional: export audit logging.

### Server - Performance and Documentation
- Add TTL cache for expensive endpoints.
- Add `generatedAt`, `dataRange`, `currencyMode` metadata.
- Add `AGGREGATION.md` for multi-currency aggregation.
- Add JSDoc to complex repositories.

### Server - Bug Fixes
- Fix Sankey negative value handling in `SankeyHelpers.ts`.

### Client - Accessibility and UX
- Add aria-labels to icon-only buttons.
- Add keyboard navigation for chart segments.
- Add non-color indicators for categories.
- Add `ReportEmptyState` for empty data.
- Add "What's this?" tooltips for complex metrics.
- Add "Last updated" display in report header.
- Add drill-down from charts to transaction list.
- Add reduce-motion and animation toggle.

### Client - Theming
- Replace hardcoded chart colors with CSS variables.
- Add theme-aware tooltip background.
- Add report chart CSS variables to `client/src/index.css`.

### Testing
- Add controller integration tests for all 20 endpoints.
- Add rate limit tests for Sankey endpoint.
- Add error path tests for invalid params.
- Add pagination edge case tests.

---

## Verification Plan

### Automated
- `npm run test:server:run -- server/modules/reports`
- `npm run lint`
- `npm run check`

### Manual
- Dark mode charts and tooltips.
- Keyboard navigation across chart segments.
- Empty states across all report sections.
- Export timeout behavior on large ranges.
- Drill-down and tooltips behavior.

---

## Risks and Mitigations

- **Risk:** Controller split changes route wiring.  
  **Mitigation:** Add integration tests for all endpoints before deployment.
- **Risk:** Caching returns stale data.  
  **Mitigation:** Short TTL and cache key includes params and householdId.
- **Risk:** Accessibility changes affect chart library behavior.  
  **Mitigation:** Provide accessible table fallback for charts.

