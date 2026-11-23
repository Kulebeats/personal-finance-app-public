# R05 notification writers: final bounded source/evidence review

31 October 2026. Independent Astra final review of the shared notification writer
slice at author `4bc66688820c301596e247330e07c9b9e8032e4a`, against canonical
`f96905c95faa671cef6ceb86a395dc96e62a5306`. Both checkouts were clean when inspected.
No tests, application runtime, database, browser, network or child agents were
started by this review. Only this review artifact was written.

**Disposition: bounded source clearance; no actionable findings in this slice.**
This clears the reviewed writer source for deliberate reconciliation into the
coherent recap/notification port. It does not approve a whole-file or 58-path
merge, establish current-base runtime acceptance, or close R05.

## Exact scope and integrity

Author root:
`C:\Users\USER\.codex\worktrees\capital-r05-setting-writers\personal-finance-app`.
The four scoped files match the bytes and SHA-256 values in the author freeze:

| Path | SHA-256 |
| --- | --- |
| `server/modules/settings/settings.controller.ts` | `dfd07b5b2a20e652acc98541deda05f42b350c890ecb2f86c517b8a8d95e7787` |
| `server/routes/investment-notifications.ts` | `d387e2ae59f4a31049da79689513e1ea3f84eb11d0138d9e725ea1066228dc29` |
| `server/repositories/UserNotificationPreferences.ts` | `e1e9ad7ecd63cdc03b18cfc29e8904b838506d5f683521b0b3ae52ef071e5c53` |
| `server/modules/settings/__tests__/completion-r05.notification-writers.realdb.integration.test.ts` | `0c6c01a81d5c4d1c1499b72567fe78e03b9d0a764a3c5024bbdaf2c476ea62ea` |

The controller clearance covers its notification writer hunks and necessary
caller compatibility; hashing the whole file does not extend approval to the
report work carried in this lineage. Relevant authentication, audit and recap
locking callers were inspected. Report-helper, legacy-widget and client changes
were excluded.

Verified author `.local/r05-setting-writers/source-freeze-final.json` SHA-256:
`bc0a21c57cb9a1843554debc8a570ee4fbfc6a6a3d6b6fb72dd6df1c1044ccc8`.
Verified canonical `.local/r05-setting-writers-oct30/receipt.json` SHA-256:
`f01e47df8085d77413ed13dddaa23dbe8629cf9d8ba976fb8a6f18cf2692614a`.
All 50 receipt artifact hashes and byte lengths matched. Integrity of unrelated
artifacts is not substantive review or acceptance of their source.

## Source adjudication

- **Serialization:** `UserNotificationPreferences.ts:31-41` takes the existing
  authenticated user's row lock before reading or creating any preference, then
  holds it throughout the batch transaction. Recap already takes that same user
  lock before its display/preference work. The shared writer never acquires a
  display lock afterward, so this slice introduces no reverse lock order.
  Participating same-user writers serialize even when the preference row does
  not yet exist; disjoint fields are read after the preceding commit.
- **Partial fields and defaults:** existing-row updates preserve omitted fields;
  explicit `false`, threshold zero and threshold `null` remain distinct from
  omission. General creation keeps email disabled by default; investment
  creation keeps email enabled. The first creator supplies defaults and a later
  writer changes only submitted fields. This preserves the existing route
  contracts rather than imposing one new default on both.
- **Atomic batch and audit:** the controller validates the complete batch before
  calling the repository. A later SQL failure rolls back earlier writes in that
  transaction. Audit calls occur only after successful return/commit. The
  existing `BusinessAuditService` behavior remains best effort outside the
  transaction; this is not a guarantee of atomic or exactly-once audit delivery.
  The investment route retains its corresponding after-commit audit behavior.
- **Identity and callers:** the authenticated general route uses the session
  subject and the investment route uses the freshly resolved authenticated user;
  neither accepts a payload-selected owner. Preference lookup is scoped by user
  and type. Existing response envelopes and touched-row order remain compatible.
  Replaced live general/investment calls now use the shared writer; preserved
  legacy repository/facade definitions are not evidence of an additional live
  bypass. Registration seeding and direct database writers are not certified by
  this locking protocol.

The schema has no new user/type uniqueness constraint or duplicate repair in
this slice. Clearance concerns serialization of the participating live writers,
not cleanup of historical duplicates or protection against arbitrary direct SQL.
That limitation is not a newly introduced defect.

## Historical evidence and its limits

The scoped test file contains **seven cases**: five real HTTP contention cases
(general/recap in both orders, general/general, general/investment in both orders),
one invalid-batch refusal and one later-write database-failure rollback. The
contention helper holds an actual PostgreSQL user lock and inspects blocked SQL
for a user-row `SELECT ... FOR UPDATE`, rather than treating a foreign-key insert
wait as equivalent. Assertions use direct persisted reads, HTTP readback where
applicable, exact row counts and a separate user's sentinel. The failure trigger
is limited to the synthetic subject/type and has bounded cleanup. These are
meaningful independent behavioral oracles, not mocked repository results.

Retained logs reviewed:

| Log under author `.local/r05-setting-writers/` | Historical result | SHA-256 |
| --- | --- | --- |
| `server-red.log` | Writer suite: 6 failed/1 passed; aggregate includes another suite | `62b0284fe6c52a37ef88efbee75b742d49d617e005f4dbdd7533f4eb3cb6deb2` |
| `server-green.log` | 103 passed across 8 files | `463965a957a66195a49c90da768fbfdf9f75c527028ed6370b60954e3071e806` |
| `server-audit-compat.log` | 1 passed/5 skipped | `69ebd581df08ea5cebe97f06df5b5e4cd8c36b6a2496d417dff7af7918e69e4d` |
| `check-final-typed.log` | Full static check exit 0 | `b525a61dcdababdf099c54829447b8e4e73959257af8506fcb32df5258466ec6` |

The GREEN summary does not independently enumerate its eight filenames or every
test. The handoff attributes the writer suite to that run, and the frozen source
contains seven cases; **103 is not writer-specific coverage**, nor is the summary
alone a separately named seven-case execution trace. The scoped RED failures
demonstrate missing explicit user locks and partial persistence before repair.

The retained pre/postflight records identify the protected disposable synthetic
target and zero leftover fixtures, failure triggers/functions or other
connections. The startup reconciliation preserves both the earlier bind failure
and the delayed observer's post-shutdown failure; neither is silently converted
to GREEN. The actual preflight preceded the accepted run, and shutdown evidence
is historical. None of this constitutes a fresh database run at canonical or a
current process-identity assertion.

## Integration boundary and next dependency

Follow `SETTINGS-INTEGRATION-MAP-2026-10-31.md`: reconcile the coherent 22-path
recap/notification batch, including this shared writer and both route callers.
Keep recap's reviewed display repository without importing the next report
batch. Retain notification correction `13efc5ad`, recap correction `86e8ba38`,
and canonical personal-preference changes. The old writer snapshot cannot replace
those newer clients wholesale. The reconciled current-base diff needs its own
review and applicable fresh checks; fresh protected DB/browser acceptance remains
pending the outstanding runtime authorization. This review grants no alternative
executor, integration execution, browser acceptance or whole-R05/release approval.

## Review Summary

| Severity | Count | Status |
| --- | --- | --- |
| CRITICAL | 0 | pass |
| HIGH | 0 | pass |
| MEDIUM | 0 | pass |
| LOW | 0 | pass |

Verdict: APPROVE the bounded shared notification writer source slice and the
historical evidence interpretation above. Current-base integration and fresh
runtime acceptance remain separate gates.
