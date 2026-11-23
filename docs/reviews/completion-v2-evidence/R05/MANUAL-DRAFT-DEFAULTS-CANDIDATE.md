# R05 manual draft defaults candidate

Allocation30 October2026; implementation/evidence pending. Governing plan is
`MANUAL-DRAFT-DEFAULTS-NEXT.md`, master R05.1/NEW-26 and matching companion R05.
This is a continuation of the approved local campaign, not a packet closure.

Canonical base: `82665218bb1f0826405300b3f700e83a0cced499` (clean before allocation).
Derived author:
`C:\Users\USER\.codex\worktrees\capital-r05-manual-drafts\personal-finance-app`
branch `codex/r05-manual-drafts`. All95 personal-preference source/test files were
copied and hash-verified from frozen candidate
`3b5250f16bad6e07c6d0119b70d5e887088f752d78e01689b96fb9a043c7a496`.
The old author stays frozen. Existing ignored dependency junction is reused.

Reconciliation found no owned PostgreSQL/browser processes. Separate R09 chat
remains terminal with its unchanged network-permission failure; no duplicate
R09 work is started. The previous goal turn made concrete implementation and
verification progress; no blocked-goal condition applies.

## Ownership and settled interface

- Sol Extra High manual_draft_core: transactionFormUtils.ts, useTransactionForm.ts,
  schema typing only if necessary, small initialization helper/hook and focused
  helper/hook tests. Preserve mutation/financial semantics.
- Sol Extra High manual_draft_ui: AddTransactionModal.tsx, small readiness component
  and focused modal tests. Preserve existing fields/attachments/goals/recurrence.
- Independent Sol Extra High code reviewer manual_draft_review: assumptions,
  test meaning and final source review, read-only.
- Parent: protected Node24 execution, serialized runtime/broad checks, evidence
  and canonical checkpoint. Maximum four active agents, including parent.

Hook interface for the UI: draftPreferencesStatus is loading/error/ready;
retryDraftPreferences retries the failed preference load. New drafts wait for
initial preference resolution; existing edit values remain usable independently.
An initialized draft must not reset on background preference refresh or refetch
error. Required date validation remains strict even when a blank input is allowed.
Cancellation remains available during initial loading/failure. Both UI and hook
must prevent premature submission. No arbitrary timezone precedence is introduced.

The user authorized implementation and meaningful regression tests. Workers add
failing tests first; parent runs the protected focused tests before production
changes. Shared database, real messages/providers, deployment and release gates
remain unchanged. Astra High final review/canonical source integration remain
separate from independent Sol review and local evidence.

## Initial failing evidence and review findings

Parent protected Node24 unit run of helper/hook/modal tests recorded16 failures
and5 passes across21 tests before production edits (`draft-red.log/.exit1` in
author `.local/r05-manual-drafts/`). This reproduced the false-date no-op,
preference-driven resets, absent readiness/retry and unsafe premature submission.
Later additions are not retrospectively counted as part of this RED run.

The modal tests deliberately mock the hook boundary and unrelated child sections;
they prove readiness presentation and submit blocking, not real date-field or
transport behavior. Core tests use real RHF/schema with mutation boundaries mocked.
A separate parent-owned protected browser window will test real settings, draft
fields and persistence. Sol Extra High manual_draft_browser owns only the new
browser spec/config registration after the UI worker released its slot.

Review highlighted edit-tag behavior: preserving dirty draft fields must also
preserve unedited tags when their query arrives late. A targeted actual hook RED
reproduced a normal edit calling setTransactionTags with[] before tags were known
(`tag-save-red.log/.exit1`,1 failed,11 filtered). The bounded repair must avoid
that replacement while still honoring explicit tag clears.

A second review finding concerns the RHF default baseline: setting late tags
without updating their clean baseline can make an explicit clear back to[] look
clean and restore old tags on rerender. A registered-field regression and repair
are in progress. No final source freeze, passing checks or runtime acceptance for
this slice is claimed at this checkpoint.

## Source verification and first browser attempts

The registered late-tag-clear regression initially also exposed an unawaited
async act in the test. That failed log remains `tag-clear-red`. After correcting
only the test await, two clean REDs reproduced the baseline issue and a second
race: tags chosen while the transaction update awaited could wrongly authorize
writing the old captured[] (`tag-boundary-red`,2 failed,13 filtered).

Production now updates the clean baseline for late hydrated tags and captures
tag-write intent before awaiting the transaction update. Explicit clears remain
meaningful, while unknown tags are preserved. The required z.date submission
schema is unchanged. Per-open initialization preserves explicit prefills and edit
values, waits for new-draft preferences, and freezes defaults after readiness.
Existing lifetime checks prevent initialization/submission from retired identity.
Modal readiness has accessible loading/error/retry with Cancel available.

All26 focused tests in3 files passed (`draft-green`, exit0). Full Node24 check
passed (`check`, exit0). Independent general and TypeScript reviewers cleared
the source delta and its stated test boundaries. Source remains uncommitted;
Astra review, full runtime and wider requirements are separate.

Owned PostgreSQL19404 started with explicit127.0.0.1:55432 and a hidden tracked
launcher. Fresh marked `pfa_completion_drafts_r05d20261030a_test`, runId
`r05d20261030a`, installed15 migrations; preflight had zero users/households/
transactions/other connections. Owned browser origin is127.0.0.1:54328.

First browser attempt failed before login: Sign in had not rendered in30seconds
and screenshot was blank. Cause remains unresolved; shared Vite optimizer cache
is a hypothesis, not an adjudicated diagnosis. The unchanged timeout was retained
while bounded pre-credential module/error diagnostics were added. The second run
reached saved preferences and the actual draft, showing the intended blank date
and income mode, then failed inaccurate test selectors: accessible Date button
contains Pick a date; the disabled income merchant picker has visible text but
no accessible name. That inherited merchant naming debt is not repaired here.

Selectors were corrected against the actual accessibility snapshot. Diagnostics
were also changed to write a JSON file explicitly: attaching a body alone did
not persist it under the line reporter. Earlier failure logs/screenshots remain
preserved. Final check/browser retry and lifecycle cleanup are still pending at
this record point. No cold-start reliability or production claim is made.

## Final local checkpoint

The final repository check passed after diagnostic/selector corrections. The real
Chromium journey then passed in22.7seconds (`browser-final.log/.exit0`): UI account
creation; acknowledged off-date/income preference save and SQL readback; fresh
preference GET; real empty date field; required-date error with zero POST and zero
transaction rows; manual calendar selection; exact POST201 payload and SQL row
for income27.35; reopen with blank date, income default and reset amount; Cancel.
This is one development-mode, Africa/Lusaka manual income journey, not expense/
transfer posting, edit-tag persistence, midnight timezone or R08 closure.

Durable initial-render diagnostics show HTTP200, login ready in1347ms,136 script
modules started/finished and no failed modules. The only request failure was the
expected blocked external Google Fonts request under the existing egress guard.
These warm-run facts do not explain or clear the first cold blank-page failure.
The two failed runs and snapshots remain preserved. The validation screenshot
was attached in memory by the test but not persisted by the line reporter; no
durable successful screenshot is claimed. The JSON diagnostics are on disk.
The independent general reviewer also cleared the final test-only locator and
durable diagnostic-file changes after inspecting those exact final bytes.

Final104-file source freeze, author `.local/r05-manual-drafts/source-freeze-final.json`:
`863a619d54910d24b22d75a1c97c0a6850b04186162a57c2405558d845ede2d8`.
All95 previous-author files were rechecked unchanged in that author. In this
derived candidate the only inherited-file delta is the added Playwright testMatch;
the new manual-draft paths account for the other additions/changes.

Canonical44-file receipt, `.local/r05-manual-drafts-oct30/receipt.json`:
`e47f46c9bd73f85a24c2f2a0cc08ba0367f666d51ad3fb9a3faa1f09c2bec065`.
Readback retained3 synthetic users/households from three attempts,2 accounts,
2 saved preference rows and1 transaction for27.35. No other users/households or
client connections were present. Owned PostgreSQL19404 was identity-checked and
stopped; browser54328 had no listener. No production/shared target was touched.

Source remains uncommitted in the derived author, pending Astra High final review
and canonical integration. This canonical checkpoint contains documents only.
All101 groups and the campaign goal remain OPEN. `ACCOUNT-MEMORY-NEXT.md` records
the next real consumer gap, including global storage and post-await lifetime risks.
