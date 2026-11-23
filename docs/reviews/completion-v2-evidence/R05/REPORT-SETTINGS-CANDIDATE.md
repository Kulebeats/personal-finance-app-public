# R05 report reset, onboarding and truthful response types

Status: implemented and locally checked in the isolated author; independent
static reviews completed with inherited followups. Astra final review,
canonical source integration and full acceptance remain pending. Governing
requirements are the master R05 persistence/per-user settings contract and
the recorded widget followups. All canonical groups remain OPEN.

## Derived author and ownership

Author: `C:\Users\USER\.codex\worktrees\capital-r05-reports\personal-finance-app`,
branch `codex/r05-report-settings`, base
`a58ceef069a44a792187c3caa6870ec7b6da36c3`.
Thirty widget candidate files were copied and verified against freeze
`2690e1bbc4dfe916ffe0beea6f515e9877f17b91415d972df789960ba897aaab`.
The copied receipt is `.local/r05-reports/inherited-widget-source-freeze.json`.
The original widget, recap, notification and profile authors are preserved.
Dependencies use the existing ignored junction; no installation was performed.

- `report_settings_trace`, Sol Extra High: read-only source trace.
- `report_contract_server`, Sol Extra High: shared response types, new pure
  response/identified-widget helper, reset route/repository and real DB tests.
- `report_settings_client`, Sol Extra High: report hooks, report page/modals,
  consumer adaptations and focused client tests. It must not edit the first
  worker's new helper, shared types or server files.
- `notification_general_review`: independent static review. Coordinator owns
  serialized database/broad checks, canonical evidence and later integration;
  TypeScript and Astra final reviews remain independent gates.

## Verified defects and bounded contract

Reports and AnnualDashboard each hold local onboarding-complete state. An
unscoped localStorage flag is ORed with server state, can leak completion into
another user's session, and can restore true after a reset. Completion and
reset both return before persistence; failed saves can close onboarding while
local state falsely reports completion. Initial preference GET errors can
also be mistaken for incomplete setup.

The existing Reset Defaults controls do not reset layout: customization calls
the flag-only resetOnboarding, and gallery's button is disabled. The existing
chart builder also closes before its save acknowledgement.

The new personal POST `/api/settings/report-widgets/reset` accepts an empty
body and restores the existing server-default core/optional widget maps inside
the current preference writer transaction. This intentionally removes widget
layout overrides, while preserving custom charts, root future metadata,
setup-completion state, adjacent recap/dashboard/calendar settings and other
users. It creates ordinary defaults for a first row. It does not delete charts
or domain data and does not invent a new preset. UI text must say custom charts
are kept; reset completion/errors must be truthful and retryable.

Server defaults and today's UI registry are not fully aligned. This candidate
uses the existing API defaults as its explicit oracle; registry/default
alignment remains a separate product consistency followup, not silently solved
by guessing new visibility or chart styles.

Onboarding will use only acknowledged server state, ignoring the old unscoped
browser hint. Failure preserves selections and retry; unknown/error/loading
state is not permission to complete setup or show a new-user modal. Identity
retirement must suppress stale effects. Chart builder/gallery failure handling
may be repaired within the existing API, but array and cross-tab concurrency
still need their own contract and proof.

Legacy widget id and custom-chart createdAt become honestly optional on the
wire. A separate IdentifiedWidgetPreference type derives required UI IDs from
map keys. No historical timestamp may be fabricated. The response parser must
validate known fields and preserve valid unknown metadata/legacy omissions.

## Verification plan

Preserve a real HTTP 404 RED for the missing reset path before production
edits, then test exact reset defaults, fresh GET/direct SQL, custom-chart and
neighbor preservation, first-row creation, strict invalid-body no-write and
observed-lock reset/patch contention in both orders. The parent alone owns the
explicit disposable target at127.0.0.1:55432, run marker r01int15a1.

Client RED/GREEN covers async complete/reset failures and retry, two onboarding
hook instances, old browser hints across identities, GET failure, pending
identity change, retained builder/gallery drafts and normalized legacy types.
Final review, checks, source freeze, integration and browser acceptance remain
separate steps. No production/shared database or external-service authority
is added by this allocation.

## Implementation and verification record

The reset route and repository now implement the bounded contract above.
The response helper validates declared fields, preserves future metadata, and
returns honest optional legacy fields. Identified UI widget values derive IDs
from map keys without changing stored records or fabricating timestamps.
Onboarding reads only acknowledged server state. Reset, onboarding completion,
chart creation/edit/deletion and gallery changes await their mutation and show
retryable failures. Reset blocks editing and dismissal while pending; failed
onboarding/chart saves retain selections. Retired identity lifetimes suppress
late UI effects and cache writes.

Parent verification:

- Missing reset path RED: expected HTTP200, received404; one failed, nine
  skipped. This preceded reset production changes.
- Real HTTP/PostgreSQL GREEN:80 tests in four files, including ten reset,
 23 report-widget,22 recap-widget and25 legacy recap cases.
- Supplemental reset authentication proof: two passed, ten filtered out.
  Anonymous POST returns401 and writes neither existing nor absent preference
  rows; subject and neighbor display/notification snapshots remain unchanged.
- Mocked report-route regression: nine passed.
- All changed client test files combined:163 passed across18 files. The
  client author's final focused run separately passed35 across11 files;
  parser author tests separately passed32. These counts overlap, not additive.
- Initial full repository check failed with TS2345 in the new reset test
  helper: an unknown request body was passed to SuperTest.send. The failed
  log/exit are preserved. The build resolver narrowed that helper parameter
  to string | object; it preserves the invalid-array cases and runtime bytes.
- Subsequent full checks exposed the modal LOC limit:314 lines, then301 after
  footer extraction, against300. Both failed logs/exits remain. A presentational
  CustomizeDashboardFooter extraction plus removal of one redundant blank line
  restored compliance. Seven affected modal cases passed after extraction;
  only the final blank line changed afterward. Final npm run check passed,
  including TypeScript, LOC, tool syntax and assessment checks.

The database suite uses real login/session handling, HTTP routes, PostgreSQL
row locks, fresh GET and direct SQL. Contention tests observe blocked writers
before releasing them, in both reset/patch orders. The test application bypasses
CSRF in NODE_ENV=test: these runs prove authenticated persistence, not browser
CSRF delivery. Client token-transport checks are complementary. There is no
full browser or production-mode acceptance in this packet.

The explicit disposable target was127.0.0.1:55432,
`pfa_completion_identity_r01int15a1_test`, verified against the persisted
r01int15a1 synthetic marker. Final readback found zero candidate/legacy fixture
users, fixture households, failure objects and competing connections. Owned
PostgreSQL PID3732 was smart-stopped successfully. No ambient finance_app write
or external provider/message was authorized or performed.

Client exploratory debounce RED is retained in the evidence directory. The
unused useWidgetChartType helper still has an unhandled rejection path; a full
client search found no production consumers. Its exploratory failing test was
not retained as an active regression because this unused API repair was
explicitly deferred. This is an open followup, not a passing test claim.
Custom-chart full-array conflicts, server-default/current-registry mismatch,
general-notification/recap first-creation concurrency, shared views and the
remaining field inventory also remain open. Astra High final review, source
integration, browser acceptance and release gates remain separate.

## Independent review, freeze and continuation

The general Sol Extra High reviewer found no new actionable issue in this
bounded reset/onboarding slice, including the final footer extraction. The
independent Sol Extra High TypeScript reviewer returned a warning for inherited
compatibility debt: the parser and gallery support a persisted unknown widget
without chartType, but mergeWidgets rejects an enabled-only patch for that
record. This needs a regression and a compatible merge correction. It is not
resolved by the optional id/createdAt type fix, and no claim of universally
editable legacy records is made. The inactive debounced hook rejection remains
the separate followup recorded above. Both reviews were static; neither ran
tests, and neither substitutes for Astra High final assessment.

Combined source freeze: author `.local/r05-reports/source-freeze.json`,46
source/test files, SHA-256
`7f502db2851154dc52d822d449da50da947dd80de5e585086ab262fb96f6c8e1`.
All30 original widget author files were rechecked unchanged at their original
worktree. The other frozen notification, recap and profile candidates remain
separate and must be reconciled by shared-file hunk ownership during integration.

Canonical evidence receipt: `.local/r05-reports-oct30/receipt.json`, SHA-256
`be0cde2c6b9825e49371185c1fcf43cce1e2aff2f12b384a4c372fc8c757c2cb`.
It rechecks46 source files and pins54 evidence files, preserving REDs, failures,
successful checks, target readbacks and shutdown. The163-case combined client
run preceded only the presentational footer extraction; seven affected cases
passed afterward. The82 database cases preceded only the erased request-body
type annotation; production server bytes are unchanged from those runs.

Next bounded local corrections are unknown legacy-widget partial updates and
general-notification/recap first-row serialization under the existing contract.
Chart-array/cross-tab conflict design and default-registry reconciliation need
their own coherent contract and proof. No source commit, canonical integration,
browser acceptance, staging or release readiness is claimed. All101 canonical
groups remain OPEN; the campaign and continuation automation remain active.
