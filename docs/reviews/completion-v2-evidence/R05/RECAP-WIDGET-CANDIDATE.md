# R05 recap and dashboard preference candidate

Status: nine-file candidate implemented, tested and independently reviewed;
frozen in its author worktree pending Astra final review and canonical
integration. R05 and all canonical closure groups remain OPEN.

## Authority and ownership

The master R05.1 contract requires widget changes to preserve recap settings,
independent recap and calendar days, per-user isolation, and save/read/reload
proof. Existing local implementation authority applies; no external send,
provider, production/shared database or release authority is added.

Author checkout:
`C:\Users\USER\.codex\worktrees\capital-r05-recap-widgets\personal-finance-app`
on `codex/r05-recap-widgets`, base
`d57ce7d757ac8313940caa8c564313d4c617776c`.
Its ignored dependency junction targets the existing canonical installation.
No packages were installed or lockfiles changed.

- `recap_widget_trace`, Sol Extra High: read-only current-source trace.
- `recap_server_patch`, Sol Extra High: display repository/helper, display and
  recap settings handlers, necessary validation, and focused real HTTP/DB tests.
- `recap_client_patch`, Sol Extra High: WeeklyRecapSection and rendered tests.
- Coordinator: serialized database/broad checks, evidence, review scheduling
  and later integration. Independent reviewers are assigned after authors stop;
  Astra High final review remains required.

The profile and notification author worktrees are separately frozen. No edits
to them are authorized by this allocation. General settings controller changes
will require hunk-level reconciliation at integration.

## Current-source defects and bounded repair

At the base, display saves replace dashboardWidgets, whose weeklyRecap member
stores recap day and content options. Recap PATCH reads/merges/writes the same
JSON and updates firstDayOfWeek, including when only a notification flag was
supplied. Its fallback day also derives from the calendar preference.
Concurrent initial creation can race across get-then-insert writers.

The recap form initializes from an initially absent query result and uses a
second useState initializer instead of responding to fetched data. It submits
all defaults, potentially replacing persisted preferences.

Repair the existing storage contract: atomically preserve disjoint settings,
serialize initial creation and merges, preserve omitted fields and explicit
false/zero, and make recap day default to Sunday independently of calendar
week start. Recap notification and display changes must commit together.
Keep user ownership and existing channel/threshold values. No schema migration
or new preference architecture is intended.

The form must render fetched values, submit only changed fields, retain failed
and newer in-flight edits, and reuse the existing session/query lifetime
boundary. Loading/errors must not permit unknown server state to be overwritten
with defaults.

## Verification plan

1. Preserve failing actual-route/disposable-PostgreSQL regressions before server
   production edits. Prove the existing target marker before any fixture write.
2. Verify sequential and deterministic concurrent dashboard/recap writes,
   initial creation, omitted fields, false/zero, calendar independence and
   neighboring user isolation through fresh HTTP reads and direct SQL.
3. Preserve rendered client RED/GREEN evidence for delayed fetch, partial save,
   retry, pending edits, reload and identity boundaries.
4. Run the scoped combined tests and repository checks; independently review
   source and evidence, freeze exact files, then request Astra final assessment
   when available. Integration and browser acceptance remain distinct.

## Following work, not closed by this slice

The trace also identified report-widget read/merge/write races in the separate
reportWidgetPreferences column and dashboard autosave failure handling that
need subsequent scoped work. Report-widget concurrency, full settings/shared
views, currency/history policy and wider R05 acceptance remain OPEN. This
candidate does not establish scheduled recap generation or delivery (R16).

## Implemented candidate and source identity

`server/repositories/UserDisplayPreferences.ts` now uses the existing user row
as a serialization anchor before ensuring/locking the display row and reading
current values. UserRepository creation is conflict-safe and its update delegates
to this helper. Display PUT merges only widgets/version into current JSON;
recap PATCH preserves calendar, layout and unknown siblings. Recap notification
and JSON changes share one transaction. Omitted notification columns, push and
threshold values are preserved. Notification-only changes do not rewrite the
dashboard JSON. Recap GET takes the matching shared user lock for its two reads.

The display controller and recap controller delegate to these operations.
The existing recap integration test's expectation that recap Monday changes
the calendar was corrected: calendar Sunday remains unchanged.

The form derives its displayed values from fetched settings and revisioned
field drafts. It sends only changed fields, retains failed/newer edits and
pending reverts, and accepts only a successful response with all five valid
fields. Its actual protected transport, CSRF and operation-lifetime controls
remain in use. The existing CSRF test response now supplies the complete five
settings fields; its request/security assertions are unchanged.

Author freeze: `.local/r05-recap-widgets/source-freeze.json`, SHA-256
`c916fc2429ea7850655afd754afda7d12f725acb07f9b391a1c54eebd0b00916`.
It pins these nine paths:

- client/src/pages/settings/__tests__/settings-sections.csrf.test.ts
- client/src/pages/settings/sections/WeeklyRecapSection.tsx
- client/src/pages/settings/sections/__tests__/WeeklyRecapSection.persistence.test.tsx
- server/repositories/UserDisplayPreferences.ts
- server/repositories/UserRepository.ts
- server/modules/settings/settings.controller.ts
- server/modules/settings/__tests__/completion-r05.recap-widgets.realdb.integration.test.ts
- server/modules/weekly-recap/weekly-recap.controller.ts
- server/modules/weekly-recap/__tests__/weekly-recap.integration.test.ts

## Executed verification and preserved failures

All following logs and paired `.exit` files are in the author's
`.local/r05-recap-widgets/`. Node 24.22.0 Windows ARM64 ran the protected
test wrappers. Database runs used the explicit disposable target below.

| Evidence | Result and scope |
|---|---|
| server-red | 11 failed, 1 passed before production edits; actual HTTP/DB overwrite, day, race and partial-persistence failures |
| server-green | 38 passed: 13 new plus 25 existing recap cases |
| server-red-day | 2 fractional-day failures, 20 filtered; API accepted 1.5 and GET returned it |
| server-green-day | Final 47 passed: 22 new plus 25 existing cases |
| client-red | 11 failed, 4 passed against the original form |
| client-green-attempt1 | 1 failed, 29 passed: immediate rendered assertion raced React Query's batched notification |
| client-green-before-response-validation | 30 passed after waiting for the rendered update; production code unchanged for this test correction |
| client-red-response | 10 failed, 15 passed before malformed-response guards |
| client-green | Final 40 passed across rendered recap, CSRF and operation-lifetime files; aggregate historical result |
| check | Initial full repository check passed |
| check-final-day | Final full repository check passed after the integer-day repair |

The coordinator executed the HTTP/DB runs and full checks; the client author
executed the focused client suite. Independent reviewers inspected source and
tests, not independently rerun results. The database contention cases observe
real HTTP writers blocked via pg_blocking_pids before releasing locks, then
assert fresh HTTP reads and direct SQL. They cover existing rows, first writes,
GET initialization, disjoint recap writes and one logical recap preference.
Paired test-owned PostgreSQL failure triggers verify rollback when either
persistence step fails; neither table may retain a partial change.

Both general and TypeScript reviewers found a real boundary mismatch: the
server accepted fractional days while the newly validated client rejected
them. The live PATCH schema now requires integer 0–6. Historical malformed
stored days read as independent Sunday 0 without a GET storage rewrite.
The added cases reject -1/1.5/7 with unchanged rows, read historical numeric and
string invalid values without rewriting them, and accept both valid endpoints.
Both reviewers re-reviewed the repair and reported no remaining scoped finding.

The reviewer also considered stale GET completion after PATCH. No current
production trigger was found: Save waits for initial settings, Retry is only
offered without settings, and the active query client disables focus refetch
and uses infinite stale time. If another caller later invalidates this key,
it must address in-flight response ordering. This is not claimed as a tested
general-purpose cache ordering solution.

## Target, cleanup and remaining gates

Explicit manifest: canonical `.local/r01-integrated/target.json`, run marker
`r01int15a1`, database `pfa_completion_identity_r01int15a1_test`, loopback port
55432, role pfa_campaign. Marker verification preceded fixture writes. Owned
PostgreSQL PIDs 15616 and 10816 were each smart-stopped after their windows.
Readbacks found zero r05w fixture users, zero other connections, no remaining
failure triggers/functions, and zero legacy recap test users/households after
the final run. These checks do not claim a count of every historical test
session in the disposable database.

Canonical evidence lives under `.local/r05-recap-widgets-oct30/`, including
preflight/postflight, failure-object cleanup and shutdown records. Consolidated
`receipt.json` SHA-256:
`d1af19eaf642364e043622f06de3181fdf8807c7af28f94eb36726755ce96557`.
It rechecks all nine source hashes and pins 41 evidence files.

No source commit, canonical integration, browser journey, staging or release
acceptance is claimed. Astra High final assessment remains pending under the
existing availability gate. The general notification endpoint can still race
recap first creation because it does not yet share this serialization contract;
report-widget stale merges also remain open. Preserve those followups and the
separate profile/notification freezes when integrating shared-file hunks.

## Value acknowledgement repair, 31 October 2026

The preceding pending-review/uncommitted labels are historical. Astra reviewed
preserved candidate `53fcdf14`, verifying all nine source pins and 41 historical
evidence artifacts. It found one MEDIUM: a fully shaped successful response could
contradict submitted values while clearing the recap draft. The original finding
and final adjudication remain in RECAP-FINAL-REVIEW-2026-10-31.md.

Corrected author HEAD is `86e8ba387ca7053ad4a97857e8b80e5472292d30`, clean on
`codex/r05-recap-widgets`. The two-file correction requires each defined submitted
field to equal the validated response before success/cache effects. It preserves
false, day zero, JSON omission, changes to unsent fields and the existing revision
and session-lifetime behavior. No server bytes or schema changed.

Nine added controls use the real rendered component and protected HTTP caller
with controlled responses. Before the production change, the suite recorded six
expected failures and 28 passes. The same test bytes then passed with old CSRF
and operation-lifetime callers: 49/49 across 34 rendered, seven CSRF and eight
operation-lifetime cases. Fresh full repository checks passed. A mistaken lifetime
test filename was caught by a coordinator prelaunch existence check; no Node/test
process ran in that attempt. The refusal and corrected explicit command are
preserved. No browser or database test was run for this client correction.

Author packet `.local/r05-recap-ack-oct31a/` contains commands, timestamps,
original pins, failed/passed logs, nine-file freeze and clean commit readback:

| Artifact | SHA256 |
| --- | --- |
| `red.log` | `4a58a9b0c596d8e73238ec76f8e442c69a027255d7f39f5c0c5a299004a6b5c7` |
| `green.log` | `21e9f31099faa319679e11b677f6897481cf85a1671094e59452ec0de328a2ce` |
| `check.log` | `05fcd5c5614b1c9bb68b85a6aa392df2d834ba7aa7fa71e02651701cbf615d53` |
| `source-freeze.json` | `d169116487ab93ff7a1dbbb33cfd0fa63b4de1aea8cd0b51d7c7baf68f42ffdd` |

Sol TypeScript and Astra final source/evidence reviews cleared the corrected
scope. Astra rechecked nine source pins and eleven evidence artifacts; report
SHA256 `c7ee2bfc795953e250862654827daaa4f0ad6419651780ad3a242ca31eb35afe`.
All source pins remained unchanged after committing. Historical persistence
results retain their original attribution; this is not integrated acceptance.

Later writer snapshot `4bc66688` already contains the shared notification-writer
serialization repair, but inherits the old recap client. The eventual combined
port must retain this correction and notification `13efc5ad`; see
SETTINGS-INTEGRATION-MAP-2026-10-31.md. Canonical integration, fresh applicable
DB/browser checks, full R05 and campaign closure remain pending. No external
delivery, remote publication, shared/production database or release occurred.
