# R05 report widgets and dashboard save state

Status: derived 30-file candidate tested and independently reviewed, with one
recorded legacy type debt; frozen pending Astra final review and canonical
integration. The master R05.1 persistence/field inventory contract governs it.

## Candidate and ownership

Derived author:
`C:\Users\USER\.codex\worktrees\capital-r05-widgets\personal-finance-app`,
branch `codex/r05-widget-persistence`, base
`e3aa8ee96f756b2c9b023f854802f4aed4ec29c5`.
The nine recap candidate files were copied and verified byte-for-byte against
freeze `c916fc2429ea7850655afd754afda7d12f725acb07f9b391a1c54eebd0b00916`.
Its receipt is preserved as `.local/r05-widgets/inherited-recap-source-freeze.json`.
The original recap, notification and profile author trees remain untouched.
This is a derived local candidate, not acceptance of its inherited source.

The ignored dependency junction uses the existing canonical installation.
No dependency installation, shared database or external provider is involved.

- `widget_followup_trace`, Sol Extra High: read-only source/caller trace.
- `widget_server_patch`, Sol Extra High: report router, preference helper,
  shared partial-patch type and real HTTP/DB tests.
- `widget_client_patch`, Sol Extra High: dashboard/report hooks, dashboard
  save-state controls, report customization form/caller and focused tests.
- `notification_general_review`: independent code/test review after authors.
  Coordinator owns database/native/broad checks, evidence and integration;
  independent TypeScript and Astra final review remain separate requirements.

## Defects and implementation contract

The report router reads and merges outside the inherited display writer lock,
then replaces the whole report JSON. Nested widget changes send full cached
objects, so toggling enabled can overwrite a newer order or chart type.
The fix must merge only supplied fields into current storage inside the user
and display-row transaction, preserving adjacent recap/dashboard/calendar data,
unknown stored siblings, false, zero and another user's settings.

Existing/default-known widget keys accept partial field updates. Previously
supported complete unknown keys remain accepted; incomplete new unknown keys
must fail with unchanged storage, including no newly created display row.
Map keys identify widgets; supplied id must not rename a key. Existing exposed
expanded and custom-chart showAverage/showComparison/createdAt fields must
validate and persist rather than being silently stripped. Arrays remain
explicit replacements under the current API.

Dashboard autosave currently clears dirty before the request succeeds and
exposes no persistent failed/unsaved/retry state. The hook and visible controls
must wait for hydration, retain failed/latest edits, serialize saves and
acknowledge only the saved revision. Retired identity work must not write or
affect the next user's state. Report helpers must send only changed fields;
customization must preserve edits/errors until save success and support retry.

## Evidence and followups

The first parent-run protected database RED is preserved in author
`.local/r05-widgets/server-red.log/.exit`: 8 failed, 14 passed (22 cases), exit1.
It reproduced lost nested/top-level updates, partial-patch rejection and
stripped custom-chart options. The parent alone owns disposable PostgreSQL
port55432, target/run marker r01int15a1; initial PID26192 passed marker/zero
fixture/zero competing connection preflight. No passing candidate is inferred.

Known following work remains explicit: custom-chart array concurrency needs
atomic operations or conflict handling; gallery/onboarding/chart-builder
fire-and-forget errors and early unscoped onboarding localStorage require their
own repair. General-notification/recap initial-creation concurrency remains
open from the previous candidate. Shared views, full field inventory, browser
acceptance, Astra final review and all 101 canonical groups remain OPEN.

## Implemented result

Report preference defaults and the pure nested merger now live in
`server/repositories/ReportWidgetPreferences.ts`. The additive report writer in
UserDisplayPreferences obtains the existing user/display locks before reading
and merging. The router passes validated supplied fields to that transaction,
returns the committed response, and no longer constructs a stale replacement.
Partial updates preserve omitted attributes, stored future metadata, adjacent
recap/dashboard settings and other users. Unknown incomplete initial widgets
fail inside the transaction without leaving a display row. Supported chart
options now round-trip. Custom-chart arrays remain explicit replacements.

The dashboard hook queues one save at a time, retains the latest draft and
failed state, and exposes load/save retries and acknowledgement-based status.
Dashboard editing waits for successful preference hydration. The report hooks
send individual changed fields and share a React Query mutation scope across
hook instances in the same query client, preventing response-order cache loss.
The customization modal retains dirty/newer edits and failed saves; it sends a
complete initial record for a visible metadata widget absent from storage,
while existing widgets receive partial patches.

Display and report response guards run before cache/success callbacks. They
reject malformed acknowledgements without discarding drafts. Valid recap-only
display JSON (no layout widgets/version), nullable display defaults, id-less
legacy report widgets and older charts without createdAt remain compatible.
AnnualDashboard exposes an initial preference-load error and Retry rather than
offering a dead customization action. Existing session/query lifetime fences
remain in use; a queued chart-type timer is also fenced and cleared on target
change or unmount.

The new shared type is ReportWidgetPreferencesPatch. The source changes in
use-settings.ts are limited to the approved display read/write guards. Its
notification/profile hooks were not changed here. Integration must reconcile
these hunks with the separate pending notification and profile candidates.

## Verification and review corrections

Author evidence is under `.local/r05-widgets/`, with actual captured exit
statuses in matching `.exit` files. Failed evidence remains preserved.

| Evidence | Actual result |
|---|---|
| server-red | 8 failed / 14 passed before report implementation |
| server-green | 70 passed: 23 report HTTP/DB, 22 inherited recap HTTP/DB, 25 existing recap cases |
| server-legacy-red | 4 failed / 5 passed: old mocked route boundary and mandatory-chartType oracle |
| server-legacy-green | 9 passed after mocks/assertions were aligned to the transactional delegate |
| client-red | 9 failures against original client behavior |
| client-red-edge | 2 failed / 4 passed: chart timer lifetime and reverted modal patch handling |
| client-green-focused | 23 passed across 6 files before subsequent review corrections |
| client-red-review | 8 failed / 9 passed: first widget, load/retry, acknowledgements and response ordering |
| client-red-load-ui | 1 failed / 5 passed: visible load-error/retry control |
| client-green-review-1 | 1 failed / 69 passed: obsolete empty display response in the CSRF fixture |
| client-green-review-2 | 71 passed after only that display fixture became truthful |
| client-red-recap-layout | 2 failed / 6 passed: valid recap-only settings rejected by the new guard |
| client-green-review-3 | 77 passed after recap-only compatibility repair |
| client-red-report-ack | 4 failed / 6 passed plus an unhandled exception: malformed report success corrupted modal state |
| client-green-final | 82 passed across 10 focused client files |
| client-session-compat | Parent-run 28 passed across 5 session/projection compatibility files |
| check | Failed exit2: TS2783 duplicate id/enabled/order before a required-widget spread |
| client-modal-final | Parent-run 6 passed in the two affected modal files after the build correction |
| check-final | Final repository check passed exit0 |

The build resolver changed one modal construction to Object.assign on a fresh
defaults object, preserving defaults -> stored values -> edits precedence.
Independent TypeScript review checked that delta. The 82-case run preceded
only this modal correction; its affected six cases were rerun afterward, as
was the full repository check. Other source remained frozen.

The coordinator ran the real HTTP/DB, route unit, compatibility, modal-delta
and repository checks. The client author ran the focused client RED/GREEN
work. The independent general and TypeScript reviewers performed static
reviews; they did not independently rerun tests. Review caught and closed the
missing-first-widget payload, reversed report response ordering and recap-only
guard regression, plus report acknowledgement and load-error gaps.

The TypeScript reviewer retains MEDIUM contract debt: the shared report types
require widget id and chart createdAt even though supported legacy responses
can omit them and the response guard casts to that type. Current consumers
normalize widget IDs and do not use the missing timestamp; this is not a
current runtime blocker, but it is not resolved by this candidate.

Real HTTP tests observe PostgreSQL lock contention before releasing writers
and assert direct SQL plus fresh GET responses. Client controls/transport tests
and server route evidence are complementary; they are not a full browser
journey. The compatibility suites are ancillary checks, not complete R02 or
investment acceptance. No cross-tab version/conflict protocol is claimed.

## Freeze, target cleanup and next work

Combined author source freeze: `.local/r05-widgets/source-freeze.json`, SHA-256
`2690e1bbc4dfe916ffe0beea6f515e9877f17b91415d972df789960ba897aaab`.
It lists all 30 source/test files. The original nine-file recap author's hashes
were rechecked unchanged. This freeze was recorded before completion of the
last check; the final passing result is recorded in the consolidated receipt.

Canonical `.local/r05-widgets-oct30/receipt.json` SHA-256:
`1b3e8704eaa14ca083e56f6e2458c0cb5d40cba70c97514c7fb09d74ce6680a0`.
It rechecks all 30 files and pins 48 evidence files, including preflight,
postflight and shutdown. Pinned Node24.22.0 ran the protected wrappers against
`pfa_completion_identity_r01int15a1_test` on127.0.0.1:55432, explicit manifest
and persisted r01int15a1 marker. Final readback found zero r05v/r05w users,
legacy recap fixture users/households, failure objects and competing database
connections. Owned PostgreSQL PID26192 was smart-stopped. No test/DB process
remains running from this window.

No source commit or canonical integration is claimed. Next independent R05
work includes report reset/defaults, onboarding/gallery/chart-builder failure
handling and the recorded type debt. Custom-chart array and cross-tab conflict
handling need their own coherent contract and proof. Preserve the separate
general-notification/recap first-creation followup, shared views and remaining
field inventory. Astra High final review, browser acceptance, production and
release gates remain in force.
