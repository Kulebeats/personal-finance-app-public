# Signed recurring confirmation: selection and provenance contract

Status: proposed implementation contract, pending coordinator/source review.
Product base: `7369038c24da88c14ee8f98ba66eabce03e02952`. This document does not
claim implementation, protected execution, acceptance or requirement closure.
The first regression set uses ordinary day-10 ZMW examples; it does not settle
the date, statistical or denomination decisions below by fixture choice.

## Authority and preserved work

The master completion specification controls FIN-01, R04.2/R04.3 and J05:
account AND transaction privacy, live capabilities, reference validation,
unchanged denied writes, and a positive authorized route control. CAMPAIGN's
November 1 detector checkpoint explicitly leaves safe confirmation and durable
complete origin restoration open. Its internal history-marker idea is a proposal.

Actor-scoped detection was integrated at `3cc13580` from author `081e1365`.
Ordinary reads intentionally contain all suggested origins. Existing manual-rule
privacy, history, link/unlink, PUT, lifecycle and replay repairs must survive.
The archived overhaul/architecture guides and February closed-plan backlog do
not certify this current feature or override the master.

The R14 durable catalog/storage/fence foundation is integrated, but its production
definitions are unsupported. This work does not admit producers, change cron,
advance a financial clock, or establish catch-up/restart acceptance. R08 retains
posting arithmetic, account economic class and ledger edit/delete. The coordinator
subsequently assigned the bounded recurring denomination hold/recovery below to
this lane. No shared schema or migration is proposed here.

## Current reachable behavior

`server/routes.ts` mounts the modular recurring router. POST `/api/recurring/confirm`
passes `householdGuard`, `requireRole("member")`, the pattern controller and
`RecurringLinkingService.confirmPattern`. That controller is the sole production
caller of the confirm service. It currently supplies household/user IDs rather
than the actor. There is no separate trusted confirmation caller to preserve.

The service prechecks the destination outside a transaction, trusts copied
pattern fields, commits a suggested rule, commits its created history, and
independently calls the trusted linker for each sample through `allSettled`.
Failures are logged and success is returned. Business audit is postcommit.
The returned rule precedes the link updates to counts and dates.

Trusted linking is not the signed linking guard. It can replace a source's
existing direct pointer when no link row survives. Its separately read account
does not enforce household/deleted-parent scope under a lock. Existing direct
POST link behavior is not authority to bypass that route from confirmation.

Detection analyzes all group contributors but returns only five sample IDs.
It groups across accounts, types and currencies by merchant or normalized name.
Ordering ties have no ID tie-breaker. The modal supplies a transaction UUID as
the destination account UUID, treats 0-100 confidence as a fraction, and loses
Scan Again results. Suggested rules remain hidden by every ordinary audience read.

## Signed write contract

1. Use verified household actor context. Lock the actual membership row through
   commit and require the existing `financial.write` capability. Missing grant
   is concealed; a recognized read-only role is forbidden; unknown roles fail
   closed. A stale request cannot outlive revocation or role downgrade.
2. Validate source and destination scope in SQL before waiting on inaccessible
   rows. Canonicalize UUIDs and sort every lock family. Hold source UPDATE locks
   before account locks, following the existing recurring order. Hold all needed
   account and reference locks through commit. Recheck after waits/retries.
3. Sources require household, live transaction/account, account AND transaction
   visibility, permitted transaction type/pending state, and valid references.
   Historical same-household archived/soft-deleted categories remain eligible
   detector sources under the accepted detector contract. A newly selected rule
   reference must satisfy its own current authoring contract.
4. Inspect both source direct pointers and every existing link. A new confirmation
   cannot reparent any source. Conceal inaccessible parents; return the established
   conflict/refusal for an accessible incompatible parent or unexplained state.
   Repeated requests must never create another rule around already claimed sources.
5. One transaction contains rule creation, all selected links, source flags and
   pointers, complete provenance, created/linked history and one actor-attributed
   business audit. Any failure rolls back all effects. No parallel partial-success
   path or catch-and-continue is permitted. Return the final committed rule.
6. Confirmation assigns existing transactions; it creates no ledger transaction
   and changes no balance. Existing trusted auto-linking, processing and
   caller-owned repository paths retain their separate contracts.

## Complete selection identity (proposed wire contract)

Detection should return its current display fields plus a versioned selection:
the resolved date window, normalized detector options/group key, complete
contributor identity, and denomination. The sample list can remain a display
preview but cannot authorize a write. Explicit request-size/contributor bounds
must reject excess input rather than silently truncate provenance. The bound
must be coordinated with the actual detector query; R14's 100-item job limit is
not a justified limit for historical contributors.

The client merely echoes this selector. It cannot assert trustworthy lineage.
Inside the confirmation transaction, requery the actor-visible eligible sources
for that resolved selection, sort by `(date, id)`, rederive the group and its
values, and compare the complete identity. Missing, added, duplicated, moved,
reparented or changed sources require safe refusal/rescan before writes. Protect
query phantoms with the established serializable/retry approach as well as row
locks; do not call the global nontransactional query from inside the callback.

Compatibility proposal: preserve existing unambiguous callers without a selector
only when visible sample anchors resolve to exactly one complete server-derived
selection and the presented pattern still matches it. Never equate old samples
with the full source set. Ambiguous/stale input requires a rescan. The coordinator
must adjudicate this adapter before its source or compatibility tests are committed.

## Date, variance and denomination adjudication

- **Late-month anchors:** the engine already clamps an explicit anchor to each
  month's length. Preserve legitimate 29-31 anchors; align confirmation validation
  with 1-31 instead of forcing day 28. Examples to verify without changing the
  engine: Jan31 -> Feb28 -> Mar31; leap-year Feb29; weekly Sunday (day zero).
  Detect ambiguous anchor inference explicitly rather than invent a day or call
  the generic clock/catch-up behavior repaired. Date-only values stay entered
  dates; resolve the detector window once, with the master's household-local
  boundary, and use stable source ordering for tie-sensitive inference.
- **Measured variance versus rule tolerance:** detector output can exceed 50 when
  a lower supported confidence threshold is selected. Recommended contract:
  preserve the server-derived measured variance, validate it as finite/nonnegative,
  and distinguish it from the existing bounded 0-50 rule tolerance. Show any
  resulting tolerance cap explicitly in the UI. Do not truncate the measurement,
  drop a valid detection merely to satisfy the old schema, or silently change
  threshold policy. This distinction needs review before implementation.
- **Denomination and grouping:** never label every detected group ZMW, average
  different currencies, or apply an assumed FX rate. Recommended contract:
  distinct currency/type groups, explicit currency on the detector Money DTO,
  and a destination with the same denomination. Same-currency sources may span
  visible accounts; destination choice is explicit, not a transaction UUID.
  Null/legacy source denomination requires existing reviewed provenance or an
  explicit unresolved outcome; current account currency alone is not new historic
  evidence. Group partition/statistical extraction needs coordinator review before
  shared detector edits. This does not authorize changes to ledger arithmetic.

## Durable origin and public restoration

Recommended no-schema representation: one versioned server-only history event
containing the complete selection and each contributor's original transaction,
account and relevant reference IDs, written in the same transaction. Store IDs
and the minimal validation facts, not a second copy of private names/amounts.
Only a server-verified complete marker may establish a new suggested rule's
origin. Legacy suggestions and malformed, missing, inconsistent or duplicate
markers remain contained. A later manual link cannot supply missing provenance.

All ordinary readers must apply the same provenance audience before ordering,
pagination, limits and aggregates: list/detail, linked transactions, public history,
upcoming, summary and their recap projection. The marker must be omitted in SQL
before public history pagination, including an otherwise empty public history.
All original IDs survive unlink/deletion in the marker. A missing/deleted or now
inaccessible source must not turn into public provenance; conservative concealment
is the default until an explicit historical tombstone contract exists.

Mutation locking must cover marker-origin transactions/accounts/references as
well as current links/history. Simply teaching GET about the marker leaves a new
authorization race in PUT/lifecycle. Coordinate `RecurringAudienceQuery.ts` and
`RecurringLifecycleAudience.ts` ownership before making this change.

## UI contract and ownership

The actual modal/hook must echo selection identity, choose a real visible account
with matching denomination, display confidence on 0-100, and replace local results
on every scan. Show stale-selection errors with a rescan path. On success remove
only the confirmed selection, invalidate recurring queries, and make the created
rule immediately readable to its authorized actor. A 201 followed by concealed
GET is not feature acceptance. Never relabel a suggestion manual to bypass privacy.

Owned candidate: dedicated confirmation helper, thin signed controller/service
delegate, confirm validation/selection contract, focused regressions and eventual
modal/hook restoration. Shared detector, query audience and lifecycle locking
edits require coordinator reconciliation with their current owner before edits.
No R08/R14/schema, global guard, replay or unrelated source changes are included.

## Acceptance stages and protected handoff

First freeze the actual signed-route test-only commit. Initial cases cover role
and outsider controls, source/destination/reference denial, malformed sample sets,
existing direct pointers/links, persistence-fault rollback, SQL-observed grant and
privacy contention, final DTO state, unchanged balances, and actual detect-confirm-
GET positive journeys. Repository fault spies reject real write calls while all
other writes/readback use the protected PostgreSQL target; there is no SMTP.

Frozen initial test-only commit: `36d898fef2ca7f108e5022fbf849a2962230dd4a`.
It adds only `server/modules/recurring/__tests__/completion-r04.recurring-confirm.realdb.integration.test.ts`
(298 lines, 41 cases). Staged whitespace validation passed. The author has run
no test, compiler, database or browser process; the coordinator's RED is pending.

After RED and contract adjudication, implement/review in bounded commits. Extend
tests for more than five contributors, complete provenance after unlink/deletion,
marker corruption/duplicates, current privacy changes, hidden history pagination,
stale/changed group selection and the adjudicated date/currency/variance cases.
Affected legacy signed and trusted callers remain controls. The coordinator owns
all protected tests, compiler/check/build, browser proof and final integration.
The final browser journey must use the real Scan -> Add Rule -> readable list/detail
path; scheduled financial effects remain a separate R08/R14 acceptance obligation.

## Prepared implementation and review clarifications

Parent RED on test-only `36d898fe` recorded 34 failures and seven passes. Logs are
`.local/r04-confirm-confirmred04l/server.log`; its marked database postflight was
`pfa_completion_scope_confirmred04l_test|0|0|0|0|0|0`. Persisted side effects,
the returned zero occurrence count and authorized detail 404 all reproduced.
This failure packet remains unchanged. No author-run tests or compiler follow.
The server log SHA-256 is `3823FA63C615EEC78DD7838D298DE9DAF8D00AD7C99718FE2D19767CCF156C55`.

The candidate now uses a dedicated signed helper with grant -> sorted source
UPDATE -> sorted account/reference locks in a serializable transaction. It does
not lock old parents after sources; old parent reads only select safe refusal.
All retryable effects stay inside the transaction. Historical links record their
observed expected/actual dates, and count N, maximum observed date and anchored
next due date are set together once. There is one atomic business audit.

The selector fingerprints complete `(date,id)`-ordered source inputs: signed
amounts, raw names, dates, type/currency, account/reference IDs, ownership/privacy,
normalized options, resolved window, grouping key, household denomination and the
actor's persisted display/profile timezone source.
Absent-selector requests require the exact entire source-ID set of one default
group (`minOccurrences=3`, `lookbackMonths=6`, `confidenceThreshold=80`) and its
canonical preview including occurrences, confidence and variance. One/two-source,
low-confidence, absent measurement and larger five-sample requests require rescan.
The legacy adapter cannot attest a historical input hash it never received; it
authorizes only that unambiguous current full derivation. New selectors bind the
actual input fingerprint. Changes committed before revalidation invalidate it;
an overlapping insert may serialize after confirmation. The contract does not
assert that every concurrent insert must invalidate an earlier serialization point.

The complete selector is bounded at 2,000 contributors to bound the echoed
request, lock set and durable JSON marker. Oversized detected groups are still
reported with an actionable shorter-lookback message and no confirmable token;
they are never truncated into a falsely complete selection. This transport bound
is distinct from the R14 job batch bound. Selection/provenance SQL fails closed
for absent, duplicate, inconsistent or malformed markers and checks both original
and current sources. Public history filters the internal event before its limit.
Lifecycle locking also holds original source accounts and historical references.

The prepared supported path requires explicit ZMW source transaction, source
account, destination account and household denomination. Current rule/summary/
materializer formats cannot carry a different currency. USD, inconsistent,
missing or empty currency is reported as unsupported with no silent inference,
FX or relabeling. Blank source currency stays blank in the detected DTO with an
actionable issue. Suggested reads and signed additional links retain those
denomination checks after creation. The auto linker is unchanged. The later
coordinator-assigned posting metadata and denomination guard below applies to the
trusted service caller as well; scheduler admission and clock policy remain R14.

Complete multi-currency support requires a separately coordinated contract:
record rule denomination with only provable legacy backfills; retain historical
expected/actual link denomination; propagate it through rule/history/link DTOs,
summary totals and recap readers; validate locked posting account denomination
and explicitly supply materialized transaction currency; bind audit/outbox facts
to the same denomination; then prove non-ZMW create/read/materialize and subsequent
account-currency changes. Cross-currency summaries need the reviewed R12 policy
or explicit per-currency totals. No such schema/job/ledger changes occur here.

Date inference uses UTC date-only fields, preserves valid 29-31 anchors and passes
Sunday zero to the public engine. The coordinator separately owns the engine and
old-caller UTC/Sunday fixes; no engine/processor edits occur in this candidate.
Measured dimensionless relative deviation remains fractional and uncapped while
the existing integer rule tolerance stays within 0-50; both are displayed.

Added stage regressions cover complete six-source identity, original/current
privacy, marker persistence/corruption, public list/upcoming/summary/history,
same-mean input swaps, exact legacy compatibility, overlapping claims, historical
category eligibility, denomination refusal and date/variance behavior. Pure date
inference covers leap anchors, Sunday zero and host timezone changes; UI tests
cover real destination identity, confidence, rescan and cap/refusal display.
Fault and race tests now obtain their canonical preview from the real detector
instead of inventing confidence. The earlier detector privacy fixture now declares
its known synthetic ZMW explicitly; production NULL is separately tested as unknown.

All of this is a prepared candidate requiring coordinator check, protected GREEN,
calendar integration and independent source/SQL/UI review. It is not whole-feature
or multi-currency acceptance, canonical integration, browser evidence or deployment.

### Failed first candidate and actual preview metadata source

`3678ea5a` failed type checking: households have no timezone column, and one test
used a narrow template UUID array against a string row ID. The protected first
run passed 24/67 and failed 43/67; many failures stopped at the nonexistent
household-timezone guard and therefore did not reach the claimed write/rollback
paths. The blank currency fixture failed the existing SQL currency-length check.
These failures remain in `.local/r04-confirm-confirmchk05a/check.log` and
`.local/r04-confirm-confirmfirst05b/server.log` (SHA-256
`0B1CCE71835C39091CF6836633D03844A5F8F5EDA9AC4C3C8D1E2A9DA4A29CC0`).

Neither households nor household_preferences stores timezone. Existing settings
and GoalBaseService use stored user display timezone, then stored profile timezone.
The repaired selector explicitly labels a **personal history window** using that
persisted hierarchy; there is no ambient UTC/Lusaka or invented household fallback.
Both the timezone and its display/profile source are fingerprinted and checked
under locks during confirmation. Actual stored UTC defaults are supported; missing
or invalid stored timezone is an actionable refusal. This read-window choice does
not alter shared scheduling or establish the master's missing household scheduling
timezone contract; that remains R14/coordinated metadata work.

The blank stored-currency control now verifies the existing SQL rejection. NULL
currency remains the executable unknown-denomination control. No constraint or
schema was weakened. A new protected run must reach the actual claimed paths.

### Restoration dependencies: unlink, processing and mounted freshness

At `aecc680f` the coordinator's pinned check passed. Protected execution passed
all 69 confirmation/selection/calendar cases and the two public unlink controls;
all eight new unlink denial/contention cases failed. This establishes that the
metadata repair reaches the earlier intended paths while preserving a separate
unlink reproducer. Test-only `33562dc4` then added process and mounted-modal
controls. Parent reported 25/39 process/selection passing, with 14 real process
failures: hidden origin disclosure, NULL generated currency and mixed owners
producing a public row. The original modal run showed two real failures and one
invalid actor control: an unused mock implementation survived a prior failed
reopen test. `e79086cc` resets implementations and requires the row to be mounted;
parent's corrected run failed all three stale-state cases (3/6 passing).

The reviewed calendar source delta from canonical `2226d988` is integrated at
`f55c625b` using that merge's first-parent delta, avoiding unrelated canonical
documentation. The only conflict was equivalent day-31 validation-test wording.
UTC old-detector getters, all three day-31 bounds, Sunday propagation and the
calendar engine/tests were retained alongside this candidate's variance contract.

`RecurringAudienceReferences` now holds the union of current and recorded
original source, account and reference facts. Unlink first verifies all target
and surviving-parent audiences, acquires parents before globally ordered sources
and accounts, then checks the graph again. No parent lock follows a source lock.
Public busy-survivor refusal and ambiguous-pointer conflicts remain; a different
private contributor or original account prevents unlink without pointer/history/
audit changes. Old positive unlink fixtures now remove their unrelated foreign
or peer-private sibling links before claiming an accessible target; focused
negative controls retain those links. Two additional new-marker controls prove
that original-account privacy alone protects both target and surviving templates.

The actual signed process controller supplies its actor to the service. Dry-run
selection uses one actor-audience SQL statement while holding the live write
grant; each real posting separately uses the serializable full-audience guard.
Inaccessible rows are excluded before returned IDs/names/amounts/counts/errors.
If a selected row becomes inaccessible before posting, it contributes no public
error ID or count. A stale grant is refused. Empty hidden-only invocations produce
no financial batch audit. The existing per-rule transaction/batch semantics are
retained; this is not a new all-or-nothing whole-batch guarantee after earlier
authorized occurrences have already committed.

The trusted three-argument cron service caller remains separate from that actor
selection. Both real posting paths verify a definition-bound denomination receipt
and derive visibility metadata from their held references. Supported ZMW is explicitly persisted on the generated
transaction, preventing the new NULL source from concealing the rule afterward.
Ordinary public outputs stay public; signed public outputs belong to their acting
user, while trusted public outputs retain null system ownership. Known private
contributors/accounts produce a private transaction belonging to their one actual
owner, including a member whose peer is the household owner. Missing or conflicting
private owners, unsupported/unknown denomination and unattested non-manual origin
are actionable refusals, never a public or arbitrarily owned financial row.
No balance arithmetic, FX, due policy, catch-up, occurrence key or cron admission
was rewritten. Account CSV reader containment is owned by the coordinator in a
separate worktree; it is not changed or claimed verified here.

The modal keeps rows/destinations under the current session data identity. Starting
a scan, closing/reopening, actor withdrawal and confirmation failure discard prior
financial state. Epoch and operation-lifetime checks reject older callbacks.
Reopen always scans anew; failed rescans cannot leave prior names/amounts/accounts
on screen. Mounted tests cover those paths plus a late scan response and a failed
confirmation. Protected SQL contention tests cover processing-time grant, source
privacy/currency and destination currency; ordinary ledger GET and rule GET/history/
upcoming follow both signed and trusted materialization. These new source repairs
and added controls still need fresh coordinator check/GREEN and independent review.

### Explicit denomination evidence and recovery, November 2

The source preservation checkpoint is `cbf78ea2`; it deliberately retained the
remaining manual/legacy inference gap for review. Test-only `78f5c94f` freezes 13
actual signed/trusted controls in
`server/modules/recurring/__tests__/completion-r04.recurring-denomination.realdb.integration.test.ts`.
These are not reported as executed here. The coordinator owns the protected run.

A current ZMW destination or household does not prove an old rule amount's unit.
Both financial materialization paths now require a persisted internal
`denomination_confirmed_v1` receipt. It records exactly version, currency, amount,
accountId and source. The amount is normalized using Money's storage format;
the receipt must still match the current amount and account. The latest receipt
is selected in SQL at the caller's snapshot and fails closed for malformed,
unsupported or mismatched evidence. No legacy backfill or account inference occurs.
Complete suggested-source audience/provenance remains a separate requirement;
currency evidence never grants access through a broken or private origin.

`verifiedRecurringCurrencySql({ id, amount, accountId })` from
`server/services/recurring/RecurringDenomination.ts` is a composable nullable
ZMW scalar for a reader's existing query/alias. It does not apply recipient
audience; the reader must do so before LIMIT/aggregation. The convenience getter
`getVerifiedRecurringRuleCurrency(id, householdId, tx?)` uses the same expression.
Both are re-exported from RecurringPatternProvenance for the digest owner.
The original `pattern_origin_v1.currency` retains the complete detected input
unit, while the dedicated receipt also binds the current rule definition.

Safe confirmation writes its receipt within the atomic confirmation transaction.
The sole production manual-create caller, the signed CRUD controller, preserves
the explicitly validated amount DTO currency through the service boundary. A
fresh grant, visible destination, household and authored references are checked
and held while writing the manual rule and receipt in one serializable transaction.
Unsupported units are actionable refusals. The old three-argument service caller
still creates an unproven rule; it cannot manufacture financial currency proof.

Legacy recovery uses existing signed PUT with `confirmDenomination: true` and an
explicit positive `{ amount, currency: "ZMW" }`. The form clears the old number
when the user selects confirmation and requires a new entry. This attests the
new intended amount; it performs no conversion of an old USD or unknown amount.
Ordinary legacy edits remain unproven. Known-unit amount/destination edits carry
the verified unit only after the locked destination/household checks. Internal
receipts are excluded before public history pagination. The trusted helper
`recordRecurringDenomination(tx, rule, explicitCurrency, performedBy, source)`
requires the caller to supply known evidence under the definition lock; processing
never issues a receipt. Existing synthetic positive rollback/concurrency fixtures
explicitly attest their authored ZMW amount without changing their old arithmetic
or atomicity assertions; the separate new suite preserves unproven legacy controls.

Multi-currency rule/link/summary representation, FX, schema work, old source-derived
writers without a receipt, and shared household scheduling remain open. Such
unproven templates have the same explicit manual recovery path. Neither this
candidate nor fixture calibration establishes comprehensive currency readiness.

### Held f17ebaec follow-up: casing, invalidation, pointers and observed recovery

Independent TypeScript/source review held `f17ebaec` for five concrete defects.
It remains preserved. Test-only `e025e532` freezes the requested regressions;
`4961f760` corrected the new DTO oracle and observation fixture, and `77e1eafe`
adds explicit signed/service recovery after invalidation. `9d134e6d` additionally
pins an aliased SQL reader for the positive-proof defect below. All retain the
old product source. The dedicated denomination suite now contains 27 cases;
the mounted edit suite contains two. No worker-run execution or compiler result
is claimed for these commits.

Coordinator execution at `4961f760` passed 10/26 server cases and failed 16/26;
mounted UI passed 1/2. Raw receipts in capital-checkpoint-tests-nov02 are
`.local/r04-recur-denomred08l/server.log` and
`.local/r04-ui-denomui08l/client.log`; database postflight reported
`pfa_completion_scope_denomred08l_test|0|0|0|0|0|0`. Positive manual authoring and
explicit recovery also returned NULL currency proof, preventing several tests
from reaching their later guard/posting assertions. Those failures are preserved,
not treated as isolated evidence for every downstream path.

Installed Drizzle PgDialect.buildSelection strips qualification from direct
PgColumn chunks in a single-table selected SQL expression. The receipt scalar's
outer rule id thereby became unqualified `id` inside the receipt subquery,
silently binding receipt.id. The repair nests each correlated column in SQL so
default and aliased rule references retain their qualification. Existing genuine
positive getter/authoring/recovery controls remain intact, plus the new actual
aliased SQL-reader regression. Fresh protected execution is still required.

PUT normalizes the rule and proposed destination UUIDs before looking up held
currency/account facts; the proof map is keyed by the actual locked row ID.
Both signed HTTP and the existing service caller retain uppercase-ID positive
controls and refuse a supplied unsupported unit for a proven rule.

An unproven monetary-definition edit records `denomination_invalidated_v1`
atomically with the edit. The composable currency SQL selects the latest proof
or invalidation event. Returning from an unaccompanied 9.50 change to an older
7.25 value cannot resurrect its old receipt. Explicit subsequent recovery can
issue new proof, while ordinary legacy edits stay unproven. Both internal event
types are excluded before public history LIMIT. Raw DB writes bypassing every
application contract are not certified as an automatically audited migration.

The read-only caller reconciliation used canonical `e6419085`: normal signed
POST transactions retain `recurringTransactionId` in transaction/create, and
autoLinkNewTransaction returns early for that pointer/isRecurring. The repository
uses withRecurringParentForCreate to hold the parent during the actual insert.
Consequently, real pointer-only rows are part of rule provenance even without a
link/history row. Rule audience SQL now excludes inaccessible direct pointers
before dry-run selection/counts. The locked source union includes all direct
pointers before globally sorted source/account locks. Trusted materialization
therefore inherits their actual privacy owner or refuses ambiguous ownership.
New controls create a pointer through the actual signed route, assert no link,
model a subsequent private transition, and exercise peer denial, trusted ledger
privacy and SQL-observed source contention. No normal transaction producer or
replay source was edited.

Signed rule reads now return `verifiedCurrency` from the same SQL snapshot and
`definitionToken`, a stable hash of all stored definition fields including revision
and destination. Explicit recovery must supply that observed token, which is
checked against the locked current rule before any edit/history/audit. Account,
amount or schedule changes require reloading and entering the amount again; the
form never sends an old account as part of recovery. Failed recovery clears its
pending assertion and refreshes the list before reopening.

The edit modal does not accept the old rule MoneyDto's default ZMW as proof.
Unknown units show “Currency unconfirmed”; amount editing is disabled until the
user explicitly selects confirmation, which clears the old number. Normal edits
omit an unconfirmed amount. This fixes the bounded editing path while preserving
the old DTO compatibility shape: blanking the currency globally would break
existing Intl currency formatting in unrelated recurring displays. General rule,
summary and link currency representation remains part of the already-open
coordinated multi-currency contract. Account/FX/digest code was not changed.

### Canceled edit-save callback ownership

Test-only `22ca91c8` mounts the actual useRecurringPageData caller with the real
edit modal. Four controls cover late success/error from canceled save A after
opening a different rule or reopening the same rule; they preserve the new B
draft and its eventual payload. Two active-completion controls retain successful
close and current recovery-error refresh behavior. Only API/settings hooks are
substituted. The repair versions edit openings, closings, save attempts and
unmounts; callbacks may affect form state only while their exact edit/save version
remains current. No row ID equality is used as an edit-session identity.

The coordinator subsequently reported pinned check passed at `865a265f`, mounted
suites 11/11 and all 27 denomination cases passed. Its 22-suite database run was
500/510; ten older compatibility failures remain under adjudication. The new six
save-context controls were independently run by the coordinator: 4/6 failed at
`22ca91c8`, then 6/6 passed at `e597a7ce`, with receipts in
capital-checkpoint-tests-nov02 `.local/r04-ui-cancelold09h/client.log` and
`.local/r04-ui-cancelfix09h/client.log`. This worker ran no tests.

### Compatibility adjudication after recproof09a

The full raw log `.local/r04-rec-recproof09a/server.log` in this owned worktree
records 500/510 across 22 recurring suites at `865a265f`. Postflight was
`pfa_completion_scope_recproof09a_test|0|0|1|1|1|0`; it is retained as non-clean,
not reclassified as an empty target. No cleanup-error line was found in that log;
the coordinator owns target diagnosis and any further protected execution.

Test-only `a50ba51` precedes the compatibility source change. Its adjudication is:

- A foreign-household transaction's bare reverse UUID is not provenance owned by
  this rule's household. Counting it was a real regression: it could block valid
  reads/lifecycle and trusted posting. Reverse-pointer selection and discovery
  are now limited to the rule household. Explicit links, original markers and
  history remain fully validated; same-household private pointers remain enforced.
  Existing foreign-pointer deletion retains its 200/unchanged-foreign-row contract.
  Two new controls prove foreign-only read/pause/resume/trusted processing remains
  valid and coexisting same-household private provenance still denies peers.
- The two unlink positives removed private synthetic link rows while leaving
  their direct pointers on the shared rule. Their helper now detaches both
  representations and proves the target readable before unlink. The owner and
  selected-survivor cases retain their intended private facts; no audience guard
  or denial assertion is removed.
- Three raw-history count assumptions predated the new internal events. Tests
  now verify the exact original created/updated business lineage, independently
  assert the exact denomination receipt or invalidation, and exercise ordinary
  history with LIMIT to ensure internal events never displace public lineage.
- Old confirmation positives fabricated one/two-source 2024 previews with unknown
  stored currency. They now seed three current dated ZMW sources, call the actual
  signed detector and confirm its returned selection, then verify complete links,
  counts and authorized GET. Old unsupported one/two-source low-confidence legacy
  requests remain executable rescan denials with unchanged rule/link/history,
  source, balance and audit snapshots. Their failed 201 assumptions remain in
  `865a265f` and recproof09a.
- The old authorization request used invalid minOccurrences=1/threshold=0 and one
  out-of-window foreign row. It now proves eligible own and foreign groups under
  valid options, verifies the foreign user's real preview, and excludes the
  foreign group's names and all IDs from the primary user's actual response.

The focused denomination suite is now 29 cases. These corrected callers and the
two-line household isolation repair still need fresh protected execution and
independent source review. No schema, account/FX, normal-create/replay or cron
admission/arithmetic change is included.

### Older route-controller mock reconciliation

After the coordinator's cleanup/sentinel run passed with a clean marked target,
it found two older failures in `server/routes/__tests__/recurring.integration.test.ts`.
They are obsolete mock contracts: known-unit detection mocks omitted currency
but expected ZMW, and confirmation expected a controller-owned post-commit audit.
The actual detector provides explicit known currency or empty currency with an
actionable issue; the controller preserves it. Known-unit mocks now declare ZMW,
and three empty/null/missing mock-unit controls prevent a fallback being restored.

The actual atomic confirmation helper calls logCreate with its serializable
transaction; the controller passes the verified actor and request IP and must not
append another audit after commit. The route test now asserts that forwarding and
the absence of a duplicate controller audit. It uses a complete three-contributor
selector instead of an unsupported old two-sample preview.

Real signed owner/admin/member confirmation controls use a passthrough audit spy,
require exactly one transaction-bearing call and exactly one persisted CREATE row
after the successful response, and keep authorized rule GET/source/link/count
assertions. The audit-failure control now performs the real audit INSERT before
throwing, then requires the complete pre-request persistence snapshot, including
audit, to be unchanged. This establishes the required committed/rollback behavior
through actual routes rather than treating a mocked service as financial proof.
These test-only changes require the coordinator's focused run; no production
controller, detector, audit service or authorization protection was modified.
