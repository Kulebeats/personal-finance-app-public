# C3-06 occurrence and reference-price schema contract — DRAFT

14 November 2026, Africa/Lusaka. Source prerequisite: `133b113403818489b48b404fdc6ca989b567749e`, including the not-yet-integrated C3-08 dependency. This document records the reviewed technical contract and remaining held clauses. It is not an assessment/status authority, executable DDL or evidence of working behavior. Main retains acceptance, integration and every test window. Main accepted the meaningful signed 12-case RED and relevant scoped contract reviews and reserved `0029_c306_sip_occurrences.sql` for this lead. Settled occurrence/proof/helper/backend/client and explicitly selected shared-calendar source preparation is released; exact SQL review and Main dispatch still precede DDL. Price schema is excluded from 0029 and remains separately held.

The approved parallel plan and the master specification govern. The owner requires a final broker statement before recording, each actual fill as a separate purchase with its own date/quantity/price/fees, final partial and zero-fill closure, unchanged future plan economics, no invented facts or fee allocation, and deletion of extra execution references on erasure. Exactly the existing seven proof columns may survive with the existing financial records. No broker execution or cash debit is performed by this workflow.

## 1. Draft file boundary

- Lead: new migration and its metadata when allocated; `shared/schema.ts`; `shared/sip-authorization-schema.ts`; new `shared/sip-occurrence-schema.ts`, `shared/security-price-override-schema.ts`, `shared/sip-occurrence-contract.ts`; new `server/services/investment/sipFillProofContract.ts`; new contract/storage fixtures.
- Backend worker: new occurrence service/controller/router modules and signed confirmation suites; assigned existing `processDueInvestments.ts`, `recordSipPurchase.ts`, `sipExecutionAuthorization.ts` and `settings.account-deletion.sip.ts` after product gates clear.
- Client worker: occurrence API/hook/components/tests; assigned existing recurring hook/types/Setup/Details and `RecurringInvestment.recovery.test.tsx` after contract freeze. Preserve every existing recovery oracle.
- Main Sol: shared investments service/router wiring and all global-price APIs/readers/writers. This draft supplies their schema rather than competing implementations.

At the original draft checkpoint all application/test source was unchanged; later test/source commits must be identified separately. New and existing caller suites require Main's explicit execution schedule. The accepted signed baseline reproduced eleven intended product failures and one passing control, without skipped cases. That bounded evidence does not prove new source behavior. Exact schema review precedes any DDL application or generated metadata registration.

## 2. Durable fence with no extra retained metadata

Proposed table `investment_sip_occurrence_fences` has exactly three columns:

| Column | Type / rule |
| --- | --- |
| `plan_id` | UUID, not null; FK to existing recurring plan, cascade only with legitimate plan/household deletion |
| `original_due_date` | Date, not null; a real finite calendar date |
| `terminal` | Boolean, not null, initially false; false may become true exactly once |

Primary key: `(plan_id, original_due_date)`. Grant revision, operation key and actor are deliberately absent from occurrence identity. Reconfirmation cannot create another occurrence for an already used date. No actor, batch, outcome, monetary amount, instrument, custody, creation/closure time or JSON is retained in this fence.

Fence deletion is denied while its plan survives, except through a separately reviewed legitimate financial-data deletion path. A terminal fence cannot revert or acquire a new operational occurrence. Pending materialization, immutable snapshot insertion and original-anchor cursor advance commit together. Terminal transition requires a complete confirmation, all required fill effects/proofs/audits and the closure audit in the same transaction. Operational purge never clears terminal state. Zero-fill closure uses the same fence with no fabricated purchase/proof.

This minimal surviving marker prevents reopening. After a completed confirmation's operational purge it does not prove outcome, fill count, completeness, total amount or the reason for closure. The fence-only survival rule applies to completed confirmation data; still-pending actorless snapshots remain household plan state as specified below.

**Custody resolution required by Astra:** enforce the plan's `id`, `household_id` and `account_id` as immutable for the entire surviving fence lifetime. A new BEFORE UPDATE guard on `recurring_investments` rejects changes to any of those fields whenever a fence exists for the old plan ID. Materialization already holds the plan FOR UPDATE through first fence insertion, so a competing custody update cannot race first materialization. Fence identities themselves cannot change, cannot be truncated, and cannot be deleted while the parent plan survives. Legitimate parent deletion removes the fence; it does not reassign it.

The complete current production writer search found only plan creation, authorization pointer/revision updates, deactivation, erasure pointer clearing, cursor advancement and household deletion. None changes an existing plan's custody/household/ID. The public recurring router has create/read/authorize/deactivate and no source-edit route. This observation supports compatibility, but does not substitute for the new SQL guard: source convention alone cannot prove retained-lifetime immutability.

Before listing a fence or returning a distinctive terminal conflict, authorize current signed identity, membership, capability and visible nondeleted custody through that immutable parent. Never authorize the historical fence using a replacement account. If the exact guard is absent/unproved or the source cannot be established, omit the fence and use indistinguishable invisible-resource failure. Store no additional custody column in the fence to solve this.

## 3. Operational occurrence snapshot

Proposed `investment_sip_occurrences` uses `(plan_id, original_due_date)` as its primary key and composite FK to the fence. It is household plan state while pending and completed-confirmation operational data after closure; it is never an additional retained authorization proof.

| Column | Type / rule |
| --- | --- |
| `plan_id`, `original_due_date` | UUID/date identity above |
| `household_id` | UUID, not null; same household as the actual plan; household cascade |
| `account_id`, `security_id` | Non-null UUID snapshot identifiers; source existence/visibility rechecked under locks, never replaced with current plan identifiers |
| `planned_amount` | Numeric(15,2), finite, positive, from the actual authorized schedule |
| `currency` | Three uppercase letters; authoritative instrument denomination must match at materialization and confirmation |
| `authorized_frequency` | Existing frequency enum; materialization supports the existing eight calendar frequencies, never the custom fallback |
| `authorized_initial_date` | Finite date copied from attributable schedule authorization, not inferred from advanced cursor/history |
| `occurrence_revision` | Integer, initially 0; immutable snapshot and one final closure allow only the reviewed 0-to-1 transition |
| `state` | `pending` or `closed`, consistent with revision and fence |
| `recorded_at` | Database timestamptz; operational only |

Use composite plan/household integrity and index `(household_id, plan_id, original_due_date)`. Do not add foreign keys that silently rewrite immutable snapshot source identifiers on custody/instrument changes. Missing/deleted/private sources produce authorized omission or bounded refusal. A current standing v1 grant may establish the schedule snapshot; it never establishes actual fill evidence. Legacy plans without attributable schedule authorization stay held until the existing explicit authorization path supplies it.

Repeated ticks return held/pending rather than purchase success, write no BUY/lot/proof/cash or legacy success log, and do not advance twice. Existing due-today discovery can remain bounded here; overdue catch-up and household-local scheduler behavior remain separately open under priority item 12. Materialized pending rows are discoverable independently of the plan's advanced cursor.

Frozen lifecycle: an existing pending occurrence remains confirmable after ordinary plan deactivation/reconfirmation, using a newly authorized current signer and the original snapshot. Deactivation stops new materialization. On erasure, retain the still-pending actorless immutable snapshot as household plan state; delete old operational grants/replay material and stop affected future materialization. Pending state contains no authority. Any later confirmation needs a fresh eligible signed actor and original custody visibility. Do not add a schedule-author pointer, infer an author from a replacement grant, invent cancellation/unfilled/terminal state, or replace pending details with an unusable false-terminal fence. Last-household deletion still cascades. This is Main's explicit technical disposition following Astra review.

## 4. Operational confirmation receipt

Proposed `investment_sip_confirmations`:

| Column | Type / rule |
| --- | --- |
| `id` | UUID primary key, server generated; operational only |
| `household_id`, `actor_user_id`, `operation_id` | UUIDs, not null; unique operation identity `(household_id, actor_user_id, operation_id)` |
| `plan_id`, `original_due_date` | Unique composite occurrence identity, scoped to the same household and snapshot |
| `expected_occurrence_revision` | Integer 0 for the pending snapshot accepted by this command |
| `request_version` | Smallint 1 for the command format; distinct from proof version |
| `request_digest` | 64 lowercase hex characters; canonical closure/economic intent only |
| `outcome` | `filled`, `partially_filled` or `unfilled`; never inferred from plan amount |
| `fill_count` | Integer 0 through 100; zero iff outcome is `unfilled` |
| `broker_reference` | Nullable operational text; optional supplied reference only, excluded from every hash |
| `authorized_at` | Actual database timestamptz of this signed confirmation, copied to each proof without a JS Date round trip |
| `confirmation_cutoff_date` | Derived only from that same database-authored instant and the locked chosen household zone; operational and purged with the receipt |
| `security_generation` | Current captured credential generation; operational only |

No original request body, SID, IP, user agent, broker document or extra retained confirmer identity is needed. Store the optional reference only here. Frozen representation: omitted means SQL NULL; supplied null, empty, whitespace-only or malformed Unicode is invalid; at most 200 Unicode code points; preserve other supplied text byte-for-byte, without trimming, normalization or case folding. Reject NUL as unsupported PostgreSQL text. Validation/conflict errors never echo the reference.

The operational request digest binds complete intent: command contract/action, request version, authenticated household and natural plan/date path, expected occurrence revision, final-statement acknowledgment, explicit outcome, snapshot currency and each ordered normalized fill's date/quantity/price/fees. It is not merely an economics digest. It excludes the reference entirely. Replay compares both that digest and nullable raw-reference equality separately, using exact valid-Unicode string/UTF-8 byte equality rather than collation-based normalization. Changing the reference therefore conflicts without hashing it. Never copy the reference to acknowledgments, notes, audits, logs, errors, retained proofs or other digests.

The current actual signed actor must have financial.write and visible, nondeleted original custody. Supported owner/admin/member roles do not widen private-account visibility. Authorize the original receipt/source before revealing changed-intent conflicts. Original standing-grant author, current plan pointer and current cursor are not substitutes for current signed confirmation authority.

## 5. One operational reservation per fill

Proposed `investment_sip_confirmed_fills` combines the ordered fill binding and INSERT-origin reservation:

| Column | Type / rule |
| --- | --- |
| `confirmation_id`, `fill_index` | UUID/integer composite primary key; indices are 0 through `fill_count - 1` |
| `purchase_id` | UUID, unique; FK to actual investment BUY, deferrable initially deferred |
| `execution_date` | Finite actual calendar date; no invented equality with scheduled date |
| `quantity` | Numeric(18,8), positive, strictly below 10^10 |
| `price` | Numeric(15,4), positive, strictly below 10^11 |
| `fees` | Numeric(15,2), explicitly supplied and nonnegative |
| `amount` | Numeric(15,2), nonnegative, equal to round-half-up(quantity × price,2) + fees |
| `creation_xid` | Text forced from the actual inserting transaction, not caller supplied |
| `posting_confirmed` | Boolean forced false; only the genuine subsequent matching BUY INSERT can seal it |

Reject malformed/excess-precision inputs before numeric coercion. Explicit zero fees are valid; blank fees are not. Preserve existing sub-cent BUY compatibility rather than imposing a plan-like positive-total condition silently. Both actual settlement and aggregate holding basis must remain inside supported storage bounds. Two identical legitimate fill rows have different indices/purchase IDs and remain two purchases/lots. Never deduplicate them by economics.

The reservation must precede a new BUY. It cannot adopt an already existing purchase through INSERT, UPDATE, delete/reinsert or savepoint manipulation. Its forced XID and sealed matching source/economics prevent a fabricated reservation from certifying an old record. Each BUY creates one lot with its own actual acquired date and amount basis. Existing holding/provenance/FX/FIFO/backdate checks run under the holding lock for every fill, with the existing first-holding custody lock and recheck preserved.

The full ordered batch, receipt, purchases, lots, mandatory actual-effect audits, proofs, closure audit and terminal transition commit atomically. Second-fill, audit, proof, receipt or closure failure rolls everything back. Deferred no-orphan/completeness checks must still work after early selective constraint flushing or attempted operational-row deletion. Purge admission checks completed closure before discarding its operational witness.

## 6. Seven-field proof v2 and legacy preservation

`investment_purchase_authorization_proofs` retains exactly:

`purchase_id`, `author_user_id`, `authorized_at`, `authorization_contract_version`, `authorized_frequency`, `authorized_initial_date`, `authorized_terms_digest`.

Broaden only the completed-proof version constraint to admit 1 and 2. Existing standing-grant version/kind constraints remain v1. Preserve all existing v1 rows, their digest interpretation, the historical migration and v1 guard function bodies. Never add a v2 proof to an old purchase or relabel an old standing grant.

Version-specific INSERT/UPDATE/DELETE trigger dispatch must retain every v1 admission/rejection behavior and reject cross-version mutation. A trigger function cannot be called as an ordinary SQL function from a dispatcher. An exact SQL candidate must show the trigger split or equivalent reviewed mechanism rather than silently rewriting v1 semantics. Existing proof/purchase immutability and truncate guards continue applying to v2.

Proposed deterministic v2 digest input, in exactly this order:

```text
[2,"record_only_sip_actual_fill",accountId,securityId,
 quantity8,price4,fees2,amount2,currency,executionDate,
 authorizedFrequency,authorizedInitialDate,fxRate4OrNull,amountZmw2OrNull]
```

UUIDs are lowercase; currency uppercase; dates remain canonical date strings; decimal strings have the exact named scale, ordinary base-ten notation and no whitespace. Main froze SHA-256 over the compact JSON array's UTF-8 bytes, with lowercase hex output. This command supplies no FX evidence: every actual purchase writes `fx_rate=NULL` and `amount_zmw=NULL`, preserving existing SIP semantics, and both tuple positions are literal JSON null. Never substitute zero, one, empty text, a quote or an inferred conversion. The fixed v2 domain is `record_only_sip_actual_fill`.

The digest contains no broker reference or reference hash, operation/occurrence/plan/grant/batch UUID, request digest, SID, credential generation, personal text or new proof column. It can be recomputed from the retained purchase plus existing proof fields after every operational row is deleted. The purchase FK binds the proof to its actual BUY; equal economic digests for two legitimate identical fills are permitted.

The v2 proof insertion guard requires a genuinely newly inserted/sealed BUY, matching confirmation actor and exact database timestamp, immutable cadence/start, matching original custody/instrument/currency and actual economics, one matching lot and exactly one mandatory correctly scoped financial audit. Current verified, unerased identity, membership and captured generation are checked at creation; retained proofs never grant future authority.

Main froze truthful signed manual-BUY audit semantics for v2: actual current confirmer `userId`, private custody `householdId=null` or original shared household, action CREATE, entity type `investment_transaction`, entity ID actual purchase. `details.newValue` is exactly persisted `{type,accountId,holdingId,securityId,quantity,amount,currency,transactionDate,price,fees,feesDeclared:true}`. Do not use a null/system actor or copy IP, user agent, broker reference, operation/batch/occurrence/grant IDs. This existing financial audit's anonymized user link survives under the existing financial-record policy; it adds no proof column or new personal field. Preserve v1's separate system audit logic unchanged.

Every closure, including zero-fill, also requires an actor-only operational CREATE audit with current `userId`, `householdId=null`, entity type `investment_sip_confirmation`, receipt entity ID and exactly `{authorizationEvent:"sip_final_confirmation_v1",requestVersion:1}`. Command request v1 is distinct from proof v2. Purge this exact operational event family on confirmer erasure. Zero-fill creates no financial purchase audit or proof.

After erasure the proof demonstrates the recorded signed fill terms and attribution permitted by its seven fields. It does not independently verify a deleted broker statement, batch completeness or a zero-fill outcome.

## 7. Erasure, replay and read contracts

Discover all current/historical households from both existing v1 authorization/operation rows and new confirmation actors before destructive work. Lock household UUIDs in sorted order, then membership/identity/session state using existing ordering; rediscover under the identity lock and refuse an unbound newly discovered scope. Confirmation and erasure must serialize without a late authority write.

After marking the actual locked actor erased, collect their closed plan/date identities while confirmation receipts still exist. Purge those CLOSED operational occurrence parents and their confirmation/reference/request-digest/operation/fill-reservation children plus actor-only operational audit families across all historical households. Deleting receipt children alone would incorrectly leave closed snapshot economics/timestamps. Purge failure rolls back erasure. Preserve existing financial rows/ordinary allowed financial audits and exactly seven proof fields. Do not add broker/operation metadata to those surviving records. The only surviving scheduler state for these purged CLOSED confirmations is the three-column terminal fence. Still-PENDING actorless snapshots remain household plan state with no execution authority, as explicitly settled in section 3. Last-household deletion follows the existing financial dependency/cascade order.

Draft read DTO is a discriminated union:

- Detailed pending: plan/due identity, occurrence revision, immutable planned terms/custody/instrument, state and current permitted actions; no actual result invented.
- Detailed closed while authorized operational witness survives: immutable financial acknowledgment/result; current permissions remain separate from the immutable receipt.
- Minimal closed fence after operational purge: `{ planId, scheduledDate, state: "closed", detailsAvailable: false }`. No outcome, purchases array, totals, actor, revision, custody or instrument snapshot is implied.

Frozen retry behavior: current signed authority and original source authorization precede receipt comparison. Same operation plus identical complete-intent digest/raw reference returns the original immutable acknowledgment with no new effects. Changed intent returns 409. A different operation on a terminal occurrence returns 409. After purge, distinguish `OCCURRENCE_CLOSED_DETAILS_UNAVAILABLE` only after the current identity/member/capability and original immutable custody checks above; otherwise omit/fail invisibly. Never pretend that the original result/reference comparison remains available. A fresh minimal-fence read discards cached acknowledgments, retry intent and reference details; an older acknowledgment cannot restore erased details, authority, state or a standing grant. Do not copy the raw command/reference into TanStack mutation variables or another query/mutation cache: keep it in the owned command store with an opaque mutation token, or prove equivalent targeted eviction on closure/purge/retirement.

Frozen natural identity route: `POST /api/investments/recurring/:planId/occurrences/:scheduledDate/confirm`, with real canonical YYYY-MM-DD path validation and authenticated household/plan binding. List is `GET /api/investments/recurring/:planId/occurrences`. No disposable occurrence UUID is retained or needed. No route is implemented by this draft.

Command fields are `operationId`, `expectedRevision` (explicitly the occurrence revision, not the plan authorization revision), `finalStatement:true`, explicit `outcome`, optional `brokerReference` and ordered `fills` containing `executionDate`, `quantity`, `price`, `fees`. The 100-fill engineering cap rejects the complete unchanged request; it never truncates, averages or splits it.

Main froze the small wire exactly: list `{success:true,data:OccurrenceRead[],pagination:{hasMore,nextBefore}}`; query `state=all|pending|closed` (default all), limit 25/max 100, optional exclusive `before=YYYY-MM-DD`; scheduled date descending, authorized rows only and no total count. Detailed pending has identity, `state:"pending"`, `detailsAvailable:true`, `occurrenceRevision:0`, `planned:{accountId,securityId,amount,currency,authorizedFrequency,authorizedInitialDate}` and current `permittedActions`. Detailed closed has the same identity/planned terms, state closed, details available, revision 1 and `result:{outcome,fills,totals}`. Each fill has exactly `fillIndex,purchaseId,executionDate,quantity,price,fees,amount`; totals are exactly `grossAmount,fees,amount`. These are unsuffixed property names: their strings have quantity scale 8, price scale 4 and monetary scale 2. Positive quantity/price may round to amount zero; never infer unfilled from that. Enforce exact aggregate/holding bounds without JS number arithmetic.

Immutable acknowledgment is `{success:true,data:{requestVersion:1,operationId,occurrence:DetailedClosed}}`, with no reference, actor detail, changing plan state, current permissions or replay flag. Runtime decoding binds original operation/household context/natural path and exact ordered economics. GET does not expose operation IDs. The minimal closed-fence variant stays as defined above.

Safe errors use indexed validation fields such as `fills.1.quantity`, existing 400/401/403/404 conventions, and 409 CONFLICT reasons `OPERATION_INTENT_MISMATCH`, `OCCURRENCE_REVISION_CHANGED`, `OCCURRENCE_ALREADY_CLOSED`, `SOURCE_CHANGED`, `FIFO_HISTORY_CONFLICT`. The separate exact 409 code is `OCCURRENCE_CLOSED_DETAILS_UNAVAILABLE`, subject to original-custody authorization. No hidden values/reference are echoed. After that special refusal the client discards ownership, reference/draft and all detailed caches before refresh, without a purchase-success message; other uncertain retries retain their exact original body/key.

**Owner-selected calendar is settled.** Add nullable `households.time_zone` with no default/backfill, initially consumed by C3-06 only. GET `/api/investments/calendar` admits actual signed recognized current members, including read-only/Professional, and returns `{timeZone,configured,permittedActions}`. PUT accepts only an explicit named `timeZone` from the current locked owner, not a general household policy capability or admin. Lock household UPDATE first, then membership and actual credential/SID; reauthorize even a same-value no-op. Valid selection is consistently server normalized and supported by both Intl and PostgreSQL. Reject whitespace/control/NUL/numeric offsets; explicit UTC is a choice, never a fallback. Unsupported stored zones hold until owner correction. The shared insert schema excludes this policy field; current general household controllers do not forward it.

Changed selection and its mandatory audit commit together. Audit is actual owner/shared household, UPDATE `household_preferences` with household entity ID and only oldValue/newValue `{timeZone}`; use the raw audit service rather than its helper that automatically adds `changes`. Same normalized selection performs no update/audit. A new confirmation holds household SHARE through the transaction, reauthorizes actor/original custody, and derives all fill cutoffs from one DB-authored `authorized_at` plus chosen zone. Unset/unsupported yields 409 `HOUSEHOLD_CALENDAR_REQUIRED`, message `Confirmation is unavailable until the household calendar is configured.`, before any receipt/reservation/financial write. Existing receipt replay is authenticated and compared first, preserving original dates/result after a later zone change. Real pre-due dates remain allowed subject to FIFO; no guessed user/device/UTC date. List metadata is a hint only. Invalidate calendar/occurrence/household caches and use bounded focus/day-rollover refresh; never amend a draft's original retry dates. Existing UTC-only scheduler behavior remains priority item 12.

## 8. Household manual reference prices

Main's price owner requires an attributable, household-scoped immutable reference record. Proposed `household_security_price_overrides`:

| Column | Type / rule |
| --- | --- |
| `id` | Stable UUID primary key |
| `publication_sequence` | Database-generated bigint identity; immutable internal tie-break, not a client financial value |
| `household_id`, `security_id` | Non-null UUID FKs; household/instrument-scoped lookup |
| `currency` | Instrument-bound uppercase three-letter denomination, checked under instrument lock and again by resolver |
| `price` | Exact numeric(15,4), finite and positive; reject excessive input scale/range |
| `declared_price_scale` | Smallint 0 through 4, supplied decimal precision metadata without rounding |
| `as_of_date` | Actual explicit declared finite date, separate from recording time |
| `actor_user_id` | Server-attributed immutable actor under current owner/admin membership and signed identity |
| `source` | Literal `household_manual`, never provider provenance |
| `recorded_at` | Actual database timestamptz, never synthesized provider observation |

Proposed identity/ordering: immutable append-only versions, unique `(household_id, security_id, as_of_date, publication_sequence)` and index in that order with date/sequence descending. The generated monotonic sequence resolves same-date/same-clock ties without a mutable head or inferred last-writer timestamp. Stable UUID is the public selected source identity; do not expose a global sequence as a household activity count. Main must accept this versioning proposal before schema coding.

Only eligible own-household/date records can precede an attributable eligible global record. Source selection carries selected ID, source, as-of, scale and currency through comparison/publication. Instrument denomination changes cannot silently re-denominate an old override. Existing ambiguous global manual rows receive no invented household/actor/source. Ordinary members never create overrides; no household role writes global quotes. Price-authority and erasure handling for these override records remain with Main's price owner under the master; this draft does not invent a new retention policy.

## 9. Attributable global reference publication

Proposed additive `security_reference_quotes` avoids retrofitting provenance onto old `security_prices` rows. Proposed fields: stable UUID; immutable database publication sequence; instrument UUID; instrument-bound currency; numeric(15,4) price; declared scale; explicit provider source; attributable provider reference where actually supplied; actual provider observation date and optional actual observation instant; fetched-at and recorded-at instants kept distinct. Never synthesize observation time from fetch/write time.

Observation shape needs Main price-owner freeze: a provider that supplies only a calendar observation date must not acquire an invented intraday instant. Missing attributable observation makes the row ineligible for any use requiring that evidence. Publication of verified history and the shared current reference must be atomic; a nullable new selected-quote pointer on securities is one candidate, subject to exact source review. Preserve legacy global prices/history without laundering them into this new source type.

No numerical share-reference validity horizon is settled. The FX three-day policy is not reused. Main's resolver must keep missing/unsupported eligibility honest. This unresolved reference horizon cannot authorize SIP posting: every reference source, fresh or stale, still leaves purchases pending actual final confirmation.

## 10. Required review and evidence before integration

Main has frozen natural API identity, pending-after-pause/reconfirmation, actorless pending retention versus closed-snapshot erasure, optional reference handling, complete-intent operational digest, wire/pagination/error/acknowledgment, v2 manual audit, null-FX proof, private fence authorization and explicit owner-selected shared calendar. Main released settled source and reserved 0029 for occurrence/fence/v2 proof plus the reviewed nullable shared calendar. Exact SQL/mapping review, runtime resources and price provider observation/publication remain distinct gates. Price schema stays out of 0029. Independent exact schema review precedes Main-scheduled empty/populated rehearsal and generated metadata registration. Preserve old records byte-for-byte; no actor/proof/lot/source backfill or old-data inference. Current source/test checkpoints are unrun candidates; the independent acceptance/integration ledger remains Main's authority.

Required storage witnesses include v1 preservation and direct guard callers; exact seven-column proof shape; v2 new-INSERT origin including savepoints/selective constraint flushing; wrong actor/date/economics/fees/digest rejection; mandatory lot/audit; immutable proof/purchase; batch rollback and zero-fill closure; historical erasure/races/rollback; digest verification after operational purge; minimal fence no-reopen; household cascade; household price scope/provenance/version ties. Signed route, client, browser, full-server and nine-check evidence remain distinct and exclusively scheduled/adjudicated by Main.

No test result, product repair, migration application, canonical integration or campaign completion is claimed here.
