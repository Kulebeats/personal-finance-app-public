# Candidate recap snapshot privacy contract

Local R04 candidate, 2 November 2026. This record preserves the initial design
proposal below and records the coordinator-approved bounded implementation.
It does not change the master completion spec or close R04, R08, R12 or R16.
The initial proposal describes its original point in time; its JSON-column
proposal is superseded by the additive nullable column described here.

## Producer and database boundary

Keep `accountBalances` as its existing array of `{accountId,balance}` objects.
Add nullable `net_worth_snapshots.provenance` through candidate migration 0016.
The coordinator owns SQL registration, database review and isolated compatibility
rehearsals. The exact migration commit is
`96689c925d8f79b3d1560dab1f705b41bc4e0ae0`.

Each new write receives a fresh lowercase canonical UUID `captureId`, even for
an unchanged same-day replacement. Aggregate, currency, self-contained capture
facts and included individual balance upserts commit atomically. Preserve
individual row IDs, creation timestamps, available balances and omitted rows:
the schema has no writer ownership evidence that permits deleting independent
CSV-imported history. Replacement removes omissions from the self-contained
household contribution array; it never erases unowned individual history.
Acquire a household/date advisory transaction guard before reading input under
SERIALIZABLE isolation. Retry the entire capture on 40001/40P01 at most three
attempts. Only a committed capture may write the distributed completion marker.

The v1 JSON header is numeric `version:1`, `captureId`, lowercase `householdId`,
ISO `date`, uppercase `currency`, `coverage:complete|unavailable`, boolean
`investmentsAbsent`, integer `omittedEligibleAccounts`, and
`investmentInventory:{holdings,tbills,pensions,bonds}` with nonnegative integers.
`contributions` is an array of accountId, kind(asset|liability), captured
accountType, decimal-string baseAmount, sourceCurrency(string|null),
baseCurrency, and fx(same_currency|unproven). Inventory counts come from the same
transactional snapshot as accounts. Existing portfolio/FX factories accept a
capture read context: all valuation inputs, including FX, use that transaction.
Ordinary callers retain existing DB and global-FX defaults. Proven investment
absence skips valuation; valuation failures roll back the attempted capture.
FX SQL failures propagate unchanged to the bounded transaction retry; an absent
rate after a successful lookup retains the existing MISSING_FX_RATE failure.
Count attributed and unresolved household
interests independently of their value; net residual never proves absence.

Complete evidence requires explicit absence (all four counts zero), zero omitted
eligible accounts and proven same-currency contributions. Unknown value/eligibility,
nonzero display-hidden/archived eligible omissions, investment presence and
unproven account FX leave the recap value unavailable. Explicit economic exclusions
retain the existing producer behavior. A proven zero display-hidden/archived
balance may be omitted without changing the amount. Display-hidden economic
policy across the product remains open; this candidate does not redefine it.

The trigger invalidates provenance when an old writer repeats the capture ID or
omits it on update, and checks new header/count structure independently. The reader
still validates all contribution content, IDs, classifications, denominations,
legacy-detail correspondence and arithmetic reconciliation. Imported individual
balance snapshots cannot rewrite these self-contained facts. No old row has a
proven attested format in inspected producers/history; existing arrays are
preserved and unsupported legacy amounts are unavailable, without backfilling
from current account state.

## Recipient and publication boundary

A read-only repeatable-read transaction checks the recipient's live grant, loads
one coherent aggregate version, validates evidence, and projects captured facts
using the shared account visibility predicate. Both periods and every history
window use one live audience. Missing, foreign, soft-deleted and inaccessible
source accounts contribute nothing to that recipient. A supported complete capture
with no visible contributions is legitimately zero. Captured kind/currency remain
historical when current account type/currency or balances change.

Recap worth bypasses the analytics aggregate cache. Read again after service
assembly, immediately before signed/generate/history publication, and at mock/real
mail transport handoff. No asynchronous assembly follows the last read before
response or mail invocation. Query failures propagate; unavailable evidence is a
data state and permits the other recap sections to function.

Public worth has available/partial/unavailable temporal coverage, captured currency
and asOf dates. Existing numeric fields are nullable for compatibility; parallel
currentMoney/previousMoney/changeMoney carry decimal-string MoneyDto values.
Percentages use decimal arithmetic. A prior zero permits absolute change but not
a percentage. Distinct captured currencies retain individual MoneyDto evidence
but have no numeric comparison without an approved dated conversion. Series points
carry their captured denomination and include only validated historical values.

UI/email render missing data explicitly, never format null as zero, and retain
supported dated values. Worth labels and accessible chart data use captured
currency/date. The worth chart uses only the selected captured currency. History
selection stores a week key plus session-owned query client, then derives details
from fresh data. Production SessionBoundary keys that provider by operation
lifetime on identity/role changes. Recap/history refetch on mount/focus and every
60 seconds, withdrawing cached values during active or offline-paused revalidation
and error, with explicit checking/error messages. Supported prior MoneyDTOs keep
their own dates/denominations even when a comparison is unavailable. Calendar-only
labels are formatted as local calendar dates without UTC-midnight shifts.

## Validation ownership and remaining work

Tests are committed before source. The coordinator established initial server
RED at 6fa8ae1f (five failures/three controls), expanded RED at 59eb24a3
(21 failures/four controls), and mounted unavailable UI RED at 8a3e8d23
(three failures). Additional focused publication, content, selection, accessible
currency, retry and concurrency tests precede the source checkpoint. The author
runs only diff checks and the lightweight LOC guard; the coordinator owns all
protected database, compiler and browser execution plus independent source review.
Migration rehearsal is candidate evidence, not deployment.

Investment-attributable dated captures and dated account FX provenance remain
R08/R12 dependencies. Legacy household reports, AccountReportingService, report
changes and CSV readers retain distinct contracts and are not repaired by this
recap-only reader. Existing investment aggregate arithmetic remains unchanged and
unproven investment-containing captures are withheld from recap for every role.
Other recap currency/settings/period and notification-delivery work is outside
this bounded candidate. No whole-requirement readiness claim is made.

---

## Preserved original proposal

# Recap historical worth: proposed bounded R04 contract

Proposal only, 2 November 2026. Source base: `3a69c477`. Regression-only commit:
`6fa8ae1f`. No production source has been edited for this assignment. Protected
execution and independent review remain with the coordinator. This document does
not change the master specification or declare any packet complete.

## Reproducing path and current hazards

The signed recap controller, signed recap history builder and
`sendWeeklyRecapEmail` all call `weeklyRecapService.getRecap`. Its worth reader
calls `AnalyticsService.getNetWorth`, then the analytics cache, then
`NetWorthReportRepository.getNetWorth`. Default household scope reads the entire
`net_worth_snapshots` row without recipient visibility. The fallback and `mine`
scope use current account balances even for an old requested period. Recap catches
query/FX/parse errors and returns zero. It also flattens Net Worth, Assets and
Liabilities report series into one unlabeled worth series.

The digest chooses `userDisplaySettings.currency` for formatting although recap
worth values have no denomination field and come from the household-base report.
That can relabel a ZMW value as another currency without converting it. The new
payload must carry its captured denomination and the renderer must use it, not
the recipient's preferred display label. If two periods have different captured
currencies and no approved dated conversion, their comparison is unavailable;
current or preferred FX must not be substituted.

`AnalyticsCache` includes user ID but has no account/privacy revision in its key;
an existing ten-minute entry is not proof of current visibility. The recap hook
uses a one-hour stale time. Membership is checked again at publication, but that
does not revalidate account privacy or cached aggregate provenance.

The common report reader also supplies `/api/reports/net-worth`, worth changes,
CSV exports and the legacy `ReportService`. They have numeric/Money DTO report
contracts and independent scope semantics. Changing the default to `mine` would
silently replace historical values with current balances; changing the common
reader's shape would break those callers. `AccountReportingService` has another
history path whose explicit household scope currently admits owner/admin to the
whole aggregate. That is not a valid privacy override. These are tracked adjacent
R04 readers, not evidence that a recap-only correction fixes all report callers.

`AccountSnapshotRepository.getUserNetWorthSeries` is not a safe replacement. It
sums untyped snapshot balances using current `is_asset`, current account flags and
no captured denomination or dated FX provenance. Its account filter also treats
display-hidden state as economic exclusion.

## Producer facts and provenance limits

`snapshotWorker.processHousehold` persists both the household aggregate and
individual `account_balance_snapshots`. `accountBalances` in the aggregate holds
account IDs and already-converted household-base amounts. Individual snapshots
also store that converted amount but have no currency column. Neither records
the captured account economic classification or native denomination; later
account edits cannot safely supply those historical facts.

The worker separately adds household holdings, active T-bill and pension values.
These amounts are absent from its account contribution detail. Holdings can be
attributed to accounts in their source model, but their valuation service returns
only household/type aggregates. T-bill and pension account references are
nullable, and their household valuation queries do not apply recipient privacy.
Investment valuation exceptions are currently swallowed, permitting incomplete
aggregate snapshots. An owner may also have another member's private interests;
an owner/admin role is not permission to use an unattributed household total.

Account FX capture currently uses latest rates, and the returned map has no rate
date. The report's snapshot conversion uses a dated SQL FX expression, but that
does not prove the original account conversion date. Current holdings prices or
current FX cannot reconstruct an earlier investment contribution. No new code
should label an assumed rate/date or residual as captured history.

## Proposed public contract

Use a recipient-specific snapshot reader for recap, history and digest. It must
read persisted dated contributions, current live membership and containing-account
visibility in a consistent database snapshot. It must bypass the existing
aggregate analytics cache until an authorization revision and snapshot-policy
version can safely bind cache entries. Do not use current balances as fallback.

Extend the recap worth section with an explicit availability state and currency:

- `status: available | partial | unavailable`;
- `currency`, `asOf`, `previousAsOf`;
- existing `current`, `previous`, `change`, `changePercent` become nullable;
- only proven dated net-worth points appear in `series`;
- `trend` is null when comparison is unavailable;
- a coarse public reason such as `history_unavailable` reveals no private
  account, investment, count or residual amount.

`partial` means temporal coverage is incomplete: a complete current historical
value can exist while its previous period is absent. It never labels a partial
economic sum as total net worth. An unproven date has no number. If either period
is absent, no invented zero comparison, percentage or trend is published.

The signed recap and history responses may still return their other valid
sections with this explicit worth state. Email renders "Historical net worth is
unavailable" or the supported value with "Previous period unavailable"; it must
not format null as zero or display an unsupported gain/loss. Actual protected
query failures must still surface as errors and prevent SMTP, rather than being
converted into an expected data-availability state.

Update the shared recap type, `NetWorthStep`, `WeeklyRecapHistory`, the email
renderer and relevant hook/component fixtures together. The UI must retain
navigation and other recap sections while omitting unsupported number, trend and
chart claims. Its retained recap query cannot stand in for current publication
authorization after a privacy/context change.

## Producer boundary and R08/R12 coordination

For newly produced account-only snapshots, record versioned immutable contribution
metadata in the existing snapshot JSON: capture date, base currency, account ID,
captured economic class/sign and the already-calculated base amount. Do not
recompute account, liability or investment arithmetic for R04. Capture monetary
provenance, rather than deriving it from later account edits.

An explicitly proven absence of investment contributions can make a complete
account-only snapshot eligible. Do not infer that absence from a zero residual:
unattributed positive/negative positions can cancel. Existing snapshots without
sufficient metadata, cross-currency contributions without captured dated FX,
partial investment calculations and unattributed investment residuals must be
unavailable, including for owners. Do not backfill them from today's accounts.

For investment-containing snapshots, R12 must provide captured attributable
contributions and provenance (or an agreed existing authoritative record). R04
applies visibility to those contributions; it does not duplicate valuation,
invent private-interest ownership, or modify the R12 team's calculation policy.
Until that boundary is supplied, explicitly unavailable investment history is
containment, not a completed worth feature or R04/R12 readiness claim.

The coordinator should adjudicate this producer/contract boundary before source
edits. A narrower reader that silently drops investments, assumes native/base
currency, reuses current account class, substitutes current balances, or emits
zero would not meet the task.

## Evidence and next tests

The first regression uses the real worker at two controlled dates, verifies full
household and per-account persistence, then changes present balances. Signed
nonowners must retain 900.00/988.89 history; the owner must retain
4900.00/5211.12. The digest exercises the same actual assembly with only SMTP
mocked. These are synthetic snapshot and delivery facts, not ledger/FX acceptance.

After agreement on the contract, add tests first for missing prior/current data,
legacy or malformed metadata, missing contribution rows, changed account
classification/currency, cached data after privacy changes, omitted/excluded
accounts, private attributable investments and unprovable investment residuals.
Paired positive cases must preserve legitimate dated values. Add protected-query
failure and unavailable UI/email cases before implementation. Keep report/CSV
contract changes separate unless the coordinator explicitly expands ownership.
