# Existing R05 settings candidates: integration map

Read-only lineage disposition at canonical
`b8f66f0de7bc64ef6d9ddf5d9f1d214e336c4b1d`, 31 October 2026. This scopes existing
work, not a new feature allocation or source/runtime acceptance. Protected
database/browser acceptance remains subject to the outstanding runtime retry.

## Avoid merging inherited snapshots

Recap `53fcdf14` owns nine paths. Report snapshot `d715fcc0` contains those nine:
eight are identical, while `UserDisplayPreferences.ts` adds the report-helper
import and report PATCH/reset operations. Its report scope is 37 additional paths
plus that repository extension.

Writer snapshot `4bc66688` combines 58 paths. Its own server work spans the
settings controller, investment notification route, notification repository and
writer contention test, report helper and two legacy-widget tests. Shared client
hook/test changes reconcile inherited work. The later notification correction
`13efc5ad` is absent from that snapshot and must survive any integration.

Although none of the 58 writer versions is byte-identical to current canonical,
54 canonical paths remain unchanged from writer base `61addbf0`. The other four
contain independent work requiring deliberate hunk reconciliation:

- `client/src/hooks/use-settings.ts`: personal-preference contract, endpoint,
  acknowledgement and lifetime guards.
- `client/src/hooks/__tests__/use-settings.csrf.test.tsx`: personal endpoint and
  realistic response fixture.
- `client/src/pages/Dashboard.tsx`: R18 timezone-aware greeting.
- `client/src/pages/__tests__/Dashboard.test.tsx`: greeting/timer coverage.

## First coherent batch: recap and notification writers

The exact 22-path set is the union of the nine recap freeze paths, the twelve
notification paths at `13efc5ad`, and these two writer additions:

- `server/repositories/UserNotificationPreferences.ts`
- `server/modules/settings/__tests__/completion-r05.notification-writers.realdb.integration.test.ts`

This comprises 14 server/shared paths and eight client paths. Source selection:

- Use recap's display repository for this batch. The full writer version imports
  the report helper and prematurely adds the next batch's report scope.
- Reconcile the settings controller with the writer version: preserve recap and
  display handlers while adding transactional general-notification writes.
- Use the writer investment route, notification repository and contention test
  so general, investment and recap writers all share the user-row lock.
- Preserve the latest notification response validation and real caller tests
  from `13efc5ad`, together with canonical personal-preference hunks.
- Use corrected recap client/test versions from `86e8ba38`, cleared by
  RECAP-FINAL-REVIEW-2026-10-31.md, instead of the old versions at `53fcdf14`.
  Its two-file correction does not change this batch's path count.

Do not integrate recap alone and claim the first-creation race fixed: canonical
general/investment writers do not yet share its lock. This combined batch also
retains route-specific creation defaults, atomic general batches and the existing
after-commit audit policy. No new schema or preference architecture is proposed.

## Following report batch

The exact set is the 46-path report freeze minus the nine recap paths, plus:

- `server/repositories/UserDisplayPreferences.ts` with its report extension.
- `server/modules/settings/__tests__/completion-r05.report-legacy-widget.realdb.integration.test.ts`
- `server/repositories/__tests__/ReportWidgetPreferences.legacy.test.ts`

Use the writer snapshot's legacy-corrected `ReportWidgetPreferences.ts`. This is
40 touched paths, 37 additional to the first batch; only the settings hook, its
CSRF test and the display repository overlap. The combined union is 59 paths.
Retain canonical greeting/test changes while adding dashboard autosave handling.
Report PATCH/reset must extend the same locking repository, not restore older
independent read/merge/write behavior. Whole-chart-array conflicts remain open.

## Evidence boundary and next allocation

The formulas refer to the exact freezes recorded in RECAP-WIDGET-CANDIDATE.md,
NOTIFICATION-CANDIDATE.md, REPORT-SETTINGS-CANDIDATE.md and
SETTINGS-WRITERS-CANDIDATE.md. Source comparison alone does not approve any batch.
The reviewer of the original nine recap paths has not reviewed the entire writer
or report package. Current-base ports need independent review of the reconciled
source, affected-caller checks and applicable fresh protected acceptance.

No port worktree, application changes or runtime was created by this disposition.
Finish corrections/reviews within existing authors before allocating a current-
base port; do not open separate duplicate feature lanes for inherited versions.
