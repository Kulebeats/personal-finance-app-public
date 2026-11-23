# R05 settings writer serialization and legacy widgets

Status: implemented and locally checked in the isolated author, with independent
static reviews complete. Astra final review, canonical source integration and
full acceptance remain pending. Governing scope: master R05.1/NEW-26 persistence,
the existing user-row serialization contract and recorded report followups.
The preceding goal turn made progress: checkpoint61addbf0 records the report
reset/onboarding candidate, its tests, reviews and remaining gates.

## Author and ownership

Author: `C:\Users\USER\.codex\worktrees\capital-r05-setting-writers\personal-finance-app`.
Branch: `codex/r05-setting-writers`, base
`61addbf0cb79034cbb8736042753051991d40421`.

All46 report candidate files were copied and byte-verified from freeze
`7f502db2851154dc52d822d449da50da947dd80de5e585086ab262fb96f6c8e1`.
Eight nonoverlapping notification files were copied from the11-file freeze
`7d6ee8ed55a37b4298b38410210ceacdcad8e59a86c410baa98713d787266402`.
The three overlapping files require explicit hunk reconciliation: settings
controller, use-settings hook and its CSRF tests. Prior authors are unchanged.
The existing ignored dependency junction is reused; no installation.

- Sol Extra High settings_writer_server owns the controller, new notification
  repository, investment notification route and writer integration tests.
- Sol Extra High report_settings_client owns the two overlapping client files,
  ReportWidgetPreferences helper and dedicated legacy unit/persistence tests.
- Independent Sol Extra High notification_general_review reviews source and
  test meaning; parent owns database/broad runs and canonical evidence. No
  nested teams. Astra High final review remains a separate gate.

## Confirmed defects and bounded behavior

General notification and investment notification endpoints perform unlocked
read/update-then-create operations against the same table. Weekly recap already
uses the user-row lock. The schema has no user/type unique constraint. All three
live HTTP writers must use the same user-row FOR UPDATE ordering before reading
or creating a preference. General batches must roll back earlier preference
changes if a later row fails. Preserve partial omission, explicit null and zero,
adjacent settings, neighbor rows and existing route-specific creation defaults.
Nonfinancial audit events retain their existing after-commit/nonblocking policy;
do not open a separate audit connection while holding the user-row lock.

This repair does not invent a historical duplicate-resolution policy or claim
to serialize administrative seed/direct SQL writers. No migration is authorized
by this allocation. General/investment and general/recap first creation must
both be exercised in both orders, with two general writers also covered.

Existing valid unknown report widgets can omit chartType under the current wire
contract, yet enabled-only updates fail completeness validation. Permit the
omission only for a valid existing record, preserve metadata and the absent
field, and keep new unknown-widget completeness validation. Malformed stored
known fields must not gain a waiver.

## Preserved RED evidence

Parent protected real HTTP/PostgreSQL RED: two files, seven failed/two passed.
Five writer cases blocked on INSERT instead of the required explicit user-row
SELECT FOR UPDATE. A later-row trigger rejection left an earlier general batch
row committed. Legacy widget PATCH returned400 instead of200. The negative
new-widget case and invalid batch passed. These failures precede production
fixes and remain in `.local/r05-setting-writers/server-red.log/.exit`.

Client overlap RED reproduced cache loss and stale identity effects: three
failed/51 passed. Exact notification hunks were reconciled into the current
report hook without replacing its display/recap changes. Provenance comparison
confirmed the notification block matches the frozen notification author and
the remaining hook matches the report author. Focused merged regressions:
166 passed across18 files. Pure legacy-helper RED initially failed two cases;
additional malformed-chart tests yielded four failed/17 passed before the fix.
These are intermediate author checks, not final acceptance.

Database target remains the explicit synthetic r01int15a1 database on
127.0.0.1:55432. Initial pg_ctl launch omitted explicit socket options and failed
to bind its default address/port; failed logs are preserved. Corrected launch
explicitly selected127.0.0.1:55432 and started owned PostgreSQL PID18932.
Separate preflight verified the persisted marker and zero fixtures/failure
objects/competing connections. The launch observation handle51922 remained
live after readiness; do not restart the server merely because that handle
has not completed. Shutdown and final cleanup remain required.

## Final implementation and verification

The controller and investment route now call a transactional notification
repository that locks the existing user row before reading or creating rows.
Weekly recap already uses that same ordering. General requests apply the entire
validated batch in one transaction; audit calls occur after commit. Existing
response shapes, authenticated identity boundaries, route-specific defaults,
omitted fields, null clearing and zero thresholds are preserved.

The report helper permits absent chartType only on a valid existing object,
retains unknown metadata, and still rejects incomplete new unknown widgets.
Its response type now comes from the truthful shared report wire type rather
than the schema type that incorrectly required chartType. This last correction
changes only TypeScript declarations/imports; no runtime logic changed after
the successful persistence checks.

| Evidence | Result |
|---|---|
| Parent protected real HTTP/DB, eight files |103 passed |
| Existing notification audit compatibility |1 passed;5 intentionally filtered |
| Author merged client regression,18 files |166 passed |
| Author pure legacy helper suite |21 passed |
| Parent affected raw-JSON assertions after compiler fix |2 passed, overlapping the103 |
| Final repository check after type alignment |Exit0 |

The initial full check failed TS2339 in the new legacy DB test's raw JSON
property access. A build resolver replaced two expressions with equivalent
Vitest raw-object property assertions; it did not use the production parser or
normalizer to manufacture expected fields. The two affected DB cases passed
again. Both full checks after that repair passed, including the last type-only
helper alignment. Failed compiler output and all REDs remain preserved.

Independent general and TypeScript Sol Extra High static reviews found no
remaining actionable issue in this bounded delta. The TypeScript reviewer also
approved the raw-JSON assertion correction and truthful server wire type. These
reviewers did not rerun tests. This does not replace Astra High final review.

Final target verification found zero candidate/legacy fixture users, households,
failure functions/triggers and competing connections. Owned PostgreSQL PID18932
was smart-stopped. The original startup observer then resumed and attempted its
delayed preflight after shutdown, producing a missing PID-file message and
ECONNREFUSED. That terminal failure is retained and explained in canonical
`startup-observer-reconciliation.txt`; the actual pre-run verification is
`preflight-observed.log/.exit0`, and final cleanup is
`postflight-final.log/.exit0`. No restart was used to manufacture a green delayed
observer. All owned test/launch/database handles are terminal.

## Freeze and next requirement

Final author freeze: `.local/r05-setting-writers/source-freeze-final.json`,58
source/test files, SHA-256
`bc0a21c57cb9a1843554debc8a570ee4fbfc6a6a3d6b6fb72dd6df1c1044ccc8`.
Earlier worker and whole-candidate manifests are historical and retain their
pre-correction hashes. All46 original report and11 original notification author
files were rechecked unchanged in their original worktrees.

Canonical receipt `.local/r05-setting-writers-oct30/receipt.json` pins50 evidence
files and rechecks all58 final source files. SHA-256:
`f01e47df8085d77413ed13dddaa23dbe8629cf9d8ba976fb8a6f18cf2692614a`.
No source commit or canonical integration is claimed; source remains in this
derived author pending final review and integration. Existing profile and other
separate candidate ownership still applies.

The legacy missing-chartType update and three live notification writer races
are locally repaired. Historical duplicates/direct seed writers, the unused
debounced hook, chart-array conflicts, registry/default alignment, browser
journeys and broader R05 requirements remain open. The next bounded personal
preferences/default account filter scope is recorded in
`PERSONAL-PREFERENCES-NEXT.md`; it is a source trace and plan, not implementation.
All101 canonical groups remain OPEN. Shared/production DB, provider, message
and release gates remain unchanged; the campaign continues.
