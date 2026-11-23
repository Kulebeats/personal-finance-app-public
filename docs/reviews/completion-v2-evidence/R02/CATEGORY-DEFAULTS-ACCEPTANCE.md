# R02 category-defaults checkpoint acceptance

Status: **accepted locally by parent Astra, 28 October 2026**.
Baseline: `8dd829a9156f287a4b65a13cb062eaec425bc7e3`.
Plan: `docs/plans/2026-10-28-r02-defaults-and-mail-execution.md`.

## Final disposition

The bounded category-defaults checkpoint passed independent general and
TypeScript/security reviews, parent final source/evidence adjudication and fresh
integrated verification on `ac9708cc0d97270a813913240ef187fbfda6fc12`:

| Gate | Observed result |
|---|---|
| Complete protected server regression | 240 files / 3,316 tests passed, exit 0 |
| Author nonincremental TypeScript; integrated npm check | Both passed, exit 0 |
| Production build and bundle budget | Both passed; 190.35 kB initial gzip / 300 kB budget |
| Protected Chromium journeys | 8 passed in 1.6 minutes, zero retries, exit 0 |

New households receive their defaults atomically. Repeated initialization and
existing customized/archived/deleted catalogues retain existing IDs and fields;
groups-only catalogues fail explicitly. The new real-UI case moved from a missing
Salary option to a successfully persisted transaction with its category and group
in the newly created household. No manual category insertion supplied that result.
Full R02/J01, G1, all 101 canonical groups and production acceptance remain open.

The sections below preserve review and red/green history; this final disposition
supersedes their earlier integration-pending statements.

## Contract and independent source review

Parent accepted the category author's empty-tree-only initializer design after
independent review identified missing immutable seed provenance. Any existing
category row, including custom, archived or soft-deleted, must be preserved with
an unchanged no-op. Groups-only catalogues return explicit conflict; no automatic
repair/reset is inferred. A fully empty catalogue receives the current unchanged
13 groups and 84 categories in the household-creation transaction. Standalone
initialization must also be atomic and serialize same-household calls.

The independent reviewer accepted the plan and then found two parent browser-test
fixture issues before execution: household creation returns `data.household.id`,
and the default Salary category's icon contributes to its accessible option name.
Both were corrected before the red run. The reviewer re-read and accepted the
repaired source, including reload persistence and independent household/category
ownership assertions. This is source review, not reviewer-executed runtime proof.

## Red evidence

Category author recorded nine focused real-DB regressions failing against unchanged
production baseline. Parent subsequently read the failed summary and current
focused green logs; exact commands and scopes are in `CATEGORY-DEFAULTS.md`.

Parent ran the single new browser case against unchanged application source with
the pinned Node 24.22.0 runtime and protected Golden target:
`node scripts/run-protected-tests.mjs database playwright test e2e/completion-r02-defaults.spec.ts --config playwright.completion.config.ts --project chromium`.
Manifest: canonical `.local/r20-golden/target.json`; run `r20ga15a1`; database
`127.0.0.1:55432/pfa_completion_golden_r20ga15a1_test`; owned origin
`http://127.0.0.1:5157`. One worker, zero retries, existing guards unchanged.

Observed exit 1: actual login, household creation, account creation and opening
the transaction category picker succeeded. The Salary default was absent and the
existing 15-second click timeout fired. The recorded DOM listbox contains only
Uncategorized; no default category was manually inserted. The foreign Golden
category was also absent. This is the intended missing-default behavior, rather
than a response-shape or selector failure. Log:
`.local/r02-session-access/category-browser-red-oct28.log`.
The owned browser server exited and no listener remained on 5157.

## Acceptance requirements at kickoff

Review the frozen implementation and its focused red/green, transaction rollback,
repeat/concurrency and preservation evidence. Parent integrates accepted source,
then runs applicable full server/static/build/browser acceptance. Preserve the
red record and separately report current green results. Full R02/J01, G1, all 101
groups and production/mail acceptance remain open.

## Frozen source review and integration

Author candidate `fb7bf588d4e92f7bd120d64231fba682de3aef66`, direct base `8dd829a`,
contains exactly five owned paths. Independent Sol general/security review and
separate Sol TypeScript/async/security review accepted that exact SHA with no
actionable findings. They inspected source and supplied evidence, not rerun tests.
Parent Astra separately read the helper, transaction composition, unchanged
configuration mapping, full new regression source and raw red/green/static logs.
The frozen source is accepted for integration, subject to integrated acceptance.

Evidence scopes remain distinct: 16 real-DB tests across three files; final 13-case
rerun after a test-only fail-fast barrier correction; 110 existing mocked tests;
fresh nonincremental TypeScript and npm check exit 0. The first npm check failed
because the household repository grew one line past its LOC ratchet. A redundant
comment line was removed; baseline limits and executable source behavior were
unchanged. The failed log remains retained. Silent TypeScript log success relies
on the author tool-observed exit 0, not empty output alone.

Parent integrated as `ac9708cc0d97270a813913240ef187fbfda6fc12` with author provenance.
Git comparison confirms canonical server/shared/client/package/lock parity with
the author candidate. The mail-documentation-only change was integrated separately
as `72007d3` from `dec0eab5bb9d7833636bfcaab9e540f73c7e5b29`; it does not alter
runtime behavior or authorize the deferred standalone SMTP component.

Both reviewers also accepted the parent browser spec. Its reviewed SHA256 is
`998D25EBCFB9D1FABB8E15565BC9BBD5C6766B819585866968D12B17B83853C7`;
config SHA256 is `4B9A1E72E586C7865CDDDC5CFC48D1637EDB10CEFEA1F6EF7308839486055367`.
The complete protected server suite passed on this fixed source: **240 files /
3,316 tests**, exit 0, 571.69 seconds. It used the marked identity target, one
worker and verbose reporting. Command:
`node scripts/run-protected-tests.mjs database vitest --server run --maxWorkers=1 --reporter=verbose`.
Log: `.local/r02-category-defaults/server-integrated-oct28.log`.
Target: canonical `.local/r01-integrated/target.json`, run `r01int15a1`,
`127.0.0.1:55432/pfa_completion_identity_r01int15a1_test`.

Integrated `npm run check`, `npm run build` and `npm run check:bundle` all exited 0.
Logs are `.local/r02-category-defaults/check-integrated-oct28.log`,
`build-integrated-oct28.log` and `bundle-integrated-oct28.log`. Initial gzip remains
190.35 kB against the unchanged 300 kB budget. Client source is unchanged from the
accepted 1,497-test baseline; no repeat client-unit run is claimed or required
solely for these server changes.

The full protected Chromium run then finished exit 0: **8 passed in 1.6 minutes**,
one worker, zero retries. It used the same separately marked Golden target and
owned origin described in the red run. Command:
`node scripts/run-protected-tests.mjs database playwright test --config playwright.completion.config.ts --project chromium`.
Log: `.local/r02-category-defaults/browser-integrated-oct28.log`.
The new case selects the actual Salary default, submits a real income transaction,
reloads and independently joins transaction/category/group rows to verify their
IDs and household ownership. It also rejects visibility of the old Golden
household's category. Existing revocation, session-entry/context, Golden persistence
and omitted-submit negative cases all passed unchanged.

Parent verified final source parity with the reviewed author commit and unchanged
reviewed browser-spec hash. The owned browser server exited; no listener remained
on 5157. Primary checkout stays at `381e9439afabe7c6cf829cb1cbded91d36da44ee` with
its pre-existing untracked material preserved. Final parent commit adds only the
reviewed browser/config change and plan/ledger/acceptance documentation.

Mail preparation is separately complete as reviewed documentation. Its standalone
component remains deferred. Read-only next-slice preparation chose a narrow
token-authorized verification CSRF design and proposed a native resolution/byte
observation milestone; neither was implemented, executed or granted full-profile
runtime acceptance during this checkpoint.
