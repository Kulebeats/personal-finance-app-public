# R18 application navigation candidate

Allocated 30 October 2026. Local component acceptance now passes; source remains
isolated pending Astra final review/integration. This addresses the outer application shell,
not the previously integrated inner Settings drawer. All101 closure groups remain OPEN.

## Identity and ownership

Canonical base: `c021863caf138a55e467fcda4c4467bf967fa56e`.
Author: `C:\Users\USER\.codex\worktrees\capital-r18-app-navigation\personal-finance-app`,
branch `codex/r18-app-navigation`. Inherited138 source files were copied with exact
SHA256 verification from the R15 freeze
`dc84bc782a38933149400530191a562c5f070c3afeb64d6f7e7f3e7d787dbebf`.
Six synthetic receipt uploads are excluded. Allocation receipt:
`.local/r18-app-navigation/allocation.json`. No inherited source is integrated by
this allocation. R15 initialization/automatic-policy/CSP and Astra gates persist.

Two Sol Extra High implementers own separate paths: shell author owns Layout,
Sidebar, TopBar and an optional focused layout focus helper; test author owns
focused component tests and an isolated browser fixture/config/spec. No shared
Sheet, mobile hook, settings context, SettingsLayout, financial, server or schema
changes. Parent owns execution/evidence/canonical records. Independent general
and TypeScript review follow; Astra High final review remains separately required.
No nested agents. Separate R09 chat remains failed with revoked network permission,
unchanged at reconciliation; its scope is not duplicated. Owned runtime ports were
clear; previous R15 PostgreSQL/preview/browser processes were stopped.

## Contract and meaningful acceptance

Master R18.1 requires usable mobile navigation without clipping and with focus
handling; companion specifies below768px. Current rail reserves256px even on320px
screens; collapse only reduces it to64px. Reuse the existing modal Sheet unchanged.
Keep desktop collapse preference; mobile open state is local. Hide desktop rail
below768px in CSS and expose an always-available44px mobile trigger through
SheetTrigger. Name the modal Application navigation; label and describe it.

Drawer uses actual named anchors with aria-current and one native Profile link;
no collapse control. Bound width/height, scroll navigation at short heights, retain
focus trap/Escape/outside dismissal/background scroll lock. Normal dismissal returns
focus to the visible trigger. Selection (including same-route) and location changes
close. Route pages remount Layout, so destination-main fallback must be scoped to
navigation and verified in a remounting fixture. Breakpoint transitions close the
drawer and focus a visible active desktop link; re-evaluate current breakpoint in
close-auto-focus for rapid reversal. When closed, transfer focus only if the focused
rail/trigger becomes hidden; preserve focus already in main content.

Tests first: actual Layout/Sidebar/TopBar/Sheet with inert effectful data and real
Wouter. Verify keyboard activation, actual anchor names/current state, forward and
reverse Tab containment, Escape/Close/outside, same/cross-route selection, unchanged
desktop preference, breakpoint closure/reversal and focus transfer. Browser geometry
at320/360/375/390/767/768 and desktop1280, plus short height, must prove usable main
width, reachable links, scroll lock, visible focus and sequential inner Settings
drawer behavior. No DB or application server is necessary for an isolated component
fixture. This is component-browser evidence, not full authenticated route/phone or
persistence acceptance. Parent runs protected focused RED/GREEN and full check once
final source is stable; preserve failed artifacts, diagnose before rerunning.

Do not widen into inert TopBar account-view controls or financial policy. Do not
add LOC baseline debt. Keep files under applicable component300-line limit through
small focused extraction if necessary. Production/deployment/release and full R18
closure remain held. Stop workers at reviewable source/tests; parent serializes all
test, browser, database and native windows and updates the continuation record.

## Initial failures retained

Protected baseline `component-red.log` failed3/passed4: the actual shell has no
mobile trigger when desktop-expanded, current-state metadata is on the child div,
and Profile is not one named native anchor. First candidate `component-first.log`
failed1/passed15: the modal lacked explicit aria-modal. Source repair remains local
to SheetContent; the shared primitive is unchanged.

Independent review requested delayed lazy-route acceptance because App wraps its
route-owned Layouts in Suspense. `lazy-red.log` failed both delayed cases before
focus assertions: Suspense hid the source shell while its existing portal retained
body pointer/scroll locks and hid the loading fallback from accessibility. This is
a real candidate lifecycle failure, independently diagnosed against App/Wouter/
Radix; not a collection error or a passing focus-only regression. Parent authorized
a bounded synchronous close before ordinary navigation and a narrowly scoped
destination focus handoff, subject to new tests and independent review. The browser
must hold a lazy destination beyond exit animation and prove locks/overlay release.
Do not rerun unchanged failures or weaken the accessible-fallback expectation.

The explicit selection repair commits local close before Wouter navigation. A
second meaningful `external-lazy-red.log` failure reproduced the same portal leak
through actual browser-history navigation. The local focus helper now observes
the four installed Wouter history events in capture phase, before its bubble-phase
subscribers, and closes before a changed pathname can suspend. It does not patch
history or shared router/session ownership. The destination handoff matches one
pathname, expires, cancels on user focus/input or later history events, and preserves
destination autofocus. Existing account-selector visibility is preserved; the
header wraps rather than hiding controls to satisfy geometry.

`component-third.log` retained a Back failure caused by fixture topology: App itself
subscribes to location above Suspense, while the first fixture subscribed only
inside it. Both fixtures now reproduce the outer subscription. The final protected
component run passes21/21 in4.21s (`component-final.log`, exit0), including delayed
selection/external navigation and native history Back. This does not establish
browser geometry, full application, database or production acceptance.

The first browser launch failed before any scenario: full installed Chromium
returned spawn UNKNOWN. Its unique packet is retained. The runner now accepts an
explicit executable path and hashes the exact binary it launches; parent selects
the existing1208 headless-shell used by prior runtime evidence. No dependency
download, install or browser failure suppression occurred. Browser acceptance and
full repository check remain pending until their observed results are recorded.

Actual browser verification then found issues that jsdom did not expose. The second
run passed all8 geometry scenarios and the first navigation group, but CSS hid and
blurred the closed trigger before the media-change callback, losing desktop focus.
The local helper now retains only owned focus lost through CSS hiding and releases
that ownership on intentional focus/input. The third browser run passed8 geometry
and10 focus groups, including both collapse preferences, breakpoint reversal,
intentional body/main focus preservation and dismissal/resize exit races.

That third run then failed cold lazy navigation: the Sheet was closed but its exit
portal remained mounted with body pointer-events:none after7s. The actual failure
snapshot records the closed/flex dialog and focused Accounts link. Component26/26
passes do not supersede this runtime failure. Parent authorized immediate local
SheetContent teardown only for changed-route departure before suspension; normal
dismissals and same-route selection retain their animations. No shared primitive,
App/session/router or global DOM cleanup is authorized. Fresh actual browser
acceptance and final reviews remain required; all failed packets are retained.

## Final local acceptance checkpoint

Immediate departure teardown repaired cold selection and external navigation. An
independent review then identified the same hazard when navigation begins during
Escape/Close/same-route exit. The focused actual browser RED reproduced it. The
departure guard now includes a still-mounted content ref as well as an open drawer;
wholly closed unrelated navigation remains unarmed. Normal dismissal animations
and current-breakpoint focus restoration remain intact.

Final complete browser packet:
`.local/r18-app-navigation/browser-9fa2958a-5ec9-4349-bf2d-25b9a44d4bd2/result.json`,
SHA256 `30ff40e042cd72d570dd08f86ea4c09f2744af4a95ef1e8617cc9452f85a3a9c`.
It passes all8 geometry and20 focus groups, including cold lazy selection/external
navigation, intentional destination child focus, Back, all three dismissal-to-lazy
races, breakpoint reversal, body/main focus preservation and sequential Settings
drawers. Browser errors and forbidden requests are empty; browser disconnected.
Actual selected/hashed binary was installed Chromium145.0.7632.6 headless-shell,
SHA256 `ac9bc025ed6be1ba6cf403116a68d2467c3e8da03844e642498e77cc2c799ac2`.
Parent visually inspected the320px drawer screenshot: bounded width and visible
focused Close control; remaining links are verified by actual scrolling assertions.

The first full repository check exposed test-only RTL options and MediaQueryList
mock typing errors. Its failed log remains. A minimal two-test-file correction
removed invalid RTL exact options (string names remain exact) and used a properly
typed event mock without casts. Production/browser files did not change. Final
protected components pass26/26 in5.13s (`component-types-final.log`), and the full
repository check passes (`check-types-final.log`, exit0). No baseline debt changed.

Source freeze153 files (15 owned,138 inherited unchanged):
`.local/r18-app-navigation/source-freeze-final.json`, SHA256
`ecb2d19270a94b2301bf1ea7ea9eb75d8e876fe73cd1c5cbb6f3e8aa1be31f0f`.
The freeze records review as pending at creation; subsequent independent reports
adjudicate these exact bytes. General review approves the bounded candidate with
zero unresolved findings; report SHA256
`ec9b9bc65ae56ba9eeee0c5b114444e83743d24542e68969dbfe9634d25ddcde`.
Independent TypeScript review also approves the exact15-file candidate with no
remaining actionable findings; report SHA256
`35f58036ac1fcf7bb475600a8c8260d975a961e8fa09d2036ed21721e6fd436d`.
Both reviewers inspected parent raw execution evidence and performed no test runs.
ESLint is unavailable; the repository's configured check sequence passed.

Canonical81-file evidence copy (all hashes verified, failed runs retained):
`.local/r18-app-navigation-oct30/receipt.json`, SHA256
`3cec653866473bb2b0178d0a6515361796a418135101c1711312e5e1dd3ba3c9`.

No database was started. Final process receipt confirms zero remaining recorded
browser processes, owned Node processes or relevant listeners. This is actual
component-browser evidence with inert data boundaries, not authenticated full-app,
persistence, real phone, actual browser zoom or production proof. Source remains
isolated/uncommitted pending Astra final review and canonical integration. All101
groups and the active goal remain OPEN. Next settled work is prepared in
`COMMAND-SHORTCUT-NEXT.md`; offered G-then-G Goals navigation is statically broken.

## Astra final approval and canonical integration,30 October2026

Astra High r20_graph_final_review independently approved the exact15 owned paths
at freezeecb2d192... after rechecking current source/snapshots, both prior independent
review reports, all81 receipt files and actual canonical dependencies. No inherited
138 paths were approved or copied; used dependency contracts remain compatible.
No new source findings remained. This final assessment was source-only.

Parent copied only the15 reviewed files onto canonical8e0d34c2 and ran fresh
protected focused checks:26 navigation components passed, together with19 shortcut
tests (45/45 total). The complete native browser fixture passed8 geometry and20
focus groups, including the three dismissal-to-lazy navigation races. Packet:
.local/r18-app-navigation/browser-2995cb0a-2462-4fe1-89d2-c9ecdfbf7e23.
Browser errors/forbidden requests are zero; browser disconnected, every recorded
browser process and owned listening port are absent after teardown. Parent viewed
the320px drawer screenshot: bounded panel and visible focused Close; scroll
assertions verify the remaining links. This is still an inert component fixture,
not full-app authentication, actual phone/zoom or screen-reader acceptance.

Pinned Node24.22.0 npm check passed TypeScript/all repository guards. All17 combined
navigation/shortcut source hashes match postflight. No LOC baseline debt changed.
A CLI Browserslist data-age advisory was retained; no dependency/lock update was
performed. Original failure packets and prior author results remain untouched.
Fresh canonical13-file receipt:
.local/r18-navigation-shortcut-integration-oct30/receipt.json SHA256
8c9af2db709c7704d59f5b089dc1ecd6e94d4c5140e0ee9c6f847a2fa60ef980.
Source integration closes no canonical group; all101 groups and goal remain OPEN.
