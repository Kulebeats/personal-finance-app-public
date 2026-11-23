# R04 bounded tag visibility pilot

Status: implemented and locally checked, pending independent source review and
parent integration. This is one R04 slice, not packet or production acceptance.
The frozen R04.1 ancestry is e7e2a2f + 8e33b3d. The governing authority is master
completion spec v2.2, section 2 Permissions and privacy, R04 and J05; the companion v1.2 is
subordinate. The accepted R20 A5-RECONSTRUCTION supplies portable synthetic
inputs, not a claim that current endpoints already pass.

## Contract and live paths

`tags.routes.ts` retains householdGuard and the existing explicit member write
gates, adding named financial.read admission. All five known roles may read;
view_only and professional still receive 403 on all nine tag write routes.
Unknown roles fail closed. No new private-tag/catalogue ownership policy is
introduced: household tags, including private-only linked tags, remain visible
as catalogue objects, with zero actor-visible usage when appropriate.
memberSpecific/memberId labels and existing archive behavior are unchanged.

The six GET handlers now require an explicit HouseholdContext through
tags.read.service.ts and TagReadRepository.ts:

| HTTP surface | Projection |
|---|---|
| GET /api/tags | Active household catalogue; visible usageCount; stable name/id order |
| GET /api/tags/:id | Household tag, including archived; visible usageCount |
| GET /api/tags/:id/transactions | Visible rows, total count and nested tag usage from one snapshot |
| GET /api/tags/transaction/:transactionId | Visible transaction required; household-scoped tag hydration |
| GET /api/tags/analytics | Visible usage before totals, denominator, percentages and top-N |
| GET /api/tags/suggest | Visible usage before ranking and confidence boost; stable ties |

The common transaction-visibility predicate requires current known-role
membership, transaction household + nondeleted state + public-or-owned privacy,
and containing account household + nondeleted state + public-or-owned privacy.
Account and transaction owners are checked independently; neither owner role,
admin nor Professional overrides another person's private data. A public
transaction on a private account remains private. A foreign account parent or
foreign transaction junction cannot contribute usage or rows.

Each read runs in a real read-only REPEATABLE READ transaction. Membership is
read again within that snapshot; rows, count and nested metadata therefore use
the same admission/data snapshot. A concurrent later membership change is not
described as retroactively invalidating an already admitted snapshot. The guard
provides fresh admission on the next request. The root tag is selected separately
inside that same transaction, so empty pages and offsets beyond the last row
retain the true visible count. A visible tagless transaction is200[], an invisible
or absent transaction404, and a household tag with zero visible links is200 with
empty rows/count0. Malformed read UUIDs and strict invalid query shapes are400;
known forbidden capabilities are403.

All raw Tag mutation responses also replace the stored global usage counter:
create, update, archive, merge target and default creation. A single projected
count query covers a returned batch. Projection uses the authorized write's
returned catalogue rows, including archived outcomes, rather than reloading only
active rows and turning a committed archive into 404. It does not add a postcommit
membership rejection: lost membership yields zero visible usage. Database errors
still propagate. This does not make the existing write/audit/projection sequence
atomic.

Transaction-tag add/set/remove responses use the same household-scoped visible
hydration predicate. Their public projection is deliberately separate from
TagRepository.getTransactionTags used by internal setTransactionTags
currentTagIds/counter bookkeeping. Those existing counter writers are unchanged.
The six obsolete household-only HTTP read methods were extracted out of
TagService; source search found no other production callers. Existing
TagRepository readers remain available to their internal/legacy callers and are
not advertised as globally secured by this slice.

Client source inspection found the active list/detail/analytics and transaction
tag hooks continue to consume their existing envelopes. The getTransactions
helper in client/src/lib/api.ts has a pre-existing array type despite the
server's existing object envelope; useTagTransactions has no production consumer
beyond its definition/re-export (its unit test is mocked). No client change or
browser/UI acceptance is claimed here.

## Narrow writer exception

The real merge positive exposed pre-existing PG42804: the INSERT SELECT target
parameter was inferred as text for a UUID column. Parent explicitly authorized
only this single-line writer correction in tags.service.ts:

```diff
- SELECT DISTINCT transaction_id, ${targetTagId}
+ SELECT DISTINCT transaction_id, ${targetTagId}::uuid
```

Payload validation, merge semantics, counters, reference authorization and lock
behavior are unchanged. The actual merge route is tested, without skipping or
mocking the failed SQL: source deletion succeeds, the stored global target count
is2, and the member's returned target usage is1, including an archived target.

## Protected fixture and observed checks

The existing exclusively reserved synthetic target is
`pfa_completion_r04_r04oct15a1_test`, run r04oct15a1, on
127.0.0.1:55432 as pfa_campaign. The protected runner verifies the immutable own
manifest `.local/r04/target.json` and persisted synthetic marker. It retains the
existing 14-migration schema; this slice adds no migration, backfill, package,
lockfile, guard or configuration edit. No other DB target or shared finance_app
was used. No providers, mail, push, browser or external service was invoked.

Runtime is native Windows ARM64 Node 24.22.0 from the recorded isolated runtime.
DB/TS slots were coordinated with the parent; no broad suite ran in this worker.

The fixture generates fresh household A/B identities and real login-issued signed
cookies for owner/admin/member/view_only/professional and an outsider. A5 PRIVATE
savings starts 5000.00 ZMW and persists 4222.23 after 777.77; SHARED checking starts
1000.00 and persists 988.89 after 11.11. Both expenses date 2026-10-05; the private
row's own isPrivate=false retains the parent-account oracle. PRIVATE belongs to
OWNER, tag A5Tag is #112233 and links both rows. Actor timezone is Africa/Lusaka;
the protected server convention is UTC. These tests read historical dates and
do not assert clock-dependent scheduling. Additional variants independently
change transaction privacy/owner, deleted account/transaction, foreign account
parent and foreign tag/transaction junctions.

| Check | Actual observed result |
|---|---|
| Baseline behavioral red, original HTTP reads | 21 failed / 9 controls passed, 30 tests, 22.05s |
| Added snapshot/postcommit projection red | 2 failed; 30 tests deliberately filtered out, 8.58s |
| Initial implementation diagnostic | SQL qualification error, PG42702 ambiguous id; not acceptance evidence |
| Repaired read checkpoint | 32 passed / 1 failed; remaining actual merge PG42804, 9.60s |
| Isolated actual merge diagnostic | 1 failed; 32 deliberately filtered out, 8.71s |
| Final protected DB checkpoint | 4 files / 48 tests passed, no skips, 16.11s, exit 0 |
| Existing mocked controller suite | 34/34 passed, 1.27s, exit 0 |
| Nonincremental TypeScript | tsc --noEmit --incremental false, exit 0 |
| Repository npm run check | exit 0; 0 new/0 grown LOC violations |

The final DB run contains 33 new A5 cases plus existing
tags.transactions.visibility.realdb.integration, tags-security.integration and
taxonomy.scp335 suites. The mocked controller suite is explicitly a unit boundary
check; it does not substitute for cookie/PG evidence. Its mock moved to the new
read-repository boundary, leaving real read service, validation and controllers.
The malformed UUID expectation changes404 to the required400.

New cases cover five-role shared/private positives and negatives; outsider;
hidden-only usage0; account AND transaction privacy with mismatched owners;
deleted/foreign parents; household tag hydration on GET and all three transaction
tag mutation responses; visible tagless versus invisible; empty and beyond-last
pages; strict NaN/fractional/negative/array queries; malformed and absent UUIDs;
unknown role through a controlled seam without modifying the real enum; readonly
write denials with independent catalogue/link/account/audit snapshots; update,
archive, merge, create and default response projection. Changing a hidden link
and setting the stored counter to987 cannot change member list, analytics,
suggestion ranking/confidence or write back that counter. Reads are compared to
independent persisted snapshots; session bookkeeping is outside those snapshots.

A real pg.Client query barrier pauses after the tag/usage read, independently
commits removal of the shared link, then releases the page query. The response
still contains2 rows/count2/nested usage2. On that same real connection,
current_setting independently reports transaction_isolation=repeatable read and
transaction_read_only=on. This proves the selected snapshot behavior; it uses a
bounded deadline, not sleep timing. A separate postcommit observational seam
removes the writer's membership after the real archive operation: response stays
200 with archived row and usage0, and independent readback confirms the archive.

Ignored local logs are `.local/r04/{tags-red,tags-snapshot-red,tags-green,
tags-query-diagnostic,tags-green-fixed,tags-merge-diagnostic,tags-focused-db,
tags-unit,tags-tsc,tags-check}.log`. The dependency node-cron missing sourcemap
warning is present in DB output; no tests failed/skipped because of it.

Reproduce from this worktree with the native Node runtime on PATH:

```powershell
$env:TEST_DATABASE_URL='postgresql://pfa_campaign@127.0.0.1:55432/pfa_completion_r04_r04oct15a1_test'
$env:TEST_RUN_ID='r04oct15a1'
$env:TEST_TARGET_MANIFEST=(Resolve-Path '.local/r04/target.json').Path
node scripts/run-protected-tests.mjs database vitest --server run modules/tags/__tests__/completion-r04.tags.realdb.integration.test.ts modules/tags/__tests__/tags.transactions.visibility.realdb.integration.test.ts modules/tags/__tests__/tags-security.integration.test.ts repositories/__tests__/taxonomy.scp335.test.ts --maxWorkers=1
node scripts/run-protected-tests.mjs unit vitest --server run modules/tags/__tests__/tags.integration.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm run check
```

## Limits and review gate

Independent exact-commit source review and parent integrated checks remain
required. No full R04/J05, hosted/production, UI or runtime deployment claim.
Goals/recurring and other indirect readers remain separate work. In particular:

- Tag mutation admission still uses existing guards/services, without new
  lock-time reference/membership/privacy rechecks or same-transaction audit.
- Existing merge SQL and delete cascade can change/remove links belonging to
  another actor's hidden transaction. Projected response metadata and readonly
  role403 tests do not establish authorized hidden-descendant writes.
- Stored global counters and legacy corrupt-counter bookkeeping remain
  unchanged; no counter repair/backfill occurs.
- TransactionReportRepository tag hydration/tagId filtering, imports, rules,
  reports, exports, recaps, AI and other jobs are outside this module pilot.
- No new catalogue-existence/memberSpecific privacy policy is inferred.

The bounded next gate is independent review of this frozen tag-read/response
projection slice. Further writer or tag-policy changes require a precise parent
assignment; this evidence does not authorize them.

## Parent integration and independent acceptance

Independent reviewer accepted author `a64c1903b969066af6874aeb471e6903d1ae9a7e`,
integrated as `320a8fef41c85e34e2363000a5ec5e6429b914cf`. The initial integrated
server run passed all 3,099 application tests but exited 1 because Vitest also
discovered the separate node:test manifest file. That failure is retained in
`.local/r01-integrated/server-full-320a8fe.log`; it is not a passing run.

After the byte-identical native-test filename correction, complete protected
server retry at `f9e7d7ef6411fca6c9e0a6688b43ed3a31a5aae5` passed **230 files /
3,099 tests**, zero failures/skips, 359.20s, exit 0. One worker, no failure-stop,
marked 14-migration identity target; no source changes during execution. Log:
`.local/r01-integrated/server-full-f9e7d7e.log`.

Fresh static/build/bundle checks passed at f9e7d7e (build 8.20s, initial JS gzip
185.88kB against 300kB). After a separate component-runner-only correction at
`b2d94078490954bd36c50c319eaa77a68e38ad5e`, static passed again and protected
Chromium passed **3/3**, 37.4s, one worker/zero retries on the marked Golden DB
(`.local/r20-golden/browser-b2d9407.log`). The browser journeys cover existing
identity/monetary controls; tag privacy evidence remains the actual DB tests
above. Writer locking, hidden-descendant mutations and indirect readers remain
OPEN; this accepts the bounded tag-read/response slice, not all of R04.

The later atomic transaction-tag writer slice at bd8c7bf strengthens the corrupt
existing-junction mutation contract: GET still filters foreign tag hydration,
while add/set/remove now refuse404 with the entire persisted state unchanged.
Its updated33-case read pilot and clean positive controls passed alongside the
new writer regressions. See TAG-LINK-WRITES.md for the separate source/review/
target evidence; global catalogue merge/delete and indirect readers remain OPEN.
