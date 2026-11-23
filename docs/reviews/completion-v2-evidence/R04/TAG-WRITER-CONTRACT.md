# R04 follow-on tag writer contract — design only

15 October 2026. This document proposes a bounded implementation contract; it
does not implement, test or accept a writer repair. Only this new document is
owned by this task. No application, test, schema, configuration, master or ledger
file was edited; no database, native test, TypeScript or runtime call was made.

## Authority, source and settled boundaries

The sole authority is master completion spec v2.2, section 2 Permissions and
privacy / Monetary and mutation invariants, R04.2–R04.3, FIN-01, ORG-001/002,
NEW-33 and J05. The companion v1.2 A3/A5 and Part E R04 is subordinate. The master
requires membership AND operation capability AND containing-account visibility
AND transaction visibility, including indirect writers; denied mutations leave
DB snapshots unchanged. It requires locked rechecks and business effects/audit
in one transaction. Malformed IDs are 400, invisible objects 404 and known forbidden
capabilities 403. Neither admin nor Professional overrides privacy.

Source was read at local a64c1903b969066af6874aeb471e6903d1ae9a7e. That accepted
tag read/projection slice was integrated by the parent as 320a8fe. Read-only diff
against canonical observed HEAD b2d94078490954bd36c50c319eaa77a68e38ad5e found no
changes to tags module, TagRepository, TagReadRepository or core/authz. The parent
reported its later server candidate f9e7d7e passed 230 files/3099 tests; that run
was not repeated here and does not prove the proposed writer races.

The accepted read slice remains intact: household catalogue existence and
memberSpecific/memberId labels are not a private-tag ownership policy. Raw
usageCount in public DTOs remains actor-projected; internal global counters are
not public authorization. Archive changes catalogue metadata while preserving
links/history; it is not hard deletion or unlink. No new alias/ownership model,
counter backfill, role privilege, schema assumption or external action follows
from this design.

## Current executable writer graph and gaps

Every listed route is under householdGuard plus financial.read and the existing
explicit requireRole("member") write adapter. These reject readonly/unknown
roles at request admission, but their snapshot is not a mutation-time lock.

| Route under /api/tags | Controller → current TagService behavior |
|---|---|
| POST / | create → findByName, then create outside a shared transaction; memberId is only UUID-shaped |
| PUT /:id | update → household lookup/duplicate-name checks, then separate update; no locked actor/reference recheck |
| DELETE /:id | delete → household lookup, then TagRepository.delete; FK cascade removes all linked transaction_tags |
| POST /:id/archive | archiveTag → household lookup, conflict if already archived, separate metadata update; keeps links |
| POST /merge | mergeTags → household tag validation before tx; raw INSERT SELECT/DELETE by source tag ID; source tags deleted; target global count recalculated |
| POST /defaults | createDefaults → active-name snapshot, then individual creates; can partially commit |
| POST /transaction/:transactionId | addTransactionTags → unlocked transaction/tag checks, link insert and counter increment in separate operations |
| PUT /transaction/:transactionId | setTransactionTags → unlocked current-tag read/checks; repository link replacement alone transacts; counter differences run later |
| DELETE /transaction/:transactionId/:tagId | removeTransactionTag → unlocked access/tag check; delete and unconditional decrement are separate, including absent-link retries |

Exact implementation anchors are tags.controller.ts:56–467,
tags.service.ts:63–414 and TagRepository.ts:97–231. Merge uses the accepted narrow
targetTagId::uuid cast; that cast fixes parameter typing only. Its source-link
INSERT/DELETE has no transaction/account visibility filter. The tag FK cascade
is declared in shared/schema.ts:1426–1447; junction uniqueness is on
(transaction_id,tag_id), with migration 0003. There is no household-name uniqueness
constraint in the inspected tags declaration/versioned SQL; do not assume one.

verifyTransactionAccess calls TransactionRepository.findByIdWithVisibility
(:218–250), which uses separate transaction/account reads. The account lookup
there checks privacy but not account household/deletedAt. Reusing it inside a
new transaction would still be insufficient. The accepted common predicate must
be applied to locked authoritative rows, including foreign/deleted parents.

All nine controllers place their business audit after the service call, without
tx (defaults audits only when created > 0).
BusinessAuditService.log without tx catches insert failures; passing tx writes
through that executor and propagates failure. Consequently even the current
merge inner transaction is not atomic with audit and locked actor authorization;
link replacement additionally excludes counter effects. Postcommit response
projection repaired disclosure, not these writes.

## Observable destructive policy: unresolved, with recommendation

The master settles that an operation cannot alter another actor's invisible
transaction or related link. It does **not** choose how the public household tag
merge/hard-delete command behaves when some of its descendants are inaccessible.
The following choices are materially different product behavior:

| Choice | Consequence |
|---|---|
| Current global merge/delete | Changes private/foreign descendants; violates the settled authorization contract |
| Silently process visible links only, then delete source/catalogue row | Cascade still removes hidden links; not a safe partial implementation |
| Process visible links, retain sources/hidden links | Requires a defined partial outcome and surviving catalogue identity; does not fulfill today's delete/full-merge promise |
| Refuse whole command if any affected link is unauthorized | Preserves atomicity/history but success versus refusal reveals a dependency boolean |
| Replace delete/merge with archive/aliases | Changes advertised semantics; archive exists, aliases do not; cannot be silently substituted |

Recommendation for the next explicit parent adjudication: choose all-or-nothing
refusal rather than silent partial mutation. Validate every **source link that
would be moved/removed**, including soft-deleted/foreign/ambiguous parents. If any
fails the common predicate, preserve every tag, link, counter and audit row.
Target's pre-existing private links need not be moved or removed by merge and
must remain unchanged; their mere presence is not permission to alter them.
An archived source/target keeps its existing catalogue meaning.

This recommendation is not a claim that a generic 404/409 hides dependency
existence. If the same visible tag can be deleted with no protected link but
refuses with one, a caller can distinguish those states even without IDs/counts.
The governing no-hidden-existence rule and current global destructive semantics
cannot both be declared satisfied by changing only error wording. Parent must
adjudicate/version this bounded observable contract before implementing those
two destructive branches. This document does not authorize a privacy exception.

For a directly supplied invisible transaction/tag/member reference, use the
settled non-disclosing 404 contract, without echoing missing IDs. For a visible
catalogue resource's protected-descendant refusal, the exact error/status and
UI explanation remain part of that adjudication; do not silently choose between
404 and 409 or return hidden affected/skipped counts. A generic policy refusal
still has the boolean limitation above.

The existing archive endpoint is an available non-destructive catalogue
operation: it sets isArchived and preserves links/history, while accepted reads
exclude it from the default list but retain direct detail. It can be described
as archive, not represented as successful hard delete/merge. This is not
permission to remove those offered capabilities.

## Proposed cohesive service and transaction boundary

Subject to the destructive-policy decision, use one actor-required tag writer
service/repository boundary. The authenticated userId/householdId come from the
session/guard, never body-supplied identity; role in the middleware context is a
hint only. The service accepts explicit actor, typed command and audit context.
All mutations call can(lockedMembership.role,"financial.write"). Missing,
removed or unknown-role membership fails closed before any business write.
Direct service callers cannot omit actor or fall back to a global/admin context.

Validate UUID/body structure first; optional preflight lookups are not authority.
Within one read-write transaction, lock/re-read current membership, references,
account and transaction state before deriving effects. Return an immutable
committed result for the controller envelope. Keep accepted actor-visible
response projection; never report a postcommit auth error as though the write
did not commit. No external calls occur inside the transaction.

Final nonnull memberId must resolve to a current known-role member of the same
household under the membership lock; null-clearing remains supported. This is
reference validity, not private-tag ownership. Preserve existing permitted
memberSpecific/memberId combinations until a separate product contract says
otherwise. A persisted invalid reference is not silently followed or repaired;
an explicit valid/null replacement can be considered without touching a foreign
member. No guessed legacy ownership, privacy copying or automatic widening.

Add/set/remove must validate transaction household, deletedAt and privacy AND
account household, deletedAt and privacy from the locked state. Resolve all
requested tags against the same household, including tags already attached for
replacement/removal; no partial valid-prefix writes. A corrupt existing foreign
junction cannot be silently removed as a cleanup side effect. Explicit repair
is a separate reviewed task. Deduplicate requested tag IDs before effects; the
unique junction index remains the final duplicate barrier.

Metadata create/update/archive/defaults do not edit linked transactions merely
because they edit a shared catalogue tag. Do not require visibility of every
private descendant for a name/color/archive operation, or reinterpret
memberSpecific as ownership. They still require locked actor, valid references,
fresh duplicate/state checks and atomic audit. Existing exact-name versus
default-name matching behavior is not redesigned here.

## Deterministic locks and finite affected-set discovery

Proposed local order, all IDs deduplicated and sorted within each class:

1. Household row (same anchor as household-policy/erasure).
2. Acting membership plus any referenced member rows, ordered by userId; recheck
   current financial.write and all member references.
3. Affected transaction rows, ascending ID.
4. Their containing account rows, ascending ID, derived from the locked
   transactions; recheck household/deletion/privacy and account ownership.
5. All affected tag rows, ascending ID, rechecking household/state/references.
6. Existing affected junction rows, ordered by transactionId/tagId; calculate
   actual old/new sets, then links/counters/catalogue/audit and commit.

This transaction→account choice follows live TransactionRepository.update and
softDelete and TransactionTransferRepository.softDeleteTransferPair (transaction rows before
accounts). Transfers create by locking existing accounts before inserting new
transaction rows. It is not evidence that every current writer already obeys
one universal order. Do not add user-row locks casually ahead of the household:
existing household erasure anchors the household before ordered memberships and
later identity changes. A proposed broader identity lock must be mapped against
R01's current security transaction order before adoption.

For explicit single-transaction commands the candidate transaction is known.
For merge/delete, first discover candidate source-link transaction IDs without
treating that discovery as authorization, lock them/accounts in the order above,
then lock source/target tags and rediscover the full authoritative affected set.
If a newly committed link/parent change introduces an unlocked transaction or
account, abort unchanged with a bounded conflict; do not append a lower-order
lock or silently ignore that link. Recheck all selected sources before effects.
The same rule applies if a tag's final memberId introduces a membership that was
not in the sorted locked reference set: abort/restart, not an out-of-order lock.

Source-tag FOR UPDATE is the proposed insert fence: FK checks for new source
links must conflict with it, including producers that do not take the household
anchor. A producer that acquired its FK lock first must finish before the tag
lock is granted; the subsequent fresh READ COMMITTED statement must see and
revalidate its committed link. This is a hypothesis to prove using actual PG
blocking/readback, not an already executed oracle. Read-only REPEATABLE READ
from TagReadRepository is not a writer lock primitive; do not let a stale writer
snapshot miss rows that committed while it waited.

Locked transaction/account rows prevent committed privacy/owner/account/deletion
changes during effects. If those changes commit first, the writer rechecks and
denies; if the writer holds locks first, it may commit the authorized operation
before the change. Downgrade/removal has the same two-order rule on membership.
Discovering an invisible/corrupt source is a refusal, not a mutation to fix it.

Plain legacy junction deletions can precede a later counter update and can invert
tag/junction lock order. Recognized serialization/deadlock conflicts must roll
back the **entire** command and audit, never continue with stale data. A bounded
conflict outcome/retry policy must be specified; no unbounded or postcommit
replay. Do not promise deadlock freedom, phantom fencing or global counter
correctness until the producer compatibility tests below pass. No guessed
production lock timeout or new global advisory-lock namespace is declared here.

## Effects, counters, audit and replay

Use actual INSERT/DELETE RETURNING effects, never requested-array length:

- Add: +1 only for each newly inserted junction; duplicates change nothing.
- Remove: -1 only for a row actually removed; absent-link retry does not
  decrement again. No GREATEST clamp concealing an inconsistent counter.
- Set: locked old/new set difference, links and exact counter deltas in one tx.
- Merge: move each distinct source transaction to target once; target's increment
  equals actual new target junctions, not the sum of source usage counters.
  Existing duplicate target links and private target links stay unchanged.
- Delete: remove the complete authorized affected set and catalogue row only
  under the adjudicated policy; no cascade can include an unchecked descendant.

Retain the existing internal counter meaning (global physical junction usage,
including retained historical links), separate from projected visible usage.
Do not reset a target to actor-visible usage. Prefer actual deltas over a global
recount racing an older producer's delayed increment. Null/negative/mismatched
legacy counters are not silently clamped or backfilled; define a conflict/report
path and leave uncertain rows unchanged. Affected-tag reconciliation would be
an explicit separately reviewed choice. Test clean fixtures against independent
SQL counts and separately prove refusal preserves a deliberately inconsistent
counter. No aggregate/private count is returned in an error or audit response.

Move successful audit into this exact transaction with tx required; remove the
corresponding post-service controller audit so there is one business record.
Keep existing action/entity conventions unless a separately reviewed migration
requires a change. Audit may describe actor-authorized catalogue IDs and actual
effects, not hidden transaction IDs/names/amounts or stored global usage in a
public response. Failure after link/counter/catalogue/audit insertion rolls all
of them back. No notification/outbox transport is added for tag operations.

Natural duplicate/no-op protection is not durable request replay. Repeating a
remove/add/set must not corrupt counters; any success audit must truthfully
identify zero actual effects. Full operation-key/fingerprint persistence and
stale-version conflict semantics from the master require a concrete reusable
mechanism/ownership decision with R11/R08; they are not satisfied by row locks,
nor silently introduced as an unreviewed schema change here. A merge retry after
sources disappeared cannot fabricate a new success without operation identity.

## Producers that bound a local guarantee

Source inventory beyond the nine tag HTTP commands:

| Caller | Current seam / consequence |
|---|---|
| services/transaction/tags.ts addTagsToTransaction | Separate visibility/tag checks and direct link inserts; no counter update |
| services/rule/actions.ts add_tags | TagRepository.addTagToTransaction + incrementUsageCount; optional existing tx, unchecked actor/reference policy remains R11 |
| services/account/AccountImportService.ts linkTagsToTransaction | Tag find/create, link and increment are separate; catches/logs failures; late increment can outlive another writer's recount |
| services/receipt/transaction.service.ts addReceiptImportTagWithTx | Uses its existing tx for tag creation/link; no usage counter update in that helper |
| settings.account-deletion.service.ts | Household/member ordered erasure, manual household-scoped junction/tag cleanup; legitimate erasure lifecycle is not a tag HTTP bypass to rewrite |
| storage/StorageTagModule.ts via storage/index.ts | Legacy direct CRUD/counters with optional runtime reachability not established by this design; repository/module repair cannot certify it |

Do not thread only an optional tx and call that adoption: each live producer needs
documented actor/service authorization, reference checks, compatible locks,
same-transaction link+counter effects and audit at its owning command boundary.
Rules/imports/receipts/ledger/erasure remain separate ownership until the parent
explicitly assigns a shared seam. A module-only commit may prove its own HTTP
boundary and rollback, not global writer/counter closure. In particular, a
legacy producer's committed link followed by delayed counter increment must be
an explicit adversarial test before any global counter claim.

## Proposed ownership and implementation gate

Small cohesive module assignment after policy adjudication:

- New focused TagWriteRepository / tag writer service and narrow transaction
  authorization helper; explicit actor and required executor, no global fallback.
- tags.service.ts delegation, tags.controller.ts transaction-owned audit removal,
  tags.validation.ts strict mutation UUID/body contracts and tags.routes.ts named
  financial.write admission if desired; preserve successful response envelopes.
- Narrow tx-aware TagRepository plumbing only where it is deliberately adopted,
  without silently changing unowned producer semantics or growing an oversized
  repository. Preserve the accepted read repository/service/projections.
- Focused real-PG writer suite/fixture plus evidence. No schema/migration,
  package/guard/config or counter backfill is presupposed. Broader producer
  adoption requires precise follow-up ownership and compatibility review.

The next implementing agent must refresh current source/ownership first, obtain
parent's destructive-policy decision and protected target/DB slot assignment,
then produce actual red/green before acceptance. This document does not reserve
a DB slot or create a new target.

## Exact synthetic regression and readback plan — NOT RUN

Reuse fresh A5 inputs: A/B households, five roles plus outsider, real login-issued
cookies, PRIVATE savings 5000→4222.23 with public-flag expense 777.77 on 2026-10-05,
SHARED checking 1000→988.89 with expense 11.11, A5Tag #112233 attached to both.
Do not reuse old cookies/IDs. Expected effects are literal, independent of the
production helper. Snapshot catalogue, full junction rows (including corrupt
variants), global counters, transactions, account balances and scoped audit via
independent SQL; compare values and timestamps on every denial/rollback.

| Proposed case | Independent expected observation |
|---|---|
| All nine writes: view_only/Professional/unknown |403 before effects, unchanged full snapshot; owner/admin/member positive on shared resources; outsider/foreign references404 |
| Malformed route/body UUID; mixed valid+foreign IDs; duplicate IDs |400 malformed;404 invisible/foreign without echoed IDs; no valid-prefix effect; duplicates produce one link/delta |
| Add/remove/set private-account public transaction | Nonowner404 unchanged; OWNER succeeds; repeat with transaction-private/shared-account and mismatched account/transaction owners |
| Deleted account/transaction, foreign account parent, foreign stored tag junction |404/default exclusion with no cleanup side effect; explicit shared positive remains available |
| memberId reference valid/null/foreign/removed | Same-household current reference succeeds and null clears; foreign/removed refuses unchanged; role does not invent tag ownership |
| Add same tag twice; remove absent link; set overlapping/duplicate sets | One physical junction; no duplicate increments/decrements; literal old/new counts match SQL and audit actual effects |
| Owner full merge source links {PRIVATE,SHARED}, target already SHARED | If policy adopted: target links exactly {PRIVATE,SHARED}, count2, source gone; projected owner2/member1; balances/transaction rows unchanged |
| Member same merge / hard delete with hidden source link | Under recommended refusal: every source/target/link/counter/audit unchanged; no hidden details; response-difference oracle recorded as unresolved policy, not privacy pass |
| Member visible-only source into target with pre-existing private link | If policy adopted: remove source/move only its visible link, preserve exact existing target private junction identity; target increment only for actual new link |
| Owner authorized delete of fully accessible tag | Declared204 only after all intended links/catalogue removed and one tx audit; no balances/transactions affected; independent remaining tags unchanged |
| Archive/rename of shared catalogue tag with private descendants | Authorized catalogue update succeeds without any junction change; no hidden metadata in response; archive does not claim delete/merge |
| Batch defaults/create/update duplicate concurrency | No partially created batch on failure; preserve current naming policy; prove only the adopted producer set's serialization, not absent uniqueness guarantees |
| Deliberate stale/null/negative global counter | Defined conflict/report without clamp, hidden count disclosure or silent repair; untouched persisted snapshot |
| Failure after each link/counter/source delete/audit insertion | HTTP fails; independent readback equals full precommand state, including audit inserted then deliberately thrown inside same tx |

Concurrency oracles must use actual pg clients and callback/query barriers, not
sleeps or MemoryStore. Capture blocked PIDs/pg_blocking_pids where waiting is the
claim, bound each barrier and release it in finally:

1. Pause after middleware, downgrade/remove actor and commit, release writer:
   locked recheck denies without changes. Opposite order: writer holds member
   lock first, prove role change waits; writer commits authorized effects/audit,
   then downgrade commits and next request is403.
2. Repeat both orders for account privacy/owner/deletedAt and transaction
   privacy/owner/accountId/deletedAt. Assert account and transaction locks, not
   merely a fresh preflight check. A changed accountId must cause complete
   rediscovery/recheck or conflict, never lock a new parent out of order.
3. Pause after merge/delete candidate discovery; insert a source link on an
   undiscovered private/foreign transaction and commit before tag lock: later
   discovery aborts unchanged. Opposite order: hold source tag lock, start real
   FK link insert, prove blocking, then complete the command; insert observes
   the surviving/deleted source truth without a ghost link/counter.
4. Concurrent add/add, add/set, remove/set and opposite-source merge commands:
   sorted lock order or whole-command conflict, no partial effects/negative
   counters. Include a legacy junction-delete→counter-update inversion; do not
   hide a deadlock as a passing serialized success.
5. Legacy producer commits link, pauses before increment, module merge/add/remove
   runs, then release increment. Prove actual final global SQL count/counter or
   mark producer compatibility OPEN; do not weaken to actor-visible count.
6. Concurrent source/target tag delete/household change and referenced-member
   removal: final locked checks win, no foreign mutation or postcommit fake404.
7. Audit fault after a real inserted audit row, and a separately injected failure
   known to occur before COMMIT: command fails and independent readback proves
   rollback. A lost commit acknowledgment is an unknown outcome until operation
   identity/readback resolves it, not proof of rollback. Projection/network
   failure after a proven commit is also distinguished from rollback; neither
   ambiguous nor committed outcomes trigger blind redispatch.

Keep the accepted read/role/snapshot tests as adjacent coverage. Later integrated
server/client/browser/production gates remain parent-owned. None of the planned
cases above was executed by this documentation task, and no R04 status advances.

## Independent design review and integration

Independent reviewer accepted author8c803406 subject to two exact source-symbol
corrections, supplied in c5bd3f1 and verified against their definitions. Parent
integrated the chain as680ad55/ff50395. This accepts the source-based proposal
and its explicit unresolved boundaries; it does not approve destructive policy,
prove concurrency behavior, authorize a particular implementation assignment,
or advance a canonical closure group. No tests were run for these documentation
changes.

The three single-transaction add/set/remove commands were subsequently assigned
independently of the destructive-policy hold and implemented in author1d7a39b,
integratedbd8c7bf. TAG-LINK-WRITES.md records their actual locked authorization,
atomic effects/audit, counter/refusal contracts, tests and separate acceptance.
This does not promote the rest of this proposed nine-command/global-producer
contract into an implementation claim; merge/delete policy, producer adoption
and durable replay remain unresolved.
