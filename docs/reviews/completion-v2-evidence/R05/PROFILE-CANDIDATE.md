# R05 profile candidate checkpoint — 29 October 2026

Status: uncommitted in its author worktree, not integrated, pending Astra High
final review. This is a bounded profile-field candidate, not R05/J03 closure.
Shared views, other settings forms and full persistence journeys remain under
the master specification. All 101 canonical groups remain OPEN.

## Resume identity

Author worktree:
`C:\Users\USER\.codex\worktrees\capital-r18-settings\personal-finance-app`.
Author HEAD: `7a953c2871ebac6018e1cbca1742f2002a32c110`.
Do not recreate or overwrite this uncommitted candidate from canonical.

The earlier 20-file R6 freeze is
`.local/r18-settings-oct29/r05-candidate-freeze.receipt-r6.json`, SHA-256
`1c05d2969d150cbf2bc16dda3999e261d2dcb70cb35b092010a456fbf17ac363`.
Compared with the earlier 19-file R3 receipt, 16 files are byte-identical;
`BirthdayPicker.tsx`, `ProfilePersonalFields.tsx` and `useProfileForm.ts`
changed, and `completion-r05.birthday.test.tsx` was added. Earlier receipts
remain historical; an assertion that all original 19 files stayed unchanged
must not be used.

Current hook SHA-256:
`7b899b82cadd28697431354337970a95b387153c5e9eb3b0b346f33afd2b5991`.
Current rendered birthday/lifecycle test SHA-256:
`fd55e2c9e94d8ba84266be6ca457767ba530ff260e987d20a7c01cbe27aa5312`.

## Corrections and review

Astra's earlier review accepted the bounded writer/minimized audit direction
but rejected birthday coercion. Subsequent repairs retain invalid typed years
and calendar days visibly, prevent leap-day/month rollover, preserve current
errors when an older save finishes, reject incomplete picker drafts, and reset
picker state when the profile subject changes. Later reviews caught stale
validation messages on corrected submissions and baseline-restoration no-ops.
All failed candidates and their RED logs remain preserved.

The R6 repair specifically reproduces: blur an empty first name, restore its
original valid value without blurring, then submit. Before repair the no-op
left the required-field message visible. The hook now includes touched fields
with existing non-picker errors in current-value revalidation. It does not
clear untouched legacy errors indiscriminately, and retains picker errors.

Luna Extra High `r05_baseline_error_repair` owned only the hook and regression
test. Independent Luna Extra High general (`r05_r6_review`) and TypeScript
(`r05_r6_types`) reviewers reported no concrete scoped findings on R6. They
considered the added awaited field validation and found no demonstrated
subject/input interleaving with the current synchronous schema rules. This
does not prove behavior with a future asynchronous resolver. The reviewers'
scope does not substitute for the required Astra final review.

Astra's subsequent attempt hit its usage limit. Do not repeatedly retry the
unchanged limit or claim that the earlier conditional review clears these
changed bytes. Final review and canonical integration remain pending.

## Verification and limits

All paths below are relative to the author worktree. Node for parent/focused
runs is the pinned Windows ARM64 `24.22.0` runtime under
`capital-r00-runtime/node-v24.22.0-win-arm64`.

- R6 focused RED: `.local/r18-settings-oct29/r05-birthday-r6-resolver-red.log`,
  15 passed / 1 failed; SHA-256
  `31c1ff7a22bca40eb20f8646321a2748d00c812817b2c468ba1c01fbfbc8f778`.
- R6 focused GREEN: `.local/r18-settings-oct29/r05-birthday-r6-resolver-green.log`,
  16/16 passed, exit 0; SHA-256
  `e43ad690c80ed217c77bb7a2051aef35099f94c8acfaaf2186260efcfc9cea9a`.
- Prior R5 parent broader client: `r05-client-parent-r5.log/.exit`, 118/118,
  nine files, exit 0. Prior R5 `r05-check-parent-r5.log/.exit`: full check exit 0.
  These predate R6 and are not its final verification.
- Older parent LOC failure and all earlier birthday RED logs are retained.

Focused command:
`node scripts/run-protected-tests.mjs unit vitest run --config client/vitest.config.ts client/src/pages/settings/sections/ProfileSection/__tests__/completion-r05.birthday.test.tsx`.

R6 parent verification completed serially with exit 0 throughout:

- `r05-client-parent-r6.log/.exit`: 76/76 tests across seven profile files.
- `r05-check-parent-r6.log/.exit`: full repository check passed, including
  TypeScript, LOC, tool syntax and assessment/worksheet guards.
- `r05-client-boundaries-parent-r6.log/.exit`: 43/43 tests across the CSRF hook
  and settings API-failure preservation files.

These two non-overlapping client selections total 119 tests across nine files.
They cover the same nine-file selection as the prior R5 run plus the new
baseline-restoration regression. This is current author-worktree verification,
not a canonical integrated run or Astra final approval.

At this client-review checkpoint, no database, browser/persistence, production
profile, provider or deployment run had been performed. The earlier reported
DB run was not promoted to current proof; the subsequent independent raw
persistence run and its limits are recorded below.

## Subsequent protected persistence run

The coordinator subsequently ran the existing frozen R6 six-case integration
test in the author worktree with pinned Node 24.22.0. It passed 6/6, exit 0,
against `127.0.0.1:55432/pfa_completion_identity_r01int15a1_test`, run marker
`r01int15a1`, role `pfa_campaign`, PostgreSQL 18.6. Preflight independently
verified the persisted synthetic marker, zero matching fixture users and zero
other connections. The coordinator started only the existing campaign cluster
at `.local/completion-pg`, owned PID 23460. Postflight reverified identity and
zero fixture users/other connections, then smart-stopped that owned process.
No shared database, schema migration, browser or production-profile run occurred.

Canonical raw evidence is in `.local/r05-persistence-oct29/`: `preflight.log`,
`realdb-r6.log`, `postflight.log`, `stop.log`, each with an exit receipt. The
receipt pins those bytes, the target manifest and the rechecked 20-file R6
freeze: `receipt.json`, SHA-256
`0e7d78518644087f3bbe6761f2c32798104e2b17ee6f3ac3c4611b120e4789ce`.

Independent Luna Extra High persistence-oracle review found no writer defect
but narrowed the claims. The audit rejection was mocked and did not assert
transaction propagation; the privacy check excluded only the NRC sentinel.
The security-generation test used a 50 ms delay, not an observed blocked
SELECT, so it did not deterministically prove row-lock acquisition. The main
round-trip also omitted explicit display-name/timezone and credential-key
assertions. These limits apply to the preserved passing R6 run.

`r05_persistence_test_hardening` owns only the existing integration test to
repair those assertions. Parent retains all DB runs and cleanup. Do not infer
that this later test change is covered by R6's freeze or passing result; a new
freeze, independent review and protected run are required. Application source
and the reviewed client correction remain unchanged.

## R7 persistence-oracle hardening and mutation checks

The Luna implementation agent hit its usage limit before editing. The parent
completed only the integration-test change; independent Sol Extra High general
and TypeScript reviewers reviewed it and the subsequent corrections. Both
reported no remaining scoped static finding. Astra final review remains held.

Current 20-file freeze:
`.local/r18-settings-oct29/r05-candidate-freeze.receipt-r7.json`, SHA-256
`046bcd562392ed18973a6000e5235c0cb95f241abd2178f4ccc24a38c90b3af5`.
Only the integration test differs from R6; its current SHA-256 is
`d7d9ae1648f4b72ce84711522509fa7b05a5c68cb0ad0049d9f70c47073c19ed`.
All application/client bytes are unchanged. The saved R6 integration test is
`.local/r18-settings-oct29/r05-realdb-before-hardening-r6.ts`.

The revised test checks an actual display-name/timezone change and GET readback,
forbidden credential keys, exact audit detail keys and field-name membership
with exact length, a genuinely changed disjoint address leaf, and a positive
blocked SELECT observation while the holder owns the user-row lock. The query
probe uses the exact blocking backend and database/role; it does not depend on
the SQL suffix, which PostgreSQL can truncate. A plain SELECT would not wait
on this row lock; the missing-lock mutant must not satisfy this observation.

The audit case checks transaction propagation before calling the real audit
service, then injects an error after its actual INSERT and verifies both the
profile and audit rows rolled back. This proves rollback after a successful
insert, not an actual database failure during audit insertion.

Canonical `.local/r05-persistence-oct29/` preserves the complete sequence:

- `realdb-r7-green.log/.exit` is a historical filename containing the initial
  **failed** run: 5 passed, 1 failed due to expected field-array order. The
  TypeScript reviewer identified schema-order normalization; comparing exact
  membership/count corrected the assertion without weakening allowed contents.
- `realdb-r7-corrected.log/.exit`: 6/6 passed before the final audit guard.
- `mutation-no-select-lock.log/.exit`: removing only `.for("update")` fails
  the positive blocked-SELECT assertion; 1 failed, 5 skipped, exit 1.
- `mutation-no-audit-transaction.log/.exit`: the first missing-transaction
  mutant timed out because its independent audit INSERT waited through the
  user foreign key on the profile's own row lock. Its cleanup hook also timed
  out. This failed harness attempt is not counted as a successful mutation
  oracle. One remaining synthetic neighbor was deleted by exact ID/email after
  verifying the synthetic database marker; `mutation-timeout-cleanup.log`
  records one deletion and zero remaining fixture users.
- `mutation-no-audit-transaction-guarded.log`: the corrected pre-insert
  transaction assertion makes that mutant fail promptly for the intended
  missing-transaction reason; 1 failed, 5 skipped, exit 1.
- `mutation-receipt-r7.json` and `mutation-guarded-receipt.json` confirm exact
  writer-byte restoration. Original/restored writer SHA-256 is
  `974ec91b9401004e2b792def9b78d01e709e73edb7507d9299ea5df5852f3ae0`.
- `realdb-r7-final.log/.exit`: restored source and final test pass 6/6, exit 0.

This second window used the same independently marker-verified target, owned
postmaster PID 6204, zero competing connections before the run, and zero fixture
users/connections afterward. `postflight-r7.log/.exit` and `stop-r7.log/.exit`
record clean readback and smart shutdown. No database or test process is left
running by this window. No schema changes or application changes were retained.

The consolidated raw-evidence receipt is
`.local/r05-persistence-oct29/receipt-r7.json`, SHA-256
`5fce3c1383329e5ca8836d5567937586df06d466e262b6a6ad3c03f770290d1d`.
It pins the final freeze, rechecks all 20 candidate files and preserves the
passing, failed, cleanup and mutation evidence separately. These are author
worktree results; canonical integration, browser journeys and final approval
remain outstanding.

Final R7 author `npm run check` also passed under pinned Node 24.22.0 after
all review corrections: `.local/r18-settings-oct29/r05-check-parent-r7-final.log`
and `.exit` (0). This includes TypeScript, LOC and existing tool/assessment
guards. The prior full check before the final test corrections is preserved
as `r05-check-parent-r7.log/.exit`, not substituted for this final result.
