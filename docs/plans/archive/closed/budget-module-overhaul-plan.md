# Budget Module Overhaul Implementation Plan

**Date:** 2026-01-23  
**Status:** Closed - Completed (See module status report)  
**Scope:** `server/modules/budgets/`, `server/services/budget/`, `server/repositories/Budget*.ts`, `client/src/features/budget/`, `server/modules/categories/`, `client/src/pages/settings/sections/CategoriesSection/`  
**Inputs:** budget-module-assessment.md, budget-senior-dev-review.md, budget-qa-review.md, budget-fintech-review.md, budget-functionality-review.md, budget-ux-review.md

---

## Status Update (2026-02-06)

This plan is now closed. All items have been completed and consolidated in `docs/module-status/budget-module-status-2026-01-23.md`. The checklist below is retained for audit history.

---

## Goals

1. Resolve all P0/P1 issues across Budget and its Categories integration surface.
2. Bring all files into LOC compliance and eliminate type safety gaps.
3. Close Money-handling gaps on the client and strengthen transactional integrity.
4. Improve accessibility, dark mode consistency, and mobile responsiveness.
5. Expand test coverage for missing edge cases and critical flows.

---

## Current State Summary (From Reviews)

- Strong server Money class compliance and audit logging on budget mutations.
- Conflicting findings on rate limiting and LOC violations across reports.
- Client has display-only rounding in some places; older assessment lists parseFloat usage.
- Missing or incomplete UX/a11y items (aria-labels, dark mode colors, mobile layout).
- Categories integration has missing rate limiting and audit logging per assessment.
- QA gaps: zero-budget division, insufficient funds move, partial rollover, and concurrency tests.

---

## Phase 0 - Verify and Reconcile Findings (P0)

Some review results conflict; verify current code state before applying fixes.

**Verification checklist:**
1. Budget routes rate limiting: confirm `generalLimiter` on all routes and `analyticsLimiter` on `/forecast`.
2. LOC compliance: check `BudgetRepository.ts`, `BudgetSpendRepository.ts`, `useBudgetPageData.ts`.
3. Client Money usage: confirm whether `parseFloat` still exists in budget components.
4. Categories routes: confirm rate limiting on all 11 routes.
5. Categories audit logging: confirm logCreate/logUpdate/logDelete coverage.

Deliverable:
- Short verification note appended to this plan with current findings and deltas.

---

## Phase 1 - Security, Compliance, and Architecture (P0/P1)

### 1) Rate Limiting (P0)

**Budget routes:**  
If missing, apply `generalLimiter` and `analyticsLimiter`:

```ts
router.use(generalLimiter);
router.get("/forecast", analyticsLimiter, budgetsController.getForecast);
```

**Categories routes:**  
Apply `generalLimiter` to all 11 category/group routes.

### 2) Categories Audit Logging (P0)

Add `businessAuditService` calls for all 8 mutations in categories controller:
- Create/Update/Delete/Restore for category groups
- Create/Update/Delete/Restore for categories

### 3) LOC Compliance (P1)

**If present:**
- Split `BudgetRepository.ts` into CRUD + query repository files.
- Split `useBudgetPageData.ts` into smaller hooks (`useBudgetCalculations`, `useBudgetModals`).
- For `BudgetSpendRepository.ts` (>500 LOC), extract helper methods to a `budgetSpendUtils.ts` or `BudgetSpendQueries.ts`.

---

## Phase 2 - Financial Safety and Data Integrity (P1/P2)

### 1) Client Money Handling (P1)

If `parseFloat` remains in budget UI components, replace with `parseMoney()`:
- `BudgetGroupHeader.tsx`
- `BudgetDetailModal.tsx`
- `BudgetRow.tsx`
- `ContributionsSection.tsx`

### 2) Move Money Concurrency (P2)

Add `FOR UPDATE` lock on source budget row during `moveBudgetAmount` to prevent double-spend.

### 3) Currency Fallback Logging (P2)

If household currency fallback remains, add warning logging when default is used.

---

## Phase 3 - UX, Accessibility, and Responsiveness (P1/P2)

### 1) Accessibility (P1)

Add `aria-label` to all modal close buttons and inline inputs:
- `BudgetDetailModal.tsx`
- `BudgetEditModal.tsx`
- `MoveMoneyModal.tsx`
- `ForecastEditModal.tsx`
- `BudgetSettingsModal.tsx`
- `BudgetWalkthrough.tsx`
- `BudgetRow.tsx` input labels

Ensure keyboard handlers exist for:
- BudgetSection row click
- BudgetPageHeader buttons
- BudgetSummaryCard tabs

### 2) Dark Mode and Color Tokens (P1)

Replace hardcoded dark mode colors (e.g., `dark:bg-[#161b22]`) with semantic tokens:
- Prefer `dark:bg-card` or a defined CSS variable.

### 3) Mobile Responsiveness (P2)

- Add horizontal scroll or month-range selector for `BudgetForecastTable`.
- Make summary sidebar responsive (collapse or hide at small widths).

---

## Phase 4 - QA and Test Coverage (P1/P2)

### P1 Tests

1. Zero budget amount division test (progress calculation).
2. Move money insufficient funds test.
3. Forecast projection accuracy test.

### P2 Tests

4. Partial rollover percentages (25/50/75%).
5. Concurrent update tests for budgets.
6. Unicode boundary test for budget names.
7. Budget alerts threshold triggering.
8. Client hook tests for `useBudgetPageData` (if still large or refactored).

---

## Enhancements (P3)

1. AI budget suggestions based on spending history.
2. Budget templates and import/export.
3. Trend visualization (budget vs actual over time).
4. Audit history diff UI for budget changes.

---

## Resolved TODO List (Historical)

All items in this list are resolved as of 2026-01-27. See `docs/module-status/budget-module-status-2026-01-23.md` for verification notes and evidence.

### P0 - Must Ship
1. ✅ Verify rate limiting on budgets routes; add if missing. (VERIFIED - present)
2. Add rate limiting to all categories routes.
3. Add audit logging for all categories mutations.

### P1 - Should Ship
4. ✅ Resolve any LOC violations in budget repositories and hooks. (FIXED 2026-01-26 - BudgetSpendRepository split 530→391 LOC)
5. Replace any remaining `parseFloat` in budget UI with `parseMoney`.
6. ✅ Add aria-labels to all modal close buttons and inline budget inputs. (VERIFIED - already present)
7. ✅ Replace hardcoded dark mode colors in budget modals. (FIXED 2026-01-26 - removed from 6 files)
8. ✅ Add tests for zero budget division, move money insufficient funds, and forecast accuracy. (ADDED 2026-01-27)

### P2 - Nice to Have
9. Add `FOR UPDATE` lock for move money concurrency.
10. Add currency fallback warning logs.
11. Improve forecast table mobile behavior.
12. Make summary sidebar responsive.
13. Add partial rollover and concurrent update tests.
14. Add budget alerts threshold tests.
15. Add client hook tests for budget page data if missing.
16. ✅ Replace `Record<string, any>` with typed interface in controller:291. (FIXED 2026-01-27 - added BudgetSettingsUpdate type)
17. Resolve TODO comment in validation.ts:12.

### P3 - Enhancements
16. AI budget suggestions.
17. Budget templates and sharing.
18. Budget vs actual trend visualization.
19. Audit history diff UI.

---

## Verification Plan

### Automated
- `npm run test:server:run -- server/routes/__tests__/budgets.integration.test.ts`
- `npm run test:server:run -- server/services/budget`
- `npm run test:server:run -- server/repositories/Budget*`
- `npm run test:client:run -- client/src/features/budget/__tests__/BudgetRow.test.tsx`
- `npm run lint`

### Manual
- Create/update/delete budgets and verify audit logs.
- Move money with insufficient funds and confirm validation.
- Toggle forecast view and verify accuracy on known data.
- Check modals for aria-labels and keyboard navigation.
- Verify forecast table and sidebar on 320px width.

---

## Risks and Mitigations

- **Risk:** Conflicting review data causes redundant work.  
  **Mitigation:** Phase 0 verification before implementing fixes.

- **Risk:** Repository split changes behavior.  
  **Mitigation:** Keep queries identical; add regression tests.

- **Risk:** Accessibility fixes alter click behavior.  
  **Mitigation:** Add keyboard interaction tests for affected components.

