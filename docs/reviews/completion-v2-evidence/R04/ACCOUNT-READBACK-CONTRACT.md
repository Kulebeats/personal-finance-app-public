# Candidate account summary and balance-history readback contract

Local R04 candidate, 2 November 2026. Base regression `2a6a6fda` reproduced private
investment summary disclosure and stale account/grant export authorization.
The isolated branch merges canonical `15835ca6` and reviewed recap `ed438b75`;
it reuses that valuation read context rather than introducing an alternative
investment calculation. This record does not close R04/R08/R12/R13.

## Scope and legacy authority

Every current summary has the same `scope:visible_account_linked` and
`complete:false` metadata, independently of private or unattributed instruments.
CSV and the Accounts screen state that scope and the exclusion of legacy
instruments without proven account access. Ordinary owner/admin/member status
does not grant access to another person's private account or its derived wealth.

Pension/GRZ creation stores a household and optional account, validates the account
only when supplied, and does not record a separate subject/public entitlement.
Creator audit establishes who performed an operation, not public ownership.
No inspected domain path supplies positive household-wide disclosure authority
for an unlinked instrument. Missing/foreign/deleted account origins and private
sources are omitted identically to absence: no count, warning, status or amount
may reveal their presence. Attribution remains an explicit unresolved legacy
matter, not an automatic backfill or fabricated owner.

Account-linked holdings, active T-bills and pensions retain the existing accepted
valuation formulas and existing per-source hidden/archive/exclusion behavior.
The optional account-ID read scope restricts only this ordinary reader. Trusted
recap/worker callers without it retain their prior semantics. R13 provides bond
PV calculations but no authoritative current required-yield/as-of selection for
this summary. A positively visible eligible bond therefore produces typed422
`FINANCIAL_DATA_UNAVAILABLE`, without an instrument identifier/name/value. A
private or unproven-origin bond cannot change the response. Proven visible rows
with missing/nonfinite required valuation inputs also fail explicitly.

## Read consistency and publication

Current membership/capability, visible accounts, attributed instrument inputs,
market values and FX come from one read-only repeatable-read transaction. Cash
and investments therefore cannot straddle a cash-to-holding purchase. Stock,
bill and pension formulas continue through PortfolioValuationService and the
existing FX repository bound to that transaction. No external calls run inside it.

After assembly, a fresh coherent read checks explicit financial/authority
projections, not unrelated notes, titles, display order or timestamps. On an
audience, parent-reference or value change, rebuild rather
than publish stale private facts. Three unsuccessful stabilizations produce409.
Financial availability errors are published only after that same revalidation.
Summary CSV obtains account rows and totals from the same authorized frame and
checks `financial.export`; it does not combine an earlier list with later totals.

Balance history uses one SQL statement for `financial.read`, or `financial.export`
for a download, the live containing account, dated rows and legitimate current
fallback. There is no separate preflight or repeated unbounded history scan. Hidden/missing
object IDs return404; lost/unknown/insufficient grants403. Preserve existing range
translation and legitimate empty-history fallback to that currently authorized
account's current balance/date. Do not delete or rewrite any imported history.

## Product and verification boundaries

The Accounts renderers label current amounts with the household-base denomination.
History shares the accepted recap capture validator and captured economic-kind
projection. Valid dated points retain their captured currency; independent imported
rows remain preserved but uncharted because denomination/classification is unverified.
Household history selection never widens account privacy. Current values, history,
their common audience and selected capture versions are revalidated together.
Unsupported current valuation remains explicit while independently proven history
stays visible. There is no current-value historical fallback. The chart separates
currencies and formats calendar dates without UTC-midnight shifts, including
tooltip and accessible data. A mixed-native-currency account-balance breakdown is unavailable
until approved conversion supplies its amounts; no new conversion is invented.
Other report history, dashboard aggregation, full allocation/breakdown
reconciliation, investment denomination/provenance and approved dated FX remain separate
R08/R12/R13 work. This is scoped current wealth, not a complete household valuation.

Regression tests precede source changes. SQL-boundary race coordination survives
replacement of the old repository helper. The coordinator owns protected DB,
compiler, native/browser and broad test execution plus independent review. The
author runs only lightweight diff and LOC checks. All work is local/candidate
only; no production or external provider actions are authorized by this record.
