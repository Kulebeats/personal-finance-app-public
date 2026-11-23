# R02 session-access checkpoint acceptance

This is a bounded local checkpoint, not full R02/J01 or production acceptance.
The owner-approved four-agent plan and intended-context amendment are in
`docs/plans/2026-10-28-r02-four-agent-execution.md` and
`docs/plans/2026-10-15-r02-session-access-design.md`.

## Final disposition — accepted locally, 28 October 2026

Parent Astra accepts this bounded session-access checkpoint after independent
general/security and TypeScript reviews, parent final source review, source-parity
checks and fresh integrated execution on
`4e105183c109fd473ecac48962a073e8c068fc47`. The new browser spec retains the exact
independently reviewed SHA256 recorded below. No application source changed during
the final validation sequence.

| Final integrated gate | Observed result |
|---|---|
| Protected full server suite | 239 files / 3,303 tests passed, exit 0 |
| Protected full client suite | 185 files / 1,497 tests passed, exit 0 |
| Nonincremental TypeScript and npm check | Both exit 0 |
| Production build and bundle budget | Both exit 0; 190.35 kB initial gzip against 300 kB limit |
| Protected Chromium journeys | 7 passed, zero retries, exit 0 |

This establishes local synthetic behavior only. Full R02/J01, G1, all 101 canonical
groups and production acceptance remain open. Next work includes a separately
reviewed fresh-device captured-mail/security-runtime contract and transactional
default-category creation. Neither is silently included in this acceptance.

The sections below retain the review and integration history, including failed
runs. This final disposition supersedes their historical pending statements.

## Server review and integration

Author: `C:\Users\USER\.codex\worktrees\capital-r04-foundation\personal-finance-app`.
Frozen candidate: `d70fb7b8fbe8f63e77b9a1d3125ebb69da924169`.
Actual base: `4e90bfab0f86947a0df8edfb75c77089eb4bdc80`.
Canonical integration: `635020f0f4f3168aa4df4156cc9ce00afec23cef`.

Independent Sol Extra High general/security reviewer `r02_parallel_review`
reviewed all 28 changed paths and relevant callers and accepted with evidence
limits, finding no actionable defect. Separate Sol Extra High TypeScript reviewer
`r02_typescript_review` inspected the same exact candidate and found no actionable
TypeScript, async or security defect. Both read the current passing evidence;
neither reran tests or changed source during final review.

Parent Astra High separately inspected the current-user/generation/erasure checks,
pending allowlist, five-state minimal DTO, deterministic household selection,
optional-header validation, request-context reuse, explicit H2 composition,
import target, MFA logout and after-password login code. Parent read the regression
source and final logs, including the real-cookie mismatches and persisted effects.
No remaining actionable server finding was identified. The bounded server source
is accepted for local integration, subject to integrated regression acceptance.

The earlier review findings were repaired before freezing: active old-tab cookie
replacement, household selection changing between guard/controller, import body
target escaping the expectation, and authenticated logout cancelling a replacement
MFA challenge. Regressions reproduced those failures before the corrections.

Fresh author evidence: 117 focused unit tests, 49 mounted database regressions,
one final selected import-envelope regression, nonincremental TypeScript and
`npm run check` passed. The selected import run intentionally left 21 other tests
unselected; the prior full focused mounted run covered them. Exact commands,
targets, logs and limitations are in `SESSION-ACCESS-SERVER.md`. Parent independently
read the final unit, mounted and npm-check summaries. The silent TypeScript log
is supported by the author's tool-reported exit0, not by silence alone.

Parent cherry-picked the reviewed commit with its provenance. Git comparison
confirmed no differences between author and canonical `server`, `shared`, package
or lock files after integration. Parent browser/config/document drafts remain
separate unstaged changes. Primary checkout is not an integration target.

## Client review and integrated acceptance

Client candidate `dd01f65d703cf891f49bd1eb4201c9e09228b645` was frozen against
the same application base. Both independent reviewers requested changes. Parent
accepted their three source-confirmed HIGH findings for required repair:

1. A household-free profile with saved protected image URLs can repeatedly fetch,
   receive HOUSEHOLD_NOT_FOUND, rebootstrap and remount. Personal editing must
   remain usable without household media requests or upload controls.
2. Three account exports fence response headers but not delayed Blob completion
   and the actual hook's download effect. An old user's bytes can download after
   replacement. Capture/check ownership through the final local effect.
3. Receipt-image prefetch precedes the OCR action epoch. An older image may arrive
   last and its OCR results can be written under the newer selected receipt ID.
   Bind ownership before prefetch and through result persistence/autofill.

Neither reviewer executed those reproductions. Parent withheld acceptance of
`dd01f65` pending focused red/green actual-App/hook regressions and corrected-source
re-review.

The author subsequently reproduced all three findings and froze repairs as
`6de4b526ecd148506074ba9c9c7e78fd8958b4f5`. Both independent reviewers accepted
that exact corrected candidate, finding no remaining actionable general,
TypeScript, async or security defects. Parent Astra separately inspected the
immutable receipt action established before prefetch and checked through OCR,
account API/hook/Blob-download continuation checks, and household-free asset
suppression that preserves stored form URLs. The current source resolves all
three findings and is accepted for local integration, pending broad verification.

Current repair evidence:30 files/226 affected tests passed; a later fixture-only
fetch-spy type annotation was followed by10 passing accessibility tests. The
unchanged CashFlowIntegration serial retry passed9/9. Its preceding timeout is
retained with cause unproven. The new profile test's readiness wait changed from
1s to5s for real lazy-loaded UI, with all no-asset/stable-bootstrap/save assertions
retained. Fresh nonincremental TypeScript and npm check exited0. Source, exact
logs and failure adjudication are in `SESSION-ACCESS-CLIENT.md`.

Parent integrated the client range as `217b5dd` then
`567aab195b004c84b08349c2db5b7a9a47a3ae66`, preserving both author commit links.
Git comparison confirms client/package/lock parity with6de4b5 and server/shared
parity withd70fb7b. Shared DTO was integrated only once through the server change.
Full-client, server correction/rerun, integrated static, build/bundle and browser
results remain pending at this integration entry.

Parent full client run on unchanged `dd01f65` ended exit1: 182 files (177 passed,
5 failed), 1,482 tests (1,459 passed,23 failed),358.76s. Log: author
`.local/r02-session-access/client-oct28-parent-full.log`. Failures are in Goals,
Tags, CashFlowIntegration, CashFlowA11y and Dashboard. Initial triage identifies
missing valid CSRF-route fixtures, outdated native-download assertions and the
Dashboard-to-App boundary ownership change; each repair must preserve behavior
coverage rather than loosen production guards. The failed log remains evidence.

Parent complete server regression on accepted635020f used the marked identity
target and protected wrapper. It ended exit1:239 files (236 passed,3 failed),
3,303 tests (3,275 passed,28 failed),1,034.97s. Log: canonical
`.local/r02-session-access/server-oct28-parent-full.log`. The failures are five
cross-household membership properties and22 R04 role-context cases whose fixtures
lack a current verified actor, plus one auth-verification test expecting the old
error class. The author owns a narrow three-file test correction; no production
guard or negative-identity coverage may be relaxed. A complete green rerun remains
required after correction/integration. Canonical source stayed fixed during this
failed run; client repairs occurred only in the separate author checkout.

The test-only correction was frozen as
`f4f0b7849f08912018c4a56efe665a60630bd75e` after196 focused tests and fresh
nonincremental TypeScript/npm check passed. Both independent reviewers accepted
that exact SHA with no weakened authorization assertions. Parent Astra separately
read all three test diffs and the passing log, accepted the correction and
integrated it as `4e105183c109fd473ecac48962a073e8c068fc47`. Server/shared parity
withf4f0b78 and client/package/lock parity with6de4b5 are confirmed. Production
server behavior remains identical to the originally accepted d70fb7b candidate.
The complete protected server rerun is executing on this combined source, with
verbose reporting for progress visibility; no timeout, worker or safety-control
relaxation was made. Its log name is
`.local/r02-session-access/server-oct28-integrated-green.log`; the name alone is
not success evidence. Actual completion will be recorded below.

At source-review time, parent browser source had passed separate general and
TypeScript review but had not executed. The fourth case keeps A's account form open while a real API
login replaces the shared cookie with B, then requires A/H1 headers and409 on
submission, B/B-household headers on the subsequent successful accounts read,
dialog withdrawal and zero new matching accounts in either household. Final spec
SHA256 at source review:086731725C67CDA863D33C1F3725A9CB43AB1ABD554132571399A4081F8671D9.
Final full regression, static, build/bundle and protected Golden browser outcomes
are recorded below from observed execution.

## Integrated validation on 28 October 2026

The complete protected server rerun on canonical
`4e105183c109fd473ecac48962a073e8c068fc47` finished with exit 0:
**239 files and 3,303 tests passed**, duration 1,381.84 seconds. This includes all
three previously failing fixture files. The original failed run remains retained.
The command used the pinned Node 24.22.0 runtime, marked identity target and
`node scripts/run-protected-tests.mjs database vitest --server run --maxWorkers=1 --reporter=verbose`.
Log: `.local/r02-session-access/server-oct28-integrated-green.log`.

The complete client regression on the same canonical source finished with exit 0:
**185 files and 1,497 tests passed**, duration 662.19 seconds. It used protected
unit mode and one worker:
`node scripts/run-protected-tests.mjs unit vitest run --config client/vitest.config.ts --maxWorkers=1 --reporter=verbose`.
Log: `.local/r02-session-access/client-oct28-integrated-full.log`.
Fresh integrated nonincremental TypeScript and `npm run check` both finished
with exit 0. Logs: `.local/r02-session-access/integrated-oct28-typecheck.log` and
`.local/r02-session-access/integrated-oct28-npm-check.log`. The silent TypeScript
log is backed by the observed command exit 0. Repository guards report no new or
grown LOC violations; the historical module report still has 0/22 final-ready
modules and is not reinterpreted as product acceptance.
`npm run build` and `npm run check:bundle` both finished with exit 0. The initial
client gzip was 190.35 kB against the unchanged 300 kB budget. Logs:
`.local/r02-session-access/integrated-oct28-build.log` and
`.local/r02-session-access/integrated-oct28-bundle.log`.

The protected Chromium run finished with exit 0: **7 tests passed in 1.9 minutes**,
one worker, zero retries. It used the separately marked Golden target
`127.0.0.1:55432/pfa_completion_golden_r20ga15a1_test`, run `r20ga15a1`, owned
origin `http://127.0.0.1:5157`, and
`node scripts/run-protected-tests.mjs database playwright test --config playwright.completion.config.ts --project chromium`.
Log: `.local/r02-session-access/browser-oct28-integrated.log`.
The wrapper and owned server enforce target identity and external-network guards.
The owned server exited; a subsequent read found no listener on 5157.

These seven cases cover the existing two-cookie session-revocation proof, Golden
UI persistence and its omitted-submit negative control, plus public query silence,
actual pending registration restriction, verified household-free onboarding and
the real replacement-cookie/old-account-form rejection. The latter verifies A/H1
request headers and 409, B/H2 successful refreshed reads, withdrawn old UI and zero
matching persisted accounts in either household. SMTP is intentionally unavailable
in this test profile; registration-pending success does not prove delivery. Real
production CSRF, cookies and limiters remain separate acceptance work.

Final source parity: canonical server/shared equal author `f4f0b78`; canonical
client/package/lock equal author `6de4b5`. Canonical tree IDs are
`6204acfd2800a3e375c3035532863ab755d9e918` (server),
`4ae7b446f95942af438c09337f62883b4ca4a066` (shared), and
`8e272ba26d19e4d43566e75bcaad5c8641bc2806` (client). Primary checkout remains at
`381e9439afabe7c6cf829cb1cbded91d36da44ee` with its pre-existing untracked material
preserved. Final parent commit contains only the reviewed browser/config changes
and checkpoint documentation; no additional production implementation.

An optional additional independent final-document read-back was requested after
all gates passed, but the agent failed at model capacity before reviewing. No
additional reviewer acceptance is attributed to that attempt. The completed
exact-source independent reviews remain unchanged; parent performed the final
integrated log, source-parity and documentation adjudication.

All101 canonical groups remain OPEN. This checkpoint does not establish real
SMTP/MIME, production CSRF/cookie/limiter behavior, category seeding, deployment or
real-household readiness. No push, main merge or deployment is authorized here.
