# R04 atomic single-transaction tag link writes

15 October 2026. Master v2.2 R04/J05 and the accepted TAG-WRITER-CONTRACT.md
govern this bounded slice. Baseline5e92a41. It repairs only POST/PUT/DELETE
`/api/tags/transaction/:transactionId[/tagId]`. No canonical group closes.

## Resulting behavior

The three service methods require an explicit actor. The focused writer validates
UUIDs and command shape, then uses one transaction for current authorization,
links, actual counter deltas and required business audit. Controllers retain the
accepted actor-visible response hydration and no longer append a separate audit.
Unknown roles fail closed; owner/admin/member may write and readonly roles may
not. Middleware context never substitutes for the locked current membership.

Lock order: household; sorted combined actor/tag-reference memberships;
transaction; containing account; sorted union of requested/current tags;
junction rows. Initial link/tag-member discovery is nonauthoritative and exists
only to acquire membership locks in order. Authoritative links are read after
the transaction lock. Final tag references must resolve to locked current
same-household known-role memberships. A newly introduced reference outside the
discovered membership set conflicts unchanged rather than adding a late lock.
MemberSpecific/memberId do not become private-tag ownership policy: a valid
Professional reference remains attachable by an authorized member.

Both transaction and account require the actor's household, undeleted state and
their independent privacy predicates. Neither administrator status nor a shared
transaction bypasses a private account. Foreign requested tags and corrupt
existing tag junctions refuse404 with no cleanup side effects. Malformed IDs or
unknown POST/PUT body keys return400 rather than reaching PostgreSQL.
Validated UUIDs are normalized to PostgreSQL's lowercase spelling before
deduplication and identity comparisons, including direct-service actor IDs.

Add deduplicates requested IDs. Only INSERT/DELETE RETURNING effects increment
or decrement counters; repeated add and absent removal do not drift them. Set
uses the actual locked old/new difference. Touched counters must already equal
physical junction counts; null, negative or inconsistent state refuses409 with
the generic reconciliation message, without repair or disclosure of counts.
Audit records describe actual added/removed tag IDs, including empty no-op
effects. Audit insertion errors propagate and roll the entire command back.

## Observed regression evidence

Selected Node24.22.0 ARM64; PostgreSQL18.6; reserved disposable target
`pfa_completion_r04_r04oct15a1_test`, runr04oct15a1, numeric127.0.0.1:55432,
14 versioned migrations. Protected wrapper/manifest used; one worker, no skips.
The worker hit its usage limit after its first green run; parent continued in
the same owned worktree and preserved its source and logs.

- Initial behavioral red:15 failed/5 controls passed,53.92s, exit1
  (`.local/r04/tag-writes-red.log`). It reproduced foreign/deleted parent access,
  corrupt-reference writes, missing atomic audit, stale authorization, bad
  counter acceptance and malformed UUID500.
- First implementation:20/20 passed,22.05s (`tag-writes-green.log`). Review found
  deletion negatives used already-private rows; parent corrected them to
  otherwise-visible shared rows so deletion checks are independently exercised.
- Persisted member-reference red:3 failed/20 controls passed,58.06s, exit1
  (`tag-writes-member-red.log`); all three commands returned200 on invalid refs.
  Ordered reference locks and final rechecks corrected those failures.
- First combined run:112 passed/5 failed,53.95s, exit1
  (`tag-writes-combined.log`). Four race assertions included transaction columns
  legitimately changed by the competing transaction; they now compare physical
  junction identities. One expected403 after completed membership removal;
  actual existing admission resolves no household and returns404. Mid-request
  removal remains403 at the locked writer. Neither application gate was weakened.
- Final focused run: **five files/120 tests passed**, zero failures/skips,
  **34.52s**, exit0 (`.local/r04/tag-writes-final.log`). This includes23 behavioral
  writer tests,23 actual-PG ordering/direct-call tests, the33-case accepted read
  pilot,34 mocked-controller tests and seven real-DB taxonomy tests.
- Final postreview run: **five files/122 tests passed**, zero failures/skips,
  **22.14s**, exit0 (`.local/r04/tag-writes-reviewed.log`), including the two
  UUID regressions below. No application/test/config changes during this run.

The actual ordering tests use separate PG clients, callback/query barriers and
`pg_blocking_pids`, with bounded waits. Actor downgrade/removal, account and
transaction privacy/ownership/deletion, transaction parent changes and referenced
member removal are tested in both orders. Writer-first cases verify one actual
audit and independently unchanged ledger while the external change remains
uncommitted, then prove a subsequent denied request changes neither ledger nor
audit. A reference introduced after discovery returns409 unchanged. Concurrent
add/add and set/remove retain literal physical-link counts. Failure cleanup
releases gates and rolls back; uncertain rollback retires the client.

Independent SQL/Drizzle reads compare tags, physical junctions, accounts,
transactions and audit. Audit-failure injection calls the real audit insert on
the provided transaction and throws afterward; all three commands then return
failure with the full precommand state restored. Explicit audit-delta/no-op
assertions do not infer atomicity from controller mocks. The old mocked suite
now checks controller delegation and absence of a duplicate controller audit;
the taxonomy suite keeps the actual writer/counter check under an explicit actor.
Corrupt-reference read tests retain filtering while all three writes now refuse
unchanged. Clean positive mutation controls remain.

Postcorrection nonincremental TypeScript and `npm run check` both passed, exit0
(`.local/r04/tag-writes-tsc-reviewed.log`, `tag-writes-check-reviewed.log`). The
check includes runtime parity, LOC ratchet,44 native-module syntax checks and
metadata guards. Independent frozen-source acceptance and parent integration/
broad verification remain required before accepting this slice.

Language review found a valid-input regression: raw uppercase UUIDs were compared
against PostgreSQL's canonical lowercase rows. Two focused actual-PG regressions
failed (23 deliberately filtered),9.61s, exit1 (`tag-writes-case-red.log`): a mixed
case existing-link command returned404 and an uppercase direct actor returned403.
The correction canonicalizes only validated UUIDs before set/identity operations;
roles, reference/visibility rules and effects are unchanged. The language reviewer
accepted the correction with no remaining actionable findings. The postreview
122-test result above includes mixed-case retries, set/removal and uppercase
direct actor authorization on its private account/transaction.
The first nonincremental TypeScript run also found test-helper typing errors
(UUID literal inference and the PG timeout option overload); these were corrected
without removing timeouts. Nonincremental TypeScript and npm check then passed
before the UUID source correction; fresh postcorrection checks also passed as
recorded above.

## Limits

Catalogue create/update/archive/defaults, global merge/delete and their observable
privacy policy remain unchanged/open. Imports, rules, receipts and legacy storage
producers do not yet adopt these locks or atomic counter effects. This local
writer can detect inconsistent counter state but does not prove global counter
correctness, deadlock freedom or compatibility with delayed legacy increments.
Operation-key persistence, durable replay/unknown-commit reconciliation, full
R04/J05, non-test CSRF, staging and release remain OPEN. No schema, migration,
shared guard/configuration, provider, deployment or real-household change occurs.

## Independent acceptance and parent integration

Independent code/evidence review and separate TypeScript/security review both
accepted frozen author `1d7a39bf358035c337fb31944dafcc3ff6af0f9a`, with no
remaining actionable finding. The reviewer-found deletion-oracle, uncertain
test-client cleanup and UUID issues were corrected before acceptance. Reviewers
did not run tests or inspect a live DB; the code/evidence reviewer read the
focused logs and the language reviewer performed source review.

Parent integrated the exact nine-file slice as
`bd8c7bff6932a5ff70831a5270571e372ea5d4c3`. The complete protected server run
uses the parent's separate marked14-migration identity DB, runr01int15a1, one
worker/no failure-stop. Its result is pending
(`.local/r01-integrated/server-full-tag-writes.log`). Source/test/config remains
frozen during that run; documentation-only status updates may follow.

## Completed integrated verification

The full protected server run at application/test candidate
`bd8c7bff6932a5ff70831a5270571e372ea5d4c3` passed **232 files/3,147 tests**,
zero failures/skips, **433.51s**, exit0. The only commit during execution was
documentation40c1b7b. The parent's identity target remained
`pfa_completion_identity_r01int15a1_test`, runr01int15a1, numeric127.0.0.1:55432,
14 versioned migrations; one worker, no failure-stop. Log:
`.local/r01-integrated/server-full-tag-writes.log`.

At documentation HEAD `40c1b7b4715db1e4afbfac01c385449c752040e4`, fresh parent
`npm run check`, production build and bundle guard passed, exit0. Build26.95s;
initial JS gzip185.88kB against300kB. Logs:
`.local/r01-integrated/{check,build,bundle}-tag-writes.log`. Protected Chromium
then passed **3/3**, reported1.3m, one worker/zero retries, on the separate marked
14-migration Golden target, runr20ga15a1
(`.local/r20-golden/browser-tag-writes.log`). These existing smoke journeys
exercise identity/monetary controls; the tag-specific proof is the actual
API/DB/race evidence above. The full client unit suite was not repeated for
this server-only slice.

Parent separately verified that every tracked non-documentation file is
identical between reviewed author1d7a39b and integratedbd8c7bf
(`.local/r01-integrated/tag-writes-source-parity.json`). This is Git source
parity, not installed dependency custody or production-profile certification.
No application/test/config changes occurred during the integrated runs.
Independent reviewer read the integrated logs, source parity and documentation
and accepted this completed local checkpoint with no further findings. No
reviewer execution or live-target inspection occurred. Full R04/J05 and all
production/release gates remain OPEN as described above.
