# R18 truthful dashboard greeting

Author: `C:\Users\USER\.codex\worktrees\capital-r18-dashboard-greeting\personal-finance-app`,
branch `codex/r18-dashboard-greeting`, base `10e38c1b0e76b2162018aa8a619ea55e64ebc740`.
Parent owns NEW-37/R18.2 greeting repair while the existing Sol agents remain
terminal on usage limits. Independent code/TypeScript and Astra reviews remain
required before integration; no model substitution or repeated quota retry.

All 173 source paths inherited from the balance-copy candidate were hash-verified
before and after copying. Manifest `.local/r18-dashboard-greeting/inherited-source.json`
SHA256 `7a3b44ff9aaf7b9e0ed1376282f9e0fc4674cbe15d85e8a6185b0ffcbc02d4be`.
The earlier candidate is frozen and untouched. No environment or user data copied.

Confirmed defect: Dashboard renders literal Good morning irrespective of time.
Use the existing display-setting timezone query, not the host/browser zone or a
new preference. Display morning at 05:00–11:59, afternoon at 12:00–17:59 and evening
otherwise. These are presentation wording boundaries, not financial/calendar rules.
While settings are loading, unavailable or invalid, use Hello. Preserve the known
profile name; do not invent User when the profile has no usable name. Refresh on
local-period boundary and resume/focus without a network request, and remove owned
timers/listeners on unmount. No date, money, permission or profile persistence changes.

Owned source: Dashboard.tsx, its existing Dashboard.test.tsx, new
components/dashboard/DashboardGreeting.tsx and its focused component tests if needed.
Use meaningful actual-dashboard RED/GREEN plus timezone, boundary, loading/error,
resume and cleanup tests. Full authenticated app/device/persistence acceptance and
all 101 closure groups remain OPEN. Parent retains test scheduling and evidence.

## Verified candidate and review handoff

The actual Dashboard regression failed before implementation: 1 failed/6 passed
(`component-red.log`), with the literal morning greeting still rendered at Lusaka
14:00. After repair, the existing Dashboard suite passes 21/21, including the six
pre-existing load/save/onboarding checks (`component-first.log`,2.36s). New checks
exercise timezone changes from Lusaka to Tokyo at the same instant; both sides of
05:00,12:00,18:00; the noon transition without interaction/remount; loading/error/
missing/invalid settings; whitespace/missing names; a clock jump followed by focus;
hidden/visible resume and removal of the owned timer at unmount.

The production leaf reads the existing display-settings query, formats hour in its
IANA timezone via Intl h23, and updates on aligned minute timers while visible.
Focus/visibility resume refreshes from the current clock immediately. It uses no
network request in its timer, no new persistent preference, no host-timezone
fallback and no ARIA live region that would announce routine clock changes.
The Dashboard still owns the profile query and passes the first usable name.

Full `npm run check` passes, including TypeScript and all repository guards; no LOC
baseline change, newly oversized file or grown debt. These are actual Dashboard
component tests with inert surrounding widgets/settings/profile hooks and a fake
clock; there is no real-browser, authenticated full-app, phone or persistence claim.
No browser/database started and no owned Node process remains. Failed RED retained.

Frozen174 source paths/3 owned, with171 inherited hashes unchanged and two owned
inherited paths modified (Dashboard.tsx and Dashboard.test.tsx). Source manifest
`.local/r18-dashboard-greeting/source-freeze.json` SHA256:
`c21c37c1215b13d545eeef1e65c9c74a0b307ecfb866e30be70692a4344676a1`.
Freeze status was written while check ran; later verification-final.json records
component/check exit0 and source parity. Canonical9-file copied evidence receipt
`.local/r18-dashboard-greeting-oct30/receipt.json` SHA256:
`3c2d6cdfff18d5ef3929094d3a6a4e37124030dd5d5dd42eb1509c71384ff55c`.
Final three source snapshots are under final-source in both evidence directories.

Next action when designated reviewers are available: independently review these
exact three files and raw evidence for timezone/neutral fallback correctness,
timer/event cleanup and resume behavior, existing dashboard workflow regressions,
and truthful test scope. Code and TypeScript reviewer roles remain required before
Astra High final assessment and canonical integration. Source is uncommitted in
the isolated author; the parent has not self-approved it or borrowed earlier slice
approval. Existing Sol agents remain terminal on usage limits, and R09 was polled
unchanged failed on revoked network permission. Neither was repeatedly retried.

Reproduce with pinned Node24.22.0 from the author:
`node scripts/run-protected-tests.mjs unit vitest run --config client/vitest.config.ts client/src/pages/__tests__/Dashboard.test.tsx`, then `npm run check`.
Do not repeat unchanged passing checks simply to wait for capacity. Preserve every
failure and exact source identity on any follow-up fix. All101 closure groups,
release and external gates remain OPEN; this candidate is local progress only.

## Independent review found integration dependency,30 October2026

Independent Sol Extra High code/TypeScript (`r18_goal_review`) and general
(`r20_native_probe`) reviewers verified all three hashes and approved the bounded
greeting behavior, but both found a P1 whole-file integration blocker. Frozen
Dashboard.tsx also consumes five widget save/load/retry properties absent from
canonical useDashboardWidgets at8467ec4a. Those are inherited predecessor changes,
not part of this greeting repair. Comparing only tracked Git base blobs misses
the uncommitted inherited candidate content. Mocked widget tests do not establish
that missing canonical contract. This original three-file snapshot stays isolated.

General report `.local/r18-copy-greeting-review/GENERAL-REVIEW.md` SHA256:
`347550307da1a6ba9768638db2f7faf818b6972db2f3d3893533c4402d38d6ad`.
No new source/runtime test failure was executed or invented for that static finding.

Sol Extra High is preparing a greeting-only port from actual canonical8467ec4a in
`C:\Users\USER\.codex\worktrees\capital-r18-greeting-port\personal-finance-app`,
branch `codex/r18-greeting-port`, owning only the same three paths. The leaf is
unchanged; Dashboard/test hunks exclude predecessor widget/hook modifications.
Its new freeze/tests/review must stand on their own; original21-test evidence is
not relabeled as evidence for the new candidate. Canonical integration remains
pending its focused verification and independent final review.

## Greeting-only port integrated after new review,30 October2026

The replacement port has independent Sol Extra High code/TypeScript and Astra
High final source approval at freeze93d5d2a78ea3d205e74f31948dc44f76ac06f6ca9b83380bbfda2c496d70ecff.
Exact three current source hashes:

| Path | SHA256 |
| --- | --- |
| client/src/pages/Dashboard.tsx | e64b44acc24d518359d0fdc8481d3609092b044a9849e6eaf11c08f53f491097 |
| client/src/pages/__tests__/Dashboard.test.tsx | eb6d9ccb0c4fe2976b37820ece3222a13afd22fccbeccde5025144b502392336 |
| client/src/components/dashboard/DashboardGreeting.tsx | d6b6510c83e6c10ff2f614d3029380fb76de11a69f6f7b2c479a30b46ac54551 |

The production Dashboard delta is only the greeting import/render replacement;
settings/widget hooks and their contracts remain canonical-identical. Four existing
canonical test bodies remain intact and17 greeting cases are added. This21-test
suite differs from the original candidate21; both counts have separate provenance.
New author21/21 and repository check pass. Fresh canonical affected checks pass
31/31 total (these21 plus10 balance-copy), followed by the separately scoped3/3
native clipboard fixture and full npm check, all exit0. No original inherited
widget controls or hook changes were imported. All3 hashes remain unchanged.

New author handoff SHA256:
b7e8354db68f494eda5385f006e73637cfc28eaf735f316e7545d5d2544644cd.
Canonical combined21-file receipt is
.local/r18-copy-greeting-integration-oct30/receipt.json SHA256
4c300795db3c42e65bc231e755dbb4ce8be92f255d310ca274504d61fab20a7d.
Native browser evidence in that packet concerns balance-copy only; greeting has
component/fake-clock evidence, not real-device or authenticated persistence proof.
The original dependency-blocked candidate and review finding remain preserved.
R18, all101 groups and the active campaign goal remain OPEN.
