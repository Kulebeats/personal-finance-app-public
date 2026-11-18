# Cash Flow Modal & Functionality Review

## Findings (ordered by severity)
- [High] Sankey data is fetched on every page load even when the user stays on the Trends view. Evidence: `client/src/pages/CashFlow.tsx:33` calls `useReportsSankey` without an `enabled` gate; the endpoint is rate-limited via `expensiveAnalyticsLimiter` (`server/routes/reports.ts:117`). Impact: unnecessary load, possible 429s, and slower initial render. Requirement: gate the query with `enabled: view === "sankey"` and consider prefetch-on-toggle.
- [High] Filter/Export controls are present but non-functional. Evidence: `client/src/pages/CashFlow.tsx:116` and `client/src/pages/CashFlow.tsx:119` render buttons with no handlers; export endpoint exists at `server/routes/reports.ts:254`. Impact: user-facing dead controls and no modal despite the UI implying one. Requirement: wire a filter modal (date range, scope, include pending/transfers) and hook export to `/api/reports/export?type=cashflow&from=...&to=...`.
- [High] Dashboard Cash Flow widget uses hard-coded data and totals. Evidence: `client/src/components/dashboard/CashFlowWidget.tsx:5` and `client/src/components/dashboard/CashFlowWidget.tsx:31`. Impact: dashboard never reflects real account data and diverges from the analytics contract. Requirement: replace static data with `useReportsCashflow` and a real date range (e.g., current month or last 6 months).
- [High] Account-level “Hide transactions” is not enforced in cash flow analytics. Evidence: the UI promises “Hide from cash flow and budget calculations” (`client/src/components/accounts/EditAccountModal.tsx:226`), but cash flow queries only filter `t.is_excluded_from_reports` and never check account settings (`server/repositories/ReportRepository.ts:228`). Impact: hidden accounts still affect cash flow totals. Requirement: apply `accounts.hide_transactions` in analytics queries or propagate the flag to transactions when toggled.
- [Medium] Sankey query parameters are defined but ignored server-side. Evidence: `reportsSankeyQuerySchema` includes `scope`, `includePending`, `includeTransfers`, `includeSavingsNode` (`server/validation/reports.ts:83`), while `getSankey` only uses `from`, `to`, `mode`, and `maxNodes` (`server/repositories/ReportRepository.ts:722`). Impact: UI filters and flags will not affect Sankey results. Requirement: implement these filters and respect `includeSavingsNode`.
- [Medium] Date-only parsing can shift month labels in some time zones. Evidence: `new Date(item.periodStart)` is used for chart labels and table rows (`client/src/pages/CashFlow.tsx:46`, `client/src/pages/CashFlow.tsx:308`). Impact: month labels can be off by one for users behind UTC. Requirement: parse as local date or use a date formatter that treats YYYY-MM-DD as local.
- [Medium] “Avg. Monthly Savings” is computed as `totals.savings / 12` regardless of actual range. Evidence: `client/src/pages/CashFlow.tsx:160` combined with `useCurrentYearRange` returning the full year (`client/src/hooks/use-reports.ts:603`). Impact: misleading values (especially early in the year or for custom ranges). Requirement: divide by actual months in `cashflowData.series` or by a computed month span.
- [Medium] Net Savings legend is shown but no Net Savings series is rendered. Evidence: legend includes Net Savings (`client/src/pages/CashFlow.tsx:183`) while `ResponsiveBar` uses only `income` and `expenses` (`client/src/pages/CashFlow.tsx:199`). Impact: UI implies a series that does not exist. Requirement: add a savings series or remove the legend entry.
- [Low] Cash Flow page ignores user formatting preferences. Evidence: `Intl.NumberFormat("en-US")` is hard-coded (`client/src/pages/CashFlow.tsx:70`) despite `useFormat`/`useFormatters` utilities (`client/src/hooks/use-format.ts:5`, `client/src/contexts/SettingsContext.tsx:95`). Impact: inconsistent currency/number display across the app. Requirement: use the existing formatting hooks with the report currency as override.
- [Low] Table rows use array index keys and no empty/error states are shown. Evidence: `key={i}` in the breakdown table (`client/src/pages/CashFlow.tsx:305`). Impact: minor React reconciliation risk and blank UI when there is no data or an API error. Requirement: use `row.periodStart` as key and show empty/error states.
- [Low] Month labels can collide if the date range spans multiple years. Evidence: bar chart index uses `month` with only the short month name (`client/src/pages/CashFlow.tsx:44`). Impact: duplicate categories if filters allow multi-year ranges. Requirement: include year in labels or use `item.label`.

## Open Questions / Assumptions
- I did not find a dedicated “Cash Flow modal” component; should the Filter button open a new modal/sheet, or reuse the Reports page filter patterns?
- Should the Cash Flow page default to YTD or a rolling 12-month range? This affects labels, averages, and what “YTD” means in the summary cards.
- Should savings be shown in the Sankey even when negative, or hidden unless `includeSavingsNode` is true?

## Requirements / Improvements
- Implement a filter modal/sheet for Cash Flow with: date range, interval, scope (mine/household), include pending, and include transfers; persist selected filters in URL or state and pass to `useReportsCashflow`/`useReportsSankey`.
- Wire Export to the existing report export endpoint with cashflow params, mirroring the pattern in `client/src/pages/Reports.tsx:384`.
- Replace static dashboard data with `useReportsCashflow` and align the range with dashboard expectations (e.g., last 4–6 months).
- Gate Sankey fetches behind the selected view; optionally prefetch on hover or after the user switches to the Sankey tab once.
- Update backend Sankey generation to honor `scope`, `includePending`, `includeTransfers`, and `includeSavingsNode`, and ensure account-level hide flags are respected.
- Normalize date handling for labels and table display to avoid timezone shifts; include year in labels when ranges span more than one year.
- Add empty and error states for both the chart and the table.

## Testing Gaps
- No UI coverage for Cash Flow: missing tests for chart transforms, summary calculations, and empty/error states.
- No tests to ensure `includePending`/`includeTransfers`/`scope` are respected in Sankey and cashflow queries.
- No tests for the cashflow export flow or filter modal behavior.
