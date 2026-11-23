# R12 holdings currency test candidate — TESTS ONLY, UNVERIFIED

Prepared 2026-11-03 from canonical `0d1e09d071b5c1faffa72196e4fb95bd479de31e`.
Author tree: `C:/Users/USER/.codex/worktrees/capital-r12-holdings-currency-nov03/personal-finance-app`,
branch `codex/r12-holdings-currency-nov03`. No production/migration edits or
unit, database, browser, type, build or other runtime checks were run.

Read first: master completion spec R12, lines631–641 and1239–1264; then
`server/modules/investments/investments.validation.ts`, holdings/portfolio
controllers, `PortfolioValuationService.ts`, and client holdings/portfolio hooks.
The backend DELETE worker owns the overlapping production files. This pin
authorizes no production repair and does not claim R12 closure.

## Proposed coupled contract for oracle review

- Preserve `currency`; support existing client `baseCurrency` as an alias.
  Trim and uppercase a single token. Both names may coexist only when their
  normalized values agree. Repeated values (even equal), empty explicit values,
  malformed strings/arrays/objects, and conflicting names return400 before
  holdings/portfolio valuation. Syntactically valid unavailable currencies and
  missing/stale pairs require separate incomplete/422 policy; this file does not
  invent that policy or restrict the API to the two currencies shown by the UI.
- Preserve current default: no selector uses household currency, then the
  existing ZMW fallback. The current page starts ZMW and explicitly requests it.
  No user-preference/default redesign is asserted.
- Existing `meta.baseCurrency` states the actual monetary unit. Proposed client
  projection retains it on each holding and summary's existing optional
  `baseCurrency` field. A response-unit mismatch must use the truthful resolved
  display or a visible unavailable/mismatch error; raw ZMW must never acquire a
  USD label. A new Money DTO representation is outside this test slice.

## Independent monetary oracle

| Source | Native current value | Native cost | ZMW value/cost | USD value/cost |
|---|---:|---:|---:|---:|
| ZMW10shares at10 |100 |80 |100 /80 |5 /4 |
| USD2shares at5 |10 |8 |200 /160 |10 /8 |
| Total at USD→ZMW20 | | |300 /240 |15 /12 |

Gain is ZMW60 or USD3,25percent in either unit. Native quote-price labels stay
ZMW10 and USD5. Both `/portfolio` and `/portfolio/summary` must agree with
`/holdings`, including response metadata and alternatives0 for this fixture.

The server file uses the protected signed fixture, real database FX repository,
initialized calculation singleton and actual converter. Only call-through
valuation-entry observers test admission order. Synthetic current-date direct
and inverse quotes are owned by UUID and deleted only by those UUIDs. A
precondition refuses another same-day/future pair; ROOT should use an isolated
marked target rather than delete/adopt unrelated quotes. These tests neither
contact providers nor change latest-versus-as-of lookup policy.

The mounted file retains actual hooks, query keys, formatter, page, summary,
table and currency controls. Its transport DTOs encode the independent oracle;
unrelated tabs/performance and session shell are isolated. The signed server
file supplies the real conversion proof. It covers resolved metadata retention,
actual USD values/native prices, metadata mismatch, and pending/error unit safety.

## Pending owner verification and remaining scope

Review both new test files before any production edit. ROOT owns protected
Node24/maxWorkers1 client and marked database execution. There are no runtime
receipts, pass counts or observed RED claims for this pin. Expected source gaps
include the ignored alias, permissive selectors, discarded metadata and display
formatting based only on requested selector state.

Performance snapshot units and dated external flows/returns, FX attribution and
FX-report amount-versus-instrument units, history/envelope/cache-limit behavior,
missing/stale completeness, dated-flow provider provenance/carry, global-market
versus household override ownership, privacy/visibility and broad report/DTO
reconciliation remain OPEN. This test slice supplies no migration, provider
refresh, new source attribution, reconciliation or product-scope reduction.
