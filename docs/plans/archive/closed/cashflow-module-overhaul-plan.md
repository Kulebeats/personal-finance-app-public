# CashFlow Module Overhaul Implementation Plan

**Date:** 2026-01-23  
**Status:** Closed - Completed (See module status report)  
**Scope:** `server/modules/reports/`, `server/core/calculations/cashflow/`, `client/src/features/cashflow/`, `client/src/pages/CashFlow.tsx`  
**Inputs:** budget-senior-dev-review.md, cashflow-module-assessment.md, cashflow-senior-dev-review.md, cashflow-qa-review.md, cashflow-fintech-review.md, cashflow-functionality-review.md, cashflow-ux-review.md

---

## Status Update (2026-02-06)

This plan is now closed. All items have been completed and consolidated in `docs/module-status/cashflow-module-status-2026-01-23.md`. The checklist below is retained for audit history.

---

## Goals

1. Close feature gaps (cashflow forecast, budget comparison) with clear UX and accurate calculations.
2. Confirm multi-currency behavior and expose explicit currency metadata for cashflow totals.
3. Resolve UI/UX polish items (legend colors, responsive legends, mobile Sankey fallback).
4. Remove minor code quality issues (`@ts-ignore`, hardcoded button styles).
5. Add missing tests for export, filters, empty states, and error boundaries.

---

## Current State Summary

- Cashflow is production ready with strong Money class compliance and good hook/component tests.
- Gaps: no forecast/projection, no budget comparison, limited mobile legends, minor hardcoded styles.
- Compliance risk: multi-currency aggregation behavior is not documented or verified.
- QA gaps: export flow tests, filter interaction tests, empty state and error boundary tests.

---

## Technical Specification

### 1) Cashflow Forecast (P1)

**User outcome:** Users can view projected income, expenses, and savings for future periods.

**API design:**
- Option A: Extend existing `/api/reports/cashflow` with `includeForecast=true` and `forecastMonths=n`.
- Option B: New endpoint `/api/reports/cashflow/forecast` with same filters + horizon.

**Server behavior:**
- Use recurring transactions (income/expense) as baseline for projections.
- Apply budgeted recurring items where present (fall back to category averages).
- Output per-period series with `isForecast` flag.

**Response shape (example):**
```ts
type CashflowSeriesPoint = {
  period: string;
  income: MoneyDto;
  expenses: MoneyDto;
  savings: MoneyDto;
  savingsRate: number;
  isForecast?: boolean;
};

type CashflowForecastResponse = {
  actuals: CashflowSeriesPoint[];
  forecast: CashflowSeriesPoint[];
  totals: {
    income: MoneyDto;
    expenses: MoneyDto;
    savings: MoneyDto;
    savingsRate: number;
  };
  metadata: {
    currencyMode: "household" | "mixed";
    generatedAt: string;
  };
};
```

**Client behavior:**
- Add toggle: "Actual" vs "Actual + Forecast".
- Add forecast styling (dashed line or muted fill) and a disclaimer tooltip.
- Ensure forecast is excluded when exporting unless explicitly included.

### 2) Budget Comparison (P1)

**User outcome:** Users can compare actual cashflow vs budgeted targets.

**API design:**
- Add `includeBudget=true` to cashflow response or new `/api/reports/cashflow/budget` endpoint.
- Return budgeted totals by period (aligned with interval).

**Server behavior:**
- Read budgets for categories/groups in range.
- Normalize budgets to period interval (day/week/month).
- Return budget totals per period and overall variance.

**Client behavior:**
- Add "Budget vs Actual" view with stacked bars or overlay lines.
- Show variance in summary cards and table.

**Dependencies:**
- Budget data correctness and period normalization (tracked in `docs/plans/budget-module-overhaul-plan.md`).

### 3) Multi-Currency Handling (P2)

**User outcome:** Users understand whether cashflow totals are converted or mixed.

**Server behavior:**
- Confirm aggregation currency mode (convert to household currency or preserve mixed).
- Add `currencyMode` and `baseCurrency` to response metadata.

**Client behavior:**
- If `currencyMode === "mixed"`, show a warning badge and tooltip.

### 4) UX and Accessibility (P2)

**Issues to address:**
- Legend text color hardcoded to `#999`.
- Pie legend truncation on mobile (legend positioning).
- Mobile Sankey readability.
- `@ts-ignore` in CashFlowChart.
- Hardcoded export button styles.

**Implementation:**
- Replace legend color with `hsl(var(--muted-foreground))`.
- Make legend layout responsive (bottom on mobile, right on desktop).
- Provide Sankey fallback on small screens (auto-switch to bar or show warning).
- Replace `@ts-ignore` with an inline comment explaining the Nivo type workaround.
- Replace export button color with the standard Button variant.

### 5) QA and Test Coverage (P1/P2)

**Tests to add:**
- Export flow test (P1).
- Filter interaction tests (P2).
- Empty state rendering tests (P2).
- Error boundary tests (P2).
- Keyboard navigation e2e test for charts (P2).

---

## Phase 1 - Core Feature Gaps (P1)

1. Implement cashflow forecast endpoint and calculation.
2. Add forecast toggle and visuals in CashFlow UI.
3. Implement budget comparison endpoint and UI.
4. Add export flow test in `CashFlow.tsx` test suite.

Deliverables:
- Forecast data available with clear UI toggle.
- Budget vs actual view with variance in summary and table.
- Export test added and passing.

---

## Phase 2 - Compliance and Data Clarity (P2)

1. Verify multi-currency aggregation in reports repositories.
2. Add `currencyMode`, `baseCurrency`, and `generatedAt` metadata.
3. Add mixed-currency warning in cashflow UI.

Deliverables:
- Documented and explicit currency handling.
- UI conveys currency mode and data freshness.

---

## Phase 3 - UX and Code Quality (P2)

1. Replace hardcoded legend text colors with CSS variables.
2. Add responsive legend positioning for pie charts.
3. Add mobile Sankey fallback or warning.
4. Replace `@ts-ignore` with documented workaround.
5. Update export button styling to use Button variant.

Deliverables:
- Theme-consistent charts across light/dark modes.
- Mobile-friendly legend layout.
- Cleaner, documented TypeScript behavior.

---

## Phase 4 - QA Expansion (P1/P2)

1. Add filter interaction tests for `CashFlowFilters`.
2. Add empty state tests for chart/table/summary.
3. Add error boundary tests for critical components.
4. Add keyboard navigation e2e test for chart interactions.

Deliverables:
- Test coverage for missing user flows and error cases.

---

## Enhancements (P3)

1. Transaction drill-down from bar segments to a filtered transaction list.
2. Category-level Sankey (subcategory flow).
3. Saved filters and shareable report presets.
4. Optional chart animations with `prefers-reduced-motion` support.
5. Keyboard shortcuts for view toggles.

---

## Resolved TODO List (Historical)

All items in this list are resolved as of 2026-01-26. See `docs/module-status/cashflow-module-status-2026-01-23.md` for verification notes and evidence.

### P1 - Must Ship
1. Add cashflow forecast endpoint and calculation logic.
2. Add forecast toggle and visualization in `CashFlow.tsx`.
3. Add budget comparison endpoint and UI view.
4. Add export flow test for `CashFlow.tsx`.

### P2 - Should Ship
5. Verify multi-currency aggregation and add response metadata.
6. Add mixed-currency warning UI.
7. Replace `#999` legend color with CSS variable.
8. Add responsive legend positioning for mobile.
9. Add mobile Sankey fallback or warning.
10. Replace `@ts-ignore` with documented workaround.
11. Update export button styling to use Button variant.
12. Add filter interaction tests.
13. Add empty state tests.
14. Add error boundary tests.
15. Add keyboard navigation e2e test.

### P3 - Enhancements
19. Add transaction drill-down from chart segments.
20. Add category-level Sankey.
21. Add saved filters and report presets.
22. Add chart animations with reduce-motion support.
23. Add keyboard shortcuts for view toggles.

---

## Verification Plan

### Automated
- `npm run test:client:run -- client/src/features/cashflow/__tests__/useCashFlowData.test.tsx`
- `npm run test:client:run -- client/src/features/cashflow/__tests__/CashFlowComponents.test.tsx`
- `npm run test:server:run -- server/modules/reports/__tests__/reports.integration.test.ts`
- `npm run lint`

### Manual
- Toggle forecast on/off across daily/weekly/monthly intervals.
- Compare budget vs actual for a multi-category budget set.
- Verify mixed-currency warning behavior.
- Check legends and Sankey on 320px width.
- Export with and without forecast inclusion.

---

## Risks and Mitigations

- **Risk:** Forecast assumptions produce misleading outputs.  
  **Mitigation:** Add tooltip disclaimer and allow forecast horizon control.

- **Risk:** Budget comparison mismatches period boundaries.  
  **Mitigation:** Normalize budgets to the selected interval and add unit tests.

- **Risk:** Mixed-currency aggregation confusion.  
  **Mitigation:** Add metadata + UI warning and document the behavior.
