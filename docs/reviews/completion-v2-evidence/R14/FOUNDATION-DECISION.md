# R14 durable job storage and fence foundation — decision proposal

30 October 2026. Astra architecture checkpoint for parent adjudication.
Source baseline: `8e0d34c2b9ec4af58217186af93c6b9004c55480`.
Source-map SHA256: `7e0667a5454e518135436b0e8f72700591da0517b35c68d70cfd512d6fb3463a`.
Only this proposal was written. No source edits, Node/test/browser/application
process, SQL, database connection, provider call or migration application occurred.

## Proposed decision and deliverable

Implement one additive PostgreSQL due-item/attempt store, a pure required-producer
catalog, and a transaction-owning fence. Prove a complete synthetic journey:
enqueue -> concurrent claim -> fenced effect plus checkpoint/result -> continuation
or completion -> restart/readback. Include lease loss, rollback and conflicting
replay. This is a storage foundation, not a production runner or required-job
capability. Do not deliver only a catalog or token-returning helper.

Use **new `durable_job_items` and `durable_job_attempts` tables**, leaving the
existing generic `jobs` table, enum, service and runner unchanged. The existing
table has optional nonunique idempotency keys and no trustworthy scope/due identity,
lease or generation. Altering existing rows into the new contract would require
invented identities or an ambiguous mixed execution mode. No legacy backfill,
adoption, dual enqueue, automatic draining, or deletion is authorized in this slice.
Document the two stores' distinct roles; later producer integration must retire or
explicitly reconcile legacy paths, not run both for the same work.

Preserve scheduler/cron/recurring/financial/outbox/receipt/snapshot implementations,
startup/readiness admission, `assertRequiredJobCapabilities`, and the snapshot
profile refusals. New modules have no import-time timers, SQL, handlers or startup
registration. Neither a schema migration nor a successful synthetic witness changes
any current production guard. PostgreSQL provides coordination/effect authority;
Redis eviction or process-local state must not decide durable ownership.

Master R14 remains the full requirement: every named producer, authenticated external
trigger, deterministic due policy, bounded catch-up, actual fenced effects and
operational evidence. R08 money/posting and R19 deployment/observability remain
dependencies. No smaller product or optional-job reclassification is proposed.

## Required producer catalog, without invented policy

Create an immutable code-owned catalog with exact named entries below. These are
catalog identifiers, not automatically runnable job definitions. Capture source
references as strings; do not import effectful modules to populate the catalog.

| Required catalog key | Current source/trigger evidence; integration remains unsupported |
| --- | --- |
| recurring.materialize | cron `/recurring`; RecurringProcessingService |
| recurring.remind | cron `/recurring-reminders`; notification service |
| budget.rollover | cron `/budget-rollover`; budget service |
| budget.alerts | cron `/budget-alerts`; notification service |
| goals.status | cron `/goals-status`; goalStatusWorker |
| goals.deadlines | cron `/goals-deadlines`; goalReminderWorker |
| goals.weekly-report | cron `/goals-weekly`; goalReminderWorker |
| snapshots.daily | cron `/snapshots`; snapshotWorker; profile lock refusal remains |
| market.fx-refresh | cron `/market-data`; MarketDataService.updateFXRates |
| market.price-refresh | same trigger; MarketDataService.updateSecurityPrices |
| market.price-alerts | same trigger; PriceAlertService.checkPriceAlerts |
| market.stale-price-alerts | same trigger; PriceAlertService.checkStalePrices |
| investments.recurring-purchase | cron `/investment-automation`; processDueInvestments |
| investments.tbill-maturity | same trigger; processTBillMaturities |
| grz.coupon-due | existing GRZ schedule/payment surface; no admitted durable automatic producer established |
| grz.bond-maturity | master required maturity family; no admitted automatic producer established |
| outbox.dispatch | core/events/processor; security notices retain their separate dispatch contract |
| receipts.match | jobs/receiptMatcher -> receipt matching queue |
| receipts.retry | receipt/matching.service retry path; separately visible retry obligation |
| recap.weekly | scheduler weekly-recap -> processWeeklyRecapEmails |
| security.daily-report | scheduler daily-security-report |
| cleanup.notifications | scheduler notification-cleanup |
| cleanup.other-retention | legacy generic CLEANUP label and master cleanup family; concrete subproducers/policy unresolved |

Do not assert that this establishes every future subproducer. The closed family
coverage test must cover every master category and every currently mapped trigger.
An unresolved family is a visible unsupported entry, not an empty successful list.
Legacy JobTypes strings may be recorded as aliases, not used to rewrite old rows.
One route invoking several services maps to several obligations, not one boolean.

Each catalog entry has closed metadata: name, required-family, source references,
observed trigger description or null, effect category (`database`, `external`,
`mixed`, `unresolved`), and blockers. All production entries have
`integration: 'unsupported'` and `duePolicy: null` / `storageDefinition: null` until
separately reviewed. Blockers distinguish missing producer, unreviewed due/calendar
policy, missing fence integration and uncertain external delivery contract.

Observed existing cron strings are descriptive only. Do not choose a timezone,
month anchor, pause/end-date semantics, catch-up cutoff, maturity/FX rate, retention
duration, retry budget or financial action for a production entry. Those require
producer-specific policy. Null does not mean default UTC, three retries or skip.
Provide a pure diagnostic returning all unsupported required names; do not wire it
into existing startup/readiness or pretend its presence proves capability.

A separately constructed **test-only synthetic registry** supplies one fully
specified transactional witness definition. Production catalog entries cannot be
enabled by an environment flag, name match, arbitrary handler registration or SQL
row. The store requires a code-owned runnable definition for enqueue/claim; there
are no runnable production definitions in this slice. Test definitions live under
the owned test paths and are passed explicitly to the store in protected DB tests.
This injection is a repository testing interface, never an admission credential.
The foundation constructor rejects runnable definitions whose names collide with
any unsupported required-catalog entry. Use a reserved `fixture.r14.*` name for
the witness. Validate and snapshot the definition/policy at construction; caller
mutation must not alter a live store's identity, retry or eligibility checks.

## Stable identity and immutable request contract

Public typed input is closed and validated before SQL:

```text
DueItemRequest = {
  jobName, definitionVersion,
  scope: Global | Household | User | HouseholdResource,
  due: { kind: 'business-date' | 'period' | 'event', key: string },
  dueAt: canonical UTC instant,
  payload: validated JSON
}
```

Scope variants contain only their required fields: global has no ID; household has
householdId; user has userId; household-resource has householdId, resourceType and
resourceId. UUIDs use one canonical lowercase spelling. Resource type is an
allowlisted definition value. These IDs establish identity, not authorization or
proof that a subject is still active. Financial writers must later reauthorize and
lock their actual subjects. No FK cascade may silently erase due history here.

The unique natural identity is `(job_name, scope_key, due_kind, due_key)`, with
non-null byte-bounded columns and deterministic case-sensitive equality. scope_key
is a specified fixed-field canonical serialization of the validated scope; retain
its structured value for diagnostics. due.key comes from the reviewed definition,
not Date.now(), enqueue time, retry count, a random invocation ID or a caller's
future asOfDate. The witness uses ordered synthetic event keys, not financial dates.

Definition/policy versions and payload hashes are deliberately **not** unique-key
components: changing them cannot create a second item for the same economic due
identity. They are immutable request data checked for conflicts. A production
semantic change needs an explicit migration/reconciliation policy, not a version
suffix that silently authorizes duplicate effects.

Canonicalize validated payload JSON with sorted object keys, preserved array order,
bounded depth/bytes and only supported JSON scalars. The synthetic definition uses
safe integers and strings; future monetary values must use the approved exact
decimal contract. Reject undefined, nonfinite values, unsupported objects and
invalid input rather than silently dropping fields. Persist canonical payload text
and its SHA256; compare both on replay. Never trust caller-supplied digests.

`enqueue` atomically inserts or returns the existing item at **any** state,
including success/dead/unknown. Compare exact immutable request, original dueAt,
definition version and the stored operational-policy snapshot. A mismatch is
`DUE_IDENTITY_CONFLICT` with no write or reset. Mutable retry-ready times/checkpoints
are not part of this comparison. Terminal rows are not re-enqueued under the same
identity, and no deletion/pruning API is added.

Use INSERT ON CONFLICT DO NOTHING RETURNING, followed by a separate SELECT in the
same READ COMMITTED transaction if necessary. Do not rely on a same-statement CTE
SELECT seeing an uncommitted conflicting insert's row. Handle transaction failures
explicitly; never convert conflict/serialization failure into successful enqueue.

## Additive data model

`durable_job_items` contains:

- UUID id; immutable identity fields and canonical scope; original dueAt;
  definition version; canonical payload text/hash; immutable validated operational
  policy snapshot/hash; DB-created timestamps.
- State `queued | running | retry_wait | succeeded | dead | outcome_unknown`;
  DB-clock readyAt; generation bigint; claim token UUID or null; opaque workerId or
  null; claimedAt/leaseUntil or null; claim count and failure count.
- Checkpoint JSON plus monotonic checkpointVersion; accumulated result JSON;
  last classified error code; lastAttemptAt, lastSucceededAt and terminalAt.
  Checkpoint/result schemas are definition-specific; arbitrary JSON is insufficient.

`durable_job_attempts` contains itemId, generation, token, workerId, claim time,
last lease time, finished time and outcome
`running | yielded | succeeded | retryable_failed | permanent_failed | expired | unknown`,
plus classified error code and checkpoint versions before/after. Unique constraints
on `(item_id, generation)` and `(item_id, token)` prevent ambiguous ownership. Keep
every claimed attempt. Expiry processing atomically finalizes the old attempt,
consumes one failure, and moves the item to retry_wait with its explicit backoff
(or to dead if the failure budget is exhausted). It creates no new attempt.
Only a subsequent eligible claim creates the next generation, fresh token and
new attempt atomically, preserving that backoff. Do not overwrite prior failure
history with the latest message.

Use timestamptz and database clock for authority. Generation uses bigint safely
end-to-end (decimal string or bigint), never lossy JS Number. Reject exhaustion;
tokens are new random UUIDs on every claim, never reused on renewal/reclaim.
Worker IDs are diagnostic opaque values, not permission. Do not log tokens/payloads.

Add DB checks for state/claim-field consistency, positive policy bounds, nonnegative
counters, generation/attempt identity, JSON/container/size bounds, valid digest
shapes and terminal timestamps. All tokens/lease owner fields are null outside
running; terminal outcomes are retained. Attempts retain their own token history.
Use indexed ready selection and indexed running lease expiry; no table scan or
client-clock selection is the designed claim path. No raw free-form error stack,
credentials or recipient data belongs in failure codes.

Operational hard ceilings for this foundation: claim selection <=100 rows, payload
64 KiB, checkpoint/result 16 KiB each, JSON depth16, identity tuple <=1 KiB, workerId
128 bytes, error code96 ASCII characters, definition name96 bytes. Policy requires
explicit lease duration (100 ms..5 minutes), maximum claim lifetime (at most15
minutes and no shorter than the lease duration), retry-failure limit (1..10), and
an explicit bounded delay sequence (each 0..1 hour, at most9 retry delays).
These are storage safety ceilings, not production
defaults. The witness supplies its own small policy; no required producer inherits it.

## Public store and fence interfaces

```text
createDurableJobStore(dbExecutor, runnableDefinitions) -> DurableJobStore
store.enqueue(request) -> { kind: 'inserted' | 'existing', item }
store.claimReady({ jobNames, workerId, limit })
  -> { claims, expiredToDead, visitedCount, moreEligible }
store.renew(claim) -> { kind: 'renewed', leaseUntil } | { kind: 'stale' }
store.recordFailure(claim, classifiedKnownFailure)
  -> { kind: 'retry_wait' | 'dead' | 'stale' }
store.holdUnknown(claim, closedReason)
  -> { kind: 'outcome_unknown' | 'stale' }
store.withClaimedTransaction(claim, async (tx: TransactionType, fence: JobFence)
  -> { kind: 'complete', result, processedCount }
   | { kind: 'yield', checkpoint, result, processedCount })
  -> committed transition | stale/refused/unconfirmed error
assertJobFence(tx: TransactionType, fence: JobFence) -> Promise<locked current item>
store.readByIdentity(identity) / store.listStatus(boundedFilterAndCursor)
```

Claim is an immutable value containing itemId, generation and token. It is neither
a reusable SQL transaction nor proof the lease is still valid. The repository
derives payload/policy from the locked row; caller-mutated copies cannot change the
effect input. Validate active definition/version/policy against the code registry
at every admission, including rows inserted by an older binary. Unknown definitions
or mismatches are unsupported diagnostics, never arbitrary handler execution.

The store owns its transactions and uses the existing protected Drizzle executor;
it never creates a new pool, URL or ambient database configuration. TransactionType
is the existing server/utils/withTransaction type. `assertJobFence` accepts only the
same transaction object and genuine live private fence created inside
withClaimedTransaction, and performs a fresh database-time ownership check under
the retained lock. A WeakMap or equivalent private closure binds fence to tx,
item and claim; revoke it in finally. JSON/structural clones, another transaction,
and post-callback use refuse. This is in-process lifetime enforcement, not a
production capability/admission brand.

No exported `complete(jobId)` bypass exists. No primitive consisting only of a
pre-work ownership query is called a fence. There is no outside-transaction
checkpoint writer or financial repository adapter in this slice.

## Claim, renewal and retry transitions

Use short READ COMMITTED transactions with SELECT FOR UPDATE SKIP LOCKED, a stable
readyAt/dueAt/id ordering and bounded candidate count. Accepted job names must be
runnable definitions; do not allow a caller to claim unsupported production names.
After acquiring each row lock, obtain a **fresh** clock_timestamp and re-evaluate
state, readyAt, lease and policy. transaction_timestamp/now frozen at transaction
start and any timestamp sampled before waiting are not lease authority.

- queued/retry_wait and readyAt <= DB now: set running, increment generation and
  claim count, create fresh token and attempt, set claimedAt and leaseUntil from DB
  now, and return the claim only after commit.
- running with leaseUntil > DB now: never claim. At equality it is expired.
- expired running: finish its attempt once as expired and consume one failure.
  If budget is exhausted, atomically make item dead with no new claim. Otherwise
  move it to retry_wait with the explicit backoff from the fresh DB timestamp;
  a subsequent eligible claim creates a new generation/token. Reclaim is not an
  immediate loop that bypasses the configured backoff.
- renewal: lock and recheck exact token/generation/state and lease > fresh DB now.
  Never resurrect an expired claim merely because no new worker has taken it.
  Extend without shortening, capped by claimedAt + maximum claim lifetime. If the
  cap is already reached, refuse renewal. Persist the matching attempt heartbeat
  in the same transaction. A successful heartbeat alone grants no effect authority.
- known retryable failure: after proven rollback/no committed effect, lock/check
  the current unexpired claim, finish the attempt, consume one failure, and move
  to retry_wait or dead. A permanent failure goes directly to dead. A stale failure
  changes neither the item nor attempt. Use closed registered codes, not error-text
  parsing or catch-all automatic retry.

Claim count/generation records all ownership grants. Failure count consumes a
bounded **retry** allowance; a successful continuation/yield does not consume it.
This prevents large legitimate backlogs exhausting their retry budget merely by
processing more than one chunk. Keep the chosen semantics explicit in names/tests;
do not use one ambiguous attempts field for both concepts.

Each claimReady call visits at most its requested limit<=100, including expired
rows finalized without a new claim. No hidden unlimited loop to fill the batch.
moreEligible is a truthful snapshot/hint, not permission to discard durable rows or
promise no locked work exists. Running/locked work remains discoverable in status.
Do not hold many future-work leases while a sequential worker processes a long
batch; a future runner must claim only its available concurrency. No runner here.

## Transactional fence, completion and durable continuation

withClaimedTransaction opens one transaction, locks the item, gets fresh DB time,
checks exact ownership/unexpired lease/current definition, and then invokes the
internal operation with tx, the private fence and persisted immutable input. Hold
the job row lock until commit/rollback. A competing reclaimer must skip or wait;
it cannot advance the generation while the effect transaction is active.

The synthetic operation writes only its owned fixture effects using that tx.
It must call assertJobFence with the same tx before writes; a later financial writer
must actually consume that fence and the same tx, not obtain a global db handle.
No HTTP/mail/provider call, arbitrary external side effect, nested independent
transaction or escaped async work belongs inside this callback. Type signatures
alone cannot prove arbitrary caller behavior; source review and actual writer
integration remain mandatory. This slice proves its real synthetic consumer only.

After the callback, validate result/checkpoint/count, get fresh DB time again and
perform a conditional final ownership/lease update in the same transaction. A
zero-row update throws, rolling back effects/checkpoint/result/attempt together.
Lease expiry during work therefore refuses even with an unchanged token. Successful
completion or yield finalizes its attempt and clears current claim fields atomically.

The final conditional write is the linearization point: the row lock prevents a
new generation until commit. Do not claim a wall-clock guarantee that commit itself
can never finish after leaseUntil; safety comes from the retained DB lock and final
fresh-time check. No stale generation can commit after a newer generation has been
granted. This distinction must be explicit in implementation comments/tests.

Use bounded PostgreSQL statement, lock-wait and idle-in-transaction timeouts on
owned transactions. Do not implement cancellation by returning from Promise.race
while SQL/transaction ownership remains alive. Await rollback/connection cleanup;
no leaked lock or transaction may be reported as a finished invocation.

A successful yield requires 1..100 processed due items, a definition-validated
forward checkpoint, incremented checkpointVersion and persisted partial result.
It atomically changes the same item to queued at its defined continuation-ready
time; it keeps the original due identity. Remaining backlog therefore survives
restart without inserting a new arbitrary run identity. Complete may process 0..100
only when the definition proves no work remains or prior durable progress covers
it. A zero-progress yield, backward/reset cursor, count>100 or false completion is
refused by the witness definition. Generic storage does not invent business cursor
ordering or prove a caller's count; each future producer needs its own contract.

At most100 effects per invocation is an orchestration/writer contract as well as a
stored bound. The witness executes exactly one transaction/chunk per invocation,
then returns durable continuation. It must not loop through repeated100-item chunks
inside that invocation and claim compliance. Per-effect unique keys remain required
in addition to the job fence when integrating real financial producers.

## Failure, unknown delivery and uncertain database commit

`outcome_unknown` is a nonclaimable hold, distinct from retry_wait/dead. holdUnknown
requires current token/generation/unexpired lease and atomically finishes its
attempt as unknown. No automatic claim, retry, expiry reset or prune may leave that
state. This slice has no release/reconciliation/operator API for unknown holds.
The test can exercise this state synthetically without dispatching anything.

This does **not** make an external sender safe. All external/mixed producers remain
unsupported: future dispatch must commit unique per-recipient/channel identity and
unknown-before-send intent, then reconcile explicit transport outcomes. Lease expiry
does not prove non-dispatch. Do not reuse generic retry failure for timeout after
possible send. Preserve security-notice-dispatch's separate unknown-before-send
contract and do not make it a general job capability by aliasing its token.

An ambiguous connection/COMMIT acknowledgement is also not a known callback
failure. Return a distinct commit-unconfirmed error; never blindly recordFailure
or rerun the effect. Once connection/transaction cleanup is established, read the
durable item/checkpoint/result on a fresh protected connection. Committed success
or yield is returned from storage; an uncommitted running item remains subject to
normal lease expiry and fencing. Atomic DB-only effects make that recovery possible.
Do not relabel every DB exception as external outcome_unknown or claim an uncertain
commit definitely rolled back. Keep raw driver details out of public diagnostics.

## Observability without readiness promotion

Provide bounded status reads exposing due identity, dueAt, readyAt, state, generation,
claim/failure counts, last attempt/success, DB-computed lag, classified error and
opaque current owner; include checkpoint version/continuation. Never return the
claim token through ordinary status or logs. Registry diagnostics retain unsupported
required producers. No new public HTTP/admin endpoint, scheduler, health promotion
or logging-framework refactor belongs here. Parent can later integrate sanctioned
operational surfaces under R19. No cleanup retention duration is invented now.

## Exact proposed source ownership

One isolated implementer owns the following coherent foundation, separate from
R20's nine production-testing files. No subagents are authorized by this proposal.

| Path | Responsibility |
| --- | --- |
| NEW shared/durable-jobs-schema.ts | New tables, constraints, indexes and inferred row types; no import from shared/schema causing a cycle. |
| NEW server/core/jobs/durable/contracts.ts | Closed requests, identity/canonical JSON and typed outcomes/bounds. |
| NEW server/core/jobs/durable/catalog.ts | Pure required catalog and explicit unsupported diagnostics; runnable-definition contract. |
| NEW server/core/jobs/durable/store.ts | Enqueue/replay/conflict and bounded reads; orchestrate transaction helpers. |
| NEW server/core/jobs/durable/claims.ts | Internal claim/reclaim/renew/failure/unknown SQL; no independent runtime/runner. |
| NEW server/core/jobs/durable/fence.ts | Private tx-bound fence and atomic effect/checkpoint/result transition. |
| NEW server/core/jobs/durable/__tests__/contracts.test.ts | Pure identity/registry/policy refusal tests. |
| NEW server/core/jobs/durable/__tests__/fixtures.ts | Synthetic definition and transaction-only witness; owned disposable fixture helpers. |
| NEW server/core/jobs/durable/__tests__/storage.realdb.integration.test.ts | Real SQL identity/claim/renew/retry/unknown assertions. |
| NEW server/core/jobs/durable/__tests__/fence.realdb.integration.test.ts | Atomic witness, races, loss/recovery and101-item continuation. |
| Coordinator allocation: migrations/<ALLOCATED>_r14_durable_jobs.sql and migrations/meta/_journal.json | Additive reviewed DDL and exact migrator journal allocation. |
| Coordinator-controlled minimal hunk: shared/schema.ts | Re-export new schema tables for the existing schema discovery/type boundary. |

No arbitrary refactor of shared/schema, existing jobs README/service/runner,
withTransaction, DB/TLS configuration, protected harness, scheduler/cron or money
repositories. Keep helpers small enough for existing LOC limits; no baseline debt
increase. If the existing Drizzle metadata convention requires additional generated
metadata, parent allocates those exact paths after inspecting the numbered migration
history; do not run schema generation against ambient credentials to discover it.

**Migration numbering HOLD:** canonical ends0013; isolated R05 owns0014. This proposal
does not assign0014 or assume0015 is free. The implementer may prepare a clearly
unregistered named SQL draft under its own ignored evidence directory while parent
reconciles R05. Only the coordinator allocates the final numeric filename/journal
entry and shared-schema hunk. No SQL application before that exact reviewed candidate
and an explicit protected disposable window. Existing jobs rows must remain byte/
semantic identical across migration; new tables start empty, including on populated
upgrades. Old application compatibility is additive; rollback means old binary can
ignore the new tables, not destructive DROP of durable history.

## Required disposable PostgreSQL assertions

Use the existing protected launcher in explicit **database** mode, server Vitest
config, global target verification and per-client PG/network guards. The parent
supplies TEST_DATABASE_URL, TEST_TARGET_MANIFEST and TEST_RUN_ID with an exact
persisted marker. The source map's historical loopback cluster/targets are not a
live target grant. Unit mode must not masquerade as SQL evidence. No new pool URL,
unmarked DB adoption, finance_app, .env credential or inferred *_test target.

Two independent guarded connections are required for races; in-process promise
barriers must establish lock ordering rather than rely on arbitrary sleeps. Tests
own run-scoped synthetic item IDs and a disposable witness relation created only
inside the approved test target. No witness table or synthetic effect enters the
production migration. Witness unique `(item_id, effect_key)` and counter rows allow
exact readback after rollback/replay. Scope cleanup strictly to owned fixture rows/
relation, and preserve raw RED/GREEN/exit/migration/source evidence.

Required controls, not a passing mocked repository suite:

1. Concurrent same due identity/same payload returns one item to both callers;
   same identity/conflicting payload/dueAt/version/policy fails without changing
   either existing payload or state. Terminal replay returns the same result; no
   new row/effect. Different scope/due identity remains distinct. SQL uniqueness
   must independently reject a duplicate, including null/alias tricks.
2. Two claimers racing one item yield exactly one committed claim/attempt. Repeat
   with multiple items to prove SKIP LOCKED does not block the whole batch. A held
   row cannot become a second generation; returned claims are not pre-commit guesses.
3. Renew-vs-reclaim, exact expiry equality, stale token/generation, forged owner,
   repeated expired-row scans and retries update only the rightful current attempt.
   Each expiry consumes one failure, not one per scanner. No revival after expiry.
   Advance controlled fixture lease timestamps using SQL, never alter global DB
   clock; fresh-time-after-lock-wait behavior also needs a bounded actual SQL race.
4. In one actual fenced transaction insert synthetic effect, checkpoint and result;
   assert committed readback. Force result validation/persistence or final lease
   check to fail after effect insert: all effect/progress/result writes roll back.
   Assert cloned fence, different transaction and post-callback fence all refuse.
5. Hold the fenced effect transaction while another worker attempts reclaim. It
   cannot grant a newer generation. Release by rollback/commit, then assert the
   correct expiry or terminal behavior. After a newer generation is granted, old
   renew/failure/unknown/fenced-completion attempts change zero state/effects.
6. Prove restart recovery with a new store instance and independent connection:
   abandoned pre-effect claim expires; interrupted uncommitted effect transaction
   leaves no witness; committed result followed by lost caller acknowledgement
   replays exactly once. Driver ambiguity is not treated as a confirmed rollback.
   A controlled owned-client disconnect can prove real transaction rollback;
   do not label a thrown JavaScript exception alone a process-crash proof.
7. Retry delay derives from DB time even if application Date.now is wrong; explicit
   failure budget reaches dead and stops. A successful yield does not consume it.
   outcome_unknown survives restart/expiry and is never claimable or auto-retried.
8.101 synthetic due effects: first invocation commits exactly100 plus checkpoint
   and queued continuation; a fresh invocation/store finishes one, for101 unique
   witnesses total. Force a failure on effect101 and prove100 remain committed and
   the final retry adds only one. Reject false completion/backward or zero-progress
   yield/101-effect chunk. Also prove101 independent due rows leave one durable
   queued row after a bounded100-row claim selection.
9. Empty and populated migration rehearsal: all pre-existing jobs/financial/session
   rows and relevant schema behavior unchanged; new uniqueness/check/index contracts
   present. Re-run old binary-compatible reads. New source may not lower current
   required-job or snapshot guard outcomes. Pure registry lists every required
   family as unsupported; storage GREEN is not admission GREEN.

## Delivery and subsequent admission

Parent accepts this contract and allocates schema/migration ownership. Implementer
authors tests plus storage/registry/fence and integrated synthetic consumer. Parent
then schedules exact-source review, protected disposable migrations and focused SQL
races, with independent readback and post-run source parity. No concurrent native/
DB work is inferred from source authorization.

After foundation acceptance, choose the next actual producer under its settled due
and effect policy. Each integration must bind real trigger identity, per-resource
due selection, authorization/current resource state, R08 lock order/posting/audit/
outbox transaction, checkpoint, retry and external-outcome handling. The new job row
must have a declared place in the producer's global lock order before money locks
are touched; this proposal does not silently supersede existing recurring/security
lock ordering. Unsupported catalog entries remain visible until those consumers
and operational evidence exist. Only a later explicit admission decision may change
required-job/profile/snapshot guards. All R14/R19/R08 closure and release gates remain.

## Coordinator disposition, 30 October 2026

Accepted for bounded local implementation against the master completion spec v2.6.
The independently authored Astra High proposal above is preserved verbatim from
SHA256 b0aa66d359d65ef5cb41e94fca4667362727b3e1ef6fbe311f50ed21a7cc3852.
The expiry/backoff correction is part of this accepted contract: expiry does not
create the next attempt; only a subsequent eligible claim does so.

Migration numbering remains HOLD pending R05 canonical integration. No runtime
window, production producer admission, schema application, or release is granted
by this design acceptance. Isolated source preparation may proceed in the ten
listed paths; any migration draft stays unregistered in ignored evidence. Parent
retains shared/schema.ts, metadata allocation and serialized protected DB windows.
Exact source review, actual SQL races, migration preservation and final independent
Astra assessment remain required before local integration. All R14 closure groups
remain OPEN.
