# Reports Module Requirements - Assessment Addendum

This addendum lists implementation requirements derived from the latest code review assessment. The authoritative specification is `docs/annual-dashboard-requirements.md` (v2.0). All items below must be implemented in a way that is consistent with v2.0.

## Document Information

| Field | Value |
| --- | --- |
| Version | 2.0 |
| Created | 2026-01-07 |
| Last Updated | 2026-01-07 |
| Status | Implementation Requirements |
| Authority | docs/annual-dashboard-requirements.md (v2.0) |

---

## 1. Definitions and Calculation Rules

- RPT-DEF-001: Savings Contributions and Net Savings must be tracked as separate metrics across APIs and UI.
- RPT-DEF-002: Savings Contributions include transfers into savings or investment accounts and transactions tagged as savings/investments.
- RPT-DEF-003: Net Savings equals income minus expenses minus debt payments; transfers are excluded by default.
- RPT-DEF-004: Debt Payments include payments to liability accounts (credit, loan, mortgage). Interest and fees remain expenses.
- RPT-DEF-005: Credit card payments are debt payments; credit card interest and fees remain expenses.
- RPT-DEF-006: Transfers between owned accounts do not affect income or expense totals unless includeTransfers is true.
- RPT-DEF-007: Savings Rate uses Savings Contributions divided by Total Income.
- RPT-DEF-008: Net Savings Rate uses Net Savings divided by Total Income.
- RPT-DEF-009: DTI uses total debt payments divided by total income for the same period.
- RPT-DEF-010: Net Worth equals total assets minus total liabilities at period end.
- RPT-DEF-011: Average monthly values use months_in_range, not a hard coded 12.
- RPT-DEF-012: Timezone defaults to Africa/Lusaka and fiscal year defaults to Jan 1 through Dec 31.

---

## 2. API Contracts and Data Integrity

- RPT-API-001: `/api/reports/annual` must expose totals for income, expenses, savingsContributions, netSavings, debtPaid, netWorth, savingsRate, and netSavingsRate.
- RPT-API-002: `/api/reports/annual` must expose monthly series for income, expenses, savingsContributions, netSavings, debtPaid, and netWorth change.
- RPT-API-003: `/api/reports/annual` must expose cumulative series for income, expenses, savingsContributions, debtPaid, and netWorth.
- RPT-API-004: `/api/reports/annual` must include category breakdowns for income, expenses, and savingsContributions.
- RPT-API-005: `/api/reports/financial-ratios` must include DTI, emergency fund, liquidity ratio, burn rate, savings rate, and net savings rate.
- RPT-API-006: `/api/reports/debt` must use actual debt payment transactions and must not use placeholder calculations.
- RPT-API-007: `/api/reports/debt` must provide payment trend data aligned to the selected aggregation.
- RPT-API-008: `/api/reports/net-worth` must return series for net worth, assets, and liabilities.
- RPT-API-009: `/api/reports/net-worth/changes` must align period labels to the selected aggregation.
- RPT-API-010: `/api/reports/spending/subcategory` must support income, expense, savingsContributions, and debt as types.
- RPT-API-011: `/api/reports/forecast` must support metrics: net-worth, net-savings, savings-contributions, expenses, income.
- RPT-API-012: `/api/reports/custom` must be POST with JSON body and must not use GET with query params.
- RPT-API-013: `/api/reports/custom` must enforce max 36 month range, max 25 group buckets, and max 5,000 rows.
- RPT-API-014: `/api/reports/custom` must honor aggregation and groupBy parameters.
- RPT-API-015: `/api/reports/custom` must map savingsContributions to contributions data (not net savings).
- RPT-API-016: All report endpoints must include range metadata with from, to, aggregation or interval, timezone, and base currency.
- RPT-API-017: All report endpoints must support scope (mine or household) and enforce role restrictions.
- RPT-API-018: Response payloads must use baseCurrency naming per v2.0 (no ambiguous currency-only fields).
- RPT-API-019: `/api/reports/annual` totals must include net worth change metrics (totalNetWorthChange and avgNetWorthChange).
- RPT-API-020: Aggregation parameters must validate and return HTTP 400 on invalid values.

---

## 3. Annual Dashboard Widgets (UI)

- RPT-UI-001: Summary Cards row must display 5 cards: Income, Expenses, Savings Contributions, Debt Paid, Net Worth.
- RPT-UI-002: Summary Cards must display average monthly values using months_in_range and YoY deltas where available.
- RPT-UI-003: Goal Progress row must include income, savings, debt payoff, and assets vs liabilities widgets.
- RPT-UI-004: Fixed vs Variable widget must render a horizontal stacked bar with fixed, variable, and discretionary shares.
- RPT-UI-005: Monthly charts must exist for income, expenses, savings contributions, debt paid, and net worth change.
- RPT-UI-006: Monthly charts must include average lines and drilldown on bar click.
- RPT-UI-007: Comparison trends must include income vs expenses (monthly and quarterly).
- RPT-UI-008: Comparison trends must include income vs savings contributions.
- RPT-UI-009: Comparison trends must include DTI trend.
- RPT-UI-010: Net worth trend must include net worth, assets, and liabilities series.
- RPT-UI-011: Cumulative charts must include income, expenses, savings contributions, debt paid, and net worth.
- RPT-UI-012: Category progress widgets must exist for income, expenses, savings, and debt.
- RPT-UI-013: Category donut widgets must exist for income, expenses, savings vs investments, loans vs credit, and assets breakdown.
- RPT-UI-014: Subcategory progress widgets must exist for income, expenses, savings, and debt.
- RPT-UI-015: Subcategory donut widgets must exist for income, expenses, savings, and debt.
- RPT-UI-016: KPI cards must include DTI, emergency fund, liquidity ratio, burn rate, and savings rate.
- RPT-UI-017: Forecast widget must include confidence interval shading and support metric selection per v2.0.
- RPT-UI-018: Chart type switching for widget groups must support the v2.0 matrix (bar, line, area, donut/pie, combo, stacked, treemap where applicable).
- RPT-UI-019: Widget chart type selections must persist per user (core and optional widgets).
- RPT-UI-020: Category breakdown widgets must support treemap view where the v2.0 matrix allows it.
- RPT-UI-021: Summary Cards must show trend arrows (up/down) based on YoY deltas.
- RPT-UI-022: Widgets must support expand/fullscreen mode.

---

## 4. Reports Tabs (Non-Annual)

- RPT-TAB-001: Cash Flow tab must include income vs expenses series, net savings trend, Sankey flow, and monthly breakdown table.
- RPT-TAB-002: Spending tab must include breakdown (donut or treemap) and trend line with comparison.
- RPT-TAB-003: Merchants tab must include top merchants table, top 10 chart, and merchant trend line.
- RPT-TAB-004: Income tab must include income series, income by source/category, and income vs expenses comparison.
- RPT-TAB-005: Net Worth tab must include net worth line, assets vs liabilities breakdown, and change deltas.
- RPT-TAB-006: Savings tab must include savings rate trend, net savings trend, and contributions breakdown.
- RPT-TAB-007: All non-annual tabs must use real API data and not mock or placeholder values.

---

## 5. Aggregation and Filters

- RPT-AGG-001: Aggregation filter must include weekly and custom range options.
- RPT-AGG-002: Weekly aggregation must use ISO weeks in the selected timezone.
- RPT-AGG-003: Custom range must update all widgets and metrics in the Annual Dashboard.
- RPT-AGG-004: Server side aggregation must be used for non-monthly views when available.
- RPT-AGG-005: Aggregation selection must be persisted in user preferences.

---

## 6. Custom Charts

- RPT-CUST-001: Custom charts must be executed via POST `/api/reports/custom` with a config body.
- RPT-CUST-002: Custom charts must honor aggregation and groupBy for all supported metrics.
- RPT-CUST-003: Custom chart preview must use the same API and configuration as saved charts.
- RPT-CUST-004: Chart type switching must be supported and persisted per chart.

---

## 7. Drilldown and Interactions

- RPT-INT-001: Chart interactions must support drilldown to `/api/reports/transactions` with filters and pagination.
- RPT-INT-002: Drilldown must carry scope, date range, category, merchant, and type filters accurately.
- RPT-INT-003: All interactive charts must either support drilldown or explicitly disable interactive affordances.

---

## 8. Formatting, Localization, and Visual Standards

- RPT-LOC-001: All report widgets must use user currency and number format settings; no hard coded USD.
- RPT-LOC-002: Dates and labels must use the user timezone and date format settings.
- RPT-LOC-003: Color semantics must be consistent: income green, expenses red, savings blue, debt orange, net worth purple.
- RPT-LOC-004: Chart colors must use theme tokens or centralized palette variables, not hard-coded colors.

---

## 9. Accessibility

- RPT-A11Y-001: Charts must provide tooltips with readable text values.
- RPT-A11Y-002: Interactive controls (chart type switchers, selectors) must be keyboard accessible and have aria-labels.
- RPT-A11Y-003: Widgets must provide clear empty states for screen readers.
- RPT-A11Y-004: Chart containers must use role="img" and provide aria-label or aria-describedby for context.
- RPT-A11Y-005: Drilldown interactions must be keyboard operable (Enter/Space) with focus indicators.
- RPT-A11Y-006: Loading states should be announced to assistive tech (aria-busy or live regions).
- RPT-A11Y-007: Status indicators must include non-color encoding (icons or labels) for color-blind users.

---

## 10. Performance and Caching

- RPT-PERF-001: Use React Query caching and avoid redundant fetches for the same report data.
- RPT-PERF-002: Heavy calculations and aggregations must be performed server side.
- RPT-PERF-003: Data returned to the client must be limited to what is needed per widget.
- RPT-PERF-004: Optional widgets must be lazy loaded to reduce initial dashboard load time.
- RPT-PERF-005: Large lists and tables in Reports must use virtualization to prevent UI stalls.
- RPT-PERF-006: FX rate lookups must be cached per request or query execution to avoid repeated conversions.

---

## 11. Testing and Quality

- RPT-TEST-001: Add unit tests for report hooks to validate data mapping and error states.
- RPT-TEST-002: Add widget tests to validate rendering of all required metrics and chart types.
- RPT-TEST-003: Replace any placeholder calculations with real data and cover with tests.
- RPT-TEST-004: No console errors or deprecated APIs in the reports module.
- RPT-TEST-005: Add integration tests for report endpoints and critical response shapes.
- RPT-TEST-006: Add end-to-end tests for dashboard customization (toggle, reorder, persist).
- RPT-TEST-007: Add edge-case tests for partial ranges, zero/negative values, and empty datasets.
- RPT-TEST-008: Reports module code must avoid `any` and `@ts-ignore` in favor of explicit types.

---

## 12. Security and Privacy

- RPT-SEC-001: All report endpoints must enforce household vs mine scope and role requirements.
- RPT-SEC-002: Report widgets must not leak private or excluded transactions.
- RPT-SEC-003: User widget preferences and custom charts are per user and must not be shared across users by default.

---

## 13. Reliability and Resilience

- RPT-REL-001: Reports dashboards must be wrapped in error boundaries so a single widget failure does not break the page.
- RPT-REL-002: Widget preference updates must be debounced or throttled and must handle failures without leaving stale UI state.
- RPT-REL-003: Widget fetch failures must show a retry action.
